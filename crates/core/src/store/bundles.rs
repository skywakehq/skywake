//! Small files stored together, many chunks back to back in one bundle object.

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};

use futures::{StreamExt, stream};
use object_store::ObjectStoreExt;
use object_store::path::Path;
use serde::{Deserialize, Serialize};

use super::io;
use super::objects::{CHUNK_LIMIT, bundle_path, chunk_path, encode, verify};
use crate::retry::random;
use crate::sync;
use crate::{Bundled, Chunk, Data, Hash, Objects, Result};

pub const FILE_MAX: u64 = 256 * 1024;
const BUNDLE_MAX: usize = 8 << 20;
const GAP_MAX: u64 = 256 * 1024;
const RUN_MAX: u64 = 16 << 20;
const RUNS_AT_ONCE: usize = 16;
pub(crate) const MOVES_MAX: usize = 8;

#[derive(Debug, Default, Serialize, Deserialize)]
pub(crate) struct Moved {
    pub(crate) to: Vec<(u32, Bundled)>,
}

impl Moved {
    pub(crate) fn find(&self, at: &Bundled) -> Option<Bundled> {
        let found = self
            .to
            .binary_search_by_key(&at.offset, |(offset, _)| *offset)
            .ok()?;
        let to = self.to[found].1;
        (to.chunk == at.chunk).then_some(to)
    }
}

pub(crate) fn moved_path(bundle: Hash) -> Path {
    Path::from(format!("moved/{bundle}"))
}

pub struct Bundler {
    objects: Objects,
    state: Mutex<State>,
}

#[derive(Default)]
struct State {
    open: Open,
    pending: HashMap<Hash, Bundled>,
}

struct Open {
    bundle: Hash,
    bytes: Vec<u8>,
}

pub(crate) fn new_id() -> Hash {
    let mut id = [0; 32];
    for part in id.chunks_mut(8) {
        part.copy_from_slice(&random().to_le_bytes());
    }
    Hash::from_bytes(id)
}

impl Default for Open {
    fn default() -> Self {
        Self {
            bundle: new_id(),
            bytes: Vec::new(),
        }
    }
}

impl Bundler {
    pub fn new(objects: &Objects) -> Self {
        Self {
            objects: objects.clone(),
            state: Mutex::default(),
        }
    }

    // Only this bundler's own bundles are reused: nothing else keeps an older one alive.
    pub async fn add(&self, raw: Vec<u8>) -> Result<Data> {
        let chunk = Chunk {
            hash: Hash::of(&raw),
            size: raw.len() as u32,
        };
        let stored = encode(&raw)?;
        let (bundled, full) = {
            let mut state = self.lock();
            if let Some(bundled) = state.pending.get(&chunk.hash) {
                return Ok(Data::Bundled(*bundled));
            }
            let open = &mut state.open;
            let bundled = Bundled {
                chunk,
                bundle: open.bundle,
                offset: open.bytes.len() as u32,
                len: stored.len() as u32,
            };
            open.bytes.extend(stored);
            let full = (open.bytes.len() >= BUNDLE_MAX).then(|| std::mem::take(open));
            state.pending.insert(chunk.hash, bundled);
            (bundled, full)
        };
        if let Some(full) = full {
            self.objects.put_bundle(full.bundle, full.bytes).await?;
        }
        Ok(Data::Bundled(bundled))
    }

    pub async fn finish(&self) -> Result<()> {
        let last = std::mem::take(&mut self.lock().open);
        if !last.bytes.is_empty() {
            self.objects.put_bundle(last.bundle, last.bytes).await?;
        }
        Ok(())
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        sync::lock(&self.state)
    }
}

pub async fn live_paths<'a>(
    objects: &Objects,
    data: impl IntoIterator<Item = &'a Data>,
) -> Result<Vec<Path>> {
    let mut paths = Vec::new();
    let mut bundled: HashMap<Hash, Vec<Bundled>> = HashMap::new();
    for data in data {
        match data {
            Data::Inline(_) => {}
            Data::Chunks(chunks) => paths.extend(chunks.iter().map(|chunk| chunk_path(chunk.hash))),
            Data::Bundled(one) => bundled.entry(one.bundle).or_default().push(*one),
        }
    }
    for (bundle, inside) in bundled {
        if exists(objects, bundle).await? {
            paths.push(bundle_path(bundle));
            continue;
        }
        for mut at in inside {
            for _ in 0..MOVES_MAX {
                paths.push(moved_path(at.bundle));
                at = objects.moved_to(&at).await?;
                if exists(objects, at.bundle).await? {
                    paths.push(bundle_path(at.bundle));
                    break;
                }
            }
        }
    }
    paths.sort_by(|a, b| a.as_ref().cmp(b.as_ref()));
    paths.dedup();
    Ok(paths)
}

pub(crate) async fn exists(objects: &Objects, bundle: Hash) -> Result<bool> {
    io::exists(objects.store().as_ref(), &bundle_path(bundle)).await
}

pub async fn get_many(objects: &Objects, wanted: Vec<Bundled>, got: impl Fn(Hash, Vec<u8>)) {
    let got = &got;
    stream::iter(runs(wanted))
        .for_each_concurrent(RUNS_AT_ONCE, |run| async move {
            let path = bundle_path(run.inside[0].bundle);
            let bytes = match objects.store().get_range(&path, run.start..run.end).await {
                Ok(bytes) => bytes,
                Err(object_store::Error::NotFound { .. }) => {
                    for bundled in run.inside {
                        if let Ok(raw) = objects.get_bundled(&bundled).await {
                            got(bundled.chunk.hash, raw);
                        }
                    }
                    return;
                }
                Err(_) => return,
            };
            for bundled in run.inside {
                let at = (u64::from(bundled.offset) - run.start) as usize;
                let Some(stored) = bytes.get(at..at + bundled.len as usize) else {
                    continue;
                };
                if let Ok(raw) = verify(&path, stored, bundled.chunk.hash, CHUNK_LIMIT) {
                    got(bundled.chunk.hash, raw);
                }
            }
        })
        .await;
}

struct Run {
    inside: Vec<Bundled>,
    start: u64,
    end: u64,
}

fn runs(mut wanted: Vec<Bundled>) -> Vec<Run> {
    wanted.sort_by_key(|bundled| (*bundled.bundle.as_bytes(), bundled.offset));
    let mut runs: Vec<Run> = Vec::new();
    for bundled in wanted {
        let start = u64::from(bundled.offset);
        let end = start + u64::from(bundled.len);
        match runs.last_mut() {
            Some(run)
                if run.inside[0].bundle == bundled.bundle
                    && start <= run.end + GAP_MAX
                    && end.max(run.end) - run.start <= RUN_MAX =>
            {
                run.end = run.end.max(end);
                run.inside.push(bundled);
            }
            _ => runs.push(Run {
                inside: vec![bundled],
                start,
                end,
            }),
        }
    }
    runs
}
