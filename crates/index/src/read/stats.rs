//! What a branch holds, for the console: rows, the tail, clusters, bytes.

use std::collections::HashMap;
use std::sync::Arc;

use futures::{StreamExt, TryStreamExt, stream};

use crate::format::Version;
use crate::format::cluster::ClusterRef;
use crate::format::pages::Paged;
use crate::format::parts;
use crate::format::rows;
use crate::format::segment_ids::SegmentIds;
use crate::store::PARALLELISM;
use crate::store::Storage;
use crate::{Id, Result};

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
    let tail = tail_ids(storage, version).await?;
    let newest = newest(&tail);
    let current = newest.values().filter(|&&doc| doc).count() as u64;
    let documents: u64 = tail.iter().map(|(_, s)| s.ids.len() as u64).sum();
    let sources = parts::sources(storage, version, true).await?;
    let mut stats = Stats {
        rows: current,
        deleted_rows: documents - current,
        segments: sources.len() as u64,
        unindexed_rows: current,
        bytes: sources.iter().map(|s| s.bytes).sum(),
        ..Stats::default()
    };
    let (text_live, text_replaced, text_bytes) =
        crate::text::counts(storage, version, newest.keys().copied()).await?;
    stats.bytes += text_bytes;
    stats.bytes += version.columns.as_ref().map_or(0, |columns| columns.bytes);
    let Some(ann) = &version.ann else {
        stats.indexed_rows = text_live - text_replaced;
        stats.rows += stats.indexed_rows;
        stats.deleted_rows += text_replaced;
        return Ok(stats);
    };
    let pages = rows::pages_of(storage, &ann.rows, newest.keys().copied()).await?;
    let replaced = (newest.keys())
        .filter(|id| pages[&rows::page_in(id, &ann.rows)].find(id).is_some())
        .count() as u64;
    stats.indexed_rows = ann.live - replaced;
    stats.rows += stats.indexed_rows;
    stats.deleted_rows += replaced;
    stats.bytes += ann.rows_bytes;
    stats.bytes += ann.parts.values().map(|part| part.bytes).sum::<u64>();
    for (name, column) in &ann.columns {
        let dims = version.schema.vectors.get(name).map_or(0, |c| c.dims);
        let table: Paged<ClusterRef> = column.table.open(storage).await?;
        stats.clusters += column.groups;
        stats.bytes += 4 * dims as u64 * column.table.len;
        stats.bytes += table.iter().map(|c| c.bytes()).sum::<u64>();
    }
    Ok(stats)
}

async fn tail_ids(storage: &Storage, version: &Version) -> Result<Vec<(u64, Arc<SegmentIds>)>> {
    let segments: Vec<_> = (version.tail().iter())
        .map(|segment| (segment.first_seq, segment.hash))
        .collect();
    stream::iter(segments)
        .map(|(first_seq, hash)| async move {
            Ok::<_, crate::Error>((first_seq, storage.segment_ids(hash).await?))
        })
        .buffered(PARALLELISM)
        .try_collect()
        .await
}

fn newest(tail: &[(u64, Arc<SegmentIds>)]) -> HashMap<&Id, bool> {
    let mut newest = HashMap::new();
    for (first_seq, segment) in tail {
        for (_, id, doc) in segment.writes(*first_seq) {
            newest.insert(id, doc);
        }
    }
    newest
}
