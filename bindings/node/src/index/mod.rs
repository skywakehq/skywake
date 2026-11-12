//! `Index`: a search index in one store folder; each method names the branch it works on.

mod export;
mod history;
mod open;

use std::collections::HashMap;
use std::collections::hash_map::Entry;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use futures::future::try_join_all;
use futures::lock::Mutex as AsyncMutex;
use futures::{StreamExt, TryStreamExt};
use napi::{Either, Result};
use napi_derive::napi;
use object_store::ObjectStore;
use skywake_index::{
    BuildPolicy, Builder, Error as IndexError, Options, Shards as Branch, ShardsSnapshot, gc,
};

use self::export::{IndexExport, IndexParquetExport};
use self::history::{
    GRACE, IndexCollectOptions, IndexCollected, IndexVersion, days, version, version_to,
};
use self::open::{IndexOpenOptions, disk, stores_of};
use crate::error::{fail_index, invalid};
use crate::index_json::documents::{
    IndexCounts, IndexDoc, IndexWrite, counts_to, doc_from, doc_to, write_from,
};
use crate::index_json::requests::{
    IndexAggregate, IndexHybrid, IndexMultiOptions, IndexOrder, IndexQuery, IndexRequest,
    IndexSearch, Request, aggregate_from, hybrid_from, order_from, query_from, request_from,
    search_from,
};
use crate::index_json::results::{
    IndexAnswers, IndexFusedHit, IndexGroup, IndexHit, IndexResult, IndexRow, IndexSearchHit,
    IndexStats, fused_hit_to, group_to, hit_to, ranked_to, reads_to, row_to, search_hit_to,
    stats_to,
};
use crate::index_json::schema::{IndexSchema, schema_from, schema_to};
use crate::index_json::values::id_from;

#[napi]
pub struct Index {
    store: Arc<dyn ObjectStore>,
    stores: Vec<Arc<dyn ObjectStore>>,
    options: Options,
    every_shard: bool,
    branches: Mutex<HashMap<String, (Branch, Builders)>>,
}

type Builders = HashMap<usize, Builder>;

#[napi]
impl Index {
    #[napi(factory)]
    pub fn open(location: String, options: Option<IndexOpenOptions>) -> Result<Self> {
        let encrypted =
            (options.as_ref()).is_some_and(|o| o.kms_key_id.is_some() || o.customer_key.is_some());
        let shared = options.as_ref().and_then(|o| o.cache_folder.clone());
        let every_shard = options.as_ref().and_then(|o| o.builders).unwrap_or(true);
        let (store, stores) = stores_of(&location, options)?;
        let options = Options {
            disk: if encrypted { None } else { disk()? },
            spill: !encrypted,
            shared,
            ..Options::default()
        };
        Ok(Self {
            store,
            stores,
            options,
            every_shard,
            branches: Mutex::default(),
        })
    }

    #[napi]
    pub async fn create(&self, schema: IndexSchema) -> Result<()> {
        let schema = schema_from(schema)?;
        let main = Branch::create(self.stores.clone(), schema, self.options.clone())
            .await
            .map_err(fail_index)?;
        self.keep(main);
        Ok(())
    }

    #[napi]
    pub async fn schema(&self, branch: String) -> Result<IndexSchema> {
        let schema = self.branch(&branch).await?.schema().await;
        Ok(schema_to(&schema.map_err(fail_index)?))
    }

    #[napi]
    pub async fn alter(&self, branch: String, schema: IndexSchema) -> Result<IndexSchema> {
        let schema = schema_from(schema)?;
        let altered = self.branch(&branch).await?.alter(&schema).await;
        Ok(schema_to(&altered.map_err(fail_index)?))
    }

    #[napi]
    pub async fn drop_attributes(&self, branch: String, names: Vec<String>) -> Result<IndexSchema> {
        let left = self.branch(&branch).await?.drop_attributes(&names).await;
        Ok(schema_to(&left.map_err(fail_index)?))
    }

    #[napi]
    pub async fn merge(&self, into: String, from: String) -> Result<f64> {
        let merged = self.branch(&into).await?.merge(&from).await;
        Ok(merged.map_err(fail_index)? as f64)
    }

    #[napi]
    pub async fn fork(
        &self,
        from: String,
        name: String,
        at: Option<String>,
        retention_days: Option<f64>,
    ) -> Result<()> {
        let from = self.branch(&from).await?;
        let fork = match at {
            None => from.fork(&name).await,
            Some(at) => (from.fork_at(&name, version(&at)?, days(retention_days)?)).await,
        };
        self.keep(fork.map_err(fail_index)?);
        Ok(())
    }

    #[napi]
    pub async fn versions(
        &self,
        branch: String,
        after: Option<String>,
        limit: u32,
    ) -> Result<Vec<IndexVersion>> {
        let after = after.as_deref().map(version).transpose()?;
        let branch = self.branch(&branch).await?;
        let moments = branch.versions(after, limit as usize).await;
        Ok(moments
            .map_err(fail_index)?
            .into_iter()
            .map(version_to)
            .collect())
    }

    #[napi]
    pub async fn restore(
        &self,
        branch: String,
        version: String,
        retention_days: Option<f64>,
    ) -> Result<String> {
        let (at, keep) = (history::version(&version)?, days(retention_days)?);
        let restored = self.branch(&branch).await?.restore(at, keep).await;
        Ok(restored.map_err(fail_index)?.to_string())
    }

    #[napi]
    pub async fn collect(&self, options: Option<IndexCollectOptions>) -> Result<IndexCollected> {
        let options = options.unwrap_or_default();
        let keep = days(options.retention_days)?;
        let grace = match options.grace_seconds {
            Some(seconds) if seconds >= 0.0 => Duration::from_secs_f64(seconds),
            Some(_) => return Err(invalid("the grace period can't be negative")),
            None => GRACE,
        };
        let dry_run = options.dry_run.unwrap_or(false);
        let shards = (self.stores.iter())
            .map(|store| gc::collect_keeping(store.clone(), grace, keep, dry_run));
        let mut all = IndexCollected::default();
        for collected in try_join_all(shards).await.map_err(fail_index)? {
            all.kept += collected.kept as f64;
            all.deleted += collected.deleted as f64;
            all.deleted_bytes += collected.deleted_bytes as f64;
            all.missing += collected.missing as f64;
        }
        Ok(all)
    }

    #[napi]
    pub async fn upsert(&self, branch: String, docs: Vec<IndexDoc>) -> Result<()> {
        let docs = docs.into_iter().map(doc_from).collect::<Result<_>>()?;
        let branch = self.branch(&branch).await?;
        branch.upsert(docs).await.map_err(fail_index)
    }

    #[napi]
    pub async fn delete(&self, branch: String, ids: Vec<Either<String, f64>>) -> Result<()> {
        let ids = ids.into_iter().map(id_from).collect::<Result<_>>()?;
        let branch = self.branch(&branch).await?;
        branch.delete(ids).await.map_err(fail_index)
    }

    #[napi]
    pub async fn write(&self, branch: String, write: IndexWrite) -> Result<IndexCounts> {
        let write = write_from(write)?;
        let branch = self.branch(&branch).await?;
        Ok(counts_to(branch.write(write).await.map_err(fail_index)?))
    }

    #[napi]
    pub async fn order(&self, branch: String, order: IndexOrder) -> Result<Vec<IndexRow>> {
        let order = order_from(order)?;
        let rows = self.branch(&branch).await?.order(&order).await;
        Ok(rows.map_err(fail_index)?.into_iter().map(row_to).collect())
    }

    #[napi]
    pub async fn aggregate(
        &self,
        branch: String,
        aggregate: IndexAggregate,
    ) -> Result<Vec<IndexGroup>> {
        let aggregate = aggregate_from(aggregate)?;
        let groups = self.branch(&branch).await?.aggregate(&aggregate).await;
        Ok(groups
            .map_err(fail_index)?
            .into_iter()
            .map(group_to)
            .collect())
    }

    #[napi]
    pub async fn multi(
        &self,
        branch: String,
        requests: Vec<IndexRequest>,
        options: Option<IndexMultiOptions>,
    ) -> Result<IndexAnswers> {
        let requests = requests
            .into_iter()
            .map(request_from)
            .collect::<Result<Vec<_>>>()?;
        let branch = self.branch(&branch).await?;
        let eventual = options.as_ref().and_then(|o| o.eventual).unwrap_or(false);
        let epoch = options.and_then(|o| o.epoch);
        let (results, reads) = skywake_index::counted(async {
            let snapshot = match (eventual, epoch) {
                (true, _) => branch.recent_snapshot().await?,
                (false, Some(epoch)) => branch.snapshot_for(epoch as u64).await?,
                (false, None) => branch.snapshot().await?,
            };
            try_join_all(requests.iter().map(|request| answer(&snapshot, request))).await
        })
        .await;
        Ok(IndexAnswers {
            results: results.map_err(fail_index)?,
            reads: reads_to(reads),
        })
    }

    #[napi]
    pub async fn get_many(
        &self,
        branch: String,
        ids: Vec<Either<String, f64>>,
    ) -> Result<Vec<IndexDoc>> {
        let ids: Vec<_> = ids.into_iter().map(id_from).collect::<Result<_>>()?;
        let docs = self.branch(&branch).await?.get_many(&ids).await;
        Ok(docs.map_err(fail_index)?.into_iter().map(doc_to).collect())
    }

    #[napi]
    pub async fn export(&self, branch: String) -> Result<IndexExport> {
        let export = self.branch(&branch).await?.export().await;
        Ok(IndexExport {
            export: AsyncMutex::new(export.map_err(fail_index)?),
        })
    }

    #[napi]
    pub async fn export_parquet(&self, branch: String) -> Result<IndexParquetExport> {
        let branch = self.branch(&branch).await?;
        let schema = branch.schema().await.map_err(fail_index)?;
        let export = branch.export().await.map_err(fail_index)?;
        Ok(IndexParquetExport {
            export: AsyncMutex::new(export.parquet(&schema).map_err(fail_index)?),
        })
    }

    #[napi]
    pub async fn copy(
        &self,
        branch: String,
        location: String,
        options: Option<IndexOpenOptions>,
    ) -> Result<()> {
        let (_, stores) = stores_of(&location, options)?;
        let branch = self.branch(&branch).await?;
        branch.copy_to(stores).await.map_err(fail_index)?;
        Ok(())
    }

    #[napi]
    pub async fn query(&self, branch: String, query: IndexQuery) -> Result<Vec<IndexHit>> {
        let query = query_from(query)?;
        let branch = self.branch(&branch).await?;
        let hits = branch.query(&query).await;
        Ok(hits.map_err(fail_index)?.into_iter().map(hit_to).collect())
    }

    #[napi]
    pub async fn search(&self, branch: String, search: IndexSearch) -> Result<Vec<IndexSearchHit>> {
        let search = search_from(search)?;
        let branch = self.branch(&branch).await?;
        let hits = branch.search(&search).await;
        Ok(hits
            .map_err(fail_index)?
            .into_iter()
            .map(search_hit_to)
            .collect())
    }

    #[napi]
    pub async fn hybrid(&self, branch: String, hybrid: IndexHybrid) -> Result<Vec<IndexFusedHit>> {
        let hybrid = hybrid_from(hybrid)?;
        let branch = self.branch(&branch).await?;
        let hits = branch.hybrid(&hybrid).await;
        Ok(hits
            .map_err(fail_index)?
            .into_iter()
            .map(fused_hit_to)
            .collect())
    }

    #[napi]
    pub async fn scan(
        &self,
        branch: String,
        after: Option<Either<String, f64>>,
        limit: u32,
    ) -> Result<Vec<IndexDoc>> {
        let after = after.map(id_from).transpose()?;
        let branch = self.branch(&branch).await?;
        let docs = branch.scan(after.as_ref(), limit as usize).await;
        Ok(docs.map_err(fail_index)?.into_iter().map(doc_to).collect())
    }

    #[napi]
    pub async fn get(&self, branch: String, id: Either<String, f64>) -> Result<Option<IndexDoc>> {
        let id = id_from(id)?;
        let branch = self.branch(&branch).await?;
        let doc = branch.get(&id).await.map_err(fail_index)?;
        Ok(doc.map(doc_to))
    }

    #[napi]
    pub async fn build(&self, branch: String) -> Result<()> {
        let branch = self.branch(&branch).await?;
        let built = branch.build().await;
        built.map_err(fail_index)
    }

    #[napi]
    pub async fn build_shards(&self, branch: String, shards: Vec<u32>) -> Result<()> {
        let open = self.branch(&branch).await?;
        let count = open.shard_count();
        if let Some(shard) = shards.iter().find(|shard| **shard as usize >= count) {
            let message = format!("shard {shard} is out of range: the index has {count}");
            return Err(invalid(message));
        }
        let mut branches = self.open_branches();
        let (_, builders) = branches
            .entry(branch)
            .or_insert_with(|| (open.clone(), Builders::new()));
        let wanted: Vec<usize> = shards.iter().map(|shard| *shard as usize).collect();
        builders.retain(|shard, _| wanted.contains(shard));
        for shard in wanted {
            if let Entry::Vacant(free) = builders.entry(shard) {
                free.insert(
                    open.spawn_builder(shard, BuildPolicy::default())
                        .expect("checked above"),
                );
            }
        }
        Ok(())
    }

    #[napi]
    pub async fn warm(&self, branch: String) -> Result<()> {
        let branch = self.branch(&branch).await?;
        branch.warm().await.map_err(fail_index)
    }

    #[napi]
    pub async fn stats(&self, branch: String) -> Result<IndexStats> {
        let branch = self.branch(&branch).await?;
        let stats = branch.stats().await.map_err(fail_index)?;
        Ok(stats_to(stats))
    }

    #[napi]
    pub async fn branches(&self) -> Result<Vec<String>> {
        let main = self.branch(skywake_index::MAIN).await;
        main?.list_branches().await.map_err(fail_index)
    }

    #[napi]
    pub async fn delete_branch(&self, name: String) -> Result<()> {
        let branch = self.branch(&name).await?;
        branch.delete_branch(&name).await.map_err(fail_index)?;
        self.open_branches().remove(&name);
        Ok(())
    }

    #[napi]
    pub async fn destroy(&self) -> Result<()> {
        let all = self.store.list(None).map_ok(|meta| meta.location).boxed();
        self.store
            .delete_stream(all)
            .try_collect::<Vec<_>>()
            .await
            .map_err(|error| fail_index(error.into()))?;
        self.open_branches().clear();
        Ok(())
    }
}

impl Index {
    async fn branch(&self, name: &str) -> Result<Branch> {
        if let Some((open, _)) = self.open_branches().get(name) {
            return Ok(open.clone());
        }
        let open = Branch::open(self.stores.clone(), name, self.options.clone())
            .await
            .map_err(fail_index)?;
        self.keep(open.clone());
        Ok(open)
    }

    fn keep(&self, branch: Branch) {
        let mut branches = self.open_branches();
        let Entry::Vacant(free) = branches.entry(branch.branch().to_string()) else {
            return;
        };
        let builders = match self.every_shard {
            true => (0..branch.shard_count())
                .filter_map(|shard| {
                    Some((shard, branch.spawn_builder(shard, BuildPolicy::default())?))
                })
                .collect(),
            false => Builders::new(),
        };
        free.insert((branch, builders));
    }

    fn open_branches(&self) -> MutexGuard<'_, HashMap<String, (Branch, Builders)>> {
        self.branches.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

async fn answer(
    snapshot: &ShardsSnapshot,
    request: &Request,
) -> std::result::Result<IndexResult, IndexError> {
    let mut result = IndexResult::default();
    match request {
        Request::Query(q) => {
            result.query = Some(snapshot.query(q).await?.into_iter().map(hit_to).collect())
        }
        Request::Search(s) => {
            let hits = snapshot.search(s).await?;
            result.search = Some(hits.into_iter().map(search_hit_to).collect())
        }
        Request::Hybrid(h) => {
            let hits = snapshot.hybrid(h).await?;
            result.hybrid = Some(hits.into_iter().map(fused_hit_to).collect())
        }
        Request::Order(o) => {
            result.order = Some(snapshot.order(o).await?.into_iter().map(row_to).collect())
        }
        Request::Aggregate(a) => {
            let groups = snapshot.aggregate(a).await?;
            result.aggregate = Some(groups.into_iter().map(group_to).collect())
        }
        Request::Rank(r) => {
            result.rank = Some(snapshot.rank(r).await?.into_iter().map(ranked_to).collect())
        }
    }
    Ok(result)
}
