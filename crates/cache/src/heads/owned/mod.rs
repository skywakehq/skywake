//! One slot this server owns: its heads in memory, every change on the write log before the answer.

mod answer;
mod flush;

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use object_store::{ObjectStore, UpdateVersion};
use serde::{Deserialize, Serialize};
use skywake_core::cache::{LogError, LogRecord, WriteLog};
use skywake_core::heads::{Held, Stored};
use skywake_core::store::refs::{self, Slot};
use tokio::sync::Mutex;
use tracing::warn;

use super::listings::Listings;
use crate::in_folder;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Hash)]
pub(super) struct Name {
    pub(super) folder: String,
    pub(super) branch: String,
}

pub(super) struct Owned {
    pub(super) slot: u32,
    pub(super) epoch: u64,
    sealed: Instant,
    key: String,
    state: Mutex<State>,
}

#[derive(Default)]
struct State {
    heads: HashMap<Name, Entry>,
    next: u64,
    trimmed: u64,
}

#[derive(Default)]
struct Entry {
    head: Option<Stored>,
    bucket: Option<UpdateVersion>,
    known: bool,
    dirty: Option<u64>,
    keep_commit: bool,
    objects: Vec<Held>,
}

#[derive(Serialize, Deserialize)]
struct Change {
    name: Name,
    head: Option<Stored>,
    keep_commit: bool,
    objects: Vec<Held>,
}

pub(super) enum Refused {
    Lost,
    Failed,
}

impl Owned {
    pub(super) async fn load(slot: u32, epoch: u64, log: &WriteLog) -> anyhow::Result<Self> {
        let key = WriteLog::key("heads", &format!("slot-{slot}"));
        let mut records = log
            .seal(&key, epoch)
            .await
            .map_err(|error| anyhow::anyhow!("{error}"))?;
        let sealed = Instant::now();
        records.sort_by_key(|record| (record.claim, record.n));
        let mut heads: HashMap<Name, Entry> = HashMap::new();
        let mut replayed = Vec::new();
        for record in records {
            let changes: Vec<Change> = postcard::from_bytes(&record.data)?;
            for change in changes {
                heads.entry(change.name.clone()).or_default().apply(&change);
                replayed.push(change);
            }
        }
        let owned = Self {
            slot,
            epoch,
            sealed,
            key,
            state: Mutex::new(State {
                heads,
                ..State::default()
            }),
        };
        if !replayed.is_empty() {
            let mut state = owned.state.lock().await;
            let n = owned
                .append(&mut state, log, &replayed)
                .await
                .map_err(|_| anyhow::anyhow!("can't log the replayed heads"))?;
            for change in &replayed {
                if let Some(entry) = state.heads.get_mut(&change.name) {
                    entry.dirty = Some(n);
                }
            }
        }
        Ok(owned)
    }

    pub(super) async fn dirty(&self) -> bool {
        self.state
            .lock()
            .await
            .heads
            .values()
            .any(|entry| entry.dirty.is_some())
    }

    async fn append(
        &self,
        state: &mut State,
        log: &WriteLog,
        changes: &[Change],
    ) -> Result<u64, Refused> {
        let n = state.next;
        let record = LogRecord {
            claim: self.epoch,
            n,
            max_tag: n,
            data: postcard::to_stdvec(changes).map_err(|_| Refused::Failed)?,
        };
        state.next += 1;
        match log.append(&self.key, &record).await {
            Ok(()) => Ok(n),
            Err(LogError::TakenOver) => Err(Refused::Lost),
            Err(LogError::Unreachable) => Err(Refused::Failed),
        }
    }
}

impl Entry {
    fn known() -> Self {
        Self {
            known: true,
            ..Self::default()
        }
    }

    fn apply(&mut self, change: &Change) {
        self.head = change.head.clone();
        self.keep_commit |= change.keep_commit;
        self.objects.extend(change.objects.iter().cloned());
    }
}

impl State {
    async fn load(
        &mut self,
        listings: &Listings,
        sealed: Instant,
        root: &Arc<dyn ObjectStore>,
        name: &Name,
    ) -> Result<&Entry, Refused> {
        if !self.heads.contains_key(name) {
            let entry = read(listings, sealed, root, name).await?;
            self.heads.insert(name.clone(), entry);
        }
        Ok(&self.heads[name])
    }
}

async fn read(
    listings: &Listings,
    sealed: Instant,
    root: &Arc<dyn ObjectStore>,
    name: &Name,
) -> Result<Entry, Refused> {
    let names = listings
        .names(root, &name.folder, sealed)
        .await
        .map_err(|error| {
            warn!(%error, folder = name.folder, "can't list branch heads in the bucket");
            Refused::Failed
        })?;
    if !names.contains(&name.branch) {
        return Ok(Entry::known());
    }
    let store = in_folder(root, &name.folder);
    let found = refs::read(store.as_ref(), &name.branch)
        .await
        .map_err(|error| {
            warn!(%error, branch = name.branch, "can't read a branch head from the bucket");
            Refused::Failed
        })?;
    Ok(match found {
        Slot::Live(head) => Entry {
            bucket: head.bucket_version().cloned(),
            head: Some(head.stored()),
            ..Entry::known()
        },
        Slot::Deleted(version) => Entry {
            bucket: Some(version),
            ..Entry::known()
        },
        Slot::Missing => Entry::known(),
    })
}
