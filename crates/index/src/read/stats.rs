//! What a branch holds, for the console: rows, the tail, clusters, bytes.

use super::tail::Tail;
use crate::Result;
use crate::format::cluster::ClusterRef;
use crate::format::pages::Paged;
use crate::format::rows;
use crate::format::{SegmentRef, Version};
use crate::store::Storage;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Stats {
    pub rows: u64,
    pub deleted_rows: u64,
    pub segments: u64,
    pub indexed_rows: u64,
    pub unindexed_rows: u64,
    pub clusters: u64,
    pub bytes: u64,
}

pub(crate) async fn stats(storage: &Storage, version: &Version) -> Result<Stats> {
    let tail = Tail::load(storage, version).await?;
    let newest = tail.newest();
    let current = tail.live(&newest).len() as u64;
    let documents: u64 = tail.segments.iter().map(|(_, s)| s.ids.len() as u64).sum();
    let built: Paged<SegmentRef> = version.built.open(storage).await?;
    let segments = built.iter().chain(version.tail());
    let mut stats = Stats {
        rows: current,
        deleted_rows: documents - current,
        segments: (version.covers() + version.tail().len()) as u64,
        unindexed_rows: current,
        bytes: segments.map(|s| s.bytes).sum(),
        ..Stats::default()
    };
    let (text_live, text_replaced, text_bytes) =
        crate::text::counts(storage, version, newest.keys().copied()).await?;
    stats.bytes += text_bytes;
    let Some(ann) = &version.ann else {
        stats.indexed_rows = text_live - text_replaced;
        stats.rows += stats.indexed_rows;
        stats.deleted_rows += text_replaced;
        return Ok(stats);
    };
    let pages = rows::pages_of(storage, &ann.rows, newest.keys().copied()).await?;
    let replaced = (newest.keys())
        .filter(|id| pages[&rows::page_of(id, ann.rows.len())].find(id).is_some())
        .count() as u64;
    stats.indexed_rows = ann.live - replaced;
    stats.rows += stats.indexed_rows;
    stats.deleted_rows += replaced;
    stats.bytes += ann.rows_bytes;
    stats.bytes += ann.parts.values().map(|part| part.bytes).sum::<u64>();
    for (name, column) in &ann.columns {
        let dims = version.schema.vectors.get(name).map_or(0, |c| c.dims);
        let table: Paged<ClusterRef> = column.table.open(storage).await?;
        stats.clusters += column.table.len;
        stats.bytes += 4 * dims as u64 * column.table.len;
        stats.bytes += table.iter().map(|c| c.bytes()).sum::<u64>();
    }
    Ok(stats)
}
