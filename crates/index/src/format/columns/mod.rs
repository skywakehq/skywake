pub(crate) mod build;
pub(crate) mod chunk;
pub(crate) mod dictionary;
pub(crate) mod leaders;
pub(crate) mod packed;
pub(crate) mod plain;
pub(crate) mod projection;
pub(crate) mod select;
pub(crate) mod stats;
#[cfg(test)]
mod tests;
pub(crate) mod writer;

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Arc;

use futures::{StreamExt, TryStreamExt, stream};
use serde::{Deserialize, Serialize};
use skywake_core::Hash;

use crate::format::cluster::checksum;
use crate::format::rows::RowMap;
use crate::store::{PARALLELISM, Storage, part};
use crate::{Error, Id, Result};
use chunk::{Chunk, Layout};
use dictionary::Dictionary;
use leaders::Leaders;
use projection::ProjectionRef;
use stats::{Stats, Totals};

pub(crate) const DIRECTORY_PAGE: usize = 64;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub(crate) struct Columns {
    pub pages: u64,
    pub live: u64,
    pub bytes: u64,
    pub rows: RowMap,
    pub rows_bytes: u64,
    pub ids: Vec<Hash>,
    pub columns: BTreeMap<String, ColumnRef>,
    pub projections: Vec<ProjectionRef>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct ColumnRef {
    pub layout: Layout,
    pub dictionary: Hash,
    pub totals: Hash,
    pub directory: Vec<Hash>,
    pub leaders: Option<Hash>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct Span {
    pub blob: Hash,
    pub start: u64,
    pub end: u64,
    pub check: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct PageRef {
    pub span: Span,
    pub stats: Stats,
}

impl Columns {
    pub(crate) fn weight(&self) -> usize {
        let directories: usize = self.columns.values().map(|c| c.directory.len()).sum();
        let rows = self.rows.root().map_or(self.rows.len() as usize, |_| 1);
        let objects = rows + self.ids.len() + directories;
        256 + 32 * objects + 128 * (self.columns.len() + self.projections.len())
    }

    pub(crate) fn has_leaders(&self) -> bool {
        self.columns.values().any(|column| column.leaders.is_some())
    }
}

pub(crate) async fn directory<T>(storage: &Storage, hashes: &[Hash]) -> Result<Vec<T>>
where
    T: Clone + for<'de> Deserialize<'de> + Send + Sync + 'static,
{
    let pages: Vec<Arc<Vec<T>>> = storage.get_all(hashes.to_vec()).await?;
    Ok(pages.iter().flat_map(|page| page.iter().cloned()).collect())
}

pub(crate) async fn pages(storage: &Storage, column: &ColumnRef) -> Result<Vec<PageRef>> {
    directory(storage, &column.directory).await
}

pub(crate) async fn dictionary(storage: &Storage, column: &ColumnRef) -> Result<Arc<Dictionary>> {
    storage.get(column.dictionary).await
}

pub(crate) async fn totals(storage: &Storage, column: &ColumnRef) -> Result<Arc<Totals>> {
    storage.get(column.totals).await
}

pub(crate) async fn leaders(storage: &Storage, column: &ColumnRef) -> Result<Option<Arc<Leaders>>> {
    match column.leaders {
        Some(hash) => Ok(Some(storage.get(hash).await?)),
        None => Ok(None),
    }
}

pub(crate) async fn chunk(storage: &Storage, span: &Span) -> Result<Arc<Chunk>> {
    read(storage, span).await
}

pub(crate) async fn ids(storage: &Storage, span: &Span) -> Result<Arc<Vec<Id>>> {
    read(storage, span).await
}

async fn read<T>(storage: &Storage, span: &Span) -> Result<Arc<T>>
where
    T: for<'de> Deserialize<'de> + Send + Sync + 'static,
{
    let mut found = read_many(storage, std::slice::from_ref(span)).await?;
    Ok(found.pop().expect("one span was read"))
}

pub(crate) async fn warm(storage: &Storage, columns: &Columns) -> Result<()> {
    let rows: Vec<Span> = directory(storage, &columns.ids).await?;
    let mut blobs: Vec<Hash> = rows.iter().map(|span| span.blob).collect();
    let mut chunks = Vec::new();
    for column in columns.columns.values() {
        futures::try_join!(dictionary(storage, column), totals(storage, column))?;
        let pages = pages(storage, column).await?;
        blobs.extend(pages.iter().map(|page| page.span.blob));
        chunks.extend(pages.into_iter().map(|page| page.span));
    }
    let blobs: HashSet<Hash> = blobs.into_iter().collect();
    storage.keep_on_disk(blobs.into_iter().collect()).await?;
    stream::iter(rows)
        .map(|span| async move { ids(storage, &span).await.map(drop) })
        .buffer_unordered(PARALLELISM)
        .try_for_each(|_| async { Ok(()) })
        .await?;
    stream::iter(chunks)
        .map(|span| async move { chunk(storage, &span).await.map(drop) })
        .buffer_unordered(PARALLELISM)
        .try_for_each(|_| async { Ok(()) })
        .await
}

pub(crate) async fn chunks(storage: &Storage, spans: &[Span]) -> Result<Vec<Arc<Chunk>>> {
    read_many(storage, spans).await
}

pub(crate) async fn ids_many(storage: &Storage, spans: &[Span]) -> Result<Vec<Arc<Vec<Id>>>> {
    read_many(storage, spans).await
}

pub(crate) fn cached(storage: &Storage, span: &Span) -> bool {
    storage.cache().get::<Chunk>(key(span)).is_some()
}

pub(crate) fn key(span: &Span) -> Hash {
    part(span.blob, &format!("column {}..{}", span.start, span.end))
}

const GAP: u64 = 256 << 10;
const MERGED: u64 = 8 << 20;

async fn read_many<T>(storage: &Storage, spans: &[Span]) -> Result<Vec<Arc<T>>>
where
    T: for<'de> Deserialize<'de> + Send + Sync + 'static,
{
    let mut found: Vec<Option<Arc<T>>> =
        spans.iter().map(|s| storage.cache().get(key(s))).collect();
    let mut by_blob: HashMap<Hash, Vec<usize>> = HashMap::new();
    for i in (0..spans.len()).filter(|&i| found[i].is_none()) {
        by_blob.entry(spans[i].blob).or_default().push(i);
    }
    let mut ranges: Vec<(Hash, u64, u64, Vec<usize>)> = Vec::new();
    for (blob, mut members) in by_blob {
        members.sort_by_key(|&i| spans[i].start);
        let mut current: Option<(u64, u64, Vec<usize>)> = None;
        for i in members {
            let span = &spans[i];
            current = match current {
                Some((start, end, mut group))
                    if span.start <= end + GAP && span.end.max(end) - start <= MERGED =>
                {
                    group.push(i);
                    Some((start, end.max(span.end), group))
                }
                Some((start, end, group)) => {
                    ranges.push((blob, start, end, group));
                    Some((span.start, span.end, vec![i]))
                }
                None => Some((span.start, span.end, vec![i])),
            };
        }
        if let Some((start, end, group)) = current {
            ranges.push((blob, start, end, group));
        }
    }
    let fetched: Vec<(u64, Vec<u8>, Vec<usize>)> = stream::iter(ranges)
        .map(|(blob, start, end, members)| async move {
            let bytes = storage.range(blob, start..end).await?;
            Ok::<_, Error>((start, bytes, members))
        })
        .buffer_unordered(PARALLELISM)
        .try_collect()
        .await?;
    for (start, bytes, members) in fetched {
        for i in members {
            let span = &spans[i];
            let piece = &bytes[(span.start - start) as usize..(span.end - start) as usize];
            if checksum(piece) != span.check {
                return Err(Error::Corrupt(format!(
                    "a column chunk of blob {} does not match its checksum",
                    span.blob
                )));
            }
            let value: Arc<T> = Arc::new(postcard::from_bytes(piece)?);
            storage
                .cache()
                .insert(key(span), Arc::clone(&value), 2 * piece.len());
            found[i] = Some(value);
        }
    }
    Ok(found
        .into_iter()
        .map(|v| v.expect("every span was read"))
        .collect())
}
