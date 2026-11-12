//! Shared work split into a fixed number of slots, each owned by one server at a time.

use std::collections::HashMap;
use std::sync::Arc;

use futures::{StreamExt, TryStreamExt, stream};
use object_store::path::Path;
use object_store::{ObjectStore, ObjectStoreExt, UpdateVersion};
use serde::{Deserialize, Serialize};

use super::Registration;
use crate::net::score;
use crate::store::io::{found, put_mode, version_of};

const AT_ONCE: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Change {
    Take { slot: u32, epoch: u64 },
    Give { slot: u32, epoch: u64 },
}

pub struct Slots {
    folder: Path,
    count: u32,
    store: Arc<dyn ObjectStore>,
    registration: Arc<Registration>,
}

#[derive(Serialize, Deserialize, Default, Debug)]
struct Claim {
    owner: Option<String>,
    epoch: u64,
}

impl Slots {
    pub fn new(
        kind: &str,
        count: u32,
        store: Arc<dyn ObjectStore>,
        registration: Arc<Registration>,
    ) -> Self {
        Self {
            folder: folder(kind),
            count,
            store,
            registration,
        }
    }

    pub fn count(&self) -> u32 {
        self.count
    }

    pub async fn plan(&self, held: &HashMap<u32, u64>) -> object_store::Result<Vec<Change>> {
        // A server the others may already count as gone must not take or give slots.
        if !self.registration.is_fresh() {
            return Ok(Vec::new());
        }
        if !self.registration.is_settled() {
            return Ok(Vec::new());
        }
        let me = self.registration.me();
        let listing = self.registration.members().listing();
        let mut candidates = listing.live.clone();
        if !self.registration.is_leaving() && !candidates.iter().any(|url| url == me) {
            candidates.push(me.to_string());
        }
        if candidates.is_empty() {
            return Ok(Vec::new());
        }
        let owners = owners(&candidates, self.count);
        let mut changes: Vec<Change> = held
            .iter()
            .filter(|(slot, _)| {
                owners
                    .get(**slot as usize)
                    .is_some_and(|owner| *owner != me)
            })
            .map(|(&slot, &epoch)| Change::Give { slot, epoch })
            .collect();
        let wanted = (0..self.count).filter(|slot| {
            owners.get(*slot as usize).is_some_and(|owner| *owner == me) && !held.contains_key(slot)
        });
        let taken: Vec<Option<Change>> = stream::iter(wanted)
            .map(|slot| self.try_take(slot, &listing))
            .buffer_unordered(AT_ONCE)
            .try_collect()
            .await?;
        changes.extend(taken.into_iter().flatten());
        Ok(changes)
    }

    async fn try_take(
        &self,
        slot: u32,
        listing: &super::Listing,
    ) -> object_store::Result<Option<Change>> {
        let me = self.registration.me();
        let (claim, version) = read(self.store.as_ref(), &self.path(slot)).await?;
        let free = match &claim.owner {
            None => true,
            Some(owner) => owner == me || !listing.is_up(owner),
        };
        if !free {
            return Ok(None);
        }
        let taken = Claim {
            owner: Some(me.to_string()),
            epoch: claim.epoch + 1,
        };
        let won = self.write(slot, &taken, version).await?;
        Ok(won.then_some(Change::Take {
            slot,
            epoch: taken.epoch,
        }))
    }

    pub async fn release(&self, slot: u32, epoch: u64) -> object_store::Result<()> {
        self.free(slot, Some(epoch)).await
    }

    pub async fn abandon(&self, slot: u32) -> object_store::Result<()> {
        self.free(slot, None).await
    }

    async fn free(&self, slot: u32, epoch: Option<u64>) -> object_store::Result<()> {
        let (claim, version) = read(self.store.as_ref(), &self.path(slot)).await?;
        let mine = claim.owner.as_deref() == Some(self.registration.me());
        if !mine || epoch.is_some_and(|epoch| epoch != claim.epoch) {
            return Ok(());
        }
        let free = Claim {
            owner: None,
            epoch: claim.epoch,
        };
        self.write(slot, &free, version).await?;
        Ok(())
    }

    async fn write(
        &self,
        slot: u32,
        claim: &Claim,
        version: Option<UpdateVersion>,
    ) -> object_store::Result<bool> {
        let bytes = serde_json::to_vec(claim).expect("a claim is plain data");
        match self
            .store
            .put_opts(&self.path(slot), bytes.into(), put_mode(version).into())
            .await
        {
            Ok(_) => Ok(true),
            Err(
                object_store::Error::Precondition { .. }
                | object_store::Error::AlreadyExists { .. },
            ) => Ok(false),
            Err(error) => Err(error),
        }
    }

    fn path(&self, slot: u32) -> Path {
        self.folder.clone().join(slot.to_string())
    }
}

// Work done under an older epoch must not reach the bucket.
pub async fn epoch(store: &dyn ObjectStore, kind: &str, slot: u32) -> object_store::Result<u64> {
    let path = folder(kind).join(slot.to_string());
    Ok(read(store, &path).await?.0.epoch)
}

async fn read(
    store: &dyn ObjectStore,
    path: &Path,
) -> object_store::Result<(Claim, Option<UpdateVersion>)> {
    let Some(object) = found(store.get(path).await)? else {
        return Ok((Claim::default(), None));
    };
    let version = version_of(&object.meta);
    let bytes = object.bytes().await?;
    let claim = serde_json::from_slice(&bytes).unwrap_or_default();
    Ok((claim, Some(version)))
}

fn folder(kind: &str) -> Path {
    Path::from(format!("slots/{kind}"))
}

pub fn preferred(nodes: &[String], slot: u32) -> &str {
    nodes
        .iter()
        .max_by_key(|node| (rank(node, slot), node.as_str()))
        .map(String::as_str)
        .unwrap_or_default()
}

pub fn rank(node: &str, slot: u32) -> u64 {
    mix(id(node), slot)
}

fn owners(nodes: &[String], count: u32) -> Vec<&str> {
    let ids: Vec<(u64, &str)> = nodes.iter().map(|node| (id(node), node.as_str())).collect();
    (0..count)
        .map(|slot| {
            ids.iter()
                .max_by_key(|(id, node)| (mix(*id, slot), *node))
                .map(|(_, node)| *node)
                .unwrap_or_default()
        })
        .collect()
}

fn id(node: &str) -> u64 {
    score(node)
}

fn mix(id: u64, slot: u32) -> u64 {
    let mut z = id ^ u64::from(slot).wrapping_mul(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cluster::members::RENEW;
    use object_store::memory::InMemory;

    async fn taken(slots: &Slots, held: &mut HashMap<u32, u64>) -> Vec<(u32, u64)> {
        let mut gives = Vec::new();
        for change in slots.plan(held).await.unwrap() {
            match change {
                Change::Take { slot, epoch } => {
                    held.insert(slot, epoch);
                }
                Change::Give { slot, epoch } => gives.push((slot, epoch)),
            }
        }
        gives
    }

    #[tokio::test]
    async fn a_server_that_joins_gets_its_share_once_the_owner_gives_it_up() {
        let store: Arc<dyn ObjectStore> = Arc::new(InMemory::new());
        let a = Registration::start("test", "http://a".into(), None, store.clone())
            .await
            .unwrap();
        tokio::time::sleep(RENEW).await;
        let on_a = Slots::new("test", 64, store.clone(), a.clone());
        let mut held_a = HashMap::new();
        assert!(taken(&on_a, &mut held_a).await.is_empty());
        assert_eq!(held_a.len(), 64, "alone, it takes every slot");

        let b = Registration::start("test", "http://b".into(), None, store.clone())
            .await
            .unwrap();
        tokio::time::sleep(RENEW + std::time::Duration::from_millis(500)).await;
        let on_b = Slots::new("test", 64, store.clone(), b.clone());
        let mut held_b = HashMap::new();
        assert!(taken(&on_b, &mut held_b).await.is_empty());
        assert!(
            held_b.is_empty(),
            "nothing moves before its owner gives it up"
        );

        let gives = taken(&on_a, &mut held_a).await;
        assert!((16..48).contains(&gives.len()), "{} given", gives.len());
        for (slot, epoch) in &gives {
            held_a.remove(slot);
            on_a.release(*slot, *epoch).await.unwrap();
        }
        taken(&on_b, &mut held_b).await;
        let mut moved: Vec<u32> = held_b.keys().copied().collect();
        let mut given: Vec<u32> = gives.iter().map(|(slot, _)| *slot).collect();
        moved.sort();
        given.sort();
        assert_eq!(moved, given);
        assert!(
            held_b.values().all(|epoch| *epoch == 2),
            "a new epoch fences the old owner"
        );
        assert_eq!(epoch(store.as_ref(), "test", given[0]).await.unwrap(), 2);
    }

    fn servers(n: usize) -> Vec<String> {
        (0..n).map(|i| format!("http://10.0.0.{i}:7070")).collect()
    }

    #[test]
    fn every_server_and_client_picks_the_same_owner() {
        let nodes = servers(7);
        let all = owners(&nodes, 4096);
        for slot in [0, 1, 99, 4095] {
            assert_eq!(all[slot as usize], preferred(&nodes, slot));
        }
    }

    #[test]
    fn slots_spread_evenly_and_a_new_server_moves_only_its_share() {
        let before = servers(16);
        let owned = owners(&before, 4096);
        let mut counts: HashMap<&str, usize> = HashMap::new();
        for owner in &owned {
            *counts.entry(owner).or_default() += 1;
        }
        assert!(
            counts.values().all(|n| (180..340).contains(n)),
            "{counts:?}"
        );

        let after = servers(17);
        let moved = owners(&after, 4096)
            .iter()
            .zip(&owned)
            .filter(|(now, was)| now != was)
            .count();
        assert!(moved < 4096 / 17 + 80, "{moved} moved");
    }
}
