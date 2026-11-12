//! Going back in time.

pub mod gc;

use std::collections::HashMap;
use std::time::{Duration, SystemTime};

use chrono::{DateTime, Utc};
use futures::future::try_join_all;
use object_store::ObjectStoreExt;
use skywake_core::{Hash, lock};

use crate::format::Version;
use crate::read::stats;
use crate::store::{Written, head, hints, object_path};
use crate::{Error, Index, Result, Shards, invalid};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Moment {
    pub version: Hash,
    pub time: DateTime<Utc>,
    pub rows: u64,
}

struct Step {
    hash: Hash,
    time: DateTime<Utc>,
    parent: Option<Hash>,
}

struct Walk<'a> {
    shards: &'a [Index],
    at: Vec<Step>,
}

impl<'a> Walk<'a> {
    async fn new(shards: &'a [Index]) -> Result<Self> {
        let heads = shards.iter().map(|shard| async move {
            let head = shard.storage.head(&shard.branch).await?;
            let step = shard.step(head.version).await?;
            step.ok_or_else(|| Error::Corrupt(format!("the head Version {} is gone", head.version)))
        });
        Ok(Self {
            shards,
            at: try_join_all(heads).await?,
        })
    }

    fn version(&self) -> Hash {
        match &self.at[..] {
            [one] => one.hash,
            all => Hash::of(
                all.iter()
                    .map(|s| s.hash.to_string())
                    .collect::<String>()
                    .as_bytes(),
            ),
        }
    }

    fn time(&self) -> DateTime<Utc> {
        self.at
            .iter()
            .map(|step| step.time)
            .max()
            .unwrap_or_default()
    }

    async fn back(&mut self) -> Result<bool> {
        let (newest, shards) = (self.time(), self.shards);
        let older = (self.at.iter().enumerate())
            .filter(|(_, step)| step.time == newest)
            .map(|(i, step)| async move {
                let parent = match step.parent {
                    Some(parent) => shards[i].step(parent).await?,
                    None => None,
                };
                Ok::<_, Error>((i, parent))
            });
        for (i, parent) in try_join_all(older).await? {
            let Some(parent) = parent else {
                return Ok(false);
            };
            self.at[i] = parent;
        }
        Ok(true)
    }

    async fn rows(&self, known: &mut HashMap<(usize, Hash), u64>) -> Result<Option<u64>> {
        let mut rows = 0;
        for (i, step) in self.at.iter().enumerate() {
            if let Some(n) = known.get(&(i, step.hash)) {
                rows += n;
                continue;
            }
            let shard = &self.shards[i];
            let counted = found(async {
                let version = shard.storage.version(step.hash).await?;
                stats::stats(&shard.storage, &version).await
            });
            let Some(stats) = counted.await? else {
                return Ok(None);
            };
            known.insert((i, step.hash), stats.rows);
            rows += stats.rows;
        }
        Ok(Some(rows))
    }
}

impl Shards {
    pub async fn versions(&self, after: Option<Hash>, limit: usize) -> Result<Vec<Moment>> {
        let mut walk = Walk::new(&self.shards).await?;
        let mut known = HashMap::new();
        let mut moments = Vec::new();
        let mut skipping = after.is_some();
        while moments.len() < limit {
            if skipping {
                skipping = Some(walk.version()) != after;
            } else {
                let Some(rows) = walk.rows(&mut known).await? else {
                    break;
                };
                let (version, time) = (walk.version(), walk.time());
                moments.push(Moment {
                    version,
                    time,
                    rows,
                });
            }
            if !walk.back().await? {
                break;
            }
        }
        Ok(moments)
    }

    pub async fn restore(&self, version: Hash, keep: Option<Duration>) -> Result<Hash> {
        let hashes = self.find(version, keep).await?;
        let restored = (self.shards.iter().zip(hashes)).map(|(shard, hash)| shard.restore(hash));
        try_join_all(restored).await?;
        Ok(Walk::new(&self.shards).await?.version())
    }

    pub async fn fork_at(
        &self,
        branch: &str,
        version: Hash,
        keep: Option<Duration>,
    ) -> Result<Self> {
        let hashes = self.find(version, keep).await?;
        let forks =
            (self.shards.iter().zip(hashes)).map(|(shard, hash)| shard.fork_at(branch, hash));
        Ok(Self {
            shards: try_join_all(forks).await?,
            ids: self.ids,
        })
    }

    async fn find(&self, version: Hash, keep: Option<Duration>) -> Result<Vec<Hash>> {
        let mut walk = Walk::new(&self.shards).await?;
        let mut ended = None;
        while walk.version() != version {
            ended = Some(walk.time());
            if !walk.back().await? {
                return Err(Error::VersionNotFound(version.to_string()));
            }
        }
        if let (Some(keep), Some(ended)) = (keep, ended)
            && ended < Utc::now() - keep
        {
            return Err(invalid(format!(
                "index version `{version}` is older than the retention period; \
                 garbage collection may have deleted it"
            )));
        }
        Ok(walk.at.iter().map(|step| step.hash).collect())
    }
}

impl Index {
    async fn step(&self, hash: Hash) -> Result<Option<Step>> {
        found(async {
            let meta = self.storage.store.head(&object_path(hash)).await?;
            let version = self.storage.version(hash).await?;
            Ok(Step {
                hash,
                time: meta.last_modified,
                parent: version.parent,
            })
        })
        .await
    }

    async fn restore(&self, hash: Hash) -> Result<()> {
        if self.storage.head(&self.branch).await?.version == hash {
            return Ok(());
        }
        let since = SystemTime::now();
        let old = self.storage.version(hash).await?;
        let restore = |current: &Version| {
            Some(Version {
                schema: current.schema.merge(&old.schema).ok()?,
                next_seq: current.next_seq.max(old.next_seq),
                ..(*old).clone()
            })
        };
        let written = Written::new();
        let saved = self.storage.saved(&self.branch, &written, restore).await?;
        let Some((before, moved)) = saved else {
            return Ok(());
        };
        if self.whole(since, moved).await? {
            return Ok(());
        }
        let head = self.storage.head(&self.branch).await?;
        if head.version == moved {
            let hints = hints(&*self.storage.version(before).await?);
            let store = self.storage.store.as_ref();
            head::advance(store, &self.branch, &head, before, &hints).await?;
        }
        Err(Error::VersionNotFound(hash.to_string()))
    }

    async fn fork_at(&self, branch: &str, hash: Hash) -> Result<Index> {
        let since = SystemTime::now();
        let version = self.storage.version(hash).await?;
        let store = self.storage.store.as_ref();
        head::create(store, branch, hash, &hints(&version)).await?;
        if !self.whole(since, hash).await? {
            head::delete(store, branch).await?;
            return Err(Error::VersionNotFound(hash.to_string()));
        }
        Ok(self.other(branch))
    }

    async fn whole(&self, since: SystemTime, hash: Hash) -> Result<bool> {
        let store = self.storage.store.as_ref();
        if !lock::settle(store, since).await? {
            return Ok(true);
        }
        let Some(version) = found(self.storage.version(hash)).await? else {
            return Ok(false);
        };
        let mut wanted = gc::used_by(self.storage.store.clone(), &version).await?;
        wanted.insert(hash);
        gc::all_there(store, &wanted).await
    }
}

async fn found<T>(read: impl Future<Output = Result<T>>) -> Result<Option<T>> {
    match read.await {
        Ok(value) => Ok(Some(value)),
        Err(
            Error::Store(object_store::Error::NotFound { .. })
            | Error::Core(skywake_core::Error::Store(object_store::Error::NotFound { .. })),
        ) => Ok(None),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests;
