pub(crate) mod build;
pub(crate) mod chunk;
pub(crate) mod dictionary;
pub(crate) mod packed;
pub(crate) mod plain;
#[cfg(test)]
mod select;
pub(crate) mod stats;
#[cfg(test)]
mod tests;
pub(crate) mod writer;

use std::collections::{BTreeMap, HashSet};
use std::sync::Arc;

use futures::{StreamExt, TryStreamExt, stream};
use serde::{Deserialize, Serialize};
use skywake_core::Hash;

use crate::format::cluster::checksum;
use crate::store::{PARALLELISM, Storage, part};
use crate::{Error, Id, Result};
use chunk::{Chunk, Layout};
use dictionary::Dictionary;
use stats::{Stats, Totals};

pub(crate) const DIRECTORY_PAGE: usize = 64;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub(crate) struct Columns {
    pub pages: u64,
    pub live: u64,
    pub rows: Vec<Hash>,
    pub ids: Vec<Hash>,
    pub columns: BTreeMap<String, ColumnRef>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct ColumnRef {
    pub layout: Layout,
    pub dictionary: Hash,
    pub totals: Hash,
    pub directory: Vec<Hash>,
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
        256 + 32 * (self.rows.len() + self.ids.len() + directories) + 128 * self.columns.len()
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

pub(crate) async fn chunk(storage: &Storage, span: &Span) -> Result<Arc<Chunk>> {
    read(storage, span).await
}

pub(crate) async fn ids(storage: &Storage, span: &Span) -> Result<Arc<Vec<Id>>> {
    read(storage, span).await
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

async fn read<T>(storage: &Storage, span: &Span) -> Result<Arc<T>>
where
    T: for<'de> Deserialize<'de> + Send + Sync + 'static,
{
    let key = part(span.blob, &format!("column {}..{}", span.start, span.end));
    if let Some(found) = storage.cache().get(key) {
        return Ok(found);
    }
    let bytes = storage.range(span.blob, span.start..span.end).await?;
    if checksum(&bytes) != span.check {
        return Err(Error::Corrupt(format!(
            "a column chunk of blob {} does not match its checksum",
            span.blob
        )));
    }
    let value = Arc::new(postcard::from_bytes(&bytes)?);
    storage
        .cache()
        .insert(key, Arc::clone(&value), 2 * bytes.len());
    Ok(value)
}
