//! Objects in the bucket by hash: chunks, bundles, trees and commits.

use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::ops::Range;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use object_store::path::Path;
use object_store::{ObjectStore, ObjectStoreExt};
use serde::Serialize;
use serde::de::DeserializeOwned;

use super::bundles::{MOVES_MAX, Moved, moved_path};
use super::held;
use super::io::found;
use crate::retry::backoff;
use crate::sync::lock;
use crate::{Bundled, Commit, Error, Hash, Result};

const FORMAT_VERSION: u8 = 1;

const ZSTD_LEVEL: i32 = 3;

pub(crate) const CHUNK_LIMIT: usize = 8 << 20;
pub(crate) const OBJECT_LIMIT: usize = 64 << 20;

const OWNER_WAIT: std::time::Duration = std::time::Duration::from_secs(40);

#[derive(Clone)]
pub struct Objects {
    store: Arc<dyn ObjectStore>,
    cache: Option<PathBuf>,
    owners: bool,
    moves: Arc<Mutex<HashMap<Hash, Arc<Moved>>>>,
}

impl Objects {
    pub fn new(store: Arc<dyn ObjectStore>) -> Self {
        Self {
            store,
            cache: None,
            owners: false,
            moves: Arc::default(),
        }
    }

    pub fn with_cache(mut self, dir: PathBuf) -> Self {
        self.cache = Some(dir);
        self
    }

    pub(crate) fn with_owners(mut self) -> Self {
        self.owners = true;
        self
    }

    pub async fn put_chunk(&self, data: Vec<u8>) -> Result<Hash> {
        let hash = Hash::of(&data);
        self.store_raw(chunk_path(hash), &data).await?;
        Ok(hash)
    }

    pub(crate) async fn put_chunk_unless(
        &self,
        data: Vec<u8>,
        stored: &HashSet<Hash>,
    ) -> Result<Hash> {
        let hash = Hash::of(&data);
        if !stored.contains(&hash) {
            self.store_raw(chunk_path(hash), &data).await?;
        }
        Ok(hash)
    }

    pub async fn get_chunk(&self, hash: Hash) -> Result<Vec<u8>> {
        let path = chunk_path(hash);
        let stored = self.fetch(&path).await?;
        verify(&path, &stored, hash, CHUNK_LIMIT)
    }

    pub async fn get_bundled(&self, bundled: &Bundled) -> Result<Vec<u8>> {
        let mut at = *bundled;
        for _ in 0..MOVES_MAX {
            let path = bundle_path(at.bundle);
            let start = u64::from(at.offset);
            let range = start..start + u64::from(at.len);
            if let Some(stored) = found(self.store.get_range(&path, range.clone()).await)? {
                return verify(&path, &stored, at.chunk.hash, CHUNK_LIMIT);
            }
            match self.moved_to(&at).await {
                Ok(to) => at = to,
                Err(Error::Store(object_store::Error::NotFound { .. })) => {
                    let stored = self.fetch_range(&path, range).await?;
                    return verify(&path, &stored, at.chunk.hash, CHUNK_LIMIT);
                }
                Err(error) => return Err(error),
            }
        }
        Err(Error::Corrupt(format!(
            "{}: moved too many times",
            bundle_path(bundled.bundle)
        )))
    }

    pub(crate) async fn moved_to(&self, at: &Bundled) -> Result<Bundled> {
        let moved = self.moved(at.bundle).await?;
        let to = moved.find(at).ok_or_else(|| {
            Error::Corrupt(format!(
                "{}: a chunk was not kept when it was compacted",
                bundle_path(at.bundle)
            ))
        })?;
        Ok(to)
    }

    pub(crate) async fn moved(&self, bundle: Hash) -> Result<Arc<Moved>> {
        if let Some(moved) = lock(&self.moves).get(&bundle) {
            return Ok(moved.clone());
        }
        let path = moved_path(bundle);
        let stored = self.store.get(&path).await?.bytes().await?;
        let raw = decode(&path, &stored, OBJECT_LIMIT)?;
        let moved: Arc<Moved> = Arc::new(postcard::from_bytes(&raw)?);
        lock(&self.moves).insert(bundle, moved.clone());
        Ok(moved)
    }

    pub(crate) async fn put_moved(&self, bundle: Hash, moved: &Moved) -> Result<()> {
        let stored = encode(&postcard::to_stdvec(moved)?)?;
        self.store.put(&moved_path(bundle), stored.into()).await?;
        Ok(())
    }

    pub(crate) async fn put_bundle(&self, bundle: Hash, stored: Vec<u8>) -> Result<()> {
        let path = bundle_path(bundle);
        if !held::hold(&path, &stored) {
            self.store.put(&path, stored.into()).await?;
        }
        Ok(())
    }

    pub async fn put<T: Serialize>(&self, value: &T) -> Result<Hash> {
        self.put_at(object_path, value).await
    }

    pub async fn put_commit(&self, commit: &Commit) -> Result<Hash> {
        self.put_at(commit_path, commit).await
    }

    async fn put_at<T: Serialize>(&self, path: fn(Hash) -> Path, value: &T) -> Result<Hash> {
        let bytes = postcard::to_stdvec(value)?;
        let hash = Hash::of(&bytes);
        let stored = encode(&bytes)?;
        let path = path(hash);
        if !held::hold(&path, &stored) {
            self.store.put(&path, stored.clone().into()).await?;
        }
        self.keep(hash, &stored).await;
        Ok(hash)
    }

    pub fn address<T: Serialize>(value: &T) -> Result<Hash> {
        Ok(Hash::of(&postcard::to_stdvec(value)?))
    }

    pub async fn get<T: DeserializeOwned>(&self, hash: Hash) -> Result<T> {
        self.get_at(object_path(hash), hash).await
    }

    pub async fn get_commit(&self, hash: Hash) -> Result<Commit> {
        self.get_at(commit_path(hash), hash).await
    }

    pub async fn get_raw(&self, hash: Hash) -> Result<Vec<u8>> {
        self.raw_at(object_path(hash), hash).await
    }

    async fn get_at<T: DeserializeOwned>(&self, path: Path, hash: Hash) -> Result<T> {
        Ok(postcard::from_bytes(&self.raw_at(path, hash).await?)?)
    }

    async fn raw_at(&self, path: Path, hash: Hash) -> Result<Vec<u8>> {
        if let Some(dir) = &self.cache
            && let Ok(stored) = tokio::fs::read(dir.join(hash.to_string())).await
            && let Ok(raw) = verify(&path, &stored, hash, OBJECT_LIMIT)
        {
            return Ok(raw);
        }
        let stored = self.fetch(&path).await?;
        let raw = verify(&path, &stored, hash, OBJECT_LIMIT)?;
        self.keep(hash, &stored).await;
        Ok(raw)
    }

    async fn keep(&self, hash: Hash, stored: &[u8]) {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let Some(dir) = &self.cache else { return };
        let temp = dir.join(format!(
            "{hash}.{}.{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let saved = async {
            tokio::fs::create_dir_all(dir).await?;
            tokio::fs::write(&temp, stored).await?;
            tokio::fs::rename(&temp, dir.join(hash.to_string())).await
        };
        if saved.await.is_err() {
            let _ = tokio::fs::remove_file(&temp).await;
        }
    }

    async fn store_raw(&self, path: Path, raw: &[u8]) -> Result<()> {
        let stored = encode(raw)?;
        if !held::hold(&path, &stored) {
            self.store.put(&path, stored.into()).await?;
        }
        Ok(())
    }

    pub(crate) async fn fetch(&self, path: &Path) -> Result<Vec<u8>> {
        self.fetch_with(path, None).await
    }

    pub(crate) async fn fetch_range(&self, path: &Path, range: Range<u64>) -> Result<Vec<u8>> {
        self.fetch_with(path, Some(range)).await
    }

    async fn fetch_with(&self, path: &Path, range: Option<Range<u64>>) -> Result<Vec<u8>> {
        let started = std::time::Instant::now();
        let mut attempt = 0;
        loop {
            let got = match &range {
                Some(range) => self.store.get_range(path, range.clone()).await,
                None => match self.store.get(path).await {
                    Ok(object) => object.bytes().await,
                    Err(error) => Err(error),
                },
            };
            match got {
                Ok(bytes) => return Ok(bytes.to_vec()),
                Err(object_store::Error::NotFound { .. })
                    if self.owners && started.elapsed() < OWNER_WAIT =>
                {
                    backoff(attempt).await;
                    attempt += 1;
                }
                Err(error) => return Err(error.into()),
            }
        }
    }

    pub fn store(&self) -> &Arc<dyn ObjectStore> {
        &self.store
    }
}

pub(crate) fn verify(path: &Path, stored: &[u8], hash: Hash, limit: usize) -> Result<Vec<u8>> {
    let raw = decode(path, stored, limit)?;
    if Hash::of(&raw) != hash {
        return Err(Error::Corrupt(format!(
            "{path}: content does not match its hash"
        )));
    }
    Ok(raw)
}

pub(crate) fn chunk_path(hash: Hash) -> Path {
    Path::from(format!("chunks/{hash}"))
}

pub(crate) fn bundle_path(bundle: Hash) -> Path {
    Path::from(format!("bundles/{bundle}"))
}

pub(crate) fn object_path(hash: Hash) -> Path {
    Path::from(format!("objects/{hash}"))
}

pub(crate) fn commit_path(hash: Hash) -> Path {
    Path::from(format!("commits/{hash}"))
}

pub(crate) fn encode(raw: &[u8]) -> Result<Vec<u8>> {
    let mut stored = vec![FORMAT_VERSION];
    stored.extend(zstd::bulk::compress(raw, ZSTD_LEVEL)?);
    Ok(stored)
}

pub(crate) fn decode(path: &Path, stored: &[u8], limit: usize) -> Result<Vec<u8>> {
    let Some((&FORMAT_VERSION, body)) = stored.split_first() else {
        return Err(Error::Corrupt(format!("{path}: unknown format")));
    };
    let mut raw = Vec::new();
    zstd::stream::read::Decoder::new(body)?
        .take(limit as u64 + 1)
        .read_to_end(&mut raw)?;
    if raw.len() > limit {
        return Err(Error::Corrupt(format!("{path}: more than {limit} bytes")));
    }
    Ok(raw)
}
