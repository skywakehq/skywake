//! Composite projections: a dictionary column's codes and a scalar sort key for every live row, sorted by
//! (code, key) in blocks with running counts. A filtered order by reads one block, a filtered count two.

use std::ops::Range;
use std::sync::Arc;

use futures::{StreamExt, TryStreamExt, stream};
use serde::{Deserialize, Serialize};
use skywake_core::Hash;

use super::chunk::Chunk;
use super::chunk::Layout;
use super::{ColumnRef, Columns, PageRef, Span, chunks, dictionary, pages};
use crate::Result;
use crate::build::full::runs::{Runs, Sorter};
use crate::layout::scalar;
use crate::store::{PARALLELISM, Storage, Written};

const BLOCK_ROWS: usize = 4096;
const LOAD: usize = 64;
const ENTRY_BYTES: usize = 24;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct ProjectionRef {
    pub by: String,
    pub sort: String,
    pub directory: Hash,
    pub source: Hash,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub(crate) struct Directory {
    pub blocks: Vec<BlockRef>,
    pub rows: u64,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub(crate) struct BlockRef {
    pub hash: Hash,
    pub last: (u32, u64),
    pub before: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub(crate) struct Entry {
    pub code: u32,
    pub key: u64,
    pub page: u32,
    pub row: u32,
}

pub(crate) struct Projected {
    pub by: String,
    pub sort: String,
    pub directory: Arc<Directory>,
}

impl Directory {
    pub(crate) async fn position(
        &self,
        storage: &Storage,
        below: impl Fn(u32, u64) -> bool,
    ) -> Result<u64> {
        let at = self.blocks.partition_point(|b| below(b.last.0, b.last.1));
        let Some(block) = self.blocks.get(at) else {
            return Ok(self.rows);
        };
        let entries = load(storage, block).await?;
        Ok(block.before + entries.partition_point(|e| below(e.code, e.key)) as u64)
    }

    pub(crate) async fn walk(
        &self,
        storage: &Storage,
        range: Range<u64>,
        descending: bool,
        mut take: impl FnMut(&Entry) -> bool,
    ) -> Result<()> {
        if range.is_empty() {
            return Ok(());
        }
        let block_of = |at: u64| self.blocks.partition_point(|b| b.before <= at) - 1;
        let (first, last) = (block_of(range.start), block_of(range.end - 1));
        let order: Vec<usize> = match descending {
            true => (first..=last).rev().collect(),
            false => (first..=last).collect(),
        };
        for at in order {
            let block = &self.blocks[at];
            let entries = load(storage, block).await?;
            let start = range.start.saturating_sub(block.before) as usize;
            let end = ((range.end - block.before) as usize).min(entries.len());
            let slice = &entries[start.min(end)..end];
            let more = match descending {
                true => slice.iter().rev().all(&mut take),
                false => slice.iter().all(&mut take),
            };
            if !more {
                break;
            }
        }
        Ok(())
    }
}

async fn load(storage: &Storage, block: &BlockRef) -> Result<Arc<Vec<Entry>>> {
    storage.get(block.hash).await
}

pub(crate) async fn directory(storage: &Storage, projection: &ProjectionRef) -> Result<Projected> {
    Ok(Projected {
        by: projection.by.clone(),
        sort: projection.sort.clone(),
        directory: storage.get(projection.directory).await?,
    })
}

pub(crate) async fn build(
    storage: &Storage,
    columns: &Columns,
    old: &[ProjectionRef],
    wanted: &[(String, String)],
    (budget, spill): (usize, bool),
    written: &mut Written,
) -> Result<Vec<ProjectionRef>> {
    let mut made = Vec::new();
    for (by, sort) in wanted {
        let (Some(by_column), Some(sort_column)) =
            (columns.columns.get(by), columns.columns.get(sort))
        else {
            continue;
        };
        if by_column.layout != Layout::Dictionary || sort_column.layout == Layout::Values {
            continue;
        }
        let source = Hash::of(&postcard::to_stdvec(&(
            &by_column.directory,
            &sort_column.directory,
        ))?);
        let kept = (old.iter()).find(|p| p.by == *by && p.sort == *sort && p.source == source);
        if let Some(kept) = kept {
            made.push(kept.clone());
            continue;
        }
        let runs = Runs::new(storage, spill)?;
        let limit = budget / 4 / ENTRY_BYTES;
        let Some(sorter) = sort_rows(storage, &runs, limit, by_column, sort_column).await? else {
            continue;
        };
        let directory = store(storage, sorter, written).await?;
        made.push(ProjectionRef {
            by: by.clone(),
            sort: sort.clone(),
            directory,
            source,
        });
    }
    Ok(made)
}

async fn sort_rows<'r>(
    storage: &Storage,
    runs: &'r Runs<'r>,
    limit: usize,
    by: &ColumnRef,
    sort: &ColumnRef,
) -> Result<Option<Sorter<'r, Entry>>> {
    let (by_pages, sort_pages, sort_dictionary) = futures::try_join!(
        pages(storage, by),
        pages(storage, sort),
        dictionary(storage, sort),
    )?;
    let mut sorter = Sorter::new(runs, limit);
    let groups: Vec<Vec<usize>> = (0..by_pages.len())
        .collect::<Vec<_>>()
        .chunks(LOAD)
        .map(<[usize]>::to_vec)
        .collect();
    let mut loads = stream::iter(groups)
        .map(|group| load_group(storage, &by_pages, &sort_pages, group))
        .buffered(4);
    while let Some((group, codes, sorts)) = loads.try_next().await? {
        for ((page, by_chunk), sort_chunk) in group.into_iter().zip(codes).zip(sorts) {
            let rows = by_pages[page].stats.rows as usize;
            let Some(codes) = by_chunk.codes() else {
                match (0..rows).all(|row| by_chunk.is_missing(row)) {
                    true => continue,
                    false => return Ok(None),
                }
            };
            let values = sort_chunk.values(sort.layout, &sort_dictionary);
            for (row, value) in values.iter().enumerate() {
                let Some(value) = value.as_ref().filter(|_| !by_chunk.is_missing(row)) else {
                    continue;
                };
                let Some(key) = scalar(value) else {
                    return Ok(None);
                };
                let entry = Entry {
                    code: codes[row],
                    key,
                    page: page as u32,
                    row: row as u32,
                };
                sorter.push(entry).await?;
            }
        }
    }
    Ok(Some(sorter))
}

type Loaded = (Vec<usize>, Vec<Arc<Chunk>>, Vec<Arc<Chunk>>);

async fn load_group(
    storage: &Storage,
    by_pages: &[PageRef],
    sort_pages: &[PageRef],
    group: Vec<usize>,
) -> Result<Loaded> {
    let by: Vec<Span> = group.iter().map(|&p| by_pages[p].span.clone()).collect();
    let sort: Vec<Span> = group.iter().map(|&p| sort_pages[p].span.clone()).collect();
    let (codes, sorts) = futures::try_join!(chunks(storage, &by), chunks(storage, &sort))?;
    Ok((group, codes, sorts))
}

async fn store(
    storage: &Storage,
    sorter: Sorter<'_, Entry>,
    written: &mut Written,
) -> Result<Hash> {
    let mut merged = sorter.finish().await?;
    let mut directory = Directory::default();
    let mut pending: Vec<Vec<Entry>> = Vec::new();
    let mut block = Vec::with_capacity(BLOCK_ROWS);
    loop {
        let next = merged.next().await?;
        let done = next.is_none();
        block.extend(next);
        if block.len() == BLOCK_ROWS || (done && !block.is_empty()) {
            pending.push(std::mem::replace(
                &mut block,
                Vec::with_capacity(BLOCK_ROWS),
            ));
        }
        if pending.len() == PARALLELISM || (done && !pending.is_empty()) {
            put_blocks(
                storage,
                std::mem::take(&mut pending),
                &mut directory,
                written,
            )
            .await?;
        }
        if done {
            break;
        }
    }
    let hash = storage.put(postcard::to_stdvec(&directory)?).await?;
    written.chunks([hash]);
    Ok(hash)
}

async fn put_blocks(
    storage: &Storage,
    full: Vec<Vec<Entry>>,
    directory: &mut Directory,
    written: &mut Written,
) -> Result<()> {
    let encoded = (full.iter())
        .map(postcard::to_stdvec)
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let hashes: Vec<Hash> = stream::iter(encoded)
        .map(|bytes| storage.put(bytes))
        .buffered(PARALLELISM)
        .try_collect()
        .await?;
    written.chunks(hashes.iter().copied());
    for (entries, hash) in full.iter().zip(hashes) {
        let last = entries.last().expect("a block holds entries");
        directory.blocks.push(BlockRef {
            hash,
            last: (last.code, last.key),
            before: directory.rows,
        });
        directory.rows += entries.len() as u64;
    }
    Ok(())
}
