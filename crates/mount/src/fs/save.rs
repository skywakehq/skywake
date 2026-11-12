//! Saving a mount: upload changed files and build trees for changed folders.

use std::collections::{HashMap, HashSet};
use std::io;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use futures::{StreamExt, TryStreamExt, stream};
use skywake_core::{
    Bundler, Data, Entry, Hash, INLINE_BUDGET, Objects, Tree, is_ignored, permissions,
    store_file_reusing,
};
use tokio::time::Instant;
use tracing::Instrument;

use super::state::{Content, FileLock, InHead, NodeKind, Saved, State, nanos};
use super::{BranchFs, Ino, ROOT};

const PARALLELISM: usize = 16;

pub(super) const IDLE: Duration = Duration::from_secs(30);

type Trees = Vec<(Ino, Tree, Hash)>;

// Like the collector's rule for reused data: only data written in the last day is reused without a check.
const REUSE_FOR: Duration = Duration::from_secs(24 * 3600);

pub struct Save {
    pub root: Hash,
    pub trees: Vec<Tree>,
    as_of: u64,
    started: Instant,
    as_chunks: Vec<(Ino, Vec<u8>, Data)>,
    stored: Vec<Ino>,
    uploaded: Vec<(Ino, Arc<HashSet<Hash>>)>,
}

impl Save {
    pub fn as_of(&self) -> u64 {
        self.as_of
    }
}

pub enum Snapshot {
    Folder,
    Entry(Entry),
    Local {
        path: PathBuf,
        mode: u32,
        modified: SystemTime,
    },
}

enum Snap {
    Same(Entry),
    Dir {
        ino: Ino,
        entries: Vec<(String, Snap)>,
    },
    File {
        ino: Ino,
        mode: u32,
        modified_ns: u64,
        data: Option<Data>,
    },
}

struct Frozen {
    ino: Ino,
    scratch: u64,
    lock: Arc<FileLock>,
}

impl BranchFs {
    pub fn has_changes(&self) -> bool {
        !self.state().changed.is_empty()
    }

    pub async fn save(&self, ignored: &[String]) -> io::Result<Save> {
        let _saving = self.saving.lock().await;
        let span = tracing::info_span!("save", mount = %self.name);
        let result = self.save_snapshot(ignored).instrument(span).await;
        self.record_unsaved();
        result
    }

    pub fn committed(&self, save: &Save) {
        let mut state = self.state();
        for (ino, chunks) in &save.uploaded {
            let in_head = InHead {
                chunks: chunks.clone(),
                at: save.started,
            };
            state.in_head.insert(*ino, in_head);
        }
        for (ino, bytes, data) in &save.as_chunks {
            state.store_as_chunk(*ino, bytes, data);
        }
        for ino in &save.stored {
            let same = state
                .changed
                .get(ino)
                .is_none_or(|change| *change <= save.as_of);
            if let Some(node) = state.nodes.get_mut(ino)
                && same
            {
                node.origin = true;
                state.originals.remove(ino);
            }
        }
        state.changed.retain(|_, change| *change > save.as_of);
        state.drop_ops_through(save.as_of);
        state.unsaved_since = match state.changed.is_empty() {
            true => None,
            false => Some(save.started),
        };
        self.record_unsaved_in(&state);
    }

    pub async fn snapshot(&self) -> io::Result<Vec<(String, Snapshot)>> {
        let _saving = self.saving.lock().await;
        self.thaw_leftovers().await?;
        let state = self.state();
        let mut paths = Vec::new();
        let mut next = vec![(ROOT, String::new())];
        while let Some((ino, path)) = next.pop() {
            let node = state.node(ino)?;
            let file = |data: Data| {
                Snapshot::Entry(Entry::File {
                    size: data.len(),
                    modified_ns: nanos(node.modified),
                    mode: permissions(node.mode),
                    data,
                })
            };
            let item = match &node.kind {
                NodeKind::Dir(dir) => match (&dir.children, dir.tree) {
                    (Some(children), _) => {
                        for (name, child) in children.iter() {
                            next.push((child, join(&path, name)));
                        }
                        Snapshot::Folder
                    }
                    (None, Some(tree)) => Snapshot::Entry(Entry::Dir { tree }),
                    (None, None) => Snapshot::Folder,
                },
                NodeKind::Symlink(target) => Snapshot::Entry(Entry::Symlink {
                    target: target.clone(),
                }),
                NodeKind::Special { .. } => continue,
                NodeKind::File(content @ (Content::Stored { .. } | Content::Inline(_))) => {
                    file(content.data().expect("stored or inline content has data"))
                }
                NodeKind::File(Content::Local { .. })
                    if !state.changed.contains_key(&ino) && state.saved.contains_key(&ino) =>
                {
                    file(state.saved[&ino].data.clone())
                }
                NodeKind::File(Content::Local { scratch, .. }) => Snapshot::Local {
                    path: state.scratch_path(*scratch),
                    mode: permissions(node.mode),
                    modified: node.modified,
                },
            };
            paths.push((path, item));
        }
        Ok(paths)
    }

    pub fn unsaved_bytes(&self) -> u64 {
        self.state().unsaved_bytes()
    }

    async fn thaw_leftovers(&self) -> io::Result<()> {
        let leftover: Vec<Frozen> = {
            let mut state = self.state();
            let inos: Vec<Ino> = state.frozen.iter().copied().collect();
            inos.into_iter()
                .filter_map(|ino| freeze_info(&mut state, ino))
                .collect()
        };
        for frozen in leftover {
            self.thaw(&frozen).await?;
        }
        Ok(())
    }

    async fn save_snapshot(&self, ignored: &[String]) -> io::Result<Save> {
        self.thaw_leftovers().await?;
        let idle = match self.local.is_nearly_full() {
            true => Duration::ZERO,
            false => IDLE,
        };
        self.reclaim_scratch(idle).await;

        let (mut snap, as_of, frozen, started) = {
            let mut state = self.state();
            if state.changed.is_empty() {
                return Ok(Save {
                    root: state.root_tree()?,
                    trees: Vec::new(),
                    as_of: state.changes,
                    started: Instant::now(),
                    as_chunks: Vec::new(),
                    stored: Vec::new(),
                    uploaded: Vec::new(),
                });
            }
            self.record_unsaved_in(&state);
            let mut uploads = Vec::new();
            let snap = state.capture(ROOT, "", ignored, &mut uploads)?;
            uploads.sort_unstable();
            uploads.dedup();
            let frozen: Vec<Frozen> = uploads
                .into_iter()
                .filter_map(|ino| {
                    state.frozen.insert(ino);
                    freeze_info(&mut state, ino)
                })
                .collect();
            (snap, state.changes, frozen, Instant::now())
        };
        self.finish(&mut snap, frozen, as_of, started).await
    }

    async fn finish(
        &self,
        snap: &mut Snap,
        frozen: Vec<Frozen>,
        as_of: u64,
        started: Instant,
    ) -> io::Result<Save> {
        let bundler = Bundler::new(&self.objects);
        let results: Vec<(Ino, io::Result<Data>)> = stream::iter(frozen)
            .map(|frozen| self.upload_and_thaw(frozen, &bundler))
            .buffer_unordered(PARALLELISM)
            .collect()
            .await;
        let mut uploaded = HashMap::new();
        for (ino, result) in results {
            uploaded.insert(ino, result?);
        }
        let in_head = uploaded
            .iter()
            .filter_map(|(ino, data)| match data {
                Data::Chunks(chunks) => {
                    Some((*ino, Arc::new(chunks.iter().map(|c| c.hash).collect())))
                }
                _ => None,
            })
            .collect();
        snap.fill(&uploaded);

        let mut over = Vec::new();
        snap.over_inline_budget(&mut over);
        let inline: Vec<Vec<u8>> = over
            .iter()
            .map(|(_, data)| match &**data {
                Data::Inline(bytes) => bytes.clone(),
                _ => unreachable!("only inline data is over the budget"),
            })
            .collect();
        let added: Vec<Data> = stream::iter(inline)
            .map(|bytes| bundler.add(bytes))
            .buffered(PARALLELISM)
            .try_collect()
            .await
            .map_err(io::Error::other)?;
        bundler.finish().await.map_err(io::Error::other)?;
        let mut as_chunks = Vec::new();
        for ((ino, data), added) in over.into_iter().zip(added) {
            let Data::Inline(bytes) = std::mem::replace(data, added.clone()) else {
                unreachable!()
            };
            as_chunks.push((ino, bytes, added));
        }

        let mut stored = Vec::new();
        snap.files(&mut stored);
        let mut trees = Vec::new();
        let Entry::Dir { tree: root } = assemble(std::mem::replace(snap, empty()), &mut trees)?
        else {
            unreachable!("the root is a folder")
        };

        let mut state = self.state();
        let mut new = Vec::new();
        for (ino, tree, hash) in trees {
            if let Ok(dir) = state.dir_mut(ino) {
                dir.tree = Some(hash);
            }
            new.push(tree);
        }
        for (ino, data) in uploaded {
            let same = state
                .changed
                .get(&ino)
                .is_none_or(|change| *change <= as_of);
            if same
                && matches!(
                    state.nodes.get(&ino).map(|node| &node.kind),
                    Some(NodeKind::File(Content::Local { .. }))
                )
            {
                state.saved.insert(ino, Saved { data, at: started });
            }
        }
        stored.retain(|ino| state.nodes.get(ino).is_some_and(|node| !node.origin));
        Ok(Save {
            root,
            trees: new,
            as_of,
            started,
            as_chunks,
            stored,
            uploaded: in_head,
        })
    }

    async fn upload_and_thaw(&self, frozen: Frozen, bundler: &Bundler) -> (Ino, io::Result<Data>) {
        let uploaded = self.upload(&frozen, bundler).await;
        let thawed = self.thaw(&frozen).await;
        (frozen.ino, thawed.and(uploaded))
    }

    async fn upload(&self, frozen: &Frozen, bundler: &Bundler) -> io::Result<Data> {
        drop(frozen.lock.read().await);
        let path = self.state().scratch_path(frozen.scratch);
        let size = tokio::fs::metadata(&path).await?.len();
        let in_head = self
            .state()
            .in_head
            .get(&frozen.ino)
            .filter(|in_head| in_head.at.elapsed() < REUSE_FOR)
            .map(|in_head| in_head.chunks.clone())
            .unwrap_or_default();
        store_file_reusing(&self.objects, path, size, &in_head, Some(bundler))
            .await
            .map_err(io::Error::other)
    }

    async fn thaw(&self, frozen: &Frozen) -> io::Result<()> {
        let mut overlay = frozen.lock.write().await;
        let (size, path) = {
            let state = self.state();
            (
                local_size(&state, frozen),
                state.scratch_path(frozen.scratch),
            )
        };
        if let (Some(size), Some(changes)) = (size, overlay.as_ref()) {
            let file = std::fs::File::options().write(true).open(&path)?;
            changes.apply(&file, size)?;
        }
        if let Some(changes) = overlay.take() {
            changes.remove();
        }
        let deleted = {
            let mut state = self.state();
            state.frozen.remove(&frozen.ino);
            local_size(&state, frozen).is_none()
        };
        if deleted {
            self.close_scratch(frozen.scratch);
            let _ = std::fs::remove_file(path);
        }
        Ok(())
    }

    pub fn record_unsaved(&self) {
        self.record_unsaved_in(&self.state());
    }

    pub fn clear_metrics(&self) {
        let mount = self.name.clone();
        metrics::gauge!("skywake_save_lag_seconds", "mount" => mount.clone()).set(0.0);
        metrics::gauge!("skywake_unsaved_bytes", "mount" => mount).set(0.0);
    }

    fn record_unsaved_in(&self, state: &State) {
        let lag = state
            .unsaved_since
            .map_or(0.0, |since| since.elapsed().as_secs_f64());
        let mount = self.name.clone();
        metrics::gauge!("skywake_save_lag_seconds", "mount" => mount.clone()).set(lag);
        metrics::gauge!("skywake_unsaved_bytes", "mount" => mount)
            .set(state.unsaved_bytes() as f64);
    }
}

fn local_size(state: &State, frozen: &Frozen) -> Option<u64> {
    match state.nodes.get(&frozen.ino).map(|node| &node.kind) {
        Some(NodeKind::File(Content::Local { size, scratch })) if *scratch == frozen.scratch => {
            Some(*size)
        }
        _ => None,
    }
}

fn freeze_info(state: &mut State, ino: Ino) -> Option<Frozen> {
    let NodeKind::File(Content::Local { scratch, .. }) = state.nodes.get(&ino)?.kind else {
        state.frozen.remove(&ino);
        return None;
    };
    let lock = state.file_lock(ino).ok()?;
    Some(Frozen { ino, scratch, lock })
}

fn empty() -> Snap {
    Snap::Same(Entry::Symlink {
        target: String::new(),
    })
}

impl Snap {
    fn fill(&mut self, uploaded: &HashMap<Ino, Data>) {
        match self {
            Snap::Dir { entries, .. } => {
                for (_, entry) in entries {
                    entry.fill(uploaded);
                }
            }
            Snap::File { ino, data, .. } if data.is_none() => {
                *data = uploaded.get(ino).cloned();
            }
            _ => {}
        }
    }

    fn files(&self, inos: &mut Vec<Ino>) {
        match self {
            Snap::Dir { entries, .. } => {
                for (_, entry) in entries {
                    entry.files(inos);
                }
            }
            Snap::File { ino, .. } => inos.push(*ino),
            Snap::Same(_) => {}
        }
    }

    fn over_inline_budget<'a>(&'a mut self, over: &mut Vec<(Ino, &'a mut Data)>) {
        let Snap::Dir { entries, .. } = self else {
            return;
        };
        let mut used = 0;
        for (_, entry) in entries {
            match entry {
                Snap::Dir { .. } => entry.over_inline_budget(over),
                Snap::File {
                    ino,
                    data: Some(data),
                    ..
                } => {
                    if let Data::Inline(bytes) = data {
                        used += bytes.len();
                        if used > INLINE_BUDGET {
                            over.push((*ino, data));
                        }
                    }
                }
                _ => {}
            }
        }
    }
}

fn assemble(snap: Snap, trees: &mut Trees) -> io::Result<Entry> {
    match snap {
        Snap::Same(entry) => Ok(entry),
        Snap::File {
            mode,
            modified_ns,
            data,
            ..
        } => {
            let data = data.ok_or_else(|| io::Error::other("a file was not uploaded"))?;
            Ok(Entry::File {
                size: data.len(),
                modified_ns,
                mode: permissions(mode),
                data,
            })
        }
        Snap::Dir { ino, entries } => {
            let mut tree = Tree::new();
            for (name, entry) in entries {
                tree.insert(name, assemble(entry, trees)?);
            }
            let hash = Objects::address(&tree).map_err(io::Error::other)?;
            trees.push((ino, tree, hash));
            Ok(Entry::Dir { tree: hash })
        }
    }
}

impl State {
    fn unsaved_bytes(&self) -> u64 {
        self.changed
            .keys()
            .filter_map(|ino| match &self.nodes.get(ino)?.kind {
                NodeKind::File(Content::Local { size, .. }) => Some(*size),
                NodeKind::File(Content::Inline(bytes)) => Some(bytes.len() as u64),
                _ => None,
            })
            .sum()
    }

    fn store_as_chunk(&mut self, ino: Ino, bytes: &[u8], data: &Data) {
        let Some(node) = self.nodes.get_mut(&ino) else {
            return;
        };
        match &mut node.kind {
            NodeKind::File(content @ Content::Inline(_)) => {
                if matches!(content, Content::Inline(current) if **current == *bytes) {
                    *content = super::state::stored(data);
                }
            }
            NodeKind::File(Content::Local { .. }) => {
                if let Some(saved) = self.saved.get_mut(&ino)
                    && matches!(&saved.data, Data::Inline(current) if current == bytes)
                {
                    saved.data = data.clone();
                }
            }
            _ => {}
        }
    }

    fn root_tree(&self) -> io::Result<Hash> {
        match self.dir(ROOT)?.tree {
            Some(tree) => Ok(tree),
            None => Err(io::Error::other("the root has no stored tree")),
        }
    }

    fn capture(
        &self,
        ino: Ino,
        path: &str,
        ignored: &[String],
        uploads: &mut Vec<Ino>,
    ) -> io::Result<Snap> {
        let dir = self.dir(ino)?;
        let Some(children) = &dir.children else {
            let tree = dir.tree.ok_or_else(|| io::Error::other("no tree"))?;
            return Ok(Snap::Same(Entry::Dir { tree }));
        };
        let mut changed = dir.tree.is_none() || self.changed.contains_key(&ino);
        let mut entries = Vec::new();
        for (name, child) in children.iter() {
            let child_path = join(path, name);
            if is_ignored(ignored, &child_path) {
                if let Some(entry) = self.branch_entry(child)? {
                    entries.push((name.clone(), Snap::Same(entry)));
                }
                continue;
            }
            changed |= self.changed.contains_key(&child);
            if let Some(entry) = self.capture_entry(child, &child_path, ignored, uploads)? {
                changed |= matches!(entry, Snap::Dir { .. });
                entries.push((name.clone(), entry));
            }
        }
        match dir.tree {
            Some(tree) if !changed => Ok(Snap::Same(Entry::Dir { tree })),
            _ => Ok(Snap::Dir { ino, entries }),
        }
    }

    fn branch_entry(&self, ino: Ino) -> io::Result<Option<Entry>> {
        let node = self.node(ino)?;
        Ok(match &node.kind {
            NodeKind::Dir(dir) => dir.tree.map(|tree| Entry::Dir { tree }),
            _ if node.origin => self.entry(ino),
            _ => self.originals.get(&ino).cloned(),
        })
    }

    fn capture_entry(
        &self,
        ino: Ino,
        path: &str,
        ignored: &[String],
        uploads: &mut Vec<Ino>,
    ) -> io::Result<Option<Snap>> {
        let node = self.node(ino)?;
        let data = match &node.kind {
            NodeKind::Dir(_) => return self.capture(ino, path, ignored, uploads).map(Some),
            NodeKind::Symlink(target) => {
                let target = target.clone();
                return Ok(Some(Snap::Same(Entry::Symlink { target })));
            }
            NodeKind::Special { .. } => return Ok(None),
            NodeKind::File(content @ (Content::Stored { .. } | Content::Inline(_))) => {
                content.data()
            }
            NodeKind::File(Content::Local { .. }) => match self.saved.get(&ino) {
                Some(saved) if !self.changed.contains_key(&ino) => Some(saved.data.clone()),
                _ => {
                    uploads.push(ino);
                    None
                }
            },
        };
        Ok(Some(Snap::File {
            ino,
            mode: node.mode,
            modified_ns: nanos(node.modified),
            data,
        }))
    }
}

fn join(dir: &str, name: &str) -> String {
    if dir.is_empty() {
        name.to_string()
    } else {
        format!("{dir}/{name}")
    }
}
