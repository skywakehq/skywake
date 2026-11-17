//! A branch at one moment.

use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use futures::future::try_join_all;
use futures::{StreamExt, TryStreamExt, stream};

use super::live;
use super::query;
use super::tail::Tail;
use crate::Filter;
use crate::filter::attrs::Attrs;
use crate::filter::{self, Directory};
use crate::format::Version;
use crate::format::cluster::ClusterRef;
use crate::model::per;
use crate::store::{PARALLELISM, Storage};
use crate::{
    Attributes, Doc, FusedHit, Hit, Hybrid, Id, Kind, Query, Result, Schema, Score, Search,
    TextHit, TextQuery, Value, invalid, text,
};

#[derive(Clone)]
pub struct Snapshot {
    pub(crate) storage: Arc<Storage>,
    pub(crate) version: Arc<Version>,
}

#[derive(Clone, Debug)]
pub struct Order {
    pub by: String,
    pub descending: bool,
    pub then: Vec<(String, bool)>,
    pub missing_lowest: bool,
    pub top_k: usize,
    pub offset: usize,
    pub filter: Option<Filter>,
    pub include: Vec<String>,
}

impl Order {
    pub fn new(by: &str, top_k: usize) -> Self {
        Self {
            by: by.to_string(),
            descending: false,
            then: Vec::new(),
            missing_lowest: false,
            top_k,
            offset: 0,
            filter: None,
            include: Vec::new(),
        }
    }
}

impl Order {
    pub(crate) fn keys(&self) -> impl Iterator<Item = (&str, bool)> {
        std::iter::once((self.by.as_str(), self.descending))
            .chain(self.then.iter().map(|(by, down)| (by.as_str(), *down)))
    }

    pub(crate) fn attributes(&self) -> Vec<String> {
        let mut names: Vec<String> = Vec::new();
        for (by, _) in self.keys() {
            if by != "id" && !names.iter().any(|n| n == by) {
                names.push(by.to_string());
            }
        }
        names
    }

    pub(crate) fn compare(&self, a: (&Id, &Attributes), b: (&Id, &Attributes)) -> Ordering {
        for (by, descending) in self.keys() {
            let order = match by {
                "id" if descending => b.0.cmp(a.0),
                "id" => a.0.cmp(b.0),
                _ => self.key_order(descending, a.1.get(by), b.1.get(by)),
            };
            if order != Ordering::Equal {
                return order;
            }
        }
        a.0.cmp(b.0)
    }

    pub(crate) fn key_order(
        &self,
        descending: bool,
        x: Option<&Value>,
        y: Option<&Value>,
    ) -> Ordering {
        let turn = |order: Ordering| if descending { order.reverse() } else { order };
        match (x, y) {
            (Some(x), Some(y)) => turn(x.order(y)),
            (x, y) if self.missing_lowest => turn(x.is_some().cmp(&y.is_some())),
            (x, y) => x.is_none().cmp(&y.is_none()),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Row {
    pub id: Id,
    pub attributes: Attributes,
}

#[derive(Clone, Debug)]
pub struct Rank {
    pub score: Score,
    pub top_k: usize,
    pub offset: usize,
    pub filter: Option<Filter>,
    pub include: Vec<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Ranked {
    pub id: Id,
    pub score: f64,
    pub attributes: Attributes,
}

impl Ranked {
    pub(crate) fn compare(&self, other: &Ranked) -> Ordering {
        (other.score.total_cmp(&self.score)).then_with(|| self.id.cmp(&other.id))
    }
}

#[derive(Clone, Debug, Default)]
pub struct Aggregate {
    pub filter: Option<Filter>,
    pub group_by: Vec<String>,
    pub each: Vec<String>,
    pub measures: BTreeMap<String, Measure>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Measure {
    Count(Option<String>),
    Sum(String),
    Avg(String),
    Min(String),
    Max(String),
}

impl Measure {
    pub(crate) fn attribute(&self) -> Option<&String> {
        match self {
            Measure::Count(name) => name.as_ref(),
            Measure::Sum(name) | Measure::Avg(name) | Measure::Min(name) | Measure::Max(name) => {
                Some(name)
            }
        }
    }

    fn check(&self, schema: &Schema) -> Result<()> {
        let Some(name) = self.attribute() else {
            return Ok(());
        };
        let kind = schema.kind(name)?;
        let ok = match self {
            Measure::Count(_) => true,
            Measure::Sum(_) | Measure::Avg(_) => matches!(kind, Kind::Int | Kind::Number),
            Measure::Min(_) | Measure::Max(_) => {
                kind == kind.item()
                    && kind != Kind::Bool
                    && schema.text.get(name).is_none_or(|o| o.filterable)
            }
        };
        match ok {
            true => Ok(()),
            false => Err(invalid(format!(
                "`{name}` is {kind:?}, which this does not measure"
            ))),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Group {
    pub key: Attributes,
    pub values: BTreeMap<String, Value>,
}

impl Snapshot {
    pub fn schema(&self) -> &Schema {
        &self.version.schema
    }

    pub async fn query(&self, query: &Query) -> Result<Vec<Hit>> {
        let typed = self.typed_query(query)?;
        self.storage.shapes().filter(query.filter.as_ref());
        let (per, include) = (query.per.as_ref(), &query.include);
        per::limited(per, include, query.top_k, query.offset, |top_k, include| {
            let query = Query {
                top_k,
                include,
                offset: 0,
                per: None,
                ..typed.clone()
            };
            async move { query::run(&self.storage, &self.version, &query).await }
        })
        .await
    }

    pub async fn warm(&self) -> Result<()> {
        let (storage, version) = (self.storage.as_ref(), self.version.as_ref());
        Tail::load(storage, version).await?;
        let parts = version.text.as_ref().map_or(&[][..], |text| &text.parts);
        let posted = parts.iter().flat_map(|p| &p.postings);
        let text_blobs = (parts.iter())
            .flat_map(|p| p.blobs.iter().copied().chain([p.hot]))
            .chain(posted.clone().flat_map(|p| p.blobs.iter().copied()));
        storage.keep_on_disk(text_blobs.collect()).await?;
        try_join_all(posted.map(|p| text::postings::read::opened(storage, p))).await?;
        try_join_all(
            parts
                .iter()
                .map(|p| text::part::open(storage, p.hot, p.hot_bytes)),
        )
        .await?;
        if let Some(columns) = &version.columns {
            crate::format::columns::warm(storage, columns).await?;
        }
        let Some(ann) = &version.ann else {
            return Ok(());
        };
        storage.get::<Attrs>(ann.filters).await?;
        let dims: Vec<usize> = version.schema.vectors.values().map(|c| c.dims).collect();
        let filter_blobs = ann.parts.values().flat_map(|p| p.blobs.iter().copied());
        storage.keep_on_disk(filter_blobs.collect()).await?;
        for part in ann.parts.values() {
            let directory: Arc<Directory> = storage.get(part.directory).await?;
            let blocks: Vec<usize> = (0..directory.blocks.len()).collect();
            filter::read(storage, part, &directory, &blocks, &dims).await?;
        }
        for (name, clusters) in &ann.columns {
            let dims = version.schema.vectors[name].dims;
            let (table, _) = futures::try_join!(
                clusters.table.open::<ClusterRef>(storage),
                storage.centroids(clusters.centroids)
            )?;
            storage.origin(clusters, dims).await?;
            let table: Vec<ClusterRef> = table.iter().cloned().collect();
            storage
                .keep_on_disk(table.iter().map(|c| c.hash).collect())
                .await?;
            stream::iter(table)
                .map(|cluster| async move { storage.codes_and_attrs(&cluster, dims).await })
                .buffer_unordered(PARALLELISM)
                .try_for_each(|_| async { Ok(()) })
                .await?;
        }
        Ok(())
    }

    pub async fn search(&self, query: &TextQuery) -> Result<Vec<TextHit>> {
        let typed = self.typed_search(query)?;
        let (per, include) = (query.per.as_ref(), &query.include);
        per::limited(per, include, query.top_k, query.offset, |top_k, include| {
            let query = TextQuery {
                top_k,
                include,
                offset: 0,
                per: None,
                ..typed.clone()
            };
            async move { text::search(&self.storage, &self.version, &query).await }
        })
        .await
    }

    pub async fn hybrid(&self, hybrid: &Hybrid) -> Result<Vec<FusedHit>> {
        let mut typed = hybrid.clone();
        for (_, search) in &mut typed.searches {
            *search = match search {
                Search::Vector(query) => Search::Vector(self.typed_query(query)?),
                Search::Text(query) => Search::Text(self.typed_search(query)?),
            };
        }
        let search = |top_k, include: Vec<String>| {
            let hybrid = typed.widened(top_k, &include);
            async move { text::hybrid(&self.storage, &self.version, &hybrid).await }
        };
        let (per, top_k, offset) = (hybrid.per.as_ref(), hybrid.top_k, hybrid.offset);
        per::limited(per, &hybrid.include(), top_k, offset, search).await
    }

    pub async fn order(&self, order: &Order) -> Result<Vec<Row>> {
        let schema = self.schema();
        if order.then.len() > MAX_ORDER_KEYS - 1 {
            return Err(invalid(format!("order by at most {MAX_ORDER_KEYS} keys")));
        }
        let keys = order.attributes();
        for by in &keys {
            match schema.kind(by)? {
                Kind::Strings | Kind::Ints | Kind::Numbers | Kind::Sparse | Kind::Vectors => {
                    return Err(invalid(format!("`{by}` is a list: order by one value")));
                }
                _ if schema.text.get(by).is_some_and(|o| !o.filterable) => {
                    return Err(invalid(format!("`{by}` is text: it cannot be ordered")));
                }
                _ => {}
            }
        }
        check_names(schema, &order.include)?;
        let filter = order.filter.as_ref().map(|f| f.typed(schema)).transpose()?;
        self.storage
            .shapes()
            .order(&order.by, order.filter.as_ref());
        let engine =
            crate::engine::order::order(&self.storage, &self.version, order, filter.as_ref());
        if let Some(rows) = engine.await? {
            return Ok(rows);
        }
        let wanted = order.offset + order.top_k;
        type Kept = (Id, Attributes, Attributes);
        let compare = |a: &Kept, b: &Kept| order.compare((&a.0, &a.1), (&b.0, &b.1));
        let mut best: Vec<Kept> = Vec::new();
        live::each(
            &self.storage,
            &self.version,
            filter.as_ref(),
            |id, mut all| {
                let values = (keys.iter())
                    .filter_map(|name| Some((name.clone(), all.get(name)?.clone())))
                    .collect();
                let kept = (order.include.iter())
                    .filter_map(|name| Some((name.clone(), all.remove(name)?)))
                    .collect();
                best.push((id.clone(), values, kept));
                if best.len() >= 2 * wanted.max(512) {
                    best.sort_by(compare);
                    best.truncate(wanted);
                }
            },
        )
        .await?;
        best.sort_by(compare);
        best.truncate(wanted);
        let rows = best
            .into_iter()
            .map(|(id, _, attributes)| Row { id, attributes });
        Ok(rows.skip(order.offset).collect())
    }

    pub async fn rank(&self, rank: &Rank) -> Result<Vec<Ranked>> {
        let schema = self.schema();
        rank.score.check(&[], schema)?;
        let score = rank.score.typed(schema)?;
        check_names(schema, &rank.include)?;
        let filter = rank.filter.as_ref().map(|f| f.typed(schema)).transpose()?;
        let wanted = rank.offset + rank.top_k;
        let no_searches = BTreeMap::new();
        let mut best: Vec<Ranked> = Vec::new();
        live::each(&self.storage, &self.version, filter.as_ref(), |id, all| {
            let score = score.eval(id, &no_searches, &all);
            if score == 0.0 {
                return;
            }
            let attributes = (all.into_iter())
                .filter(|(name, _)| rank.include.contains(name))
                .collect();
            best.push(Ranked {
                id: id.clone(),
                score,
                attributes,
            });
            if best.len() >= 2 * wanted.max(512) {
                best.sort_by(Ranked::compare);
                best.truncate(wanted);
            }
        })
        .await?;
        best.sort_by(Ranked::compare);
        best.truncate(wanted);
        Ok(best.into_iter().skip(rank.offset).collect())
    }

    pub async fn aggregate(&self, aggregate: &Aggregate) -> Result<Vec<Group>> {
        let schema = self.schema();
        check_names(schema, &aggregate.group_by)?;
        for name in &aggregate.each {
            if !aggregate.group_by.contains(name) {
                return Err(invalid(format!(
                    "`{name}` is grouped by each item, but not grouped by"
                )));
            }
            if schema.kind(name)?.item() == schema.kind(name)? {
                return Err(invalid(format!("`{name}` is not a list")));
            }
        }
        for (name, measure) in &aggregate.measures {
            measure
                .check(schema)
                .map_err(|e| invalid(format!("measure `{name}`: {e}")))?;
        }
        let filter = (aggregate.filter.as_ref())
            .map(|f| f.typed(schema))
            .transpose()?;
        self.storage.shapes().filter(aggregate.filter.as_ref());
        let engine = crate::engine::aggregate::aggregate(
            &self.storage,
            &self.version,
            aggregate,
            filter.as_ref(),
        );
        let groups = match engine.await? {
            Some(groups) => groups,
            None => self.tally(aggregate, filter.as_ref()).await?,
        };
        let mut groups: Vec<(Vec<u8>, Tallied)> = (groups.into_iter())
            .map(|group| Ok((postcard::to_stdvec(&group.0)?, group)))
            .collect::<Result<_>>()?;
        groups.sort_by(|(a_bytes, a), (b_bytes, b)| {
            let pairs = a.0.iter().zip(&b.0);
            let order = pairs.map(|(x, y)| match (x, y) {
                (Some(x), Some(y)) => x.order(y),
                (x, y) => x.is_some().cmp(&y.is_some()),
            });
            order
                .fold(Ordering::Equal, Ordering::then)
                .then_with(|| a_bytes.cmp(b_bytes))
        });
        let mut groups: Vec<Tallied> = groups.into_iter().map(|(_, group)| group).collect();
        if groups.is_empty() && aggregate.group_by.is_empty() {
            groups.push((Vec::new(), Tally::many(aggregate.measures.len())));
        }
        groups
            .into_iter()
            .map(|(key, tallies)| {
                let mut values = BTreeMap::new();
                for ((name, measure), tally) in aggregate.measures.iter().zip(tallies) {
                    if let Some(value) = tally.value(measure, schema)? {
                        values.insert(name.clone(), value);
                    }
                }
                Ok(Group {
                    key: (aggregate.group_by.iter().cloned())
                        .zip(key)
                        .filter_map(|(name, value)| Some((name, value?.canonical())))
                        .collect(),
                    values,
                })
            })
            .collect()
    }

    pub(crate) async fn tally(
        &self,
        aggregate: &Aggregate,
        filter: Option<&Filter>,
    ) -> Result<Vec<Tallied>> {
        let mut groups: HashMap<Vec<u8>, Tallied> = HashMap::new();
        let mut failed = None;
        live::each(&self.storage, &self.version, filter, |_, all| {
            for key in keys_of(aggregate, &all) {
                let encoded = match postcard::to_stdvec(&key) {
                    Ok(encoded) => encoded,
                    Err(e) => {
                        failed.get_or_insert(e.into());
                        continue;
                    }
                };
                let count = aggregate.measures.len();
                let (_, tallies) = groups
                    .entry(encoded)
                    .or_insert_with(|| (key, Tally::many(count)));
                for (tally, measure) in tallies.iter_mut().zip(aggregate.measures.values()) {
                    tally.add(measure, &all);
                }
            }
        })
        .await?;
        match failed {
            Some(e) => Err(e),
            None => Ok(groups.into_values().collect()),
        }
    }

    pub async fn get_many(&self, ids: &[Id]) -> Result<Vec<Doc>> {
        let kind = self.schema().id;
        let ids: Vec<Id> = (ids.iter().map(|id| kind.check(id.clone()))).collect::<Result<_>>()?;
        let mut found = live::fetch(&self.storage, &self.version, &ids).await?;
        Ok(ids.iter().filter_map(|id| found.remove(id)).collect())
    }

    fn typed_query(&self, query: &Query) -> Result<Query> {
        let mut query = query.clone();
        query.filter = (query.filter.as_ref())
            .map(|f| f.typed(self.schema()))
            .transpose()?;
        Ok(query)
    }

    fn typed_search(&self, query: &TextQuery) -> Result<TextQuery> {
        let mut query = query.clone();
        query.filter = (query.filter.as_ref())
            .map(|f| f.typed(self.schema()))
            .transpose()?;
        Ok(query)
    }
}

pub(crate) fn keys_of(aggregate: &Aggregate, all: &Attributes) -> Vec<Vec<Option<Value>>> {
    let mut keys: Vec<Vec<Option<Value>>> = vec![Vec::new()];
    for name in &aggregate.group_by {
        let value = all.get(name);
        let options: Vec<Option<Value>> = match value {
            Some(list) if aggregate.each.contains(name) => {
                let mut unique: Vec<Value> = Vec::new();
                for item in list.items() {
                    let item = item.canonical();
                    if !unique.contains(&item) {
                        unique.push(item);
                    }
                }
                unique.into_iter().map(Some).collect()
            }
            None if aggregate.each.contains(name) => Vec::new(),
            value => vec![value.cloned().map(Value::canonical)],
        };
        keys = (keys.into_iter())
            .flat_map(|key| {
                options.iter().map(move |option| {
                    let mut key = key.clone();
                    key.push(option.clone());
                    key
                })
            })
            .collect();
    }
    keys
}

pub const MAX_ORDER_KEYS: usize = 8;

fn check_names(schema: &Schema, names: &[String]) -> Result<()> {
    names
        .iter()
        .try_for_each(|name| schema.kind(name).map(drop))
}

pub(crate) type Tallied = (Vec<Option<Value>>, Vec<Tally>);

#[derive(Default)]
pub(crate) struct Tally {
    pub count: u64,
    int: i128,
    float: f64,
    extreme: Option<Value>,
}

impl Tally {
    pub(crate) fn many(count: usize) -> Vec<Tally> {
        (0..count).map(|_| Tally::default()).collect()
    }

    fn add(&mut self, measure: &Measure, attributes: &Attributes) {
        match measure.attribute() {
            None => self.count += 1,
            Some(name) => self.add_value(measure, attributes.get(name)),
        }
    }

    pub(crate) fn merge(&mut self, other: Tally, measure: &Measure) {
        self.count += other.count;
        self.int += other.int;
        self.float += other.float;
        if let Some(value) = other.extreme {
            self.consider(measure, value);
        }
    }

    fn consider(&mut self, measure: &Measure, value: Value) {
        if matches!(value, Value::Number(n) if n.is_nan()) {
            return;
        }
        let wins = |old: &Value| match measure {
            Measure::Min(_) => value.order(old).is_lt(),
            _ => value.order(old).is_gt(),
        };
        if self.extreme.as_ref().is_none_or(wins) {
            self.extreme = Some(value.canonical());
        }
    }

    pub(crate) fn add_value(&mut self, measure: &Measure, value: Option<&Value>) {
        let Some(value) = value else {
            return;
        };
        self.count += 1;
        match (measure, value) {
            (Measure::Sum(_) | Measure::Avg(_), Value::Int(n)) => {
                self.int += *n as i128;
                self.float += *n as f64;
            }
            (Measure::Sum(_) | Measure::Avg(_), Value::Number(n)) => self.float += n,
            (Measure::Min(_) | Measure::Max(_), value) => self.consider(measure, value.clone()),
            _ => {}
        }
    }

    fn value(self, measure: &Measure, schema: &Schema) -> Result<Option<Value>> {
        Ok(Some(match measure {
            Measure::Count(_) => Value::Int(self.count as i64),
            Measure::Sum(name) if schema.attributes.get(name) == Some(&Kind::Int) => Value::Int(
                i64::try_from(self.int)
                    .map_err(|_| invalid(format!("the sum of `{name}` is too large")))?,
            ),
            Measure::Sum(_) => Value::Number(self.float),
            Measure::Avg(_) if self.count == 0 => return Ok(None),
            Measure::Avg(_) => Value::Number(self.float / self.count as f64),
            Measure::Min(_) | Measure::Max(_) => return Ok(self.extreme),
        }))
    }
}
