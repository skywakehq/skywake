use std::collections::VecDeque;
use std::ops::Range;
use std::sync::Arc;

use futures::{StreamExt, TryStreamExt, stream};
use serde::{Deserialize, Serialize};
use skywake_core::Hash;

use super::chunk::Chunk;
use super::chunk::Layout;
use super::dictionary::Dictionary;
use super::{ColumnRef, Columns, PageRef, Span, chunks, dictionary, pages};
use crate::Result;
use crate::build::full::runs::{Merged, Runs, Sorter};
use crate::layout::scalar;
use crate::store::{PARALLELISM, Storage, Written};

const BLOCK_ROWS: usize = 4096;
const LOAD: usize = 64;
const ENTRY_BYTES: usize = 24;
const HEAD: usize = 32;
const HEAD_ENTRIES: usize = 16_384;
const MAX_RUNS: usize = 8;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct ProjectionRef {
    pub by: String,
    pub sort: String,
    pub source: Hash,
    pub runs: Vec<RunRef>,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct RunRef {
    pub added: Hash,
    pub removed: Option<Hash>,
    pub rows: u64,
}

impl ProjectionRef {
    pub(crate) fn directories(&self) -> impl Iterator<Item = Hash> + '_ {
        (self.runs.iter()).flat_map(|run| std::iter::once(run.added).chain(run.removed))
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub(crate) struct Directory {
    pub blocks: Vec<BlockRef>,
    pub rows: u64,
    pub heads: Vec<Head>,
    pub owners: Vec<u8>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub(crate) struct Head {
    pub code: u32,
    pub rows: u64,
    pub low: Vec<Entry>,
    pub high: Vec<Entry>,
}

struct Heads {
    done: Vec<Head>,
    open: Option<(Head, VecDeque<Entry>)>,
    entries: usize,
    over: bool,
}

impl Heads {
    fn new() -> Self {
        Self {
            done: Vec::new(),
            open: None,
            entries: 0,
            over: false,
        }
    }

    fn add(&mut self, entry: Entry) {
        if self.over {
            return;
        }
        if self
            .open
            .as_ref()
            .is_some_and(|(head, _)| head.code != entry.code)
        {
            self.close();
        }
        let (head, high) = self.open.get_or_insert_with(|| {
            let head = Head {
                code: entry.code,
                ..Head::default()
            };
            (head, VecDeque::with_capacity(HEAD))
        });
        head.rows += 1;
        if head.low.len() < HEAD {
            head.low.push(entry);
        }
        if high.len() == HEAD {
            high.pop_front();
        }
        high.push_back(entry);
    }

    fn close(&mut self) {
        let Some((mut head, high)) = self.open.take() else {
            return;
        };
        head.high = high.into_iter().rev().collect();
        self.entries += head.low.len() + head.high.len();
        self.over = self.entries > HEAD_ENTRIES;
        match self.over {
            true => self.done.clear(),
            false => self.done.push(head),
        }
    }

    fn finish(mut self) -> Vec<Head> {
        self.close();
        self.done
    }
}

impl Directory {
    pub(crate) fn head(&self, code: u32) -> Option<Option<&Head>> {
        if self.heads.is_empty() && self.rows > 0 {
            return None;
        }
        let at = self.heads.binary_search_by_key(&code, |head| head.code);
        Some(at.ok().map(|at| &self.heads[at]))
    }
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
    pub runs: Vec<Run>,
}

pub(crate) struct Run {
    pub added: Arc<Directory>,
    pub removed: Option<Arc<Directory>>,
}

impl Projected {
    pub(crate) fn owners(&self) -> &[u8] {
        (self.runs.last()).map_or(&[], |run| &run.added.owners)
    }
}

pub(crate) fn owns(owners: &[u8], run: usize, entry: &Entry) -> bool {
    (owners.get(entry.page as usize)).is_none_or(|&owner| owner as usize == run)
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

async fn load_run(storage: &Storage, run: RunRef) -> Result<Run> {
    let (added, removed) = futures::try_join!(
        load_directory(storage, run.added),
        load_removed(storage, run.removed),
    )?;
    Ok(Run { added, removed })
}

async fn load_removed(storage: &Storage, hash: Option<Hash>) -> Result<Option<Arc<Directory>>> {
    match hash {
        Some(hash) => load_directory(storage, hash).await.map(Some),
        None => Ok(None),
    }
}

async fn load(storage: &Storage, block: &BlockRef) -> Result<Arc<Vec<Entry>>> {
    storage.get(block.hash).await
}

pub(crate) async fn directory(storage: &Storage, projection: &ProjectionRef) -> Result<Projected> {
    let runs = (projection.runs.iter()).map(|&run| load_run(storage, run));
    Ok(Projected {
        by: projection.by.clone(),
        sort: projection.sort.clone(),
        runs: futures::future::try_join_all(runs).await?,
    })
}

pub(crate) async fn build(
    storage: &Storage,
    columns: &Columns,
    previous: Option<&Columns>,
    wanted: &[(String, String)],
    sizes: (usize, bool),
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
        let old =
            (previous.iter().flat_map(|p| &p.projections)).find(|p| p.by == *by && p.sort == *sort);
        if let Some(old) = old.filter(|old| old.source == source) {
            made.push(old.clone());
            continue;
        }
        let names = (by.as_str(), sort.as_str());
        let grown = match old.zip(previous) {
            Some((old, previous)) => {
                grow(storage, previous, columns, old, names, sizes, written).await?
            }
            None => None,
        };
        let runs = match grown {
            Some(runs) => runs,
            None => match full(storage, by_column, sort_column, sizes, written).await? {
                Some(run) => vec![run],
                None => continue,
            },
        };
        made.push(ProjectionRef {
            by: by.clone(),
            sort: sort.clone(),
            source,
            runs,
        });
    }
    Ok(made)
}

async fn full(
    storage: &Storage,
    by: &ColumnRef,
    sort: &ColumnRef,
    (budget, spill): (usize, bool),
    written: &mut Written,
) -> Result<Option<RunRef>> {
    let side = Side::load(storage, by, sort).await?;
    let runs = Runs::new(storage, spill)?;
    let mut sorter = Sorter::new(&runs, budget / 4 / ENTRY_BYTES);
    let pages: Vec<usize> = (0..side.by.len()).collect();
    if !side.push(storage, &mut sorter, &pages).await? {
        return Ok(None);
    }
    let entries = Entries::new(sorter, None).await?;
    let (added, rows) = store(storage, entries, Vec::new(), written).await?;
    Ok(Some(RunRef {
        added,
        removed: None,
        rows,
    }))
}

async fn grow(
    storage: &Storage,
    previous: &Columns,
    columns: &Columns,
    old: &ProjectionRef,
    (by, sort): (&str, &str),
    (budget, spill): (usize, bool),
    written: &mut Written,
) -> Result<Option<Vec<RunRef>>> {
    let (Some(old_by), Some(old_sort)) = (previous.columns.get(by), previous.columns.get(sort))
    else {
        return Ok(None);
    };
    let (new_by, new_sort) = (&columns.columns[by], &columns.columns[sort]);
    if old_by.layout != new_by.layout || old_sort.layout != new_sort.layout || old.runs.is_empty() {
        return Ok(None);
    }
    let (before, after, codes_before, codes_after, last) = futures::try_join!(
        Side::load(storage, old_by, old_sort),
        Side::load(storage, new_by, new_sort),
        dictionary(storage, old_by),
        dictionary(storage, new_by),
        load_directory(storage, old.runs[old.runs.len() - 1].added),
    )?;
    let stable = extends(&codes_before, &codes_after)
        && extends(&before.dictionary, &after.dictionary)
        && after.by.len() >= before.by.len();
    if !stable {
        return Ok(None);
    }
    let changed: Vec<usize> = (0..before.by.len())
        .filter(|&p| {
            before.by[p].span != after.by[p].span || before.sort[p].span != after.sort[p].span
        })
        .collect();
    let fresh: Vec<usize> = (changed.iter().copied())
        .chain(before.by.len()..after.by.len())
        .collect();
    let delta = before.rows(&changed) + after.rows(&fresh);
    let pending: u64 = old.runs[1..].iter().map(|run| run.rows).sum();
    if (pending + delta) * 2 > old.runs[0].rows {
        return Ok(None);
    }
    let mut merged = old.runs.len();
    let mut size = delta;
    while merged > 1 && (old.runs[merged - 1].rows <= 2 * size || merged + 1 > MAX_RUNS) {
        merged -= 1;
        size += old.runs[merged].rows;
    }
    let mut owners = last.owners.clone();
    owners.resize(before.by.len(), 0);
    let fresh_set: std::collections::HashSet<usize> = fresh.iter().copied().collect();
    let runs = Runs::new(storage, spill)?;
    let limit = budget / 12 / ENTRY_BYTES;
    let (mut added, mut removed, mut stale) = (
        Sorter::new(&runs, limit),
        Sorter::new(&runs, limit),
        Sorter::new(&runs, limit),
    );
    if !after.push(storage, &mut added, &fresh).await?
        || !before.push(storage, &mut removed, &changed).await?
    {
        return Ok(None);
    }
    for (at, run) in old.runs.iter().enumerate().skip(merged) {
        for entry in load_all(storage, run.added).await? {
            let page = entry.page as usize;
            match owners[page] as usize == at && !fresh_set.contains(&page) {
                true => added.push(entry).await?,
                false => stale.push(entry).await?,
            }
        }
        if let Some(hash) = run.removed {
            for entry in load_all(storage, hash).await? {
                removed.push(entry).await?;
            }
        }
    }
    let index = merged as u8;
    for owner in owners.iter_mut().filter(|owner| **owner >= index) {
        *owner = index;
    }
    owners.resize(after.by.len(), index);
    for &page in &fresh {
        owners[page] = index;
    }
    let removed = Entries::new(removed, Some(stale)).await?;
    let (removed, gone) = store(storage, removed, Vec::new(), written).await?;
    let added = Entries::new(added, None).await?;
    let (added, rows) = store(storage, added, owners, written).await?;
    let mut kept = old.runs[..merged].to_vec();
    kept.push(RunRef {
        added,
        removed: (gone > 0).then_some(removed),
        rows: rows + gone,
    });
    Ok(Some(kept))
}

fn extends(old: &Dictionary, new: &Dictionary) -> bool {
    new.values.len() >= old.values.len() && new.values[..old.values.len()] == old.values[..]
}

async fn load_directory(storage: &Storage, hash: Hash) -> Result<Arc<Directory>> {
    storage.get(hash).await
}

async fn load_all(storage: &Storage, hash: Hash) -> Result<Vec<Entry>> {
    let directory = load_directory(storage, hash).await?;
    let hashes: Vec<Hash> = directory.blocks.iter().map(|block| block.hash).collect();
    let blocks: Vec<Arc<Vec<Entry>>> = stream::iter(hashes)
        .map(|hash| storage.get(hash))
        .buffered(PARALLELISM)
        .try_collect()
        .await?;
    Ok(blocks
        .iter()
        .flat_map(|block| block.iter().copied())
        .collect())
}

struct Side {
    by: Vec<PageRef>,
    sort: Vec<PageRef>,
    layout: Layout,
    dictionary: Arc<Dictionary>,
}

impl Side {
    async fn load(storage: &Storage, by: &ColumnRef, sort: &ColumnRef) -> Result<Self> {
        let (by_pages, sort_pages, dictionary) = futures::try_join!(
            pages(storage, by),
            pages(storage, sort),
            dictionary(storage, sort),
        )?;
        Ok(Self {
            by: by_pages,
            sort: sort_pages,
            layout: sort.layout,
            dictionary,
        })
    }

    fn rows(&self, pages: &[usize]) -> u64 {
        pages
            .iter()
            .map(|&page| u64::from(self.by[page].stats.rows))
            .sum()
    }

    async fn push(
        &self,
        storage: &Storage,
        sorter: &mut Sorter<'_, Entry>,
        pages: &[usize],
    ) -> Result<bool> {
        let groups: Vec<Vec<usize>> = pages.chunks(LOAD).map(<[usize]>::to_vec).collect();
        let mut loads = stream::iter(groups)
            .map(|group| self.load_group(storage, group))
            .buffered(4);
        while let Some((group, codes, sorts)) = loads.try_next().await? {
            for ((page, by_chunk), sort_chunk) in group.into_iter().zip(codes).zip(sorts) {
                let rows = self.by[page].stats.rows as usize;
                let Some(codes) = by_chunk.codes() else {
                    match (0..rows).all(|row| by_chunk.is_missing(row)) {
                        true => continue,
                        false => return Ok(false),
                    }
                };
                let values = sort_chunk.values(self.layout, &self.dictionary);
                for (row, value) in values.iter().enumerate() {
                    let Some(value) = value.as_ref().filter(|_| !by_chunk.is_missing(row)) else {
                        continue;
                    };
                    let Some(key) = scalar(value) else {
                        return Ok(false);
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
        Ok(true)
    }

    async fn load_group(&self, storage: &Storage, group: Vec<usize>) -> Result<Loaded> {
        let by: Vec<Span> = group.iter().map(|&p| self.by[p].span.clone()).collect();
        let sort: Vec<Span> = group.iter().map(|&p| self.sort[p].span.clone()).collect();
        let (codes, sorts) = futures::try_join!(chunks(storage, &by), chunks(storage, &sort))?;
        Ok((group, codes, sorts))
    }
}

type Loaded = (Vec<usize>, Vec<Arc<Chunk>>, Vec<Arc<Chunk>>);

struct Entries<'r> {
    keep: Merged<'r, Entry>,
    drop: Option<Merged<'r, Entry>>,
    next_drop: Option<Entry>,
}

impl<'r> Entries<'r> {
    async fn new(keep: Sorter<'r, Entry>, drop: Option<Sorter<'r, Entry>>) -> Result<Self> {
        let keep = keep.finish().await?;
        let mut drop = match drop {
            Some(drop) => Some(drop.finish().await?),
            None => None,
        };
        let next_drop = match &mut drop {
            Some(drop) => drop.next().await?,
            None => None,
        };
        Ok(Self {
            keep,
            drop,
            next_drop,
        })
    }

    async fn next(&mut self) -> Result<Option<Entry>> {
        'entries: while let Some(entry) = self.keep.next().await? {
            while let (Some(drop), Some(next)) = (&mut self.drop, self.next_drop) {
                if next > entry {
                    break;
                }
                self.next_drop = drop.next().await?;
                if next == entry {
                    continue 'entries;
                }
            }
            return Ok(Some(entry));
        }
        Ok(None)
    }
}

async fn store(
    storage: &Storage,
    mut entries: Entries<'_>,
    owners: Vec<u8>,
    written: &mut Written,
) -> Result<(Hash, u64)> {
    let mut directory = Directory {
        owners,
        ..Directory::default()
    };
    let mut pending: Vec<Vec<Entry>> = Vec::new();
    let mut block = Vec::with_capacity(BLOCK_ROWS);
    let mut heads = Heads::new();
    loop {
        let next = entries.next().await?;
        let done = next.is_none();
        if let Some(entry) = next {
            heads.add(entry);
        }
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
    directory.heads = heads.finish();
    let rows = directory.rows;
    let hash = storage.put(postcard::to_stdvec(&directory)?).await?;
    written.chunks([hash]);
    Ok((hash, rows))
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
