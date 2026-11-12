//! The vector query path.

mod known;
mod top;

use std::collections::{BTreeMap, HashMap};
use std::ops::RangeInclusive;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering::Relaxed};

use futures::{StreamExt, TryStreamExt, stream};

use crate::filter::attrs::{Attrs, Bits, has};
use crate::filter::{self, FilterPart};
use crate::format::cluster::{self, Codes};
use crate::format::{Clusters, Version};
use crate::read::tail::{Row, Tail};
use crate::store::{PARALLELISM, Storage};
use crate::vector::ivf;
use crate::vector::rabitq::{self, Anchor, Estimator, Prepared, Rotation};
use crate::{Column, Error, Hit, Id, Metric, Query, Result, invalid};
use known::{Known, reach};
use skywake_core::Hash;
use top::{From, Kth, Top, hits, kth};

const DEFAULT_RECALL: f32 = 0.95;

const GAP: u64 = 256 << 10;

const FILTER_FIRST_SHARE: f64 = 0.003;

const FILTER_FIRST_ROWS: RangeInclusive<u64> = 4096..=100_000;

pub(crate) const FAN_OUT: usize = 256;

pub(crate) async fn run(storage: &Storage, version: &Version, query: &Query) -> Result<Vec<Hit>> {
    let schema = &version.schema;
    let (pos, column) = schema
        .vectors
        .iter()
        .enumerate()
        .find(|(_, (name, _))| **name == query.column)
        .map(|(pos, (_, column))| (pos, *column))
        .ok_or_else(|| invalid(format!("no vector column `{}`", query.column)))?;
    let dims = column.dims;
    if query.vector.len() != dims {
        return Err(invalid(format!(
            "the query vector has {} dimensions, not {dims}",
            query.vector.len()
        )));
    }
    if query
        .recall
        .is_some_and(|recall| recall.is_nan() || recall <= 0.0)
    {
        return Err(invalid("recall must be more than 0"));
    }
    if let Some(name) = query
        .include
        .iter()
        .find(|name| !schema.attributes.contains_key(*name))
    {
        return Err(invalid(format!("no attribute `{name}`")));
    }
    let mut vector = query.vector.clone();
    if column.metric == Metric::Cosine {
        ivf::normalize(&mut vector);
    }

    let tail = Tail::load(storage, version).await?;
    let newest = tail.newest();
    let mut top = Top::new(query.top_k);
    let mut matched = 0;
    for (id, row) in tail.live(&newest) {
        let segment = tail.segment(row);
        if (query.filter.as_ref()).is_some_and(|f| !f.matches(id, &segment.attributes[row.row])) {
            continue;
        }
        matched += 1;
        let d = ivf::distance(column.metric, &vector, segment.vector(pos, dims, row.row));
        top.offer(d, id, From::Tail(row));
    }

    let mut table = None;
    if let Some(ann) = &version.ann
        && query.top_k > 0
    {
        let clusters = ann
            .columns
            .get(&query.column)
            .ok_or_else(|| Error::Corrupt(format!("no clusters for `{}`", query.column)))?;
        let (known, origin) = futures::try_join!(
            Known::open(storage, clusters, column.metric, &vector),
            storage.origin(clusters, dims)
        )?;
        let mut search = Search {
            storage,
            query,
            column,
            vector: &vector,
            clusters,
            known,
            origin: &origin,
            newest: &newest,
            filters: ann.filters,
            parts: &ann.parts,
            pos,
            dims: &schema.vectors.values().map(|c| c.dims).collect::<Vec<_>>(),
        };
        search.run(&mut top, matched).await?;
        table = Some(search.known);
    }
    hits(storage, &tail, table.as_ref(), top, &query.include).await
}

struct Search<'a> {
    storage: &'a Storage,
    query: &'a Query,
    column: Column,
    vector: &'a [f32],
    clusters: &'a Clusters,
    known: Known,
    origin: &'a [f32],
    newest: &'a HashMap<&'a Id, Option<Row>>,
    filters: Hash,
    parts: &'a BTreeMap<String, FilterPart>,
    pos: usize,
    dims: &'a [usize],
}

struct Estimate {
    lower: f32,
    upper: f32,
    cluster: usize,
    row: usize,
}

#[derive(Default)]
struct Found {
    rows: Vec<Estimate>,
    codes: HashMap<usize, Arc<Codes>>,
    seen: usize,
    matched: usize,
}

impl Search<'_> {
    async fn run(&mut self, top: &mut Top, tail_matched: usize) -> Result<()> {
        if self.filter_first(top).await? {
            return Ok(());
        }
        let storage = self.storage;
        let count = self.clusters.table.len as usize;
        let k = self.query.top_k;
        if self.plan(k as f64) >= count {
            self.known.settle(storage, count).await?;
            return self.exact(&self.known.order, top).await;
        }
        let mut planned = self.plan(k as f64 / self.share().await?);
        self.known.settle(storage, planned).await?;

        let mut found = Found::default();
        let mut visited = 0;
        let before = top.kth().min(self.bound_before_reading(&self.known.order));
        let mut asked = false;
        loop {
            self.known.settle(storage, planned).await?;
            let limit = before.min(kth(found.rows.iter().map(|e| e.upper), top));
            let wave: Vec<usize> = (self.known.order[visited..planned].iter())
                .filter(|&&(score, c)| self.lower(score, c) <= limit)
                .map(|&(_, c)| c)
                .collect();
            self.estimate(&wave, &mut found, limit).await?;
            visited = planned;
            let more = match (&self.query.filter, self.query.probe) {
                (Some(_), None) if !asked && found.matched < found.seen => {
                    asked = true;
                    let share = found.matched.max(1) as f64 / found.seen as f64;
                    self.plan(k as f64 / share)
                }
                _ => planned,
            };
            if more <= planned {
                break;
            }
            planned = more;
        }
        if found.matched + tail_matched < k {
            self.known.settle(storage, count).await?;
            self.exact(&self.known.order[visited..], top).await?;
        }
        let limit = kth(found.rows.iter().map(|e| e.upper), top);
        let candidates = (found.rows.iter())
            .filter(|e| e.lower <= limit)
            .map(|e| {
                let codes = &found.codes[&e.cluster];
                Candidate {
                    cluster: e.cluster,
                    row: e.row,
                    check: codes.checks[e.row],
                    id: codes.ids[e.row].clone(),
                }
            })
            .collect();
        self.rerank(candidates, top).await
    }

    async fn filter_first(&mut self, top: &mut Top) -> Result<bool> {
        let (Some(filter), None) = (&self.query.filter, self.query.probe) else {
            return Ok(false);
        };
        let Some(choice) = filter::choose(self.storage, self.parts, filter).await? else {
            return Ok(false);
        };
        let share = (FILTER_FIRST_SHARE * choice.part.rows as f64) as u64;
        let (least, most) = FILTER_FIRST_ROWS.into_inner();
        if choice.rows > share.clamp(least, most) {
            return Ok(false);
        }
        let blocks = filter::read(
            self.storage,
            choice.part,
            &choice.directory,
            &choice.blocks,
            self.dims,
        )
        .await?;
        let clusters = (blocks.iter()).flat_map(|b| &b.columns[self.pos].clusters);
        let storage = self.storage;
        self.known
            .load(storage, clusters.map(|&c| c as usize))
            .await?;
        let rest = !std::ptr::eq(filter, choice.clause);
        let exact = self.query.recall.unwrap_or(DEFAULT_RECALL) >= 1.0;
        let (estimator, query) = self.prepared();
        let words = rabitq::words(self.column.dims);
        let mut anchors: HashMap<usize, Anchor> = HashMap::new();
        let mut best = Kth::new(self.query.top_k, top.kth());
        let mut rows: Vec<(f32, f32, usize, usize)> = Vec::new();
        for (b, block) in blocks.iter().enumerate() {
            let located = &block.columns[self.pos];
            for (i, value) in block.values.iter().enumerate() {
                let id = &located.codes.ids[i];
                if !choice.clause.test(Some(value)) || self.newest.contains_key(id) {
                    continue;
                }
                if rest {
                    let mut attributes = block.others[i].clone();
                    attributes.insert(choice.name.to_string(), value.clone());
                    if !filter.matches(id, &attributes) {
                        continue;
                    }
                }
                let (lower, upper) = match exact {
                    true => (f32::NEG_INFINITY, f32::INFINITY),
                    false => {
                        let c = located.clusters[i] as usize;
                        let anchor = anchors.entry(c).or_insert_with(|| self.anchor(c));
                        let bits = &located.codes.bits[i * words..(i + 1) * words];
                        let factors = &located.codes.factors[i];
                        let (d, error) = estimator.estimate(&query, anchor, bits, factors);
                        (d - error, d + error)
                    }
                };
                if lower > best.get() {
                    continue;
                }
                best.offer(upper);
                rows.push((lower, upper, b, i));
            }
        }
        let limit = kth(rows.iter().map(|r| r.1), top);
        let candidates = (rows.into_iter())
            .filter(|r| r.0 <= limit)
            .map(|(_, _, b, i)| {
                let located = &blocks[b].columns[self.pos];
                Candidate {
                    cluster: located.clusters[i] as usize,
                    row: located.rows[i] as usize,
                    check: located.codes.checks[i],
                    id: located.codes.ids[i].clone(),
                }
            })
            .collect();
        self.rerank(candidates, top).await?;
        Ok(true)
    }

    async fn share(&self) -> Result<f64> {
        let (Some(filter), None) = (&self.query.filter, self.query.probe) else {
            return Ok(1.0);
        };
        let sample: Arc<Attrs> = self.storage.get(self.filters).await?;
        let rows = sample.seqs.len();
        if rows == 0 {
            return Ok(1.0);
        }
        let bits = sample.eval(filter, None, rows);
        let passed = bits.iter().map(|w| w.count_ones()).sum::<u32>() as f64;
        Ok(((passed - passed.sqrt()).max(0.5) / rows as f64).min(1.0))
    }

    fn plan(&self, k: f64) -> usize {
        let count = self.clusters.table.len as usize;
        let recall = self.query.recall.unwrap_or(DEFAULT_RECALL);
        match self.query.probe {
            Some(probe) => probe.min(count),
            None if recall >= 1.0 => count,
            None => {
                let share = self.clusters.calibration.share(k, recall);
                ((share * count as f32).ceil() as usize).clamp(1, count)
            }
        }
    }

    fn lower(&self, score: f32, c: usize) -> f32 {
        self.reach(score, self.known.get(c).radius).0
    }

    fn reach(&self, score: f32, radius: f32) -> (f32, f32) {
        reach(self.column.metric, self.vector, score, radius)
    }

    fn bound_before_reading(&self, order: &[(f32, usize)]) -> f32 {
        if self.query.filter.is_some() {
            return f32::INFINITY;
        }
        let mut far: Vec<(f32, u64)> = (order.iter())
            .map(|&(score, c)| {
                let cluster = self.known.get(c);
                (self.reach(score, cluster.radius).1, cluster.rows)
            })
            .collect();
        far.sort_by(|a, b| a.0.total_cmp(&b.0));
        let needed = (self.query.top_k + self.newest.len()) as u64;
        let mut rows = 0;
        for (distance, count) in far {
            rows += count;
            if rows >= needed {
                return distance;
            }
        }
        f32::INFINITY
    }

    async fn estimate(&self, wave: &[usize], found: &mut Found, limit: f32) -> Result<()> {
        let read: Vec<(usize, Arc<Codes>, Option<Bits>)> = stream::iter(wave.to_vec())
            .map(|c| async move {
                let (cluster, dims) = (self.known.get(c), self.column.dims);
                let found = match &self.query.filter {
                    Some(filter) => {
                        let (codes, attrs) = self.storage.codes_and_attrs(cluster, dims).await?;
                        let bits = attrs.eval(filter, Some(&codes.ids), cluster.rows as usize);
                        (c, codes, Some(bits))
                    }
                    None => (c, self.storage.codes(cluster, dims).await?, None),
                };
                Ok::<_, Error>(found)
            })
            .buffer_unordered(FAN_OUT)
            .try_collect()
            .await?;
        let (estimator, query) = self.prepared();
        let next = AtomicUsize::new(0);
        let shared = AtomicU32::new(order_bits(limit));
        let cores = std::thread::available_parallelism().map_or(1, |n| n.get());
        let parts = ivf::parallel(cores.min(read.len()), |_| {
            let mut part = Found::default();
            let mut best = Kth::new(self.query.top_k, limit);
            while let Some((c, codes, pass)) = read.get(next.fetch_add(1, Relaxed)) {
                best.limit = best.limit.min(from_order_bits(shared.load(Relaxed)));
                let cluster = Cluster {
                    c: *c,
                    codes,
                    pass: pass.as_ref(),
                };
                self.estimate_cluster(&cluster, &estimator, &query, &mut best, &mut part);
                shared.fetch_min(order_bits(best.get()), Relaxed);
            }
            part
        });
        for part in parts {
            found.rows.extend(part.rows);
            found.seen += part.seen;
            found.matched += part.matched;
        }
        found
            .codes
            .extend(read.into_iter().map(|(c, codes, _)| (c, codes)));
        Ok(())
    }

    fn prepared(&self) -> (Estimator, Prepared) {
        let dims = self.column.dims;
        let rotation = Rotation::new(dims, self.clusters.seed);
        let estimator = Estimator::new(self.column.metric, dims);
        let query = estimator.prepare(&rotation.difference(self.vector, self.origin));
        (estimator, query)
    }

    fn anchor(&self, c: usize) -> Anchor {
        let scale = self.known.get(c).scale;
        let centroid = self.known.centroid(c);
        let (mut far, mut along) = (0.0, 0.0);
        for (q, x) in self.vector.iter().zip(centroid) {
            far += (q - scale * x) * (q - scale * x);
            along += q * x;
        }
        Anchor {
            norm: f32::sqrt(far),
            to_anchor: scale * along,
        }
    }

    fn estimate_cluster(
        &self,
        cluster: &Cluster,
        estimator: &Estimator,
        query: &Prepared,
        best: &mut Kth,
        found: &mut Found,
    ) {
        let (c, codes) = (cluster.c, cluster.codes);
        let words = rabitq::words(self.column.dims);
        let anchor = self.anchor(c);
        for (row, id) in codes.ids.iter().enumerate() {
            if self.newest.contains_key(id) {
                continue;
            }
            found.seen += 1;
            if cluster.pass.is_some_and(|bits| !has(bits, row)) {
                continue;
            }
            found.matched += 1;
            let bits = &codes.bits[row * words..(row + 1) * words];
            let (d, error) = estimator.estimate(query, &anchor, bits, &codes.factors[row]);
            if d - error > best.get() {
                continue;
            }
            best.offer(d + error);
            found.rows.push(Estimate {
                lower: d - error,
                upper: d + error,
                cluster: c,
                row,
            });
        }
    }

    async fn rerank(&self, mut candidates: Vec<Candidate>, top: &mut Top) -> Result<()> {
        candidates.sort_unstable_by_key(|c| (c.cluster, c.row));
        let size = self.column.dims * self.column.element.bytes();
        let mut runs: Vec<Vec<Candidate>> = Vec::new();
        for candidate in candidates {
            match runs.last_mut() {
                Some(run) if near(&run[run.len() - 1], &candidate, size) => run.push(candidate),
                _ => runs.push(vec![candidate]),
            }
        }
        let mut read = stream::iter(runs)
            .map(|run| async move {
                let cluster = self.known.get(run[0].cluster);
                let range = cluster.vectors(run[0].row..run[run.len() - 1].row + 1);
                let bytes = self.storage.range_cached(cluster.hash, range).await?;
                Ok::<_, Error>((run, bytes))
            })
            .buffer_unordered(FAN_OUT);
        while let Some((run, bytes)) = read.try_next().await? {
            for candidate in &run {
                let at = (candidate.row - run[0].row) * size;
                let bytes = bytes.get(at..at + size).unwrap_or_default();
                if cluster::checksum(bytes) != candidate.check {
                    let hash = self.known.get(candidate.cluster).hash;
                    return Err(Error::Corrupt(format!(
                        "a vector of blob {hash} does not match its checksum"
                    )));
                }
                let vector = cluster::from_bytes(bytes, self.column.element);
                let d = ivf::distance(self.column.metric, self.vector, &vector);
                let from = From::Cluster(candidate.cluster, candidate.row);
                top.offer(d, &candidate.id, from);
            }
        }
        Ok(())
    }

    async fn exact(&self, order: &[(f32, usize)], top: &mut Top) -> Result<()> {
        let dims = self.column.dims;
        let clusters: Vec<usize> = order.iter().map(|&(_, c)| c).collect();
        let mut read = stream::iter(clusters)
            .map(|c| async move {
                let blob = self.storage.blob(self.known.get(c).hash).await?;
                Ok::<_, Error>((c, cluster::decode(&blob)?))
            })
            .buffer_unordered(PARALLELISM);
        while let Some((c, cluster)) = read.try_next().await? {
            for (row, id) in cluster.ids.iter().enumerate() {
                if self.newest.contains_key(id) {
                    continue;
                }
                if (self.query.filter.as_ref())
                    .is_some_and(|filter| !filter.matches(id, &cluster.attributes[row]))
                {
                    continue;
                }
                let vector = &cluster.vectors[row * dims..(row + 1) * dims];
                let d = ivf::distance(self.column.metric, self.vector, vector);
                top.offer(d, id, From::Cluster(c, row));
            }
        }
        Ok(())
    }
}

fn order_bits(x: f32) -> u32 {
    let bits = x.to_bits();
    match bits >> 31 {
        1 => !bits,
        _ => bits | 1 << 31,
    }
}

fn from_order_bits(bits: u32) -> f32 {
    f32::from_bits(match bits >> 31 {
        1 => bits & !(1 << 31),
        _ => !bits,
    })
}

struct Cluster<'a> {
    c: usize,
    codes: &'a Codes,
    pass: Option<&'a Bits>,
}

struct Candidate {
    cluster: usize,
    row: usize,
    check: u64,
    id: Id,
}

fn near(a: &Candidate, b: &Candidate, size: usize) -> bool {
    a.cluster == b.cluster && ((b.row - a.row - 1) * size) as u64 <= GAP
}

#[cfg(test)]
mod tests;
