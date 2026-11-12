//! Reading and writing an index's objects.

pub(crate) mod cache;
pub(crate) mod head;
pub(crate) mod reads;

use cache::Cache;
use head::{Head, Hint};
use reads::From;

use std::io;
use std::ops::Range;
use std::sync::Arc;
use std::time::SystemTime;

use async_trait::async_trait;
use futures::{StreamExt, TryStreamExt, stream};
use object_store::path::Path;
use object_store::{ObjectStore, ObjectStoreExt};
use serde::de::DeserializeOwned;
use skywake_core::cache::{ChunkCache, Shared, Source};
use skywake_core::{Hash, Objects, lock};
use tokio::sync::Semaphore;

use crate::filter::Directory;
use crate::filter::attrs::Attrs;
use crate::format::cluster::{ClusterRef, Codes};
use crate::format::directory;
use crate::format::{Clusters, Segment, Version, decode_version};
use crate::vector::ivf;
use crate::{Error, Result, text};

const SAVE_ATTEMPTS: u32 = 30;

pub(crate) const PARALLELISM: usize = 32;

const FILLS: usize = 8;

const CACHED_RANGE: u64 = 64 << 10;

pub(crate) struct Storage {
    pub store: Arc<dyn ObjectStore>,
    chunks: Chunks,
    blobs: Blobs,
    cache: Arc<Cache>,
    disk: Option<Disk>,
}

struct Disk {
    cache: Arc<ChunkCache>,
    fills: Arc<Semaphore>,
}

struct Chunks {
    objects: Objects,
    shared: Option<String>,
}

#[async_trait]
impl Source for Chunks {
    async fn fetch(&self, hash: Hash) -> io::Result<Vec<u8>> {
        self.objects.get_chunk(hash).await.map_err(io::Error::other)
    }

    fn shared(&self) -> Option<Shared> {
        self.shared.clone().map(Shared::chunks)
    }
}

#[derive(Clone)]
struct Blobs {
    store: Arc<dyn ObjectStore>,
    shared: Option<String>,
}

impl Blobs {
    async fn get(&self, hash: Hash) -> Result<Vec<u8>> {
        let bytes = self.store.get(&blob_path(hash)).await?.bytes().await?;
        if Hash::of(&bytes) != hash {
            return Err(Error::Corrupt(format!(
                "blob {hash} does not match its hash"
            )));
        }
        Ok(bytes.into())
    }
}

#[async_trait]
impl Source for Blobs {
    async fn fetch(&self, hash: Hash) -> io::Result<Vec<u8>> {
        self.get(hash).await.map_err(io::Error::other)
    }

    fn shared(&self) -> Option<Shared> {
        self.shared.clone().map(Shared::blobs)
    }
}

pub(crate) struct Written {
    since: SystemTime,
    paths: Vec<Path>,
}

impl Written {
    pub(crate) fn new() -> Self {
        Self {
            since: SystemTime::now(),
            paths: Vec::new(),
        }
    }

    pub(crate) fn chunks(&mut self, hashes: impl IntoIterator<Item = Hash>) {
        self.paths.extend(hashes.into_iter().map(chunk_path));
    }

    pub(crate) fn object(&mut self, hash: Hash) {
        self.paths.push(object_path(hash));
    }

    pub(crate) fn blobs(&mut self, hashes: impl IntoIterator<Item = Hash>) {
        self.paths.extend(hashes.into_iter().map(blob_path));
    }
}

impl Storage {
    pub(crate) fn new(
        store: Arc<dyn ObjectStore>,
        cache_bytes: usize,
        disk: Option<Arc<ChunkCache>>,
        shared: Option<String>,
    ) -> Self {
        Self {
            chunks: Chunks {
                objects: Objects::new(store.clone()),
                shared: shared.clone(),
            },
            blobs: Blobs {
                store: store.clone(),
                shared,
            },
            store,
            cache: Arc::new(Cache::new(cache_bytes)),
            disk: disk.map(|cache| Disk {
                cache,
                fills: Arc::new(Semaphore::new(FILLS)),
            }),
        }
    }

    pub(crate) fn cache(&self) -> &Arc<Cache> {
        &self.cache
    }

    pub(crate) async fn head(&self, branch: &str) -> Result<Head> {
        head::read(self.store.as_ref(), branch)
            .await?
            .ok_or_else(|| Error::BranchNotFound(branch.to_string()))
    }

    pub(crate) async fn current(&self, branch: &str) -> Result<Arc<Version>> {
        let head = self.head(branch).await?;
        let (version, ()) = futures::join!(self.version(head.version), self.prefetch(&head.hints));
        version
    }

    async fn prefetch(&self, hints: &[Hint]) {
        let fetches = hints.iter().map(|hint| async move {
            let _ = match *hint {
                Hint::Centroids(hash) => self.centroids(hash).await.map(drop),
                Hint::Table(hash) => self.get::<Vec<ClusterRef>>(hash).await.map(drop),
                Hint::Filters(hash) => self.get::<Attrs>(hash).await.map(drop),
                Hint::Text(hash, bytes) => text::part::open(self, hash, bytes).await.map(drop),
                Hint::Segment(hash) => self.get::<Segment>(hash).await.map(drop),
                Hint::Directory(hash) => self.get::<Directory>(hash).await.map(drop),
                Hint::Clusters(hash) => self.get::<directory::Directory>(hash).await.map(drop),
            };
        });
        futures::future::join_all(fetches).await;
    }

    pub(crate) async fn version(&self, hash: Hash) -> Result<Arc<Version>> {
        if let Some(found) = self.cache.get(hash) {
            return Ok(found);
        }
        reads::count(From::Store);
        let raw = self.chunks.objects.get_raw(hash).await?;
        let version = Arc::new(decode_version(&raw)?);
        self.cache.insert(hash, version.clone(), version.weight());
        Ok(version)
    }

    pub(crate) async fn put_version(&self, version: &Version) -> Result<Hash> {
        Ok(self.chunks.objects.put(version).await?)
    }

    pub(crate) async fn get<T>(&self, hash: Hash) -> Result<Arc<T>>
    where
        T: DeserializeOwned + Send + Sync + 'static,
    {
        if let Some(found) = self.cache.get(hash) {
            return Ok(found);
        }
        let bytes = match self.disk_read(&self.chunks, hash, 0..u64::MAX).await {
            Some(bytes) => bytes,
            None => {
                reads::count(From::Store);
                self.chunks.objects.get_chunk(hash).await?
            }
        };
        let value = Arc::new(postcard::from_bytes(&bytes)?);
        self.cache.insert(hash, Arc::clone(&value), bytes.len());
        Ok(value)
    }

    pub(crate) async fn get_all<T>(&self, hashes: Vec<Hash>) -> Result<Vec<Arc<T>>>
    where
        T: DeserializeOwned + Send + Sync + 'static,
    {
        stream::iter(hashes)
            .map(|hash| self.get(hash))
            .buffered(PARALLELISM)
            .try_collect()
            .await
    }

    pub(crate) async fn fetch<T: DeserializeOwned>(&self, hash: Hash) -> Result<T> {
        Ok(postcard::from_bytes(
            &self.chunks.objects.get_chunk(hash).await?,
        )?)
    }

    pub(crate) async fn put(&self, bytes: Vec<u8>) -> Result<Hash> {
        Ok(self.chunks.objects.put_chunk(bytes).await?)
    }

    pub(crate) async fn centroids(&self, hash: Hash) -> Result<Arc<Vec<f32>>> {
        if let Some(found) = self.cache.get(hash) {
            return Ok(found);
        }
        reads::count(From::Store);
        let centroids: Arc<Vec<f32>> = Arc::new(self.chunks.objects.get(hash).await?);
        self.cache
            .insert(hash, centroids.clone(), 4 * centroids.len());
        Ok(centroids)
    }

    pub(crate) async fn origin(&self, clusters: &Clusters, dims: usize) -> Result<Arc<Vec<f32>>> {
        if let Some(origin) = clusters.origin {
            return self.centroids(origin).await;
        }
        let key = part(clusters.centroids, "origin");
        if let Some(found) = self.cache.get(key) {
            return Ok(found);
        }
        let origin = Arc::new(ivf::mean(&self.centroids(clusters.centroids).await?, dims));
        self.cache.insert(key, origin.clone(), 4 * dims);
        Ok(origin)
    }

    pub(crate) async fn put_centroids(&self, centroids: &Vec<f32>) -> Result<Hash> {
        Ok(self.chunks.objects.put(centroids).await?)
    }

    pub(crate) async fn put_blob(&self, bytes: Vec<u8>) -> Result<Hash> {
        let hash = Hash::of(&bytes);
        self.store.put(&blob_path(hash), bytes.into()).await?;
        Ok(hash)
    }

    pub(crate) async fn keep_on_disk(&self, blobs: Vec<Hash>) -> Result<()> {
        let Some(disk) = &self.disk else {
            return Ok(());
        };
        let fetches: Vec<_> = (blobs.into_iter())
            .map(|hash| disk.cache.fetch(&self.blobs, hash))
            .collect();
        stream::iter(fetches)
            .buffer_unordered(PARALLELISM)
            .try_collect::<()>()
            .await
            .map_err(|error| Error::Core(error.into()))
    }

    pub(crate) async fn blob(&self, hash: Hash) -> Result<Vec<u8>> {
        if let Some(bytes) = self.disk_read(&self.blobs, hash, 0..u64::MAX).await {
            return Ok(bytes);
        }
        reads::count(From::Store);
        self.blobs.get(hash).await
    }

    pub(crate) async fn range(&self, hash: Hash, range: Range<u64>) -> Result<Vec<u8>> {
        if let Some(disk) = &self.disk {
            if disk.cache.has(hash) {
                if let Some(bytes) = self.disk_read(&self.blobs, hash, range.clone()).await {
                    return Ok(bytes);
                }
            } else if let Ok(permit) = disk.fills.clone().try_acquire_owned() {
                let (cache, blobs) = (disk.cache.clone(), self.blobs.clone());
                tokio::spawn(async move {
                    let _ = cache.fetch(&blobs, hash).await;
                    drop(permit);
                });
            }
        }
        reads::count(From::Store);
        Ok(self.store.get_range(&blob_path(hash), range).await?.into())
    }

    async fn disk_read(&self, from: &dyn Source, hash: Hash, range: Range<u64>) -> Option<Vec<u8>> {
        let disk = self.disk.as_ref()?;
        reads::count(match disk.cache.has(hash) {
            true => From::Disk,
            false => From::Store,
        });
        let loaded = disk.cache.open(from, hash).await.ok()?;
        let len = range.end.saturating_sub(range.start) as usize;
        tokio::task::spawn_blocking(move || loaded.read(range.start, len))
            .await
            .ok()?
            .ok()
    }

    async fn section(&self, cluster: &ClusterRef, range: Range<u64>, sum: Hash) -> Result<Vec<u8>> {
        let bytes = self.range(cluster.hash, range).await?;
        if Hash::of(&bytes) != sum {
            return Err(Error::Corrupt(format!(
                "a section of blob {} does not match its hash",
                cluster.hash
            )));
        }
        Ok(bytes)
    }

    pub(crate) async fn codes(&self, cluster: &ClusterRef, dims: usize) -> Result<Arc<Codes>> {
        let key = part(cluster.hash, "codes");
        if let Some(found) = self.cache.get(key) {
            return Ok(found);
        }
        let codes = Arc::new(self.read_codes(cluster, dims).await?);
        self.cache.insert(key, codes.clone(), codes.weight());
        Ok(codes)
    }

    pub(crate) async fn read_codes(&self, cluster: &ClusterRef, dims: usize) -> Result<Codes> {
        let bytes = self
            .section(cluster, cluster.codes(), cluster.sums[0])
            .await?;
        Codes::decode(&bytes, cluster.rows as usize, dims)
    }

    pub(crate) async fn codes_and_attrs(
        &self,
        cluster: &ClusterRef,
        dims: usize,
    ) -> Result<(Arc<Codes>, Arc<Attrs>)> {
        let keys = (
            part(cluster.hash, "codes"),
            part(cluster.hash, "attributes"),
        );
        match (self.cache.get(keys.0), self.cache.get(keys.1)) {
            (Some(codes), Some(attrs)) => return Ok((codes, attrs)),
            (Some(_), None) | (None, Some(_)) => {
                return futures::try_join!(self.codes(cluster, dims), self.attrs(cluster));
            }
            (None, None) => {}
        }
        let (codes, attrs, bytes) = self.read_codes_and_attrs(cluster, dims).await?;
        let (codes, attrs) = (Arc::new(codes), Arc::new(attrs));
        self.cache.insert(keys.0, codes.clone(), codes.weight());
        self.cache.insert(keys.1, attrs.clone(), 2 * bytes);
        Ok((codes, attrs))
    }

    pub(crate) async fn read_codes_and_attrs(
        &self,
        cluster: &ClusterRef,
        dims: usize,
    ) -> Result<(Codes, Attrs, usize)> {
        let both = cluster.codes().start..cluster.attributes().end;
        let bytes = self.range(cluster.hash, both.clone()).await?;
        let (codes, attrs) = bytes.split_at((cluster.codes().end - both.start) as usize);
        for (section, sum) in [(codes, cluster.sums[0]), (attrs, cluster.sums[1])] {
            if Hash::of(section) != sum {
                return Err(Error::Corrupt(format!(
                    "a section of blob {} does not match its hash",
                    cluster.hash
                )));
            }
        }
        let decoded = Codes::decode(codes, cluster.rows as usize, dims)?;
        Ok((decoded, postcard::from_bytes(attrs)?, attrs.len()))
    }

    pub(crate) async fn range_cached(&self, hash: Hash, range: Range<u64>) -> Result<Arc<Vec<u8>>> {
        if range.end - range.start > CACHED_RANGE {
            return Ok(Arc::new(self.range(hash, range).await?));
        }
        let key = part(hash, &format!("{}..{}", range.start, range.end));
        if let Some(found) = self.cache.get(key) {
            return Ok(found);
        }
        let bytes = Arc::new(self.range(hash, range).await?);
        self.cache.insert(key, bytes.clone(), bytes.len());
        Ok(bytes)
    }

    pub(crate) async fn attrs(&self, cluster: &ClusterRef) -> Result<Arc<Attrs>> {
        let key = part(cluster.hash, "attributes");
        if let Some(found) = self.cache.get(key) {
            return Ok(found);
        }
        let bytes = (self.section(cluster, cluster.attributes(), cluster.sums[1])).await?;
        let attrs: Arc<Attrs> = Arc::new(postcard::from_bytes(&bytes)?);
        self.cache.insert(key, attrs.clone(), 2 * bytes.len());
        Ok(attrs)
    }

    pub(crate) async fn save(
        &self,
        branch: &str,
        written: &Written,
        change: impl Fn(&Version) -> Option<Version>,
    ) -> Result<bool> {
        Ok(self.saved(branch, written, change).await?.is_some())
    }

    pub(crate) async fn saved(
        &self,
        branch: &str,
        written: &Written,
        change: impl Fn(&Version) -> Option<Version>,
    ) -> Result<Option<(Hash, Hash)>> {
        for attempt in 0..SAVE_ATTEMPTS {
            let head = self.head(branch).await?;
            let current = self.version(head.version).await?;
            let Some(mut next) = change(&current) else {
                return Ok(None);
            };
            next.parent = Some(head.version);
            let hash = self.put_version(&next).await?;
            self.settle(written, hash).await?;
            let hints = hints(&next);
            if head::advance(self.store.as_ref(), branch, &head, hash, &hints).await? {
                return Ok(Some((head.version, hash)));
            }
            head::backoff(attempt).await;
        }
        Err(Error::Conflict(branch.to_string()))
    }

    pub(crate) async fn settle(&self, written: &Written, version: Hash) -> Result<()> {
        let store = self.store.as_ref();
        if lock::settle(store, written.since).await? {
            let mut paths = written.paths.clone();
            paths.push(object_path(version));
            lock::exist(store, paths).await?;
        }
        Ok(())
    }

    #[cfg(test)]
    pub fn cache_used(&self) -> usize {
        self.cache.used()
    }
}

pub(crate) fn chunk_path(hash: Hash) -> Path {
    Path::from(format!("chunks/{hash}"))
}

pub(crate) fn hints(version: &Version) -> Vec<Hint> {
    let mut hints = Vec::new();
    if let Some(text) = &version.text {
        hints.extend(text.parts.iter().map(|p| Hint::Text(p.hot, p.hot_bytes)));
    }
    if version.tail.len() <= HINTED_SEGMENTS {
        hints.extend(version.tail.iter().map(|s| Hint::Segment(s.hash)));
    }
    if let Some(ann) = &version.ann {
        hints.push(Hint::Filters(ann.filters));
        hints.extend(ann.parts.values().map(|p| Hint::Directory(p.directory)));
        for clusters in ann.columns.values() {
            if let Some(directory) = clusters.directory {
                hints.push(Hint::Clusters(directory));
                continue;
            }
            hints.push(Hint::Centroids(clusters.centroids));
            if clusters.table.hashes.len() <= HINTED_PAGES {
                hints.extend(clusters.table.hashes.iter().map(|&h| Hint::Table(h)));
            }
        }
    }
    hints
}

const HINTED_PAGES: usize = 16;

const HINTED_SEGMENTS: usize = 16;

pub(crate) fn object_path(hash: Hash) -> Path {
    Path::from(format!("objects/{hash}"))
}

pub(crate) fn blob_path(hash: Hash) -> Path {
    Path::from(format!("blobs/{hash}"))
}

pub(crate) fn part(hash: Hash, part: &str) -> Hash {
    Hash::of(format!("{hash}/{part}").as_bytes())
}

#[cfg(test)]
mod tests;
