//! Branch heads owned by cache servers: names spread over slots, each server serving its own.

mod cleanup;
mod listings;
mod owned;
mod route;

pub(crate) use route::route;

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};

use futures::StreamExt;
use skywake_core::Objects;
use skywake_core::cache::WriteLog;
use skywake_core::cluster::members::LEASE;
use skywake_core::cluster::slots::{Change, preferred};
use skywake_core::cluster::{Registration, Slots};
use skywake_core::heads::SLOTS;
use tokio::sync::Notify;
use tracing::{info, warn};

use cleanup::Cleanup;
use listings::Listings;
use owned::Owned;

use crate::hold;

const PRIMING: usize = 16;
const STEP: Duration = Duration::from_secs(1);
const AT_ONCE: usize = 32;

pub(crate) struct Heads {
    registration: Arc<Registration>,
    claims: Slots,
    objects: Objects,
    log: Arc<WriteLog>,
    held: Mutex<HashMap<u32, u64>>,
    owned: Mutex<HashMap<u32, Arc<Owned>>>,
    loading: Mutex<HashSet<u32>>,
    orphans: Mutex<HashSet<u32>>,
    loads: Arc<tokio::sync::Semaphore>,
    changed: Notify,
    cleanup: Cleanup,
    listings: Listings,
}

impl Heads {
    pub(crate) fn start(
        registration: Arc<Registration>,
        objects: Objects,
        log: WriteLog,
    ) -> Arc<Self> {
        let claims = Slots::new(
            "heads",
            SLOTS,
            objects.store().clone(),
            registration.clone(),
        );
        let heads = Arc::new(Self {
            registration,
            claims,
            objects,
            log: Arc::new(log),
            held: Mutex::default(),
            owned: Mutex::default(),
            loading: Mutex::default(),
            orphans: Mutex::default(),
            loads: Arc::new(tokio::sync::Semaphore::new(AT_ONCE)),
            changed: Notify::new(),
            cleanup: Cleanup::default(),
            listings: Listings::default(),
        });
        tokio::spawn(stepping(Arc::downgrade(&heads)));
        tokio::spawn(flushing(Arc::downgrade(&heads)));
        tokio::spawn(watching_cleanup(Arc::downgrade(&heads)));
        heads
    }

    fn me(&self) -> &str {
        self.registration.me()
    }

    fn serving(&self, slot: u32) -> Option<Arc<Owned>> {
        if !self.registration.is_fresh() {
            return None;
        }
        hold(&self.owned).get(&slot).cloned()
    }

    fn owner(&self, slot: u32) -> Option<String> {
        let listing = self.registration.members().listing();
        let owner = preferred(&listing.live, slot);
        (!owner.is_empty() && owner != self.me()).then(|| owner.to_string())
    }

    fn lost(&self, slot: u32) {
        let mut held = hold(&self.held);
        held.remove(&slot);
        hold(&self.owned).remove(&slot);
    }

    pub(crate) async fn leave(self: &Arc<Self>) {
        let started = Instant::now();
        while started.elapsed() < LEASE * 2 {
            if let Err(error) = self.step().await {
                warn!(%error, "can't give up slots of branch heads");
            }
            if hold(&self.held).is_empty() {
                info!("handed every slot of branch heads to other servers");
                return;
            }
            tokio::time::sleep(STEP).await;
        }
        warn!("still owning slots of branch heads; they move once this server's record lapses");
    }

    async fn step(self: &Arc<Self>) -> anyhow::Result<()> {
        if !self.registration.is_fresh() {
            let mut held = hold(&self.held);
            hold(&self.orphans).extend(held.keys());
            held.clear();
            hold(&self.owned).clear();
            return Ok(());
        }
        self.free_orphans().await;
        let held = hold(&self.held).clone();
        let mut takes = Vec::new();
        for (&slot, &epoch) in &held {
            let idle =
                !hold(&self.owned).contains_key(&slot) && !hold(&self.loading).contains(&slot);
            if idle {
                takes.push((slot, epoch));
            }
        }
        let mut gives = Vec::new();
        for change in self.claims.plan(&held).await? {
            match change {
                Change::Take { slot, epoch } => {
                    hold(&self.held).insert(slot, epoch);
                    takes.push((slot, epoch));
                }
                Change::Give { slot, epoch } => gives.push((slot, epoch)),
            }
        }
        // A server that joined moments ago may already hold records, so a seal must ask it too.
        if !takes.is_empty()
            && let Err(error) = self.registration.refresh().await
        {
            warn!(%error, "can't list the servers before taking slots; taking them later");
            for (slot, _) in takes {
                hold(&self.held).remove(&slot);
                hold(&self.orphans).insert(slot);
            }
            return Ok(());
        }
        let takes: Vec<_> = takes
            .into_iter()
            .map(|(slot, epoch)| self.take(slot, epoch))
            .collect();
        futures::stream::iter(gives)
            .for_each_concurrent(AT_ONCE, |(slot, epoch)| self.give(slot, epoch))
            .await;
        if !takes.is_empty() {
            let heads = self.clone();
            tokio::spawn(async move {
                futures::future::join_all(takes).await;
                heads.prime().await;
            });
        }
        Ok(())
    }

    fn take(self: &Arc<Self>, slot: u32, epoch: u64) -> tokio::task::JoinHandle<()> {
        hold(&self.loading).insert(slot);
        let heads = self.clone();
        tokio::spawn(async move {
            let _turn = heads.loads.clone().acquire_owned().await;
            let loaded = Owned::load(slot, epoch, &heads.log).await;
            hold(&heads.loading).remove(&slot);
            match loaded {
                Ok(owned) => {
                    // Under the held lock, so a give in between can't leave it served.
                    let held = hold(&heads.held);
                    if held.get(&slot) == Some(&epoch) {
                        hold(&heads.owned).insert(slot, Arc::new(owned));
                        info!(slot, epoch, "owning a slot of branch heads");
                        heads.changed.notify_one();
                    }
                }
                Err(error) => {
                    warn!(slot, %error, "can't take a slot of branch heads");
                    hold(&heads.held).remove(&slot);
                    hold(&heads.orphans).insert(slot);
                }
            }
        })
    }

    async fn give(&self, slot: u32, epoch: u64) {
        let owned = {
            let mut held = hold(&self.held);
            held.remove(&slot);
            hold(&self.owned).remove(&slot)
        };
        if let Some(owned) = owned {
            owned.flush(&self.log, self.objects.store()).await;
        }
        if let Err(error) = self.claims.release(slot, epoch).await {
            warn!(slot, %error, "can't give up a slot of branch heads; trying again");
            hold(&self.held).insert(slot, epoch);
        }
    }

    async fn free_orphans(&self) {
        let orphans: Vec<u32> = hold(&self.orphans).iter().copied().collect();
        for slot in orphans {
            if self.owner(slot).is_none() {
                hold(&self.orphans).remove(&slot);
                continue;
            }
            match self.claims.abandon(slot).await {
                Ok(()) => {
                    hold(&self.orphans).remove(&slot);
                }
                Err(error) => warn!(slot, %error, "can't free a slot of branch heads"),
            }
        }
    }

    async fn prime(&self) {
        let root = self.objects.store();
        futures::stream::iter(self.listings.folders())
            .for_each_concurrent(PRIMING, |folder| async move {
                if let Err(error) = self.listings.list(root, &folder).await {
                    warn!(%error, folder, "can't list branch heads in the bucket");
                }
            })
            .await;
    }
}

async fn stepping(heads: Weak<Heads>) {
    while let Some(heads) = heads.upgrade() {
        if let Err(error) = heads.step().await {
            warn!(%error, "can't check the slots of branch heads");
        }
        drop(heads);
        tokio::time::sleep(STEP + jitter(STEP / 2)).await;
    }
}

async fn watching_cleanup(heads: Weak<Heads>) {
    while let Some(heads) = heads.upgrade() {
        heads.cleanup.refresh(heads.objects.store().as_ref()).await;
        drop(heads);
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}

async fn flushing(heads: Weak<Heads>) {
    while let Some(heads) = heads.upgrade() {
        let owned: Vec<Arc<Owned>> = hold(&heads.owned).values().cloned().collect();
        for slot in &owned {
            if heads.serving(slot.slot).is_some() {
                slot.flush(&heads.log, heads.objects.store()).await;
            }
        }
        let mut dirty = false;
        for slot in &owned {
            dirty |= slot.dirty().await;
        }
        if dirty {
            tokio::time::sleep(Duration::from_millis(200)).await;
        } else {
            let changed = heads.changed.notified();
            let _ = tokio::time::timeout(Duration::from_secs(1), changed).await;
        }
    }
}

fn jitter(most: Duration) -> Duration {
    let seed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let random = u64::from_le_bytes(
        blake3::hash(&seed.as_nanos().to_le_bytes()).as_bytes()[..8]
            .try_into()
            .unwrap(),
    );
    most.mul_f64((random % 1000) as f64 / 1000.0)
}
