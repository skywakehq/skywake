//! This server's record in the bucket, and the list of servers read from everyone's records.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

use futures::TryStreamExt;
use object_store::path::Path;
use object_store::{ObjectStore, ObjectStoreExt};
use tracing::warn;

use super::members::{FOLDER, LEASE, RENEW, Record};
use super::{Listing, Members};
use crate::clock::millis;
use crate::store::io::found;
use crate::sync::lock;

const FORGET: Duration = Duration::from_secs(3600);
pub const SKEW: Duration = Duration::from_secs(3);

pub struct Registration {
    me: String,
    zone: Option<String>,
    folder: Path,
    store: Arc<dyn ObjectStore>,
    members: Arc<Members>,
    leaving: AtomicBool,
    removed: AtomicBool,
    renewed: Mutex<Option<Instant>>,
    started: Instant,
    read: Mutex<HashMap<Path, (Option<String>, Record)>>,
}

impl Registration {
    pub async fn start(
        kind: &str,
        me: String,
        zone: Option<String>,
        store: Arc<dyn ObjectStore>,
    ) -> object_store::Result<Arc<Self>> {
        let registration = Arc::new(Self {
            me: me.trim_end_matches('/').to_string(),
            zone,
            folder: Path::from(format!("{FOLDER}/{kind}")),
            store,
            members: Members::fixed(Listing::default()),
            leaving: AtomicBool::new(false),
            removed: AtomicBool::new(false),
            renewed: Mutex::default(),
            started: Instant::now(),
            read: Mutex::default(),
        });
        registration.renew().await?;
        tokio::spawn(renewing(Arc::downgrade(&registration)));
        Ok(registration)
    }

    pub fn me(&self) -> &str {
        &self.me
    }

    pub fn members(&self) -> Arc<Members> {
        self.members.clone()
    }

    pub fn is_leaving(&self) -> bool {
        self.leaving.load(Ordering::Relaxed)
    }

    pub fn is_settled(&self) -> bool {
        self.started.elapsed() >= RENEW
    }

    pub fn is_fresh(&self) -> bool {
        lock(&self.renewed).is_some_and(|at| at.elapsed() + SKEW < LEASE)
    }

    pub async fn neighbours(&self) -> object_store::Result<Vec<String>> {
        let now = millis(SystemTime::now());
        let records = self.read_all().await?;
        Ok(records
            .into_iter()
            .filter(|record| record.url != self.me && !record.leaving && record.until >= now)
            .filter(|record| record.zone == self.zone)
            .map(|record| record.url)
            .collect())
    }

    pub async fn leave(&self) -> object_store::Result<()> {
        self.leaving.store(true, Ordering::Relaxed);
        self.renew().await
    }

    pub async fn remove(&self) -> object_store::Result<()> {
        self.removed.store(true, Ordering::Relaxed);
        *lock(&self.renewed) = None;
        self.store.delete(&self.path_of(&self.me)).await
    }

    pub async fn refresh(&self) -> object_store::Result<()> {
        let records = self.read_all().await?;
        self.members
            .set(Listing::of(&records, millis(SystemTime::now())));
        Ok(())
    }

    async fn renew(&self) -> object_store::Result<()> {
        let started = Instant::now();
        let record = Record {
            url: self.me.clone(),
            zone: self.zone.clone(),
            leaving: self.is_leaving(),
            until: 0,
        };
        let bytes = serde_json::to_vec(&record).expect("a record is plain data");
        if self.removed.load(Ordering::Relaxed) {
            return Ok(());
        }
        self.store
            .put(&self.path_of(&self.me), bytes.into())
            .await?;
        if self.removed.load(Ordering::Relaxed) {
            return self.store.delete(&self.path_of(&self.me)).await;
        }
        *lock(&self.renewed) = Some(started);
        let records = self.read_all().await?;
        let now = millis(SystemTime::now());
        for old in records
            .iter()
            .filter(|record| record.until + (FORGET.as_millis() as u64) < now)
        {
            let _ = self.store.delete(&self.path_of(&old.url)).await;
        }
        self.members.set(Listing::of(&records, now));
        Ok(())
    }

    async fn read_all(&self) -> object_store::Result<Vec<Record>> {
        let listed: Vec<_> = self.store.list(Some(&self.folder)).try_collect().await?;
        let mut records = Vec::with_capacity(listed.len());
        for meta in &listed {
            let known = lock(&self.read)
                .get(&meta.location)
                .filter(|(e_tag, _)| e_tag.is_some() && *e_tag == meta.e_tag)
                .map(|(_, record)| record.clone());
            let mut record = match known {
                Some(record) => record,
                None => {
                    let Some(object) = found(self.store.get(&meta.location).await)? else {
                        continue;
                    };
                    let bytes = object.bytes().await?;
                    let Ok(record) = serde_json::from_slice::<Record>(&bytes) else {
                        continue;
                    };
                    let entry = (meta.e_tag.clone(), record.clone());
                    lock(&self.read).insert(meta.location.clone(), entry);
                    record
                }
            };
            record.until =
                meta.last_modified.timestamp_millis().max(0) as u64 + LEASE.as_millis() as u64;
            records.push(record);
        }
        let kept: HashSet<&Path> = listed.iter().map(|meta| &meta.location).collect();
        lock(&self.read).retain(|path, _| kept.contains(path));
        Ok(records)
    }

    fn path_of(&self, url: &str) -> Path {
        let id = blake3::hash(url.as_bytes()).to_hex();
        self.folder.clone().join(&id[..32])
    }
}

async fn renewing(registration: std::sync::Weak<Registration>) {
    loop {
        tokio::time::sleep(RENEW).await;
        let Some(registration) = registration.upgrade() else {
            return;
        };
        if let Err(error) = registration.renew().await {
            warn!(%error, "can't renew this server's record in the bucket");
        }
    }
}
