//! Garbage collection of an index.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use futures::{StreamExt, TryStreamExt, stream};
use object_store::path::Path;
use object_store::prefix::PrefixStore;
use object_store::{ObjectMeta, ObjectStore, ObjectStoreExt};
use skywake_core::lock::{self, Lease};
use skywake_core::kind::{Kind, require};
use skywake_core::{Hash, Objects};

pub use skywake_core::Collected;

use serde::de::DeserializeOwned;

use crate::format::cluster::ClusterRef;
use crate::format::directory::Directory;
use crate::format::pages::Pages;
use crate::format::{SegmentRef, Version, decode_version};
use crate::store::head::{self, DELETED};
use crate::store::object_path;
use crate::{Error, Result};

const PARALLELISM: usize = 64;

const BATCH: usize = 1000;

pub const HISTORY: Duration = Duration::from_secs(7 * 24 * 60 * 60);

pub async fn collect(
    store: Arc<dyn ObjectStore>,
    grace: Duration,
    dry_run: bool,
) -> Result<Collected> {
    require(store.as_ref(), Kind::Index).await?;
    collect_keeping(store, grace, Some(HISTORY), dry_run).await
}

pub async fn collect_index(
    store: Arc<dyn ObjectStore>,
    grace: Duration,
    keep: Duration,
    dry_run: bool,
) -> Result<Collected> {
    // Never sweep a filesystem's folder: none of its roots are ours to see.
    require(store.as_ref(), Kind::Index).await?;
    let folders = shard_folders(store.as_ref()).await?;
    if folders.is_empty() {
        return collect_keeping(store, grace, Some(keep), dry_run).await;
    }
    let mut total = Collected::default();
    for folder in folders {
        let shard = Arc::new(PrefixStore::new(store.clone(), folder));
        let collected = collect_keeping(shard, grace, Some(keep), dry_run).await?;
        total.kept += collected.kept;
        total.deleted += collected.deleted;
        total.deleted_bytes += collected.deleted_bytes;
        total.missing += collected.missing;
        total.unknown += collected.unknown;
    }
    Ok(total)
}

async fn shard_folders(store: &dyn ObjectStore) -> Result<Vec<Path>> {
    let listed = store
        .list_with_delimiter(Some(&Path::from("shards")))
        .await?;
    let mut folders = listed.common_prefixes;
    folders.sort();
    Ok(folders)
}

pub async fn collect_keeping(
    store: Arc<dyn ObjectStore>,
    grace: Duration,
    keep: Option<Duration>,
    dry_run: bool,
) -> Result<Collected> {
    let started = Instant::now();
    let objects = Objects::new(store.clone());
    let store = store.as_ref();
    let mut roots = heads(store).await?;
    let mut expired = Vec::new();
    for meta in listed(store, DELETED).await? {
        match old(&meta, Utc::now(), grace) {
            true => expired.push(meta.location),
            false => roots.extend(hash(&meta)),
        }
    }
    let mut reachable = Reachable::default();
    let cutoff = keep.map(|keep| Utc::now() - keep);
    reachable.walk(&objects, store, roots, cutoff).await?;
    if !grace.is_zero() && started.elapsed() > grace / 2 {
        return Err(Error::Core(skywake_core::Error::Collection(
            "marking took longer than half the grace period; nothing was deleted".into(),
        )));
    }

    let lease = match dry_run {
        true => None,
        false => Some(Lease::take(store).await?),
    };
    let mut sweep = Sweep {
        store,
        objects: &objects,
        reachable,
        grace,
        lease,
        collected: Collected::default(),
        batch: Vec::new(),
    };
    let mut swept = sweep.run().await;
    let (mut lease, mut collected, reachable) = (sweep.lease, sweep.collected, sweep.reachable);
    if swept.is_ok()
        && let Some(lease) = &mut lease
        && !expired.is_empty()
    {
        swept = remove(store, lease, expired).await;
    }
    if let Some(lease) = lease {
        lease.release().await;
    }
    swept?;
    collected.missing = reachable.missing;
    Ok(collected)
}

pub(crate) async fn used_by(
    store: Arc<dyn ObjectStore>,
    version: &Version,
) -> Result<HashSet<Hash>> {
    let mut reachable = Reachable::default();
    reachable.mark(&Objects::new(store), version).await?;
    Ok(reachable.blobs)
}

pub(crate) async fn all_there(store: &dyn ObjectStore, wanted: &HashSet<Hash>) -> Result<bool> {
    let found: HashSet<Hash> = (paths_of(store, wanted).await?.iter())
        .filter_map(|path| path.filename()?.parse().ok())
        .collect();
    Ok(found.len() == wanted.len())
}

async fn heads(store: &dyn ObjectStore) -> Result<Vec<Hash>> {
    let branches = head::list(store).await?;
    let heads: Vec<_> = stream::iter(branches)
        .map(|branch| async move { head::read(store, &branch).await })
        .buffer_unordered(PARALLELISM)
        .try_collect()
        .await?;
    Ok(heads
        .into_iter()
        .flatten()
        .map(|head| head.version)
        .collect())
}

pub(crate) async fn paths_of(store: &dyn ObjectStore, wanted: &HashSet<Hash>) -> Result<Vec<Path>> {
    let mut paths = Vec::new();
    for prefix in ["objects", "chunks", "blobs"] {
        let mut listing = store.list(Some(&Path::from(prefix)));
        while let Some(meta) = listing.try_next().await? {
            if hash(&meta).is_some_and(|hash| wanted.contains(&hash)) {
                paths.push(meta.location);
            }
        }
    }
    Ok(paths)
}

#[derive(Default)]
struct Reachable {
    blobs: HashSet<Hash>,
    missing: u64,
}

impl Reachable {
    async fn walk(
        &mut self,
        objects: &Objects,
        store: &dyn ObjectStore,
        roots: Vec<Hash>,
        cutoff: Option<DateTime<Utc>>,
    ) -> Result<()> {
        let mut level = roots;
        while !level.is_empty() {
            let todo: Vec<Hash> = level
                .into_iter()
                .filter(|h| self.blobs.insert(*h))
                .collect();
            let found = fetch(todo, |hash| async move {
                let raw = objects.get_raw(hash).await?;
                let before = match cutoff {
                    None => true,
                    Some(cutoff) => {
                        let meta = store.head(&object_path(hash)).await?;
                        meta.last_modified >= cutoff
                    }
                };
                Ok((raw, before))
            })
            .await?;
            level = Vec::new();
            for found in found {
                let Some((raw, before)) = found else {
                    self.missing += 1;
                    continue;
                };
                let version = decode_version(&raw)?;
                self.mark(objects, &version).await?;
                level.extend(version.parent.filter(|_| before));
            }
        }
        Ok(())
    }

    async fn heads(&mut self, objects: &Objects, store: &dyn ObjectStore) -> Result<()> {
        let new: Vec<Hash> = (heads(store).await?.into_iter())
            .filter(|h| self.blobs.insert(*h))
            .collect();
        for raw in fetch(new, |hash| objects.get_raw(hash)).await? {
            match raw {
                Some(raw) => self.mark(objects, &decode_version(&raw)?).await?,
                None => self.missing += 1,
            }
        }
        Ok(())
    }

    async fn mark(&mut self, objects: &Objects, version: &Version) -> Result<()> {
        self.blobs
            .extend(version.tail.iter().map(|segment| segment.hash));
        for page in self.pages::<SegmentRef>(objects, &version.built).await? {
            self.blobs.extend(page.iter().map(|segment| segment.hash));
        }
        for part in version.text.iter().flat_map(|text| &text.parts) {
            self.blobs.insert(part.hot);
            self.blobs.extend(part.blobs.iter().copied());
            self.blobs.extend(part.dead);
        }
        let Some(ann) = &version.ann else {
            return Ok(());
        };
        self.blobs.extend(ann.rows.iter().copied());
        self.blobs.insert(ann.filters);
        for part in ann.parts.values() {
            self.blobs.insert(part.directory);
            self.blobs.extend(part.blobs.iter().copied());
        }
        for column in ann.columns.values() {
            self.blobs.insert(column.centroids);
            self.blobs.extend(column.origin);
            for page in self.pages::<ClusterRef>(objects, &column.table).await? {
                self.blobs.extend(page.iter().map(|cluster| cluster.hash));
            }
            // Only the directory names its pages and slots, so a missed mark here deletes them.
            for directory in self.chunks::<Directory>(objects, column.directory).await? {
                self.blobs.extend(directory.pages);
                self.blobs.extend(directory.slots.hashes);
            }
        }
        Ok(())
    }

    async fn pages<T: DeserializeOwned>(
        &mut self,
        objects: &Objects,
        pages: &Pages,
    ) -> Result<Vec<Vec<T>>> {
        self.chunks(objects, pages.hashes.iter().copied()).await
    }

    async fn chunks<T: DeserializeOwned>(
        &mut self,
        objects: &Objects,
        hashes: impl IntoIterator<Item = Hash>,
    ) -> Result<Vec<T>> {
        let todo: Vec<Hash> = (hashes.into_iter())
            .filter(|h| self.blobs.insert(*h))
            .collect();
        let found = fetch(todo, |hash| async move {
            Ok(postcard::from_bytes(&objects.get_chunk(hash).await?)?)
        })
        .await?;
        self.missing += found.iter().filter(|page| page.is_none()).count() as u64;
        Ok(found.into_iter().flatten().collect())
    }
}

async fn fetch<T, F>(hashes: Vec<Hash>, get: impl Fn(Hash) -> F) -> Result<Vec<Option<T>>>
where
    F: Future<Output = skywake_core::Result<T>>,
{
    stream::iter(hashes)
        .map(|hash| {
            let got = get(hash);
            async move {
                match got.await {
                    Ok(found) => Ok(Some(found)),
                    Err(skywake_core::Error::Store(object_store::Error::NotFound { .. })) => {
                        Ok(None)
                    }
                    Err(error) => Err(Error::from(error)),
                }
            }
        })
        .buffer_unordered(PARALLELISM)
        .try_collect()
        .await
}

struct Sweep<'a> {
    store: &'a dyn ObjectStore,
    objects: &'a Objects,
    reachable: Reachable,
    grace: Duration,
    lease: Option<Lease<'a>>,
    collected: Collected,
    batch: Vec<ObjectMeta>,
}

impl Sweep<'_> {
    async fn run(&mut self) -> Result<()> {
        let now = Utc::now();
        for prefix in ["objects", "chunks", "blobs"] {
            let mut listing = self.store.list(Some(&Path::from(prefix)));
            while let Some(meta) = listing.try_next().await? {
                let Some(hash) = hash(&meta) else {
                    self.collected.unknown += 1;
                    continue;
                };
                if self.reachable.blobs.contains(&hash) || !old(&meta, now, self.grace) {
                    self.collected.kept += 1;
                    continue;
                }
                self.batch.push(meta);
                if self.batch.len() == BATCH {
                    self.flush().await?;
                }
            }
            self.flush().await?;
        }
        Ok(())
    }

    async fn flush(&mut self) -> Result<()> {
        let mut doomed = std::mem::take(&mut self.batch);
        if doomed.is_empty() {
            return Ok(());
        }
        let Some(lease) = &mut self.lease else {
            self.collected.deleted += doomed.len() as u64;
            self.collected.deleted_bytes += doomed.iter().map(|meta| meta.size).sum::<u64>();
            return Ok(());
        };
        if !lease.keep().await {
            return Err(lock::lost().into());
        }
        lease.deleting(true).await?;
        let deleted = match self.reachable.heads(self.objects, self.store).await {
            Ok(()) => {
                let reachable = &self.reachable.blobs;
                let before = doomed.len();
                doomed.retain(|meta| hash(meta).is_none_or(|hash| !reachable.contains(&hash)));
                self.collected.kept += (before - doomed.len()) as u64;
                recheck_and_delete(self.store, lease, self.grace, &mut self.collected, doomed).await
            }
            Err(error) => Err(error),
        };
        let unmarked = lease.deleting(false).await.map_err(Error::from);
        deleted.and(unmarked)
    }
}

async fn recheck_and_delete(
    store: &dyn ObjectStore,
    lease: &mut Lease<'_>,
    grace: Duration,
    collected: &mut Collected,
    doomed: Vec<ObjectMeta>,
) -> Result<()> {
    let now: Vec<Option<ObjectMeta>> = stream::iter(doomed)
        .map(|meta| async move {
            match store.head(&meta.location).await {
                Ok(meta) => Ok(Some(meta)),
                Err(object_store::Error::NotFound { .. }) => Ok(None),
                Err(error) => Err(error),
            }
        })
        .buffered(PARALLELISM)
        .try_collect()
        .await?;
    let mut paths = Vec::new();
    for meta in now.into_iter().flatten() {
        if old(&meta, Utc::now(), grace) {
            collected.deleted += 1;
            collected.deleted_bytes += meta.size;
            paths.push(meta.location);
        } else {
            collected.kept += 1;
        }
    }
    if !lease.keep().await {
        return Err(lock::lost().into());
    }
    Ok(lease.within(delete(store, paths)).await?)
}

async fn remove(store: &dyn ObjectStore, lease: &mut Lease<'_>, paths: Vec<Path>) -> Result<()> {
    if !lease.keep().await {
        return Err(lock::lost().into());
    }
    lease.deleting(true).await?;
    let deleted = lease.within(delete(store, paths)).await;
    let unmarked = lease.deleting(false).await;
    Ok(deleted.and(unmarked)?)
}

async fn delete(store: &dyn ObjectStore, paths: Vec<Path>) -> skywake_core::Result<()> {
    if paths.is_empty() {
        return Ok(());
    }
    let paths = stream::iter(paths.into_iter().map(Ok)).boxed();
    store
        .delete_stream(paths)
        .try_for_each(|_| async { Ok(()) })
        .await?;
    Ok(())
}

async fn listed(store: &dyn ObjectStore, prefix: &str) -> Result<Vec<ObjectMeta>> {
    Ok(store.list(Some(&Path::from(prefix))).try_collect().await?)
}

fn old(meta: &ObjectMeta, now: DateTime<Utc>, grace: Duration) -> bool {
    (now - meta.last_modified)
        .to_std()
        .is_ok_and(|age| age >= grace)
}

fn hash(meta: &ObjectMeta) -> Option<Hash> {
    meta.location.filename().and_then(|name| name.parse().ok())
}
