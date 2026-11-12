//! Sweeping one slice of a run: what the marks and the worker's own late marks don't keep is deleted.

mod compact;
mod late;

use std::collections::BTreeMap;
use std::time::{Duration, SystemTime};

use chrono::Utc;
use futures::stream::{self, StreamExt, TryStreamExt};
use object_store::path::Path;
use object_store::{ObjectMeta, ObjectStoreExt};

use super::bucket::{delete, old};
use super::run::Shelf;
use super::slices::{SLICES, contains, files, hashes, slice_of};
use super::walk::{commits, walk};
use super::{BATCH, Collected, Lock, PARALLELISM, held, mark};
use crate::model::Bundled;
use crate::store::gc::lock;
use crate::store::io::found;
use crate::{Error, Hash, Objects, Refs, Result};
use late::Late;

#[derive(Default)]
struct Marks {
    chunks: Vec<Hash>,
    names: Vec<Hash>,
    files: Vec<Bundled>,
}

pub(super) struct Sweep<'a> {
    objects: &'a Objects,
    refs: &'a Refs,
    grace: Duration,
    deadline: Option<SystemTime>,
    shelf: &'a Shelf<'a>,
    slices: usize,
    work: usize,
    marks: Marks,
    late: Late<'a>,
    batch: Vec<ObjectMeta>,
    pub(super) collected: Collected,
}

const PREFIXES: [&str; 5] = ["commits", "objects", "moved", "bundles", "chunks"];

impl<'a> Sweep<'a> {
    pub(super) fn new(
        objects: &'a Objects,
        refs: &'a Refs,
        grace: Duration,
        deadline: Option<SystemTime>,
        shelf: &'a Shelf<'a>,
        slices: usize,
    ) -> Self {
        Self {
            objects,
            refs,
            grace,
            deadline,
            shelf,
            slices,
            work: 0,
            marks: Marks::default(),
            late: Late::new(shelf, slices),
            batch: Vec::new(),
            collected: Collected::default(),
        }
    }

    pub(super) fn finish(mut self, missing: u64) -> Collected {
        self.collected.missing = missing + self.late.missing;
        self.collected
    }

    pub(super) async fn slice(&mut self, work: usize, lease: &mut Lock<'_>) -> Result<()> {
        let shelf = self.shelf;
        self.work = work;
        self.marks = Marks {
            chunks: hashes(&shelf.get(&format!("chunks-{work}")).await?),
            names: hashes(&shelf.get(&format!("names-{work}")).await?),
            files: files(&shelf.get(&format!("files-{work}")).await?),
        };
        let per = SLICES / self.slices;
        let store = self.objects.store().clone();
        let mut sparse = Vec::new();
        for prefix in PREFIXES {
            let start = Path::from(format!("{prefix}/{:03x}", work * per));
            let end =
                (work + 1 < self.slices).then(|| format!("{prefix}/{:03x}", (work + 1) * per));
            let mut listing = store.list_with_offset(Some(&Path::from(prefix)), &start);
            while let Some(meta) = listing.try_next().await? {
                if end
                    .as_ref()
                    .is_some_and(|end| meta.location.as_ref() >= end.as_str())
                {
                    break;
                }
                let Some(hash) = named(&meta, prefix) else {
                    self.collected.unknown += 1;
                    continue;
                };
                if prefix == "bundles" && old(&meta, Utc::now(), self.grace) && self.sparse(&meta) {
                    sparse.push(meta.clone());
                }
                if self.consider(meta, hash) {
                    self.flush(lease).await?;
                }
            }
            self.flush(lease).await?;
        }
        self.compact_all(lease, sparse).await
    }

    fn keeps(&self, meta: &ObjectMeta, hash: Hash) -> bool {
        // Marks only answer for their own slice; anything else stays.
        if slice_of(hash) / (SLICES / self.slices) != self.work {
            return true;
        }
        match meta.location.as_ref().starts_with("chunks/") {
            true => contains(&self.marks.chunks, hash) || self.late.chunks.contains(&hash),
            false => {
                contains(&self.marks.names, hash)
                    || self.late.names.contains(&hash)
                    || self.late.live.contains_key(&hash)
            }
        }
    }

    fn live(&self, bundle: Hash) -> Vec<Bundled> {
        let files = &self.marks.files;
        let start = files.partition_point(|file| file.bundle.as_bytes() < bundle.as_bytes());
        let mut live: BTreeMap<u32, Bundled> = files[start..]
            .iter()
            .take_while(|file| file.bundle == bundle)
            .map(|file| (file.offset, *file))
            .collect();
        if let Some(late) = self.late.live.get(&bundle) {
            live.extend(late.iter().map(|(&offset, &file)| (offset, file)));
        }
        live.into_values().collect()
    }

    fn sparse(&self, meta: &ObjectMeta) -> bool {
        let Some(bundle) = named(meta, "bundles") else {
            return false;
        };
        let live = self.live(bundle);
        let used: u64 = live.iter().map(|file| u64::from(file.len)).sum();
        !live.is_empty() && used * 2 < meta.size
    }

    fn consider(&mut self, meta: ObjectMeta, hash: Hash) -> bool {
        if self.keeps(&meta, hash) || !old(&meta, Utc::now(), self.grace) {
            self.collected.kept += 1;
            return false;
        }
        self.batch.push(meta);
        self.batch.len() == BATCH
    }

    fn on_time(&self) -> Result<()> {
        match self.deadline {
            Some(deadline) if SystemTime::now() >= deadline => Err(Error::Collection(
                "the collection ran past its time and stopped; run it again".into(),
            )),
            _ => Ok(()),
        }
    }

    async fn flush(&mut self, lease: &mut Lock<'_>) -> Result<()> {
        let doomed = std::mem::take(&mut self.batch);
        if doomed.is_empty() {
            return Ok(());
        }
        if lease.is_none() {
            self.collected.deleted += doomed.len() as u64;
            self.collected.deleted_bytes += doomed.iter().map(|meta| meta.size).sum::<u64>();
            return Ok(());
        }
        self.on_time()?;
        held(lease).await?;
        mark(lease, true).await?;
        let deleted = match self.owned_heads(lease).await {
            Ok(()) => self.recheck_and_delete(lease, doomed).await,
            Err(error) => Err(error),
        };
        let unmarked = mark(lease, false).await;
        deleted.and(unmarked)
    }

    async fn recheck_and_delete(
        &mut self,
        lease: &mut Lock<'_>,
        doomed: Vec<ObjectMeta>,
    ) -> Result<()> {
        let store = self.objects.store().as_ref();
        let now: Vec<Option<ObjectMeta>> = stream::iter(doomed)
            .map(|meta| async move { found(store.head(&meta.location).await) })
            .buffered(PARALLELISM)
            .try_collect()
            .await?;
        let (old_now, young): (Vec<ObjectMeta>, Vec<ObjectMeta>) = now
            .into_iter()
            .flatten()
            .partition(|meta| old(meta, Utc::now(), self.grace));
        self.collected.kept += young.len() as u64;
        let young = young
            .iter()
            .filter_map(|meta| named(meta, "commits"))
            .collect();
        let young = commits(self.objects, &mut self.late, young).await?;
        walk(self.objects, &mut self.late, young, lease).await?;
        self.late.resolve(self.objects).await?;

        let mut paths = Vec::new();
        for meta in old_now {
            let hash = PREFIXES.iter().find_map(|prefix| named(&meta, prefix));
            if hash.is_none_or(|hash| self.keeps(&meta, hash)) {
                self.collected.kept += 1;
            } else {
                self.collected.deleted += 1;
                self.collected.deleted_bytes += meta.size;
                paths.push(meta.location);
            }
        }
        held(lease).await?;
        let Some(lease) = lease else { return Ok(()) };
        lease.within(delete(store, paths)).await
    }

    // Heads that moved since marking may name more of what is about to go.
    async fn owned_heads(&mut self, lease: &mut Lock<'_>) -> Result<()> {
        if !self.refs.served() {
            return Ok(());
        }
        tokio::time::sleep(lock::VIEW_LIFETIME + Duration::from_secs(2)).await;
        held(lease).await?;
        let mut roots = Vec::new();
        for commit in self.refs.heads().await? {
            roots.push((Objects::address(&commit)?, commit));
        }
        walk(self.objects, &mut self.late, roots, lease).await?;
        self.late.resolve(self.objects).await
    }
}

fn named(meta: &ObjectMeta, prefix: &str) -> Option<Hash> {
    let (start, name) = meta.location.as_ref().split_once('/')?;
    let hash: Hash = name.parse().ok()?;
    (start == prefix && hash.to_string() == name).then_some(hash)
}
