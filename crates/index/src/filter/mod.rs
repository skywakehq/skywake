//! Filter parts: rows sorted by an attribute.

pub(crate) mod attrs;
#[cfg(test)]
mod tests;

use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use futures::{StreamExt, TryStreamExt, stream};
use serde::{Deserialize, Serialize};
use skywake_core::Hash;

use crate::format::Ann;
use crate::format::cluster::{self, ClusterRef, Codes};
use crate::format::pages::Paged;
use crate::store::{PARALLELISM, Storage, Written};
use crate::vector::rabitq;
use crate::{Attributes, Error, Filter, Result, Schema, Value};
use attrs::Attrs;

const BLOCK: usize = 1024;

const PIECE: usize = 64 << 20;

const REQUEST: u64 = 8 << 20;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct FilterPart {
    pub directory: Hash,
    pub blobs: Vec<Hash>,
    pub rows: u64,
    pub bytes: u64,
}

#[derive(Serialize, Deserialize)]
pub(crate) struct Directory {
    pub blocks: Vec<BlockRef>,
}

#[derive(Serialize, Deserialize)]
pub(crate) struct BlockRef {
    pub first: Value,
    pub rows: u32,
    pub blob: u32,
    pub start: u64,
    pub end: u64,
    pub check: u64,
}

#[derive(Serialize, Deserialize)]
struct Stored {
    values: Vec<Value>,
    others: Vec<Attributes>,
    clusters: Vec<Vec<u32>>,
    rows: Vec<Vec<u32>>,
    codes: Vec<Vec<u8>>,
}

pub(crate) struct Block {
    pub values: Vec<Value>,
    pub others: Vec<Attributes>,
    pub columns: Vec<Located>,
}

#[derive(Default)]
pub(crate) struct Located {
    pub clusters: Vec<u32>,
    pub rows: Vec<u32>,
    pub codes: Codes,
}

impl Block {
    fn decode(bytes: &[u8], dims: &[usize]) -> Result<Self> {
        let stored: Stored = postcard::from_bytes(bytes)?;
        let rows = stored.values.len();
        let columns = (stored.clusters.into_iter())
            .zip(stored.rows)
            .zip(&stored.codes)
            .zip(dims)
            .map(|(((clusters, rows_in), codes), &dims)| {
                Ok(Located {
                    clusters,
                    rows: rows_in,
                    codes: Codes::decode(codes, rows, dims)?,
                })
            })
            .collect::<Result<_>>()?;
        Ok(Self {
            values: stored.values,
            others: stored.others,
            columns,
        })
    }
}

fn by_value(a: &Value, b: &Value) -> Ordering {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => a.total_cmp(b),
        _ => a.order(b),
    }
}

type Key = (Value, u64);

fn by_key(a: &Key, b: &Key) -> Ordering {
    by_value(&a.0, &b.0).then(a.1.cmp(&b.1))
}

pub(crate) async fn build(
    storage: &Storage,
    schema: &Schema,
    ann: &Ann,
    base: Option<&Ann>,
    budget: usize,
    written: &mut Written,
) -> Result<BTreeMap<String, FilterPart>> {
    let names: Vec<&String> = schema.filter_index.iter().collect();
    if let Some(base) = base
        && base.columns == ann.columns
        && base.parts.keys().eq(names.iter().copied())
    {
        return Ok(base.parts.clone());
    }
    let mut columns = Vec::new();
    for (name, column) in &schema.vectors {
        let table: Paged<ClusterRef> = ann.columns[name].table.open(storage).await?;
        columns.push((column.dims, table));
    }
    let mut parts = BTreeMap::new();
    for &name in &names {
        let others: Vec<String> = names
            .iter()
            .filter(|&&n| n != name)
            .map(|&n| n.clone())
            .collect();
        let writer = PartWriter {
            storage,
            columns: &columns,
            name,
            others: &others,
        };
        let part = writer.write(ann, budget, written).await?;
        parts.insert(name.clone(), part);
    }
    Ok(parts)
}

struct PartWriter<'a> {
    storage: &'a Storage,
    columns: &'a [(usize, Paged<ClusterRef>)],
    name: &'a str,
    others: &'a [String],
}

#[derive(Default)]
struct Rows {
    keys: Vec<Key>,
    others: Vec<Attributes>,
    columns: Vec<Located>,
}

#[derive(Default)]
struct Out {
    piece: Vec<u8>,
    blobs: Vec<Hash>,
    blocks: Vec<BlockRef>,
    bytes: u64,
}

impl PartWriter<'_> {
    async fn write(&self, ann: &Ann, budget: usize, written: &mut Written) -> Result<FilterPart> {
        let sample: Arc<Attrs> = self.storage.get(ann.filters).await?;
        let bounds = self.bounds(&sample, ann.live, budget);
        let mut out = Out::default();
        for range in 0..=bounds.len() {
            let low = range.checked_sub(1).map(|i| &bounds[i]);
            let rows = self.rows(low, bounds.get(range)).await?;
            self.blocks(rows, &mut out, written).await?;
        }
        self.flush(&mut out, written).await?;
        let rows = out.blocks.iter().map(|b| b.rows as u64).sum();
        let directory = postcard::to_stdvec(&Directory { blocks: out.blocks })?;
        let bytes = out.bytes + directory.len() as u64;
        let hash = self.storage.put(directory).await?;
        written.chunks([hash]);
        Ok(FilterPart {
            directory: hash,
            blobs: out.blobs,
            rows,
            bytes,
        })
    }

    fn bounds(&self, sample: &Attrs, live: u64, budget: usize) -> Vec<Key> {
        let mut keys: Vec<Key> = match sample.columns.get(self.name) {
            Some(values) => (values.iter().zip(&sample.seqs))
                .filter_map(|(value, &seq)| Some((stored(value.as_ref()?)?.clone(), seq)))
                .collect(),
            None => Vec::new(),
        };
        keys.sort_by(by_key);
        let share = keys.len() as f64 / sample.seqs.len().max(1) as f64;
        let words = self.columns.iter().map(|(dims, _)| rabitq::words(*dims));
        let row_bytes = 160 + words.map(|w| 8 * w + 48).sum::<usize>();
        let bytes = live as f64 * share * row_bytes as f64;
        let ranges = ((bytes / budget.max(1) as f64).ceil() as usize).clamp(1, keys.len().max(1));
        (1..ranges)
            .map(|i| keys[i * keys.len() / ranges].clone())
            .collect()
    }

    async fn rows(&self, low: Option<&Key>, high: Option<&Key>) -> Result<Rows> {
        let inside = |key: &Key| {
            low.is_none_or(|low| by_key(key, low).is_ge())
                && high.is_none_or(|high| by_key(key, high).is_lt())
        };
        let mut rows = Rows::default();
        let (dims, table) = &self.columns[0];
        let words = rabitq::words(*dims);
        let mut first = Located::default();
        let mut read = stream::iter(owned(table))
            .map(|(c, cluster)| async move {
                let (codes, attrs, _) = self.storage.read_codes_and_attrs(&cluster, *dims).await?;
                Ok::<_, Error>((c, codes, attrs))
            })
            .buffered(PARALLELISM);
        while let Some((c, codes, attrs)) = read.try_next().await? {
            let Some(values) = attrs.columns.get(self.name) else {
                continue;
            };
            for (row, value) in values.iter().enumerate() {
                let Some(value) = value.as_ref().and_then(stored) else {
                    continue;
                };
                let key = (value.clone(), attrs.seqs[row]);
                if !inside(&key) {
                    continue;
                }
                rows.keys.push(key);
                rows.others.push(attrs.row(row, Some(self.others)));
                first.clusters.push(c as u32);
                first.rows.push(row as u32);
                first.codes.push(&codes, row, words);
            }
        }
        drop(read);
        let at: HashMap<&crate::Id, usize> = (first.codes.ids.iter().enumerate())
            .map(|(i, id)| (id, i))
            .collect();
        let mut columns = Vec::new();
        for (dims, table) in &self.columns[1..] {
            columns.push(self.locate(&at, *dims, table).await?);
        }
        drop(at);
        rows.columns = std::iter::once(first).chain(columns).collect();
        Ok(rows)
    }

    async fn locate(
        &self,
        at: &HashMap<&crate::Id, usize>,
        dims: usize,
        table: &Paged<ClusterRef>,
    ) -> Result<Located> {
        let (n, words) = (at.len(), rabitq::words(dims));
        let mut located = Located {
            clusters: vec![u32::MAX; n],
            rows: vec![0; n],
            codes: Codes::zeros(n, words),
        };
        let mut read = stream::iter(owned(table))
            .map(|(c, cluster)| async move {
                Ok::<_, Error>((c, self.storage.read_codes(&cluster, dims).await?))
            })
            .buffered(PARALLELISM);
        while let Some((c, codes)) = read.try_next().await? {
            for (row, id) in codes.ids.iter().enumerate() {
                if let Some(&i) = at.get(id) {
                    located.clusters[i] = c as u32;
                    located.rows[i] = row as u32;
                    located.codes.set(i, &codes, row, words);
                }
            }
        }
        if located.clusters.contains(&u32::MAX) {
            return Err(Error::Corrupt(
                "the clusters of two vector columns hold different rows".into(),
            ));
        }
        Ok(located)
    }

    async fn blocks(&self, rows: Rows, out: &mut Out, written: &mut Written) -> Result<()> {
        let mut order: Vec<usize> = (0..rows.keys.len()).collect();
        order.sort_by(|&a, &b| by_key(&rows.keys[a], &rows.keys[b]));
        for block in order.chunks(BLOCK) {
            let mut stored = Stored {
                values: block.iter().map(|&i| rows.keys[i].0.clone()).collect(),
                others: block.iter().map(|&i| rows.others[i].clone()).collect(),
                clusters: Vec::new(),
                rows: Vec::new(),
                codes: Vec::new(),
            };
            for (located, (dims, _)) in rows.columns.iter().zip(self.columns) {
                let words = rabitq::words(*dims);
                let mut codes = Codes::default();
                block
                    .iter()
                    .for_each(|&i| codes.push(&located.codes, i, words));
                stored
                    .clusters
                    .push(block.iter().map(|&i| located.clusters[i]).collect());
                stored
                    .rows
                    .push(block.iter().map(|&i| located.rows[i]).collect());
                stored.codes.push(codes.encode()?);
            }
            let bytes = postcard::to_stdvec(&stored)?;
            out.blocks.push(BlockRef {
                first: stored.values[0].clone(),
                rows: block.len() as u32,
                blob: out.blobs.len() as u32,
                start: out.piece.len() as u64,
                end: (out.piece.len() + bytes.len()) as u64,
                check: cluster::checksum(&bytes),
            });
            out.piece.extend(bytes);
            if out.piece.len() >= PIECE {
                self.flush(out, written).await?;
            }
        }
        Ok(())
    }

    async fn flush(&self, out: &mut Out, written: &mut Written) -> Result<()> {
        if out.piece.is_empty() {
            return Ok(());
        }
        let piece = std::mem::take(&mut out.piece);
        out.bytes += piece.len() as u64;
        let hash = self.storage.put_blob(piece).await?;
        written.blobs([hash]);
        out.blobs.push(hash);
        Ok(())
    }
}

fn owned(table: &Paged<ClusterRef>) -> Vec<(usize, ClusterRef)> {
    table.iter().cloned().enumerate().collect()
}

fn stored(value: &Value) -> Option<&Value> {
    match value {
        Value::Number(n) if n.is_nan() => None,
        value => Some(value),
    }
}

impl Directory {
    pub(crate) fn blocks(&self, clause: &Filter) -> Option<Vec<usize>> {
        let ranges: Vec<(Option<&Value>, Option<&Value>)> = match clause {
            Filter::Eq(_, v) => vec![(Some(v), Some(v))],
            Filter::In(_, values) => values.iter().map(|v| (Some(v), Some(v))).collect(),
            Filter::Lt(_, v) | Filter::Lte(_, v) => vec![(None, Some(v))],
            Filter::Gt(_, v) | Filter::Gte(_, v) => vec![(Some(v), None)],
            _ => return None,
        };
        let blocks = &self.blocks;
        let mut picked = Vec::new();
        for (low, high) in ranges {
            let compares = |v: &Value| blocks.first().is_some_and(|b| b.first.compare(v).is_some());
            if !low.into_iter().chain(high).all(compares) {
                continue;
            }
            let start = low.map_or(0, |low| {
                let at = blocks.partition_point(|b| b.first.compare(low) == Some(Ordering::Less));
                at.saturating_sub(1)
            });
            let end = high.map_or(blocks.len(), |high| {
                blocks.partition_point(|b| b.first.compare(high) != Some(Ordering::Greater))
            });
            picked.extend(start..end);
        }
        picked.sort_unstable();
        picked.dedup();
        Some(picked)
    }
}

pub(crate) struct Choice<'a> {
    pub name: &'a str,
    pub part: &'a FilterPart,
    pub directory: Arc<Directory>,
    pub clause: &'a Filter,
    pub blocks: Vec<usize>,
    pub rows: u64,
}

pub(crate) async fn choose<'a>(
    storage: &Storage,
    parts: &'a BTreeMap<String, FilterPart>,
    filter: &'a Filter,
) -> Result<Option<Choice<'a>>> {
    let mut names = Vec::new();
    filter.names(&mut names);
    if names.is_empty() || !names.iter().all(|name| parts.contains_key(*name)) {
        return Ok(None);
    }
    let mut best: Option<Choice> = None;
    for clause in conditions(filter) {
        let (Filter::Eq(name, _)
        | Filter::In(name, _)
        | Filter::Lt(name, _)
        | Filter::Lte(name, _)
        | Filter::Gt(name, _)
        | Filter::Gte(name, _)) = clause
        else {
            continue;
        };
        let part = &parts[name];
        let directory: Arc<Directory> = storage.get(part.directory).await?;
        let Some(blocks) = directory.blocks(clause) else {
            continue;
        };
        let rows = blocks
            .iter()
            .map(|&b| directory.blocks[b].rows as u64)
            .sum();
        if best.as_ref().is_none_or(|best| rows < best.rows) {
            best = Some(Choice {
                name,
                part,
                directory,
                clause,
                blocks,
                rows,
            });
        }
    }
    Ok(best)
}

fn conditions(filter: &Filter) -> Vec<&Filter> {
    match filter {
        Filter::And(all) => all.iter().flat_map(conditions).collect(),
        one => vec![one],
    }
}

pub(crate) async fn read(
    storage: &Storage,
    part: &FilterPart,
    directory: &Directory,
    wanted: &[usize],
    dims: &[usize],
) -> Result<Vec<Arc<Block>>> {
    let key = |b: usize| crate::store::part(part.directory, &format!("block {b}"));
    let follows = |run: &[usize], next: &BlockRef| {
        let (first, last) = (
            &directory.blocks[run[0]],
            &directory.blocks[run[run.len() - 1]],
        );
        last.blob == next.blob && last.end == next.start && next.end - first.start <= REQUEST
    };
    let mut found: BTreeMap<usize, Arc<Block>> = BTreeMap::new();
    let mut runs: Vec<Vec<usize>> = Vec::new();
    for &b in wanted {
        if let Some(block) = storage.cache().get(key(b)) {
            found.insert(b, block);
            continue;
        }
        match runs.last_mut() {
            Some(run) if follows(run, &directory.blocks[b]) => run.push(b),
            _ => runs.push(vec![b]),
        }
    }
    let read: Vec<Vec<(usize, Arc<Block>)>> = stream::iter(runs)
        .map(|run| async move {
            let (first, last) = (
                &directory.blocks[run[0]],
                &directory.blocks[run[run.len() - 1]],
            );
            let blob = part.blobs[first.blob as usize];
            let bytes = storage.range(blob, first.start..last.end).await?;
            let mut decoded = Vec::new();
            for b in run {
                let block = &directory.blocks[b];
                let at = (block.start - first.start) as usize..(block.end - first.start) as usize;
                let bytes = bytes.get(at).unwrap_or_default();
                if cluster::checksum(bytes) != block.check {
                    return Err(Error::Corrupt(format!(
                        "a block of blob {blob} does not match its checksum"
                    )));
                }
                let block = Arc::new(Block::decode(bytes, dims)?);
                storage
                    .cache()
                    .insert(key(b), block.clone(), 2 * bytes.len());
                decoded.push((b, block));
            }
            Ok::<_, Error>(decoded)
        })
        .buffer_unordered(crate::read::query::FAN_OUT)
        .try_collect()
        .await?;
    found.extend(read.into_iter().flatten());
    Ok(wanted.iter().map(|b| found[b].clone()).collect())
}
