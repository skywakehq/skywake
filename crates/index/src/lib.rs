//! Skywake Index: documents searched by vector, text and filters.

#[cfg(feature = "bench")]
#[doc(hidden)]
pub mod bench;
mod build;
mod error;
mod export;
mod filter;
mod format;
mod history;
mod model;
mod read;
mod shards;
mod store;
mod text;
mod vector;
mod write;

use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use object_store::ObjectStore;
use skywake_core::cache::ChunkCache;

pub use build::{BuildPolicy, Builder};
pub use error::{Error, Result};
pub use export::Export;
pub use export::parquet::ParquetExport;
use format::Version;
pub use history::{Moment, gc};
pub use model::{
    Attributes, Column, Condition, Doc, Element, Filter, Hit, Id, IdKind, Kind, Metric, Operand,
    Pattern, Per, Query, Schema, Score, Syntax, Value, datetime_text, parse_datetime, parse_uuid,
    uuid_text,
};
pub use read::snapshot::{Aggregate, Group, Measure, Order, Rank, Ranked, Row, Snapshot};
pub use read::stats::Stats;
pub use shards::{MAX_SHARDS, Shards, ShardsExport, ShardsSnapshot, shard_folder};
pub use store::reads::{Reads, counted};
use store::{Storage, Written, head};
pub use text::{
    FusedHit, Highlight, Hybrid, Language, Match, Search, TextHit, TextOptions, TextQuery,
    sync_misses,
};
pub use write::change::{Affected, Changes, Counts, Patch, Write};
use write::{Op, Writer};

pub const MAIN: &str = "main";

#[derive(Clone, Debug)]
pub struct Options {
    pub cache_bytes: usize,
    pub build_bytes: usize,
    pub commit_rows: usize,
    pub queued_rows: usize,
    pub unbuilt_bytes: u64,
    pub cluster_rows: usize,
    pub disk: Option<Arc<ChunkCache>>,
    pub shared: Option<String>,
    /// Lets a build larger than `build_bytes` write its rows once to a
    /// temporary folder, unencrypted, instead of reading every segment from
    /// the bucket again for each part. Off for an index with its own key.
    pub spill: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            cache_bytes: 1 << 30,
            build_bytes: 1 << 30,
            commit_rows: 10_000,
            queued_rows: 100_000,
            unbuilt_bytes: 2 << 30,
            cluster_rows: 2000,
            disk: None,
            shared: None,
            spill: true,
        }
    }
}

const KEEP_OPENED: Duration = Duration::from_secs(1);

const EVENTUAL: Duration = Duration::from_secs(60);

type Opened = (Instant, Arc<Version>);

type Known = (u64, Instant, Arc<Version>);

#[derive(Clone)]
pub struct Index {
    storage: Arc<Storage>,
    branch: String,
    writer: Arc<Writer>,
    options: Options,
    opened: Arc<Mutex<Option<Opened>>>,
    seen: Arc<Mutex<Option<Opened>>>,
    known: Arc<Mutex<Option<Known>>>,
}

impl Index {
    pub async fn create(store: Arc<dyn ObjectStore>, schema: Schema) -> Result<Self> {
        Self::create_with(store, schema, Options::default()).await
    }

    pub async fn create_with(
        store: Arc<dyn ObjectStore>,
        schema: Schema,
        options: Options,
    ) -> Result<Self> {
        schema.check()?;
        skywake_core::kind::mark(store.as_ref(), skywake_core::kind::Kind::Index).await?;
        let index = Self::at(store, MAIN, options);
        let version = Version::new(schema);
        let written = Written::new();
        let hash = index.storage.put_version(&version).await?;
        index.storage.settle(&written, hash).await?;
        head::create(index.storage.store.as_ref(), MAIN, hash, &[]).await?;
        Ok(index)
    }

    pub async fn open(store: Arc<dyn ObjectStore>, branch: &str) -> Result<Self> {
        Self::open_with(store, branch, Options::default()).await
    }

    pub async fn open_with(
        store: Arc<dyn ObjectStore>,
        branch: &str,
        options: Options,
    ) -> Result<Self> {
        let index = Self::at(store, branch, options);
        let version = index.storage.current(branch).await?;
        *lock(&index.opened) = Some((Instant::now(), version.clone()));
        *lock(&index.seen) = Some((Instant::now(), version));
        Ok(index)
    }

    fn at(store: Arc<dyn ObjectStore>, branch: &str, options: Options) -> Self {
        Self {
            storage: Arc::new(Storage::new(
                store,
                options.cache_bytes,
                options.disk.clone(),
                options.shared.clone(),
            )),
            branch: branch.to_string(),
            writer: Arc::new(Writer::new(options.commit_rows, options.queued_rows)),
            options,
            opened: Arc::default(),
            seen: Arc::default(),
            known: Arc::default(),
        }
    }

    pub fn branch(&self) -> &str {
        &self.branch
    }

    pub async fn schema(&self) -> Result<Schema> {
        Ok(self.version().await?.schema.clone())
    }

    pub async fn alter(&self, schema: &Schema) -> Result<Schema> {
        self.version().await?.schema.merge(schema)?.check()?;
        let merge = |current: &Version| {
            let merged = current.schema.merge(schema).ok()?;
            (merged != current.schema).then(|| Version {
                schema: merged,
                ..current.clone()
            })
        };
        self.storage
            .save(&self.branch, &Written::new(), merge)
            .await?;
        self.schema().await
    }

    /// Takes attributes out: clears their values, then the schema.
    pub async fn drop_attributes(&self, names: &[String]) -> Result<Schema> {
        self.version().await?.schema.without(names)?.check()?;
        let present = Filter::Or(names.iter().map(|n| Filter::Exists(n.clone())).collect());
        let changes = names.iter().map(|n| (n.clone(), None)).collect();
        self.write(Write {
            patch_by: Some((present, changes)),
            ..Write::default()
        })
        .await?;
        let drop = |current: &Version| {
            let left = current.schema.without(names).ok()?;
            Some(Version {
                schema: left,
                ..current.clone()
            })
        };
        self.storage
            .save(&self.branch, &Written::new(), drop)
            .await?;
        self.schema().await
    }

    pub async fn merge(&self, from: &str) -> Result<u64> {
        write::merge::merge(&self.storage, &self.branch, from).await
    }

    pub async fn fork(&self, branch: &str) -> Result<Self> {
        let head = self.storage.head(&self.branch).await?;
        let store = self.storage.store.as_ref();
        head::create(store, branch, head.version, &head.hints).await?;
        Ok(self.other(branch))
    }

    fn other(&self, branch: &str) -> Self {
        Self {
            branch: branch.to_string(),
            writer: Arc::new(Writer::new(
                self.options.commit_rows,
                self.options.queued_rows,
            )),
            opened: Arc::default(),
            seen: Arc::default(),
            known: Arc::default(),
            ..self.clone()
        }
    }

    pub async fn list_branches(&self) -> Result<Vec<String>> {
        head::list(self.storage.store.as_ref()).await
    }

    pub async fn delete_branch(&self, branch: &str) -> Result<()> {
        head::delete(self.storage.store.as_ref(), branch).await
    }

    pub async fn upsert(&self, mut docs: Vec<Doc>) -> Result<()> {
        if docs.is_empty() {
            return Ok(());
        }
        let schema = self.writable().await?;
        for doc in &mut docs {
            write::check(&schema, doc)?;
        }
        let op = Op::Upsert(docs);
        (self.writer)
            .write(&self.storage, &self.branch, &schema, op)
            .await
    }

    pub async fn delete(&self, ids: Vec<Id>) -> Result<()> {
        if ids.is_empty() {
            return Ok(());
        }
        let schema = self.writable().await?;
        let ids = (ids.into_iter().map(|id| schema.id.check(id))).collect::<Result<_>>()?;
        let op = Op::Delete(ids);
        (self.writer)
            .write(&self.storage, &self.branch, &schema, op)
            .await
    }

    pub async fn snapshot(&self) -> Result<Snapshot> {
        Ok(Snapshot {
            storage: self.storage.clone(),
            version: self.version().await?,
        })
    }

    pub async fn recent_snapshot(&self) -> Result<Snapshot> {
        let seen = lock(&self.seen).clone();
        let version = match seen {
            Some((at, version)) if at.elapsed() <= EVENTUAL => version,
            _ => self.version().await?,
        };
        Ok(Snapshot {
            storage: self.storage.clone(),
            version,
        })
    }

    /// The newest snapshot, given `epoch`: a number the caller raises whenever
    /// the branch may have moved, and never repeats. While it stays the same, the
    /// head is not read again, for up to a minute, so a build's new version is
    /// picked up later. A read that started at an older epoch never replaces the
    /// head kept for a newer one.
    pub async fn snapshot_for(&self, epoch: u64) -> Result<Snapshot> {
        let known = lock(&self.known).clone();
        let version = match known {
            Some((seen, at, version)) if seen == epoch && at.elapsed() <= EVENTUAL => version,
            _ => {
                let version = self.storage.current(&self.branch).await?;
                let mut known = lock(&self.known);
                if known.as_ref().is_none_or(|(seen, ..)| *seen <= epoch) {
                    *known = Some((epoch, Instant::now(), version.clone()));
                }
                version
            }
        };
        Ok(Snapshot {
            storage: self.storage.clone(),
            version,
        })
    }

    pub async fn query(&self, query: &Query) -> Result<Vec<Hit>> {
        self.snapshot().await?.query(query).await
    }

    pub async fn search(&self, query: &TextQuery) -> Result<Vec<TextHit>> {
        self.snapshot().await?.search(query).await
    }

    pub async fn hybrid(&self, hybrid: &Hybrid) -> Result<Vec<FusedHit>> {
        self.snapshot().await?.hybrid(hybrid).await
    }

    pub async fn order(&self, order: &Order) -> Result<Vec<Row>> {
        self.snapshot().await?.order(order).await
    }

    pub async fn rank(&self, rank: &Rank) -> Result<Vec<Ranked>> {
        self.snapshot().await?.rank(rank).await
    }

    pub async fn aggregate(&self, aggregate: &Aggregate) -> Result<Vec<Group>> {
        self.snapshot().await?.aggregate(aggregate).await
    }

    pub async fn build(&self) -> Result<()> {
        self.build_inner(false).await.map(drop)
    }

    pub async fn rebuild(&self) -> Result<()> {
        self.build_inner(true).await.map(drop)
    }

    async fn build_inner(&self, full: bool) -> Result<bool> {
        let options = &self.options;
        let (budget, rows) = (options.build_bytes, options.cluster_rows);
        let spill = options.spill;
        build::build(&self.storage, &self.branch, budget, rows, spill, full).await
    }

    pub async fn stats(&self) -> Result<Stats> {
        let version = self.version().await?;
        read::stats::stats(&self.storage, &version).await
    }

    pub fn spawn_builder(&self, policy: BuildPolicy) -> Builder {
        build::spawn(self.clone(), policy)
    }

    async fn writable(&self) -> Result<Schema> {
        let version = self.version().await?;
        let unbuilt: u64 = version.tail().iter().map(|segment| segment.bytes).sum();
        if unbuilt > self.options.unbuilt_bytes {
            return Err(Error::Busy(format!(
                "index branch `{}` has {} MiB waiting for a build; try again soon",
                self.branch,
                unbuilt >> 20
            )));
        }
        Ok(version.schema.clone())
    }

    async fn version(&self) -> Result<Arc<Version>> {
        let opened = lock(&self.opened).take();
        match opened {
            Some((at, version)) if at.elapsed() <= KEEP_OPENED => Ok(version),
            _ => {
                let version = self.storage.current(&self.branch).await?;
                *lock(&self.seen) = Some((Instant::now(), version.clone()));
                Ok(version)
            }
        }
    }

    async fn written(&self) {
        self.writer.written.notified().await
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

pub(crate) fn invalid(message: impl Into<String>) -> Error {
    Error::Invalid(message.into())
}

#[cfg(test)]
mod testing;
#[cfg(test)]
mod tests;
