//! The collection lock, and the check every writer makes before it moves a head.

use std::future::poll_fn;
use std::pin::pin;
use std::task::Poll;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use chrono::Utc;
use futures::{StreamExt, TryStreamExt, stream};
use object_store::path::Path;
use object_store::{ObjectStore, ObjectStoreExt, PutMode, UpdateVersion};
use serde::{Deserialize, Serialize};
use tokio::time::Instant;

use crate::clock::{from_secs, secs};
use crate::retry::{backoff, random};
use crate::store::io::{found, generic, put_mode, version_of, written};
use crate::store::objects::{OBJECT_LIMIT, decode, encode};
use crate::{Error, Result};

const LOCK: &str = "gc/lock";

const LEASE: Duration = Duration::from_secs(120);
const RENEW: Duration = Duration::from_secs(15);
const STEP: Duration = Duration::from_secs(30);
const SKEW: Duration = Duration::from_secs(60);

pub const VIEW_LIFETIME: Duration = Duration::from_secs(3);

pub(crate) const FRESH: Duration = Duration::from_secs(24 * 3600);

const PARALLELISM: usize = 32;

const CONFLICTS: u32 = 20;

#[derive(Serialize, Deserialize, Default, Clone)]
struct State {
    holders: Vec<Holder>,
    deleted: u64,
}

#[derive(Serialize, Deserialize, Clone, Copy)]
struct Holder {
    id: u64,
    until: u64,
    deleting: bool,
    shared: bool,
}

struct Seen {
    version: Option<UpdateVersion>,
    state: State,
    alive: Vec<Holder>,
    deleting: bool,
    deleted: SystemTime,
}

async fn read(store: &dyn ObjectStore) -> Result<Seen> {
    let path = Path::from(LOCK);
    let (state, version) = match found(store.get(&path).await)? {
        Some(object) => {
            let version = version_of(&object.meta);
            let bytes = object.bytes().await?;
            let state = match bytes.is_empty() {
                true => State::default(),
                false => postcard::from_bytes(&decode(&path, &bytes, OBJECT_LIMIT)?)?,
            };
            (state, Some(version))
        }
        None => (State::default(), None),
    };
    let now = SystemTime::now();
    let (alive, state) = prune(state, now);
    Ok(Seen {
        version,
        deleting: alive.iter().any(|holder| holder.deleting),
        deleted: from_secs(state.deleted),
        alive,
        state,
    })
}

fn prune(state: State, now: SystemTime) -> (Vec<Holder>, State) {
    let mut deleted = state.deleted;
    let mut alive = Vec::new();
    for holder in state.holders {
        let until = from_secs(holder.until);
        let forged = until > now + LEASE + SKEW;
        if forged {
            tracing::warn!("the collection lock ends too far ahead; ignoring it");
        }
        // A holder whose lease ended while deleting counts as a deletion then.
        if !forged && now < until + SKEW {
            alive.push(holder);
        } else if holder.deleting {
            deleted = deleted.max(secs(until.min(now)));
        }
    }
    let state = State {
        holders: alive.clone(),
        deleted,
    };
    (alive, state)
}

#[derive(Clone, Copy, Debug)]
pub struct View {
    deleting: bool,
    deleted: SystemTime,
}

impl View {
    pub fn clear(&self, since: SystemTime) -> bool {
        !self.deleting && self.deleted + SKEW < since
    }
}

pub async fn view(store: &dyn ObjectStore) -> Result<View> {
    let seen = read(store).await?;
    Ok(View {
        deleting: seen.deleting,
        deleted: seen.deleted,
    })
}

pub async fn settle(store: &dyn ObjectStore, since: SystemTime) -> Result<bool> {
    let started = Instant::now();
    let mut attempt = 0;
    loop {
        let seen = read(store).await?;
        if !seen.deleting {
            return Ok(seen.deleted + SKEW >= since);
        }
        if started.elapsed() > LEASE + SKEW * 2 {
            return Err(Error::CollectionRunning);
        }
        backoff(attempt).await;
        attempt = (attempt + 1).min(6);
    }
}

pub async fn exist(store: &dyn ObjectStore, paths: Vec<Path>) -> Result<()> {
    stream::iter(paths)
        .map(|path| async move { store.head(&path).await })
        .buffer_unordered(PARALLELISM)
        .try_for_each(|_| async { Ok(()) })
        .await?;
    Ok(())
}

pub async fn revive(store: &dyn ObjectStore, paths: &[Path]) -> Result<()> {
    let since = SystemTime::now();
    let unclear: Vec<bool> = stream::iter(paths.to_vec())
        .map(|path| async move { refresh(store, &path).await })
        .buffer_unordered(PARALLELISM)
        .try_collect()
        .await?;
    if settle(store, since).await? || unclear.contains(&true) {
        exist(store, paths.to_vec()).await?;
    }
    Ok(())
}

async fn refresh(store: &dyn ObjectStore, path: &Path) -> Result<bool> {
    let meta = store.head(path).await?;
    let fresh = (Utc::now() - meta.last_modified)
        .to_std()
        .is_ok_and(|age| age < FRESH);
    if fresh {
        return Ok(false);
    }
    let object = store.get(path).await?;
    let version = version_of(&object.meta);
    let bytes = object.bytes().await?;
    match store
        .put_opts(path, bytes.into(), PutMode::Update(version).into())
        .await
    {
        Ok(_) => Ok(false),
        Err(object_store::Error::Precondition { .. })
        | Err(object_store::Error::NotFound { .. }) => Ok(true),
        Err(error) => Err(error.into()),
    }
}

pub(crate) async fn alive(store: &dyn ObjectStore) -> Result<Vec<u64>> {
    Ok(read(store)
        .await?
        .alive
        .iter()
        .map(|holder| holder.id)
        .collect())
}

pub struct Lease<'a> {
    store: &'a dyn ObjectStore,
    version: UpdateVersion,
    state: State,
    mine: Holder,
    renewed: Instant,
    until: SystemTime,
}

impl<'a> Lease<'a> {
    pub async fn take(store: &'a dyn ObjectStore) -> Result<Self> {
        Self::enter(store, false).await
    }

    pub(crate) async fn join(store: &'a dyn ObjectStore) -> Result<Self> {
        Self::enter(store, true).await
    }

    async fn enter(store: &'a dyn ObjectStore, shared: bool) -> Result<Self> {
        let mut attempt = 0;
        loop {
            let seen = read(store).await?;
            if seen.alive.iter().any(|holder| !shared || !holder.shared) {
                return Err(Error::CollectionRunning);
            }
            let renewed = Instant::now();
            let until = secs(SystemTime::now() + LEASE);
            let mine = Holder {
                id: random(),
                until,
                deleting: false,
                shared,
            };
            let mut state = seen.state;
            state.holders.push(mine);
            match put(store, put_mode(seen.version), &state).await {
                Ok(version) => {
                    return Ok(Self {
                        store,
                        version,
                        state,
                        mine,
                        renewed,
                        until: from_secs(until),
                    });
                }
                Err(
                    object_store::Error::AlreadyExists { .. }
                    | object_store::Error::Precondition { .. },
                ) if attempt < CONFLICTS => {
                    backoff(attempt).await;
                    attempt += 1;
                }
                Err(
                    object_store::Error::AlreadyExists { .. }
                    | object_store::Error::Precondition { .. },
                ) => return Err(Error::CollectionRunning),
                Err(error) => return Err(error.into()),
            }
        }
    }

    pub(crate) fn id(&self) -> u64 {
        self.mine.id
    }

    pub async fn keep(&mut self) -> bool {
        let wall = SystemTime::now() + LEASE >= self.until + RENEW;
        if self.renewed.elapsed() >= RENEW || wall {
            match self.renew().await {
                Ok(()) => {}
                Err(object_store::Error::Precondition { .. }) => return false,
                Err(error) => tracing::warn!(%error, "could not renew the collection lock"),
            }
        }
        self.renewed.elapsed() + STEP + SKEW < LEASE && SystemTime::now() + STEP + SKEW < self.until
    }

    pub async fn deleting(&mut self, deleting: bool) -> Result<()> {
        self.mine.deleting = deleting;
        let deleted = match deleting {
            true => 0,
            false => secs(SystemTime::now()) + 1,
        };
        self.save(deleted).await.map_err(|error| match error {
            object_store::Error::Precondition { .. } => lost(),
            error => error.into(),
        })
    }

    async fn renew(&mut self) -> object_store::Result<()> {
        let started = Instant::now();
        let until = secs(SystemTime::now() + LEASE);
        self.mine.until = until;
        self.save(0).await?;
        if self.renewed.elapsed() + SKEW < LEASE && SystemTime::now() + SKEW < self.until {
            self.renewed = started;
            self.until = from_secs(until);
        }
        Ok(())
    }

    async fn save(&mut self, deleted: u64) -> object_store::Result<()> {
        let mut attempt = 0;
        loop {
            let mut state = self.state.clone();
            state.deleted = state.deleted.max(deleted);
            match state
                .holders
                .iter_mut()
                .find(|holder| holder.id == self.mine.id)
            {
                Some(holder) => *holder = self.mine,
                None => return Err(precondition()),
            }
            let mode = PutMode::Update(self.version.clone());
            match put(self.store, mode, &state).await {
                Ok(version) => {
                    self.version = version;
                    self.state = state;
                    return Ok(());
                }
                Err(object_store::Error::Precondition { .. }) if attempt < CONFLICTS => {
                    let seen = read(self.store).await.map_err(generic)?;
                    let Some(version) = seen.version else {
                        return Err(precondition());
                    };
                    self.version = version;
                    self.state = seen.state;
                    backoff(attempt).await;
                    attempt += 1;
                }
                Err(error) => return Err(error),
            }
        }
    }

    pub async fn within<T>(&self, work: impl Future<Output = Result<T>>) -> Result<T> {
        let end = self.until.checked_sub(SKEW).unwrap_or(UNIX_EPOCH);
        let mut work = pin!(work);
        let checked = poll_fn(|cx| match SystemTime::now() < end {
            true => work.as_mut().poll(cx),
            false => Poll::Ready(Err(lost())),
        });
        tokio::time::timeout_at(self.renewed + LEASE - SKEW, checked)
            .await
            .unwrap_or_else(|_| Err(lost()))
    }

    pub async fn release(mut self) {
        let deleted = match self.mine.deleting {
            true => secs(SystemTime::now()) + 1,
            false => 0,
        };
        self.mine.until = 0;
        self.mine.deleting = false;
        if let Err(error) = self.save(deleted).await {
            tracing::warn!(%error, "could not free the collection lock");
        }
    }
}

pub fn lost() -> Error {
    Error::Collection("lost the collection lock".into())
}

async fn put(
    store: &dyn ObjectStore,
    mode: PutMode,
    state: &State,
) -> object_store::Result<UpdateVersion> {
    let bytes = postcard::to_stdvec(state).map_err(generic)?;
    let bytes = encode(&bytes).map_err(generic)?;
    let result = store
        .put_opts(&Path::from(LOCK), bytes.into(), mode.into())
        .await?;
    Ok(written(result))
}

fn precondition() -> object_store::Error {
    object_store::Error::Precondition {
        path: LOCK.into(),
        source: "the lease ended".into(),
    }
}

#[cfg(test)]
pub(crate) async fn end(store: &dyn ObjectStore, id: u64) {
    let seen = read(store).await.unwrap();
    let mut state = seen.state;
    for holder in &mut state.holders {
        if holder.id == id {
            holder.until = secs(SystemTime::now() - LEASE - SKEW * 2);
        }
    }
    let mode = PutMode::Update(seen.version.unwrap());
    put(store, mode, &state).await.unwrap();
}

#[cfg(test)]
mod tests {
    use object_store::memory::InMemory;

    use super::*;

    #[tokio::test(start_paused = true)]
    async fn a_collection_that_stalled_past_its_lock_stops_deleting() {
        let store = InMemory::new();
        let mut lease = Lease::take(&store).await.unwrap();
        assert!(lease.keep().await);
        tokio::time::advance(LEASE + SKEW + Duration::from_secs(1)).await;
        assert!(!lease.keep().await);
    }

    #[tokio::test(start_paused = true)]
    async fn a_collection_whose_machine_slept_stops_deleting() {
        let store = InMemory::new();
        let mut lease = Lease::take(&store).await.unwrap();
        lease.until = SystemTime::now() - Duration::from_secs(1);
        assert!(!lease.keep().await);
        let sent = lease.within(async { Ok(()) }).await;
        assert!(matches!(sent, Err(Error::Collection(_))), "{sent:?}");
    }

    async fn forge(store: &InMemory, state: State) {
        let bytes = encode(&postcard::to_stdvec(&state).unwrap()).unwrap();
        store.put(&Path::from(LOCK), bytes.into()).await.unwrap();
    }

    #[tokio::test]
    async fn a_lock_far_in_the_future_does_not_stop_writers_or_collections() {
        for until in [u64::MAX, secs(SystemTime::now()) + 10 * 365 * 24 * 3600] {
            let store = InMemory::new();
            let path = Path::from("chunks/x");
            store.put(&path, vec![1].into()).await.unwrap();
            let holder = Holder {
                id: 1,
                until,
                deleting: true,
                shared: false,
            };
            let state = State {
                holders: vec![holder],
                deleted: 0,
            };
            forge(&store, state).await;
            let paths = [path];
            let revived = tokio::time::timeout(Duration::from_secs(5), revive(&store, &paths));
            revived.await.expect("waited for a forged lock").unwrap();
            Lease::take(&store).await.unwrap().release().await;
        }
    }

    #[tokio::test(start_paused = true)]
    async fn a_writer_waits_for_a_collection_only_so_long() {
        let store = InMemory::new();
        let mut lease = Lease::take(&store).await.unwrap();
        lease.deleting(true).await.unwrap();
        let settled = settle(&store, SystemTime::now()).await;
        assert!(
            matches!(settled, Err(Error::CollectionRunning)),
            "{settled:?}"
        );
    }

    #[tokio::test]
    async fn workers_share_the_lock_but_a_lone_holder_does_not() {
        let store = InMemory::new();
        let mut one = Lease::join(&store).await.unwrap();
        let mut two = Lease::join(&store).await.unwrap();
        assert!(matches!(
            Lease::take(&store).await,
            Err(Error::CollectionRunning)
        ));
        assert_eq!(alive(&store).await.unwrap().len(), 2);

        one.deleting(true).await.unwrap();
        assert!(!view(&store).await.unwrap().clear(SystemTime::now()));
        assert!(two.keep().await, "the other worker keeps its lease");
        one.deleting(false).await.unwrap();
        one.release().await;
        two.release().await;
        assert!(alive(&store).await.unwrap().is_empty());

        let alone = Lease::take(&store).await.unwrap();
        assert!(matches!(
            Lease::join(&store).await,
            Err(Error::CollectionRunning)
        ));
        alone.release().await;
    }

    #[tokio::test]
    async fn a_worker_that_died_while_deleting_counts_as_a_deletion() {
        let store = InMemory::new();
        let mut dead = Lease::join(&store).await.unwrap();
        dead.deleting(true).await.unwrap();
        end(&store, dead.id()).await;
        let seen = read(&store).await.unwrap();
        assert!(seen.alive.is_empty() && !seen.deleting);
        assert!(seen.deleted > UNIX_EPOCH);
        let mut next = Lease::join(&store).await.unwrap();
        assert!(next.keep().await);
        let late = dead.deleting(false).await;
        assert!(
            matches!(late, Err(Error::Collection(_))),
            "the next worker dropped it"
        );
    }
}
