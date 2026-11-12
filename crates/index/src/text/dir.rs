//! A read-only Tantivy `Directory` on the object store.

use std::collections::{BTreeMap, HashMap};
use std::fmt;
use std::io;
use std::ops::Range;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError, Weak};

use async_trait::async_trait;
use futures::FutureExt;
use futures::future::{BoxFuture, Shared, try_join_all};
use object_store::{ObjectStore, ObjectStoreExt};
use skywake_core::Hash;
use tantivy::HasLen;
use tantivy::directory::error::{DeleteError, LockError, OpenReadError, OpenWriteError};
use tantivy::directory::{
    Directory, DirectoryLock, FileHandle, Lock, OwnedBytes, WatchCallback, WatchHandle, WritePtr,
};

use crate::store::blob_path;
use crate::store::cache::Cache;
use crate::store::reads;

pub(crate) const SPLIT: usize = 1 << 20;

static SYNC_MISSES: AtomicU64 = AtomicU64::new(0);

pub fn sync_misses() -> u64 {
    SYNC_MISSES.load(Ordering::Relaxed)
}

type Extents = BTreeMap<usize, (usize, Hash)>;

type Record = Mutex<Vec<(Hash, Range<usize>)>>;

type Flying = Shared<BoxFuture<'static, Result<OwnedBytes, Arc<io::Error>>>>;

#[derive(Clone)]
pub(crate) struct BlobDir {
    inner: Arc<Inner>,
}

struct Inner {
    store: Arc<dyn ObjectStore>,
    runtime: tokio::runtime::Handle,
    files: HashMap<PathBuf, (Hash, usize)>,
    atomic: HashMap<PathBuf, Vec<u8>>,
    hot: HashMap<Hash, BTreeMap<usize, OwnedBytes>>,
    cache: Weak<Cache>,
    ranges: Mutex<HashMap<Hash, Extents>>,
    flying: Mutex<HashMap<(Hash, usize, usize), Flying>>,
    record: Option<Record>,
}

pub(crate) struct Files<'a> {
    pub files: &'a [(String, Hash, u64)],
    pub atomic: &'a [(String, Vec<u8>)],
    pub ranges: &'a [(Hash, u64, Vec<u8>)],
}

impl BlobDir {
    pub(super) fn open(store: Arc<dyn ObjectStore>, files: Files<'_>, cache: Weak<Cache>) -> Self {
        Self::new(store, files, cache, None)
    }

    pub(super) fn recorder(store: Arc<dyn ObjectStore>, files: Files<'_>) -> Self {
        Self::new(store, files, Weak::new(), Some(Mutex::default()))
    }

    fn new(
        store: Arc<dyn ObjectStore>,
        files: Files<'_>,
        cache: Weak<Cache>,
        record: Option<Record>,
    ) -> Self {
        let mut hot: HashMap<Hash, BTreeMap<usize, OwnedBytes>> = HashMap::new();
        for (hash, start, bytes) in files.ranges {
            let bytes = OwnedBytes::new(bytes.clone());
            hot.entry(*hash).or_default().insert(*start as usize, bytes);
        }
        Self {
            inner: Arc::new(Inner {
                store,
                runtime: tokio::runtime::Handle::current(),
                files: (files.files.iter())
                    .map(|(name, hash, len)| (PathBuf::from(name), (*hash, *len as usize)))
                    .collect(),
                atomic: (files.atomic.iter())
                    .map(|(name, bytes)| (PathBuf::from(name), bytes.clone()))
                    .collect(),
                hot,
                cache,
                ranges: Mutex::default(),
                flying: Mutex::default(),
                record,
            }),
        }
    }

    pub(super) fn recorded(&self) -> Vec<(Hash, Range<usize>)> {
        (self.inner.record.as_ref())
            .map(|record| lock(record).clone())
            .unwrap_or_default()
    }

    pub(super) fn hot_bytes(&self) -> usize {
        (self.inner.hot.values())
            .flat_map(|ranges| ranges.values())
            .map(|bytes| bytes.len())
            .sum()
    }
}

impl Inner {
    fn cached(&self, hash: Hash, range: &Range<usize>) -> Option<OwnedBytes> {
        covering(self.hot.get(&hash)?, range)
    }

    fn lookup(&self, hash: Hash, range: &Range<usize>) -> Option<OwnedBytes> {
        if let Some(found) = self.hot.get(&hash).and_then(|r| covering(r, range)) {
            return Some(found);
        }
        let cache = self.cache.upgrade()?;
        let mut ranges = lock(&self.ranges);
        let starts = ranges.get_mut(&hash)?;
        let candidates: Vec<(usize, usize, Hash)> = (starts.range(..=range.start).rev().take(8))
            .map(|(&start, &(end, key))| (start, end, key))
            .collect();
        for (start, end, key) in candidates {
            if end < range.end {
                continue;
            }
            match cache.get::<OwnedBytes>(key) {
                Some(bytes) => return Some(bytes.slice(range.start - start..range.end - start)),
                None => drop(starts.remove(&start)),
            }
        }
        None
    }

    fn keep(&self, hash: Hash, start: usize, bytes: &OwnedBytes) {
        let Some(cache) = self.cache.upgrade() else {
            return;
        };
        let end = start + bytes.len();
        let key = Hash::of(format!("{hash}/{start}/{end}").as_bytes());
        cache.insert(key, Arc::new(bytes.clone()), bytes.len() + 64);
        lock(&self.ranges)
            .entry(hash)
            .or_default()
            .insert(start, (end, key));
    }

    async fn fetch(&self, hash: Hash, range: Range<usize>) -> io::Result<OwnedBytes> {
        reads::count(reads::From::Store);
        let path = blob_path(hash);
        let pieces = (range.start..range.end)
            .step_by(SPLIT)
            .map(|start| start as u64..(start + SPLIT).min(range.end) as u64);
        let parts = try_join_all(pieces.map(|piece| self.store.get_range(&path, piece)))
            .await
            .map_err(io::Error::other)?;
        Ok(match parts.len() {
            1 => OwnedBytes::new(parts[0].to_vec()),
            _ => OwnedBytes::new(parts.concat()),
        })
    }
}

fn covering(ranges: &BTreeMap<usize, OwnedBytes>, range: &Range<usize>) -> Option<OwnedBytes> {
    let (&start, bytes) = ranges.range(..=range.start).next_back()?;
    (start + bytes.len() >= range.end).then(|| bytes.slice(range.start - start..range.end - start))
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

struct BlobHandle {
    dir: Arc<Inner>,
    hash: Hash,
    len: usize,
}

impl fmt::Debug for BlobHandle {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "blob {}", self.hash)
    }
}

impl HasLen for BlobHandle {
    fn len(&self) -> usize {
        self.len
    }
}

#[async_trait]
impl FileHandle for BlobHandle {
    fn read_bytes(&self, range: Range<usize>) -> io::Result<OwnedBytes> {
        if range.is_empty() {
            return Ok(OwnedBytes::empty());
        }
        let dir = &self.dir;
        if let Some(record) = &dir.record {
            lock(record).push((self.hash, range.clone()));
            if let Some(found) = dir.cached(self.hash, &range) {
                return Ok(found);
            }
        } else if let Some(found) = dir.lookup(self.hash, &range) {
            return Ok(found);
        } else {
            SYNC_MISSES.fetch_add(1, Ordering::Relaxed);
            tracing::warn!(blob = %self.hash, ?range, "a text search read missed the cache");
        }
        let bytes = dir.runtime.block_on(dir.fetch(self.hash, range.clone()))?;
        dir.keep(self.hash, range.start, &bytes);
        Ok(bytes)
    }

    async fn read_bytes_async(&self, range: Range<usize>) -> io::Result<OwnedBytes> {
        if range.is_empty() {
            return Ok(OwnedBytes::empty());
        }
        if let Some(found) = self.dir.lookup(self.hash, &range) {
            return Ok(found);
        }
        let key = (self.hash, range.start, range.end);
        let shared = lock(&self.dir.flying)
            .entry(key)
            .or_insert_with(|| {
                let dir = self.dir.clone();
                async move {
                    let fetched = dir.fetch(key.0, key.1..key.2).await;
                    lock(&dir.flying).remove(&key);
                    let bytes = fetched.map_err(Arc::new)?;
                    dir.keep(key.0, key.1, &bytes);
                    Ok(bytes)
                }
                .boxed()
                .shared()
            })
            .clone();
        shared
            .await
            .map_err(|error| io::Error::new(error.kind(), error.to_string()))
    }
}

fn read_only() -> io::Error {
    io::Error::new(
        io::ErrorKind::Unsupported,
        "a stored text part is read-only",
    )
}

impl fmt::Debug for BlobDir {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "BlobDir({} files)", self.inner.files.len())
    }
}

impl Directory for BlobDir {
    fn get_file_handle(&self, path: &Path) -> Result<Arc<dyn FileHandle>, OpenReadError> {
        let (hash, len) = *(self.inner.files.get(path))
            .ok_or_else(|| OpenReadError::FileDoesNotExist(path.to_path_buf()))?;
        Ok(Arc::new(BlobHandle {
            dir: self.inner.clone(),
            hash,
            len,
        }))
    }

    fn delete(&self, path: &Path) -> Result<(), DeleteError> {
        Err(DeleteError::IoError {
            io_error: Arc::new(read_only()),
            filepath: path.to_path_buf(),
        })
    }

    fn exists(&self, path: &Path) -> Result<bool, OpenReadError> {
        Ok(self.inner.files.contains_key(path) || self.inner.atomic.contains_key(path))
    }

    fn open_write(&self, path: &Path) -> Result<WritePtr, OpenWriteError> {
        Err(OpenWriteError::wrap_io_error(
            read_only(),
            path.to_path_buf(),
        ))
    }

    fn atomic_read(&self, path: &Path) -> Result<Vec<u8>, OpenReadError> {
        (self.inner.atomic.get(path).cloned())
            .ok_or_else(|| OpenReadError::FileDoesNotExist(path.to_path_buf()))
    }

    fn atomic_write(&self, _path: &Path, _data: &[u8]) -> io::Result<()> {
        Err(read_only())
    }

    fn sync_directory(&self) -> io::Result<()> {
        Ok(())
    }

    fn acquire_lock(&self, _lock: &Lock) -> Result<DirectoryLock, LockError> {
        Ok(DirectoryLock::from(Box::new(())))
    }

    fn watch(&self, _callback: WatchCallback) -> tantivy::Result<WatchHandle> {
        Ok(WatchHandle::empty())
    }
}

pub(crate) fn merge_ranges(
    mut ranges: Vec<(Hash, Range<usize>)>,
    gap: usize,
) -> Vec<(Hash, Range<usize>)> {
    ranges.sort_by_key(|(hash, range)| (hash.to_string(), range.start));
    let mut merged: Vec<(Hash, Range<usize>)> = Vec::new();
    for (hash, range) in ranges {
        match merged.last_mut() {
            Some((last, open)) if *last == hash && range.start <= open.end + gap => {
                open.end = open.end.max(range.end);
            }
            _ => merged.push((hash, range)),
        }
    }
    merged
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranges_that_touch_are_joined() {
        let (a, b) = (Hash::of(b"a"), Hash::of(b"b"));
        let merged = merge_ranges(vec![(a, 10..20), (b, 0..5), (a, 0..10), (a, 30..40)], 4);
        assert_eq!(merged.len(), 3);
        assert!(merged.contains(&(a, 0..20)));
        assert!(merged.contains(&(a, 30..40)));
    }

    #[test]
    fn a_covering_range_is_sliced() {
        let mut map = BTreeMap::new();
        map.insert(10, OwnedBytes::new((0u8..20).collect::<Vec<_>>()));
        assert_eq!(covering(&map, &(12..15)).unwrap().as_slice(), &[2, 3, 4]);
        assert!(covering(&map, &(25..35)).is_none());
        assert!(covering(&map, &(5..12)).is_none());
    }
}
