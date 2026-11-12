//! The mount's in-memory tree, and what changed since the last save.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::io;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use skywake_core::{Bundled, Chunk, Data, Entry, Hash, permissions};
use tokio::time::Instant;

use super::log::OpLog;
use super::overlay::Overlay;
use super::{Attr, Ino, Kind, ROOT, errno};

const NAME_MAX: usize = 255;

pub(super) type FileLock = tokio::sync::RwLock<Option<Overlay>>;

pub(super) struct State {
    pub(super) nodes: HashMap<Ino, Node>,
    pub(super) next_ino: Ino,
    pub(super) refs: HashMap<Ino, u64>,
    pub(super) orphans: HashSet<Ino>,
    pub(super) changes: u64,
    pub(super) changed: HashMap<Ino, u64>,
    pub(super) unsaved_since: Option<Instant>,
    pub(super) saved: HashMap<Ino, Saved>,
    pub(super) in_head: HashMap<Ino, InHead>,
    pub(super) originals: HashMap<Ino, Entry>,
    pub(super) files: HashMap<Ino, Arc<FileLock>>,
    pub(super) frozen: HashSet<Ino>,
    pub(super) next_scratch: u64,
    pub(super) scratch: PathBuf,
    pub(super) names: HashMap<Ino, (Ino, String)>,
    pub(super) log: Option<OpLog>,
}

#[derive(Default)]
pub(super) struct Garbage {
    pub(super) scratch: Vec<u64>,
    pub(super) paths: Vec<PathBuf>,
    pub(super) bytes: u64,
}

pub(super) struct LocalBytes {
    used: AtomicU64,
    pub(super) limit: u64,
}

impl LocalBytes {
    pub(super) fn new(limit: u64) -> Self {
        Self {
            used: AtomicU64::new(0),
            limit,
        }
    }

    pub(super) fn used(&self) -> u64 {
        self.used.load(Ordering::Relaxed)
    }

    #[allow(deprecated)]
    pub(super) fn take(&self, bytes: u64) -> io::Result<()> {
        if bytes == 0 {
            return Ok(());
        }
        self.used
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |used| {
                let next = used.checked_add(bytes)?;
                (self.limit == 0 || next <= self.limit).then_some(next)
            })
            .map(drop)
            .map_err(|_| errno(libc::ENOSPC))
    }

    #[allow(deprecated)]
    pub(super) fn give_back(&self, bytes: u64) {
        if bytes > 0 {
            let _ = self
                .used
                .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |used| {
                    Some(used.saturating_sub(bytes))
                });
        }
    }

    pub(super) fn settle(&self, node: &mut Node, bytes: u64, taken: u64) {
        let before = std::mem::replace(&mut node.on_disk, bytes) + taken;
        if bytes > before {
            self.used.fetch_add(bytes - before, Ordering::Relaxed);
        } else {
            self.give_back(before - bytes);
        }
    }

    pub(super) fn is_nearly_full(&self) -> bool {
        self.limit > 0 && self.used() > self.limit / 4 * 3
    }
}

pub(super) struct InHead {
    pub(super) chunks: Arc<HashSet<Hash>>,
    pub(super) at: Instant,
}

pub(super) struct Saved {
    pub(super) data: Data,
    pub(super) at: Instant,
}

pub(super) struct Node {
    pub(super) kind: NodeKind,
    pub(super) mode: u32,
    pub(super) uid: Option<u32>,
    pub(super) gid: Option<u32>,
    pub(super) nlink: u32,
    pub(super) modified: SystemTime,
    pub(super) accessed: Option<SystemTime>,
    pub(super) changed: SystemTime,
    pub(super) xattrs: Option<BTreeMap<Vec<u8>, Vec<u8>>>,
    pub(super) on_disk: u64,
    pub(super) origin: bool,
}

pub(super) enum NodeKind {
    Dir(Dir),
    File(Content),
    Symlink(String),
    Special { kind: Kind, rdev: u32 },
}

pub(super) struct Dir {
    pub(super) tree: Option<Hash>,
    pub(super) children: Option<Children>,
    pub(super) parent: Ino,
    pub(super) name: String,
}

#[derive(Clone)]
pub(super) enum Content {
    Stored {
        size: u64,
        chunks: Arc<[(u64, Chunk)]>,
        bundled: Option<Bundled>,
    },
    Inline(Arc<[u8]>),
    Local {
        size: u64,
        scratch: u64,
    },
}

#[derive(Default)]
pub(super) struct Children {
    by_name: BTreeMap<String, Child>,
    by_position: BTreeMap<u64, String>,
    next_position: u64,
    folders: u32,
}

#[derive(Clone, Copy)]
struct Child {
    ino: Ino,
    is_dir: bool,
    position: u64,
}

pub(super) const FIRST_POSITION: u64 = 3;

impl Children {
    pub(super) fn get(&self, name: &str) -> Option<Ino> {
        self.by_name.get(name).map(|child| child.ino)
    }

    pub(super) fn contains(&self, name: &str) -> bool {
        self.by_name.contains_key(name)
    }

    pub(super) fn insert(&mut self, name: &str, ino: Ino, is_dir: bool) {
        self.remove(name);
        let position = self.next_position.max(FIRST_POSITION);
        self.next_position = position + 1;
        let child = Child {
            ino,
            is_dir,
            position,
        };
        self.by_name.insert(name.to_string(), child);
        self.by_position.insert(position, name.to_string());
        self.folders += u32::from(is_dir);
    }

    pub(super) fn remove(&mut self, name: &str) -> Option<Ino> {
        let child = self.by_name.remove(name)?;
        self.by_position.remove(&child.position);
        self.folders -= u32::from(child.is_dir);
        Some(child.ino)
    }

    pub(super) fn is_empty(&self) -> bool {
        self.by_name.is_empty()
    }

    pub(super) fn iter(&self) -> impl Iterator<Item = (&String, Ino)> {
        self.by_name.iter().map(|(name, child)| (name, child.ino))
    }

    pub(super) fn after(&self, position: u64) -> impl Iterator<Item = (u64, &String, Ino)> {
        self.by_position
            .range(position + 1..)
            .map(|(&position, name)| (position, name, self.by_name[name].ino))
    }
}

impl State {
    pub(super) fn new(scratch: PathBuf, root: Hash) -> Self {
        let root = Node::new(
            NodeKind::Dir(Dir {
                tree: Some(root),
                children: None,
                parent: ROOT,
                name: String::new(),
            }),
            0o755,
            None,
        );
        State {
            nodes: HashMap::from([(ROOT, root)]),
            next_ino: ROOT + 1,
            refs: HashMap::new(),
            orphans: HashSet::new(),
            changes: 0,
            changed: HashMap::new(),
            unsaved_since: None,
            saved: HashMap::new(),
            in_head: HashMap::new(),
            originals: HashMap::new(),
            files: HashMap::new(),
            frozen: HashSet::new(),
            next_scratch: 0,
            scratch,
            names: HashMap::new(),
            log: None,
        }
    }

    pub(super) fn touch(&mut self, ino: Ino) {
        self.changes += 1;
        self.changed.insert(ino, self.changes);
        self.unsaved_since.get_or_insert_with(Instant::now);
    }

    pub(super) fn leave_branch(&mut self, ino: Ino) {
        let Some(node) = self.nodes.get_mut(&ino) else {
            return;
        };
        if !std::mem::take(&mut node.origin) {
            return;
        }
        if let Some(entry) = self.entry(ino) {
            self.originals.insert(ino, entry);
        }
    }

    pub(super) fn entry(&self, ino: Ino) -> Option<Entry> {
        let node = self.nodes.get(&ino)?;
        let data = match &node.kind {
            NodeKind::Symlink(target) => {
                let target = target.clone();
                return Some(Entry::Symlink { target });
            }
            NodeKind::File(content @ (Content::Stored { .. } | Content::Inline(_))) => {
                content.data()?
            }
            NodeKind::File(Content::Local { .. }) => self.saved.get(&ino)?.data.clone(),
            _ => return None,
        };
        Some(Entry::File {
            size: data.len(),
            modified_ns: nanos(node.modified),
            mode: permissions(node.mode),
            data,
        })
    }

    pub(super) fn allocate(&mut self) -> Ino {
        self.next_ino += 1;
        self.next_ino - 1
    }

    pub(super) fn path_ino(&mut self, path: &str) -> Ino {
        let hash = blake3::hash(path.as_bytes());
        let bits = u64::from_le_bytes(hash.as_bytes()[..8].try_into().unwrap());
        let ino = (bits >> 2) | (1 << 62);
        if self.nodes.contains_key(&ino) {
            return self.allocate();
        }
        ino
    }

    pub(super) fn scratch_path(&self, scratch: u64) -> PathBuf {
        self.scratch.join(scratch.to_string())
    }

    pub(super) fn inline_copy_path(&self, ino: Ino) -> PathBuf {
        self.scratch.join(format!("{ino}.inline"))
    }

    pub(super) fn file_lock(&mut self, ino: Ino) -> io::Result<Arc<FileLock>> {
        match self.node(ino)?.kind {
            NodeKind::File(_) => Ok(self.files.entry(ino).or_default().clone()),
            NodeKind::Dir(_) => Err(errno(libc::EISDIR)),
            _ => Err(errno(libc::EINVAL)),
        }
    }

    pub(super) fn changing_file(&mut self, ino: Ino) -> io::Result<Arc<FileLock>> {
        let lock = self.file_lock(ino)?;
        self.leave_branch(ino);
        Ok(lock)
    }

    pub(super) fn node(&self, ino: Ino) -> io::Result<&Node> {
        self.nodes.get(&ino).ok_or_else(|| errno(libc::ENOENT))
    }

    pub(super) fn node_mut(&mut self, ino: Ino) -> io::Result<&mut Node> {
        self.nodes.get_mut(&ino).ok_or_else(|| errno(libc::ENOENT))
    }

    pub(super) fn dir(&self, ino: Ino) -> io::Result<&Dir> {
        match &self.node(ino)?.kind {
            NodeKind::Dir(dir) => Ok(dir),
            _ => Err(errno(libc::ENOTDIR)),
        }
    }

    pub(super) fn dir_mut(&mut self, ino: Ino) -> io::Result<&mut Dir> {
        match &mut self.node_mut(ino)?.kind {
            NodeKind::Dir(dir) => Ok(dir),
            _ => Err(errno(libc::ENOTDIR)),
        }
    }

    pub(super) fn children(&self, ino: Ino) -> io::Result<&Children> {
        self.dir(ino)?
            .children
            .as_ref()
            .ok_or_else(|| errno(libc::EIO))
    }

    pub(super) fn children_mut(&mut self, ino: Ino) -> io::Result<&mut Children> {
        self.dir_mut(ino)?
            .children
            .as_mut()
            .ok_or_else(|| errno(libc::EIO))
    }

    pub(super) fn child(&self, parent: Ino, name: &str) -> io::Result<Ino> {
        check_name(name)?;
        self.children(parent)?
            .get(name)
            .ok_or_else(|| errno(libc::ENOENT))
    }

    pub(super) fn is_dir(&self, ino: Ino) -> bool {
        matches!(
            self.nodes.get(&ino).map(|node| &node.kind),
            Some(NodeKind::Dir(_))
        )
    }

    pub(super) fn path(&self, mut ino: Ino) -> io::Result<String> {
        let mut names = Vec::new();
        while ino != ROOT {
            let dir = self.dir(ino)?;
            names.push(dir.name.as_str());
            ino = dir.parent;
        }
        names.reverse();
        Ok(names.join("/"))
    }

    pub(super) fn is_inside(&self, mut ino: Ino, ancestor: Ino) -> io::Result<bool> {
        loop {
            if ino == ancestor {
                return Ok(true);
            }
            if ino == ROOT {
                return Ok(false);
            }
            ino = self.dir(ino)?.parent;
        }
    }

    pub(super) fn attach(&mut self, parent: Ino, name: &str, ino: Ino) -> io::Result<()> {
        let is_dir = self.is_dir(ino);
        match &mut self.node_mut(ino)?.kind {
            NodeKind::Dir(dir) => {
                dir.parent = parent;
                dir.name = name.to_string();
            }
            _ => {
                self.names.insert(ino, (parent, name.to_string()));
            }
        }
        self.children_mut(parent)?.insert(name, ino, is_dir);
        self.changed_entries(parent)
    }

    pub(super) fn detach(
        &mut self,
        parent: Ino,
        name: &str,
        garbage: &mut Garbage,
    ) -> io::Result<()> {
        let Some(ino) = self.children_mut(parent)?.remove(name) else {
            return Err(errno(libc::ENOENT));
        };
        self.changed_entries(parent)?;
        if self
            .names
            .get(&ino)
            .is_some_and(|(at, called)| *at == parent && called == name)
        {
            self.names.remove(&ino);
        }
        self.unlink_node(ino, garbage);
        Ok(())
    }

    fn unlink_node(&mut self, ino: Ino, garbage: &mut Garbage) {
        let Some(node) = self.nodes.get_mut(&ino) else {
            return;
        };
        node.nlink = node.nlink.saturating_sub(1);
        node.changed = SystemTime::now();
        if node.nlink > 0 {
            return;
        }
        if self.refs.contains_key(&ino) {
            self.orphans.insert(ino);
        } else {
            self.free(ino, garbage);
        }
    }

    pub(super) fn free(&mut self, ino: Ino, garbage: &mut Garbage) {
        self.orphans.remove(&ino);
        self.changed.remove(&ino);
        self.saved.remove(&ino);
        self.in_head.remove(&ino);
        self.originals.remove(&ino);
        self.files.remove(&ino);
        self.names.remove(&ino);
        let Some(node) = self.nodes.remove(&ino) else {
            return;
        };
        garbage.bytes += node.on_disk;
        match node.kind {
            NodeKind::Dir(Dir {
                children: Some(children),
                ..
            }) => {
                for (_, child) in children.iter() {
                    self.unlink_node(child, garbage);
                }
            }
            NodeKind::File(Content::Local { .. }) if self.frozen.contains(&ino) => {}
            NodeKind::File(Content::Local { scratch, .. }) => garbage.scratch.push(scratch),
            NodeKind::File(Content::Inline(_)) => garbage.paths.push(self.inline_copy_path(ino)),
            NodeKind::File(_) if node.on_disk > 0 => garbage.paths.push(self.inline_copy_path(ino)),
            _ => {}
        }
    }

    pub(super) fn changed_entries(&mut self, ino: Ino) -> io::Result<()> {
        let now = SystemTime::now();
        let node = self.node_mut(ino)?;
        node.modified = now;
        node.changed = now;
        self.touch(ino);
        Ok(())
    }
}

pub(super) fn check_name(name: &str) -> io::Result<()> {
    if name.len() > NAME_MAX {
        return Err(errno(libc::ENAMETOOLONG));
    }
    if name.is_empty() || name == "." || name == ".." || name.contains('/') {
        return Err(errno(libc::EINVAL));
    }
    Ok(())
}

impl Node {
    pub(super) fn new(kind: NodeKind, mode: u32, owner: Option<(u32, u32)>) -> Self {
        let now = SystemTime::now();
        Self {
            kind,
            mode: mode & 0o7777,
            uid: owner.map(|(uid, _)| uid),
            gid: owner.map(|(_, gid)| gid),
            nlink: 1,
            modified: now,
            accessed: None,
            changed: now,
            xattrs: None,
            on_disk: 0,
            origin: false,
        }
    }

    pub(super) fn from_entry(entry: Entry, parent: Ino, name: &str) -> Self {
        let directory_time = SystemTime::now();
        let (kind, mode, modified) = match entry {
            Entry::File {
                modified_ns,
                mode,
                data,
                ..
            } => {
                let modified = UNIX_EPOCH + Duration::from_nanos(modified_ns);
                (NodeKind::File(stored(&data)), mode, modified)
            }
            Entry::Dir { tree } => {
                let dir = Dir {
                    tree: Some(tree),
                    children: None,
                    parent,
                    name: name.to_string(),
                };
                (NodeKind::Dir(dir), 0o755, directory_time)
            }
            Entry::Symlink { target } => (NodeKind::Symlink(target), 0o777, directory_time),
        };
        Node {
            kind,
            mode: mode & 0o7777,
            uid: None,
            gid: None,
            nlink: 1,
            modified,
            accessed: None,
            changed: modified,
            xattrs: None,
            on_disk: 0,
            origin: true,
        }
    }

    pub(super) fn attr(&self, ino: Ino) -> Attr {
        let (kind, size, rdev) = match &self.kind {
            NodeKind::Dir(_) => (Kind::Dir, 4096, 0),
            NodeKind::File(Content::Stored { size, .. } | Content::Local { size, .. }) => {
                (Kind::File, *size, 0)
            }
            NodeKind::File(Content::Inline(bytes)) => (Kind::File, bytes.len() as u64, 0),
            NodeKind::Symlink(target) => (Kind::Symlink, target.len() as u64, 0),
            NodeKind::Special { kind, rdev } => (*kind, 0, *rdev),
        };
        let nlink = match &self.kind {
            NodeKind::Dir(Dir {
                children: Some(children),
                ..
            }) => 2 + children.folders,
            NodeKind::Dir(_) => 1,
            _ => self.nlink,
        };
        Attr {
            ino,
            kind,
            size,
            mode: self.mode,
            nlink,
            uid: self.uid,
            gid: self.gid,
            rdev,
            modified: self.modified,
            accessed: self.accessed.unwrap_or(self.modified),
            changed: self.changed,
        }
    }
}

pub(super) fn nanos(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_nanos() as u64)
}

pub(super) fn stored(data: &Data) -> Content {
    if let Data::Inline(bytes) = data {
        return Content::Inline(bytes.as_slice().into());
    }
    let mut start = 0;
    let chunks = data
        .chunks()
        .iter()
        .map(|chunk| {
            start += u64::from(chunk.size);
            (start - u64::from(chunk.size), *chunk)
        })
        .collect();
    Content::Stored {
        size: data.len(),
        chunks,
        bundled: match data {
            Data::Bundled(bundled) => Some(*bundled),
            _ => None,
        },
    }
}

impl Content {
    pub(super) fn data(&self) -> Option<Data> {
        match self {
            Content::Stored {
                bundled: Some(bundled),
                ..
            } => Some(Data::Bundled(*bundled)),
            Content::Stored { chunks, .. } => Some(Data::Chunks(
                chunks.iter().map(|(_, chunk)| *chunk).collect(),
            )),
            Content::Inline(bytes) => Some(Data::Inline(bytes.to_vec())),
            Content::Local { .. } => None,
        }
    }
}
