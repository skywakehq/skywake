//! An index split into shards by a hash of the id.

use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use futures::future::try_join_all;
use object_store::ObjectStore;

use crate::export::Export;
use crate::format::rows;
use crate::model::per;
use crate::read::snapshot::Snapshot;
use crate::{
    Aggregate, BuildPolicy, Builder, Counts, Doc, FusedHit, Group, Hit, Hybrid, Id, IdKind, Index,
    Measure, Options, Order, Query, Rank, Ranked, Result, Row, Schema, Stats, TextHit, TextQuery,
    Value, Write, invalid, lock,
};

pub const MAX_SHARDS: usize = 256;

pub fn shard_folder(n: usize) -> String {
    format!("shards/{n}")
}

fn per_shard(options: &Options, count: usize) -> impl Iterator<Item = Options> + '_ {
    (0..count).map(move |n| {
        let shared = (options.shared.as_ref()).map(|folder| match count {
            1 => folder.clone(),
            _ => format!("{folder}/{}", shard_folder(n)),
        });
        Options {
            shared,
            ..options.clone()
        }
    })
}

#[derive(Clone)]
pub struct Shards {
    pub(crate) shards: Vec<Index>,
    pub(crate) ids: IdKind,
}

#[derive(Clone)]
pub struct ShardsSnapshot {
    shards: Vec<Snapshot>,
}

impl Shards {
    pub async fn create(
        stores: Vec<Arc<dyn ObjectStore>>,
        schema: Schema,
        options: Options,
    ) -> Result<Self> {
        check_count(stores.len())?;
        let ids = schema.id;
        let made = per_shard(&options, stores.len())
            .zip(stores)
            .map(|(options, store)| Index::create_with(store, schema.clone(), options));
        Ok(Self {
            shards: try_join_all(made).await?,
            ids,
        })
    }

    pub async fn open(
        stores: Vec<Arc<dyn ObjectStore>>,
        branch: &str,
        options: Options,
    ) -> Result<Self> {
        check_count(stores.len())?;
        let opened = per_shard(&options, stores.len())
            .zip(stores)
            .map(|(options, store)| Index::open_with(store, branch, options));
        let shards = try_join_all(opened).await?;
        let seen = lock(&shards[0].seen).clone();
        let ids = seen.map_or(IdKind::Any, |(_, version)| version.schema.id);
        Ok(Self { shards, ids })
    }

    pub fn branch(&self) -> &str {
        self.shards[0].branch()
    }

    pub async fn schema(&self) -> Result<Schema> {
        self.shards[0].schema().await
    }

    pub async fn merge(&self, from: &str) -> Result<u64> {
        let merged = try_join_all(self.shards.iter().map(|shard| shard.merge(from))).await?;
        Ok(merged.into_iter().sum())
    }

    pub async fn warm(&self) -> Result<()> {
        let warmed = self
            .shards
            .iter()
            .map(|shard| async { shard.snapshot().await?.warm().await });
        try_join_all(warmed).await.map(drop)
    }

    pub async fn alter(&self, schema: &Schema) -> Result<Schema> {
        let altered = try_join_all(self.shards.iter().map(|shard| shard.alter(schema))).await?;
        Ok(altered.into_iter().next().unwrap_or_default())
    }

    pub async fn drop_attributes(&self, names: &[String]) -> Result<Schema> {
        let left =
            try_join_all(self.shards.iter().map(|shard| shard.drop_attributes(names))).await?;
        Ok(left.into_iter().next().unwrap_or_default())
    }

    pub async fn fork(&self, branch: &str) -> Result<Self> {
        let forks = self.shards.iter().map(|shard| shard.fork(branch));
        Ok(Self {
            shards: try_join_all(forks).await?,
            ids: self.ids,
        })
    }

    pub async fn list_branches(&self) -> Result<Vec<String>> {
        self.shards[0].list_branches().await
    }

    pub async fn delete_branch(&self, branch: &str) -> Result<()> {
        try_join_all(self.shards.iter().map(|s| s.delete_branch(branch))).await?;
        Ok(())
    }

    pub async fn upsert(&self, docs: Vec<Doc>) -> Result<()> {
        let docs = (docs.into_iter())
            .map(|doc| {
                Ok::<_, crate::Error>(Doc {
                    id: self.ids.check(doc.id)?,
                    ..doc
                })
            })
            .collect::<Result<Vec<_>>>()?;
        let parts = self.split(docs, |doc| &doc.id);
        let writes = self
            .shards
            .iter()
            .zip(parts)
            .filter(|(_, part)| !part.is_empty());
        try_join_all(writes.map(|(shard, part)| shard.upsert(part))).await?;
        Ok(())
    }

    pub async fn delete(&self, ids: Vec<Id>) -> Result<()> {
        let ids = (ids.into_iter().map(|id| self.ids.check(id))).collect::<Result<_>>()?;
        let parts = self.split(ids, |id| id);
        let writes = self
            .shards
            .iter()
            .zip(parts)
            .filter(|(_, part)| !part.is_empty());
        try_join_all(writes.map(|(shard, part)| shard.delete(part))).await?;
        Ok(())
    }

    pub async fn write(&self, write: Write) -> Result<Counts> {
        let blank = || Write {
            upsert_if: write.upsert_if.clone(),
            patch_if: write.patch_if.clone(),
            delete_if: write.delete_if.clone(),
            delete_by: write.delete_by.clone(),
            patch_by: write.patch_by.clone(),
            return_ids: write.return_ids,
            exact_deletes: write.exact_deletes,
            ..Write::default()
        };
        let mut parts: Vec<Write> = self.shards.iter().map(|_| blank()).collect();
        let n = self.shards.len();
        for mut doc in write.upserts {
            doc.id = self.ids.check(doc.id)?;
            parts[rows::page_of(&doc.id, n)].upserts.push(doc);
        }
        for mut patch in write.patches {
            patch.id = self.ids.check(patch.id)?;
            parts[rows::page_of(&patch.id, n)].patches.push(patch);
        }
        for id in write.deletes {
            let id = self.ids.check(id)?;
            parts[rows::page_of(&id, n)].deletes.push(id);
        }
        let by_filter = write.delete_by.is_some() || write.patch_by.is_some();
        let writes = self.shards.iter().zip(parts).filter(|(_, part)| {
            by_filter
                || !(part.upserts.is_empty() && part.patches.is_empty() && part.deletes.is_empty())
        });
        let counts = try_join_all(writes.map(|(shard, part)| shard.write(part))).await?;
        Ok(counts.into_iter().fold(Counts::default(), Counts::add))
    }

    pub async fn snapshot(&self) -> Result<ShardsSnapshot> {
        let shards = try_join_all(self.shards.iter().map(Index::snapshot)).await?;
        Ok(ShardsSnapshot { shards })
    }

    pub async fn snapshot_for(&self, epoch: u64) -> Result<ShardsSnapshot> {
        let shards = self.shards.iter().map(|shard| shard.snapshot_for(epoch));
        let shards = try_join_all(shards).await?;
        Ok(ShardsSnapshot { shards })
    }

    pub async fn recent_snapshot(&self) -> Result<ShardsSnapshot> {
        let shards = try_join_all(self.shards.iter().map(Index::recent_snapshot)).await?;
        Ok(ShardsSnapshot { shards })
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

    pub async fn get_many(&self, ids: &[Id]) -> Result<Vec<Doc>> {
        self.snapshot().await?.get_many(ids).await
    }

    pub async fn get(&self, id: &Id) -> Result<Option<Doc>> {
        Ok(self.get_many(std::slice::from_ref(id)).await?.pop())
    }

    pub async fn scan(&self, after: Option<&Id>, limit: usize) -> Result<Vec<Doc>> {
        let pages = try_join_all(self.shards.iter().map(|s| s.scan(after, limit))).await?;
        let mut all: Vec<Doc> = pages.into_iter().flatten().collect();
        all.sort_by(|a, b| a.id.cmp(&b.id));
        all.truncate(limit);
        Ok(all)
    }

    pub async fn build(&self) -> Result<()> {
        try_join_all(self.shards.iter().map(Index::build)).await?;
        Ok(())
    }

    pub fn spawn_builders(&self, policy: BuildPolicy) -> Vec<Builder> {
        let spawn = |shard: &Index| shard.spawn_builder(policy.clone());
        self.shards.iter().map(spawn).collect()
    }

    pub fn spawn_builder(&self, shard: usize, policy: BuildPolicy) -> Option<Builder> {
        Some(self.shards.get(shard)?.spawn_builder(policy))
    }

    pub fn shard_count(&self) -> usize {
        self.shards.len()
    }

    pub async fn stats(&self) -> Result<Stats> {
        let all = try_join_all(self.shards.iter().map(Index::stats)).await?;
        Ok(all.into_iter().fold(Stats::default(), |a, b| Stats {
            rows: a.rows + b.rows,
            deleted_rows: a.deleted_rows + b.deleted_rows,
            segments: a.segments + b.segments,
            indexed_rows: a.indexed_rows + b.indexed_rows,
            unindexed_rows: a.unindexed_rows + b.unindexed_rows,
            clusters: a.clusters + b.clusters,
            bytes: a.bytes + b.bytes,
        }))
    }

    pub async fn export(&self) -> Result<ShardsExport> {
        let exports = try_join_all(self.shards.iter().map(Index::export)).await?;
        Ok(ShardsExport { exports, at: 0 })
    }

    pub async fn copy_to(&self, stores: Vec<Arc<dyn ObjectStore>>) -> Result<Shards> {
        if stores.len() != self.shards.len() {
            return Err(invalid("a copy takes as many stores as there are shards"));
        }
        let copies = self
            .shards
            .iter()
            .zip(stores)
            .map(|(s, store)| s.copy_to(store));
        Ok(Shards {
            shards: try_join_all(copies).await?,
            ids: self.ids,
        })
    }

    fn split<T>(&self, items: Vec<T>, id: impl Fn(&T) -> &Id) -> Vec<Vec<T>> {
        let n = self.shards.len();
        let mut parts: Vec<Vec<T>> = (0..n).map(|_| Vec::new()).collect();
        for item in items {
            parts[rows::page_of(id(&item), n)].push(item);
        }
        parts
    }
}

fn check_count(count: usize) -> Result<()> {
    match (1..=MAX_SHARDS).contains(&count) {
        true => Ok(()),
        false => Err(invalid(format!("an index has 1 to {MAX_SHARDS} shards"))),
    }
}

pub struct ShardsExport {
    exports: Vec<Export>,
    at: usize,
}

impl ShardsExport {
    pub async fn next(&mut self) -> Result<Option<Vec<Doc>>> {
        while let Some(export) = self.exports.get_mut(self.at) {
            if let Some(docs) = export.next().await? {
                return Ok(Some(docs));
            }
            self.at += 1;
        }
        Ok(None)
    }
}

impl ShardsSnapshot {
    pub fn schema(&self) -> &Schema {
        self.shards[0].schema()
    }

    pub async fn query(&self, query: &Query) -> Result<Vec<Hit>> {
        let (per, include) = (query.per.as_ref(), &query.include);
        per::limited(per, include, query.top_k, query.offset, |top_k, include| {
            let each = Query {
                top_k,
                include,
                offset: 0,
                per: None,
                ..query.clone()
            };
            async move {
                let all = try_join_all(self.shards.iter().map(|s| s.query(&each))).await?;
                let by = |a: &Hit, b: &Hit| {
                    a.distance
                        .total_cmp(&b.distance)
                        .then_with(|| a.id.cmp(&b.id))
                };
                Ok(merge(all, by, 0, top_k))
            }
        })
        .await
    }

    pub async fn search(&self, query: &TextQuery) -> Result<Vec<TextHit>> {
        let (per, include) = (query.per.as_ref(), &query.include);
        per::limited(per, include, query.top_k, query.offset, |top_k, include| {
            let each = TextQuery {
                top_k,
                include,
                offset: 0,
                per: None,
                ..query.clone()
            };
            async move {
                let all = try_join_all(self.shards.iter().map(|s| s.search(&each))).await?;
                let by = |a: &TextHit, b: &TextHit| {
                    b.score.total_cmp(&a.score).then_with(|| a.id.cmp(&b.id))
                };
                Ok(merge(all, by, 0, top_k))
            }
        })
        .await
    }

    pub async fn hybrid(&self, hybrid: &Hybrid) -> Result<Vec<FusedHit>> {
        let search = |top_k, include: Vec<String>| {
            let each = hybrid.widened(top_k, &include);
            async move {
                let all = try_join_all(self.shards.iter().map(|s| s.hybrid(&each))).await?;
                let by = |a: &FusedHit, b: &FusedHit| {
                    b.score.total_cmp(&a.score).then_with(|| a.id.cmp(&b.id))
                };
                Ok(merge(all, by, 0, top_k))
            }
        };
        let (per, top_k, offset) = (hybrid.per.as_ref(), hybrid.top_k, hybrid.offset);
        per::limited(per, &hybrid.include(), top_k, offset, search).await
    }

    pub async fn order(&self, order: &Order) -> Result<Vec<Row>> {
        let mut each = order.clone();
        (each.top_k, each.offset) = (order.top_k + order.offset, 0);
        let added: Vec<String> = (order.attributes().into_iter())
            .filter(|name| !order.include.contains(name))
            .collect();
        each.include.extend(added.iter().cloned());
        let all = try_join_all(self.shards.iter().map(|s| s.order(&each))).await?;
        let by = |a: &Row, b: &Row| order.compare((&a.id, &a.attributes), (&b.id, &b.attributes));
        let mut rows = merge(all, by, order.offset, order.top_k);
        for row in &mut rows {
            added
                .iter()
                .for_each(|name| drop(row.attributes.remove(name)));
        }
        Ok(rows)
    }

    pub async fn rank(&self, rank: &Rank) -> Result<Vec<Ranked>> {
        let mut each = rank.clone();
        (each.top_k, each.offset) = (rank.top_k + rank.offset, 0);
        let all = try_join_all(self.shards.iter().map(|s| s.rank(&each))).await?;
        Ok(merge(all, Ranked::compare, rank.offset, rank.top_k))
    }

    pub async fn aggregate(&self, aggregate: &Aggregate) -> Result<Vec<Group>> {
        let mut each = aggregate.clone();
        for (name, measure) in &aggregate.measures {
            if let Measure::Avg(attribute) = measure {
                let (sum, count) = hidden(name);
                each.measures.insert(sum, Measure::Sum(attribute.clone()));
                each.measures
                    .insert(count, Measure::Count(Some(attribute.clone())));
            }
        }
        let all = try_join_all(self.shards.iter().map(|s| s.aggregate(&each))).await?;
        let mut merged: HashMap<Vec<u8>, Group> = HashMap::new();
        for group in all.into_iter().flatten() {
            let key = postcard::to_stdvec(&group.key).unwrap_or_default();
            match merged.get_mut(&key) {
                None => {
                    merged.insert(key, group);
                }
                Some(into) => {
                    for (name, value) in group.values {
                        let measure = each.measures.get(&name);
                        let kept = into.values.remove(&name);
                        into.values.insert(name, add(measure, kept, value));
                    }
                }
            }
        }
        let mut groups: Vec<Group> = merged.into_values().collect();
        for group in &mut groups {
            for (name, measure) in &aggregate.measures {
                if !matches!(measure, Measure::Avg(_)) {
                    continue;
                }
                let (sum, count) = hidden(name);
                let number = |value: Option<Value>| match value {
                    Some(Value::Int(n)) => n as f64,
                    Some(Value::Number(n)) => n,
                    _ => 0.0,
                };
                let (sum, count) = (group.values.remove(&sum), group.values.remove(&count));
                let (sum, count) = (number(sum), number(count));
                group.values.remove(name);
                if count > 0.0 {
                    group
                        .values
                        .insert(name.clone(), Value::Number(sum / count));
                }
            }
        }
        groups.sort_by(|a, b| {
            let pairs = aggregate
                .group_by
                .iter()
                .map(|name| (a.key.get(name), b.key.get(name)));
            let order = pairs.map(|(x, y)| match (x, y) {
                (Some(x), Some(y)) => x.order(y),
                (x, y) => x.is_some().cmp(&y.is_some()),
            });
            order.fold(Ordering::Equal, Ordering::then)
        });
        Ok(groups)
    }

    pub async fn get_many(&self, ids: &[Id]) -> Result<Vec<Doc>> {
        let n = self.shards.len();
        let ids: Vec<Id> =
            (ids.iter().map(|id| self.schema().id.check(id.clone()))).collect::<Result<_>>()?;
        let mut parts: Vec<Vec<Id>> = vec![Vec::new(); n];
        for id in &ids {
            parts[rows::page_of(id, n)].push(id.clone());
        }
        let found = try_join_all(
            self.shards
                .iter()
                .zip(&parts)
                .map(|(s, part)| s.get_many(part)),
        )
        .await?;
        let mut by_id: BTreeMap<Id, Doc> = found
            .into_iter()
            .flatten()
            .map(|doc| (doc.id.clone(), doc))
            .collect();
        Ok(ids.iter().filter_map(|id| by_id.remove(id)).collect())
    }
}

fn hidden(name: &str) -> (String, String) {
    (format!("\0sum\0{name}"), format!("\0count\0{name}"))
}

fn add(measure: Option<&Measure>, a: Option<Value>, b: Value) -> Value {
    let Some(a) = a else { return b };
    match (measure, &a, &b) {
        (Some(Measure::Count(_) | Measure::Sum(_)), Value::Int(x), Value::Int(y)) => {
            Value::Int(x.saturating_add(*y))
        }
        (Some(Measure::Count(_) | Measure::Sum(_)), Value::Number(x), Value::Number(y)) => {
            Value::Number(x + y)
        }
        (Some(Measure::Min(_)), ..) if b.order(&a).is_lt() => b,
        (Some(Measure::Max(_)), ..) if b.order(&a).is_gt() => b,
        _ => a,
    }
}

fn merge<T>(
    lists: Vec<Vec<T>>,
    by: impl Fn(&T, &T) -> Ordering,
    offset: usize,
    top_k: usize,
) -> Vec<T> {
    let mut all: Vec<T> = lists.into_iter().flatten().collect();
    all.sort_by(&by);
    all.into_iter().skip(offset).take(top_k).collect()
}
