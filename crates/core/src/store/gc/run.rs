//! A collection several workers share: the run record, the marks it publishes and one claim per slice.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures::TryStreamExt;
use object_store::path::Path;
use object_store::{ObjectStore, ObjectStoreExt, UpdateVersion};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use tempfile::TempDir;

use super::bucket::delete;
use super::lock;
use super::slices::SLICES;
use crate::store::io::{found, lost_race, put_mode, version_of, written};
use crate::store::objects::{decode, encode};
use crate::{Error, Hash, Result};

const RUN: &str = "gc/run";
const RUNS: &str = "gc/runs";

const MARKS_LIMIT: usize = 1 << 30;

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub(super) enum Phase {
    Marking,
    Sweeping,
    Done,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub(super) struct Run {
    pub(super) id: u64,
    pub(super) marker: u64,
    pub(super) phase: Phase,
    pub(super) started: u64,
    pub(super) grace: u64,
    pub(super) slices: u32,
}

impl Run {
    // Past this, objects made since marking started may look old, so the marks no longer protect them.
    pub(super) fn deadline(&self) -> Option<SystemTime> {
        let grace = Duration::from_millis(self.grace);
        (!grace.is_zero()).then(|| UNIX_EPOCH + Duration::from_millis(self.started) + grace * 3 / 4)
    }

    pub(super) fn open(&self) -> bool {
        self.phase == Phase::Sweeping
            && (1..=SLICES as u32).contains(&self.slices)
            && self
                .deadline()
                .is_none_or(|deadline| SystemTime::now() < deadline)
    }
}

pub(super) async fn read(store: &dyn ObjectStore) -> Result<(Option<Run>, Option<UpdateVersion>)> {
    match get(store, &Path::from(RUN)).await? {
        Some((run, version)) => Ok((Some(run), Some(version))),
        None => Ok((None, None)),
    }
}

pub(super) async fn write(
    store: &dyn ObjectStore,
    run: &Run,
    version: Option<UpdateVersion>,
) -> Result<Option<UpdateVersion>> {
    put(store, &Path::from(RUN), run, version).await
}

pub(super) async fn clear(store: &dyn ObjectStore, which: impl Fn(u64) -> bool) -> Result<()> {
    let paths: Vec<Path> = store
        .list(Some(&Path::from(RUNS)))
        .map_ok(|meta| meta.location)
        .try_filter(|path| {
            let id = path
                .parts()
                .nth(2)
                .and_then(|id| u64::from_str_radix(id.as_ref(), 16).ok());
            std::future::ready(id.is_some_and(&which))
        })
        .try_collect()
        .await?;
    delete(store, paths).await
}

pub(super) enum Shelf<'a> {
    Bucket(&'a dyn ObjectStore, u64),
    Local(TempDir),
}

impl<'a> Shelf<'a> {
    pub(super) fn local() -> Result<Self> {
        Ok(Self::Local(
            tempfile::Builder::new().prefix("skywake-gc-").tempdir()?,
        ))
    }

    fn path(id: u64, name: &str) -> Path {
        Path::from(format!("{RUNS}/{id:016x}/{name}"))
    }

    pub(super) async fn put(&self, name: &str, raw: &[u8]) -> Result<()> {
        let mut sealed = Hash::of(raw).as_bytes().to_vec();
        sealed.extend_from_slice(raw);
        let stored = encode(&sealed)?;
        match self {
            Self::Bucket(store, id) => {
                store.put(&Self::path(*id, name), stored.into()).await?;
            }
            Self::Local(dir) => std::fs::write(dir.path().join(name), stored)?,
        }
        Ok(())
    }

    pub(super) async fn get(&self, name: &str) -> Result<Vec<u8>> {
        let (path, stored) = match self {
            Self::Bucket(store, id) => {
                let path = Self::path(*id, name);
                let stored = store.get(&path).await?.bytes().await?.to_vec();
                (path, stored)
            }
            Self::Local(dir) => (Path::from(name), std::fs::read(dir.path().join(name))?),
        };
        let sealed = decode(&path, &stored, MARKS_LIMIT)?;
        let (hash, raw) = sealed
            .split_at_checked(32)
            .ok_or_else(|| Error::Corrupt(format!("{path}: too short")))?;
        if hash != Hash::of(raw).as_bytes() {
            return Err(Error::Corrupt(format!(
                "{path}: content does not match its hash"
            )));
        }
        Ok(raw.to_vec())
    }
}

#[derive(Serialize, Deserialize)]
struct Claimed {
    holder: u64,
    done: bool,
}

pub(super) enum Claim {
    Taken(UpdateVersion),
    Done,
    Busy,
}

pub(super) async fn claim(store: &dyn ObjectStore, run: u64, name: &str, me: u64) -> Result<Claim> {
    let path = claim_path(run, name);
    let mine = Claimed {
        holder: me,
        done: false,
    };
    let version = match get::<Claimed>(store, &path).await? {
        None => None,
        Some((claimed, _)) if claimed.done => return Ok(Claim::Done),
        Some((claimed, _)) if lock::alive(store).await?.contains(&claimed.holder) => {
            return Ok(Claim::Busy);
        }
        Some((_, version)) => Some(version),
    };
    Ok(match put(store, &path, &mine, version).await? {
        Some(version) => Claim::Taken(version),
        None => Claim::Busy,
    })
}

pub(super) async fn done(
    store: &dyn ObjectStore,
    run: u64,
    name: &str,
    me: u64,
    version: UpdateVersion,
) -> Result<()> {
    let path = claim_path(run, name);
    let mine = Claimed {
        holder: me,
        done: true,
    };
    match put(store, &path, &mine, Some(version)).await? {
        Some(_) => Ok(()),
        None => Err(lock::lost()),
    }
}

pub(super) async fn is_done(store: &dyn ObjectStore, run: u64, name: &str) -> Result<bool> {
    let path = claim_path(run, name);
    let claimed = get::<Claimed>(store, &path).await?;
    Ok(claimed.is_some_and(|(claimed, _)| claimed.done))
}

fn claim_path(run: u64, name: &str) -> Path {
    Shelf::path(run, &format!("claims/{name}"))
}

async fn get<T: DeserializeOwned>(
    store: &dyn ObjectStore,
    path: &Path,
) -> Result<Option<(T, UpdateVersion)>> {
    let Some(object) = found(store.get(path).await)? else {
        return Ok(None);
    };
    let version = version_of(&object.meta);
    let bytes = object.bytes().await?;
    let value = postcard::from_bytes(&decode(path, &bytes, 1 << 20)?)?;
    Ok(Some((value, version)))
}

async fn put<T: Serialize>(
    store: &dyn ObjectStore,
    path: &Path,
    value: &T,
    version: Option<UpdateVersion>,
) -> Result<Option<UpdateVersion>> {
    let bytes = encode(&postcard::to_stdvec(value)?)?;
    match store
        .put_opts(path, bytes.into(), put_mode(version).into())
        .await
    {
        Ok(result) => Ok(Some(written(result))),
        Err(error) if lost_race(&error) => Ok(None),
        Err(error) => Err(error.into()),
    }
}
