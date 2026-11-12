//! The local chunk cache: chunks on disk, fetched from the cache tier or the bucket on a miss.

use std::collections::{BTreeMap, HashMap};
use std::fs::File;
use std::future::{Future, ready};
use std::io;
use std::os::unix::fs::FileExt;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use async_trait::async_trait;
use tokio::sync::OnceCell;
use tracing::warn;

use crate::store::bundles;
use crate::sync::lock;
use crate::{Bundled, Hash, Objects};

mod log;
mod nodes;
pub mod slices;

pub use crate::cluster::{Listing, Members};
pub use log::{LogError, LogRecord, Sealed, Trimmed, WriteLog, ZONE};
pub use nodes::{BATCH_FILES_MAX, BATCH_MAX, CacheNodes, HOT, Shared};

pub struct ChunkCache {
    nodes: CacheNodes,
    dir: PathBuf,
    downloads: Mutex<HashMap<Hash, Download>>,
    held: Mutex<Held>,
    hits: AtomicU64,
    misses: AtomicU64,
}

#[async_trait]
pub trait Source: Send + Sync {
    async fn fetch(&self, hash: Hash) -> io::Result<Vec<u8>>;

    fn shared(&self) -> Option<Shared> {
        None
    }
}

#[async_trait]
impl Source for Objects {
    async fn fetch(&self, hash: Hash) -> io::Result<Vec<u8>> {
        self.get_chunk(hash).await.map_err(io::Error::other)
    }

    fn shared(&self) -> Option<Shared> {
        Some(Shared::chunks(""))
    }
}

pub struct InBundle {
    pub objects: Objects,
    pub at: Bundled,
}

#[async_trait]
impl Source for InBundle {
    async fn fetch(&self, hash: Hash) -> io::Result<Vec<u8>> {
        if hash != self.at.chunk.hash {
            return Err(io::Error::other(
                "asked for a chunk this bundle entry doesn't hold",
            ));
        }
        self.objects
            .get_bundled(&self.at)
            .await
            .map_err(io::Error::other)
    }

    fn shared(&self) -> Option<Shared> {
        Some(Shared::chunks("").at(Some(self.at)))
    }
}

type Download = Arc<OnceCell<Option<Arc<[u8]>>>>;

pub enum Loaded {
    File(File, u64),
    Memory(Arc<[u8]>),
}

impl Loaded {
    pub fn read(&self, offset: u64, len: usize) -> io::Result<Vec<u8>> {
        match self {
            Loaded::Memory(data) => {
                let start = (offset as usize).min(data.len());
                let end = start.saturating_add(len).min(data.len());
                Ok(data[start..end].to_vec())
            }
            Loaded::File(file, size) => {
                let end = (*size).min(offset.saturating_add(len as u64));
                let mut buffer = vec![0; end.saturating_sub(offset) as usize];
                file.read_exact_at(&mut buffer, offset)?;
                Ok(buffer)
            }
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct CacheStats {
    pub hits: u64,
    pub misses: u64,
    pub bytes: u64,
    pub max_bytes: u64,
}

struct Held {
    chunks: HashMap<Hash, Use>,
    by_use: BTreeMap<u64, Hash>,
    bytes: u64,
    max_bytes: u64,
    clock: u64,
}

struct Use {
    size: u64,
    last: u64,
    verified: bool,
}

const DISK_TRIES: usize = 3;

impl ChunkCache {
    pub fn new(dir: PathBuf, max_bytes: u64) -> io::Result<Self> {
        std::fs::create_dir_all(&dir)?;
        let mut found = Vec::new();
        for item in std::fs::read_dir(&dir)? {
            let item = item?;
            if item.file_type()?.is_dir() {
                continue;
            }
            let name = item.file_name();
            let Some(hash) = name.to_str().and_then(|name| name.parse::<Hash>().ok()) else {
                std::fs::remove_file(item.path())?;
                continue;
            };
            let metadata = item.metadata()?;
            if !metadata.is_file() {
                continue;
            }
            found.push((metadata.modified()?, hash, metadata.len()));
        }
        found.sort_by_key(|(modified, ..)| *modified);
        let mut held = Held {
            chunks: HashMap::new(),
            by_use: BTreeMap::new(),
            bytes: 0,
            max_bytes,
            clock: 0,
        };
        for (_, hash, size) in found {
            held.add(hash, size, false);
        }
        let cache = Self {
            nodes: CacheNodes::default(),
            dir,
            downloads: Mutex::default(),
            held: Mutex::new(held),
            hits: AtomicU64::new(0),
            misses: AtomicU64::new(0),
        };
        cache.evict();
        Ok(cache)
    }

    pub fn with_nodes(mut self, nodes: CacheNodes) -> Self {
        self.nodes = nodes;
        self
    }

    pub async fn read(
        &self,
        from: &dyn Source,
        hash: Hash,
        offset: u64,
        len: usize,
    ) -> io::Result<Vec<u8>> {
        let loaded = self
            .load(from, hash, |hash, size, verified| {
                ready(Ok(self.open_checked(hash, size, verified)))
            })
            .await?;
        loaded.read(offset, len)
    }

    pub async fn read_slice(
        &self,
        from: &dyn Source,
        hash: Hash,
        offset: u64,
        len: usize,
    ) -> Option<Vec<u8>> {
        if self.has(hash) || lock(&self.downloads).contains_key(&hash) {
            return None;
        }
        let shared = from.shared()?;
        let data = self.nodes.slice(hash, &shared, offset, len as u64).await?;
        self.misses.fetch_add(1, Ordering::Relaxed);
        Some(data)
    }

    pub async fn get(&self, from: &dyn Source, hash: Hash) -> io::Result<Vec<u8>> {
        self.read(from, hash, 0, usize::MAX).await
    }

    pub async fn open(self: &Arc<Self>, from: &dyn Source, hash: Hash) -> io::Result<Loaded> {
        self.load(from, hash, |hash, size, verified| {
            let cache = self.clone();
            async move {
                tokio::task::spawn_blocking(move || cache.open_checked(hash, size, verified))
                    .await
                    .map_err(io::Error::other)
            }
        })
        .await
    }

    pub async fn fetch(&self, from: &dyn Source, hash: Hash) -> io::Result<()> {
        if self.lookup(hash).is_none() {
            self.download(from, hash).await?;
        }
        Ok(())
    }

    pub async fn fetch_bundled(&self, objects: &Objects, mut wanted: Vec<Bundled>) {
        wanted.retain(|bundled| !self.has(bundled.chunk.hash));
        let keep = |hash: Hash, data: Vec<u8>| {
            self.misses.fetch_add(1, Ordering::Relaxed);
            if let Err(error) = self.insert(hash, &data) {
                warn!(%hash, %error, "can't write to the chunk cache");
            }
        };
        let left = match self.nodes.is_empty() {
            true => wanted,
            false => self.nodes.get_bundled(wanted, &keep).await,
        };
        if !left.is_empty() {
            bundles::get_many(objects, left, &keep).await;
        }
    }

    pub fn has(&self, hash: Hash) -> bool {
        self.held().chunks.contains_key(&hash)
    }

    pub fn insert(&self, hash: Hash, data: &[u8]) -> io::Result<()> {
        if self.lookup(hash).is_some() {
            return Ok(());
        }
        if Hash::of(data) != hash {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "content does not match its hash",
            ));
        }
        write_whole(&self.path(hash), data)?;
        self.held().add(hash, data.len() as u64, true);
        self.evict();
        Ok(())
    }

    pub fn bytes(&self) -> u64 {
        self.held().bytes
    }

    pub fn stats(&self) -> CacheStats {
        let held = self.held();
        CacheStats {
            hits: self.hits.load(Ordering::Relaxed),
            misses: self.misses.load(Ordering::Relaxed),
            bytes: held.bytes,
            max_bytes: held.max_bytes,
        }
    }

    async fn load<F, Opening>(&self, from: &dyn Source, hash: Hash, open: F) -> io::Result<Loaded>
    where
        F: Fn(Hash, u64, bool) -> Opening,
        Opening: Future<Output = io::Result<Option<File>>>,
    {
        for _ in 0..DISK_TRIES {
            match self.lookup(hash) {
                Some((size, verified)) => {
                    if let Some(file) = open(hash, size, verified).await? {
                        self.hits.fetch_add(1, Ordering::Relaxed);
                        metrics::counter!("skywake_cache_hits_total").increment(1);
                        return Ok(Loaded::File(file, size));
                    }
                }
                None => {
                    if let Some(data) = self.download(from, hash).await? {
                        return Ok(Loaded::Memory(data));
                    }
                }
            }
        }
        Ok(Loaded::Memory(self.fetch_remote(from, hash).await?.into()))
    }

    fn open_checked(&self, hash: Hash, size: u64, verified: bool) -> Option<File> {
        let path = self.path(hash);
        let checked = File::open(&path).and_then(|file| {
            if file.metadata()?.len() != size {
                return Ok(Err("wrong length"));
            }
            if !verified {
                let mut data = Vec::with_capacity(size as usize);
                io::Read::read_to_end(&mut &file, &mut data)?;
                if Hash::of(&data) != hash {
                    return Ok(Err("content does not match its hash"));
                }
                if let Some(used) = self.held().chunks.get_mut(&hash) {
                    used.verified = true;
                }
            }
            Ok(Ok(file))
        });
        let problem = match checked {
            Ok(Ok(file)) => return Some(file),
            Err(error) if error.kind() == io::ErrorKind::NotFound => None,
            Ok(Err(problem)) => Some(problem.to_string()),
            Err(error) => Some(error.to_string()),
        };
        if let Some(problem) = problem {
            warn!(%hash, %problem, "bad chunk in the cache; downloading it again");
            let _ = std::fs::remove_file(&path);
        }
        self.held().remove(hash);
        None
    }

    async fn download(&self, from: &dyn Source, hash: Hash) -> io::Result<Option<Arc<[u8]>>> {
        let download = lock(&self.downloads).entry(hash).or_default().clone();
        let result = download
            .get_or_try_init(|| async {
                if self.held().chunks.contains_key(&hash) {
                    return Ok(None);
                }
                self.misses.fetch_add(1, Ordering::Relaxed);
                metrics::counter!("skywake_cache_misses_total").increment(1);
                let data: Arc<[u8]> = self.fetch_remote(from, hash).await?.into();
                if let Err(error) = self.write(hash, data.clone()).await {
                    warn!(%hash, %error, "can't write to the chunk cache; serving from memory");
                }
                Ok::<_, io::Error>(Some(data))
            })
            .await
            .cloned();
        let mut downloads = lock(&self.downloads);
        if downloads
            .get(&hash)
            .is_some_and(|current| Arc::ptr_eq(current, &download))
        {
            downloads.remove(&hash);
        }
        result
    }

    async fn fetch_remote(&self, from: &dyn Source, hash: Hash) -> io::Result<Vec<u8>> {
        let shared = match from.shared() {
            Some(shared) => self.nodes.get(hash, &shared).await,
            None => None,
        };
        match shared {
            Some(data) => Ok(data),
            None => from.fetch(hash).await,
        }
    }

    async fn write(&self, hash: Hash, data: Arc<[u8]>) -> io::Result<()> {
        let path = self.path(hash);
        let size = data.len() as u64;
        tokio::task::spawn_blocking(move || write_whole(&path, &data))
            .await
            .map_err(io::Error::other)??;
        self.held().add(hash, size, true);
        self.evict();
        Ok(())
    }

    fn evict(&self) {
        let doomed = {
            let mut held = self.held();
            if held.bytes <= held.max_bytes {
                return;
            }
            let target = held.max_bytes / 10 * 9;
            let mut doomed = Vec::new();
            while held.bytes > target
                && let Some((_, hash)) = held.by_use.pop_first()
            {
                held.remove(hash);
                doomed.push(hash);
            }
            metrics::gauge!("skywake_cache_bytes").set(held.bytes as f64);
            doomed
        };
        metrics::counter!("skywake_cache_evictions_total").increment(doomed.len() as u64);
        for hash in doomed {
            let _ = std::fs::remove_file(self.path(hash));
        }
    }

    fn lookup(&self, hash: Hash) -> Option<(u64, bool)> {
        self.held().touch(hash)
    }

    fn path(&self, hash: Hash) -> PathBuf {
        self.dir.join(hash.to_string())
    }

    fn held(&self) -> MutexGuard<'_, Held> {
        lock(&self.held)
    }
}

// Each write gets its own name, so one write never cuts short a file a reader just opened.
pub fn unfinished(path: &std::path::Path) -> PathBuf {
    static WRITES: AtomicU64 = AtomicU64::new(0);
    path.with_extension(format!(
        "partial-{}",
        WRITES.fetch_add(1, Ordering::Relaxed)
    ))
}

// No fsync: after a crash, chunks found on disk are checked against their hash before use.
fn write_whole(path: &std::path::Path, data: &[u8]) -> io::Result<()> {
    let partial = unfinished(path);
    let written = std::fs::write(&partial, data).and_then(|()| std::fs::rename(&partial, path));
    if written.is_err() {
        let _ = std::fs::remove_file(&partial);
    }
    written
}

impl std::fmt::Debug for ChunkCache {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ChunkCache")
            .field("dir", &self.dir)
            .finish()
    }
}

impl Held {
    fn add(&mut self, hash: Hash, size: u64, verified: bool) {
        self.clock += 1;
        let used = Use {
            size,
            last: self.clock,
            verified,
        };
        self.by_use.insert(self.clock, hash);
        match self.chunks.insert(hash, used) {
            Some(old) => {
                self.by_use.remove(&old.last);
                self.bytes = self.bytes - old.size + size;
            }
            None => self.bytes += size,
        }
        metrics::gauge!("skywake_cache_bytes").set(self.bytes as f64);
    }

    fn touch(&mut self, hash: Hash) -> Option<(u64, bool)> {
        self.clock += 1;
        let used = self.chunks.get_mut(&hash)?;
        self.by_use.remove(&used.last);
        used.last = self.clock;
        self.by_use.insert(self.clock, hash);
        Some((used.size, used.verified))
    }

    fn remove(&mut self, hash: Hash) {
        if let Some(used) = self.chunks.remove(&hash) {
            self.by_use.remove(&used.last);
            self.bytes -= used.size;
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use crate::{Hash, Objects};
    use object_store::memory::InMemory;

    use super::ChunkCache;

    async fn bucket() -> (Objects, Vec<u8>, Hash) {
        let objects = Objects::new(Arc::new(InMemory::new()));
        let data: Vec<u8> = (0..200_000u32).map(|i| (i * 13 % 251) as u8).collect();
        let hash = objects.put_chunk(data.clone()).await.unwrap();
        (objects, data, hash)
    }

    #[tokio::test]
    async fn a_planted_file_is_refused_and_fetched_again() {
        let (objects, data, hash) = bucket().await;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(hash.to_string());
        std::fs::write(&path, vec![0u8; data.len()]).unwrap();
        let cache = ChunkCache::new(dir.path().into(), u64::MAX).unwrap();
        assert_eq!(
            cache.read(&objects, hash, 10, 100).await.unwrap(),
            data[10..110]
        );
        assert_eq!(std::fs::read(&path).unwrap(), data);
        assert_eq!(cache.stats().misses, 1);
    }

    #[tokio::test]
    async fn a_short_file_is_refused_and_fetched_again() {
        let (objects, data, hash) = bucket().await;
        let dir = tempfile::tempdir().unwrap();
        let cache = ChunkCache::new(dir.path().into(), u64::MAX).unwrap();
        assert_eq!(cache.get(&objects, hash).await.unwrap(), data);
        let path = dir.path().join(hash.to_string());
        std::fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_len(1000)
            .unwrap();
        assert_eq!(cache.get(&objects, hash).await.unwrap(), data);
        assert_eq!(std::fs::read(&path).unwrap(), data);
    }

    #[tokio::test]
    async fn a_good_file_from_before_is_used() {
        let (objects, data, hash) = bucket().await;
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(hash.to_string()), &data).unwrap();
        let cache = ChunkCache::new(dir.path().into(), u64::MAX).unwrap();
        assert_eq!(cache.get(&objects, hash).await.unwrap(), data);
        assert_eq!(cache.get(&objects, hash).await.unwrap(), data);
        assert_eq!((cache.stats().hits, cache.stats().misses), (2, 0));
    }

    #[tokio::test]
    async fn reads_work_when_the_disk_cannot_hold_chunks() {
        let (objects, data, hash) = bucket().await;
        let dir = tempfile::tempdir().unwrap();
        let cache = ChunkCache::new(dir.path().join("chunks"), u64::MAX).unwrap();
        std::fs::remove_dir(dir.path().join("chunks")).unwrap();
        assert_eq!(
            cache.read(&objects, hash, 5, 50).await.unwrap(),
            data[5..55]
        );
        assert_eq!(cache.bytes(), 0);
    }

    #[tokio::test]
    async fn eviction_keeps_the_recently_used() {
        let objects = Objects::new(Arc::new(InMemory::new()));
        let mut hashes = Vec::new();
        for i in 0..10u8 {
            hashes.push(objects.put_chunk(vec![i; 1000]).await.unwrap());
        }
        let dir = tempfile::tempdir().unwrap();
        let cache = ChunkCache::new(dir.path().into(), 5000).unwrap();
        for &hash in &hashes[..5] {
            cache.fetch(&objects, hash).await.unwrap();
        }
        cache.get(&objects, hashes[0]).await.unwrap();
        cache.fetch(&objects, hashes[5]).await.unwrap();
        assert!(cache.bytes() <= 4500);
        assert!(dir.path().join(hashes[0].to_string()).exists());
        assert!(!dir.path().join(hashes[1].to_string()).exists());
        assert!(dir.path().join(hashes[5].to_string()).exists());
    }

    #[tokio::test]
    async fn inserted_chunks_need_no_download() {
        let (objects, data, hash) = bucket().await;
        let dir = tempfile::tempdir().unwrap();
        let cache = ChunkCache::new(dir.path().into(), u64::MAX).unwrap();
        assert!(cache.insert(hash, &data[1..]).is_err(), "wrong bytes taken");
        cache.insert(hash, &data).unwrap();
        assert_eq!(cache.get(&objects, hash).await.unwrap(), data);
        assert_eq!((cache.stats().hits, cache.stats().misses), (1, 0));
    }
}
