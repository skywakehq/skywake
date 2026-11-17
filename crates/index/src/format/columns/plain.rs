use std::collections::{BTreeMap, BTreeSet, HashMap};

use futures::{StreamExt, TryStreamExt, stream};

use super::Columns;
use super::writer::{Old, Values, Writer, covers};
use crate::build::full::runs::{Runs, Sorter};
use crate::format::pages::Paged;
use crate::format::rows::{self, RowPage};
use crate::format::{SegmentRef, Version};
use crate::layout::{self, Keyed};
use crate::read::tail::Tail;
use crate::store::{PARALLELISM, Storage, Written};
use crate::{Attributes, Id, Result, Schema};

const SAMPLE_ROWS: usize = 65_536;

pub(crate) async fn build(
    storage: &Storage,
    version: &Version,
    (page_rows, budget, spill): (usize, usize, bool),
    full: bool,
    written: &mut Written,
) -> Result<Columns> {
    let base = (version.columns.as_ref())
        .filter(|base| !full && !base.rows.is_empty() && covers(base, &version.schema))
        .filter(|base| small_tail(base, version) && !fragmented(base, page_rows));
    match base {
        Some(base) => grow(storage, version, base, page_rows, written).await,
        None => rebuild(storage, version, (page_rows, budget, spill), written).await,
    }
}

fn small_tail(base: &Columns, version: &Version) -> bool {
    let tail: u64 = version.tail.iter().map(|segment| segment.rows).sum();
    base.live > 0 && tail * 2 <= base.live
}

fn fragmented(base: &Columns, page_rows: usize) -> bool {
    base.pages > 2 * base.live.div_ceil(page_rows as u64) + 8
}

async fn rebuild(
    storage: &Storage,
    version: &Version,
    (page_rows, budget, spill): (usize, usize, bool),
    written: &mut Written,
) -> Result<Columns> {
    let schema = &version.schema;
    let built: Paged<SegmentRef> = version.built.open(storage).await?;
    let refs: Vec<SegmentRef> = (built.iter().cloned())
        .chain(version.tail.iter().cloned())
        .collect();
    let mut latest: HashMap<Id, (u64, bool)> = HashMap::new();
    let mut sample = Batch::default();
    let mut read = crate::build::segments(storage, &refs);
    while let Some((first, segment)) = read.try_next().await? {
        for (seq, id, row) in segment.writes(first) {
            latest.insert(id.clone(), (seq, row.is_some()));
            if let Some(row) = row
                && sample.ids.len() < SAMPLE_ROWS
            {
                sample.push(schema, id, &segment.attributes[row]);
            }
        }
    }
    drop(read);
    let live = latest.values().filter(|(_, live)| *live).count();
    let n = rows::pages_for(live);
    let mut out = Out {
        writer: Writer::new(storage, schema, Some(&sample.values), None),
        map: vec![RowPage::default(); n],
        batch: Batch::default(),
        page_rows,
    };
    let key = layout::key(storage, schema, version.columns.as_ref()).await?;
    let runs = Runs::new(storage, spill)?;
    let row_bytes =
        refs.iter().map(|r| r.bytes).sum::<u64>() / refs.iter().map(|r| r.rows).sum::<u64>().max(1);
    let limit = budget / 4 / (row_bytes as usize).max(1);
    let mut sorter = key.as_ref().map(|_| Sorter::new(&runs, limit));
    let mut read = crate::build::segments(storage, &refs);
    while let Some((first, mut segment)) = read.try_next().await? {
        let kept: Vec<(u64, Id, usize)> = (segment.writes(first))
            .filter_map(|(seq, id, row)| Some((seq, id, row?)))
            .filter(|(seq, id, _)| latest.get(*id) == Some(&(*seq, true)))
            .map(|(seq, id, row)| (seq, id.clone(), row))
            .collect();
        for (seq, id, row) in kept {
            match (&key, &mut sorter) {
                (Some(key), Some(sorter)) => {
                    let attributes = std::mem::take(&mut segment.attributes[row]);
                    sorter.push(Keyed::new(key, seq, id, attributes)).await?
                }
                _ => {
                    out.place(schema, &id, seq, &segment.attributes[row], written)
                        .await?
                }
            }
        }
    }
    drop(read);
    if let Some(sorter) = sorter {
        let mut sorted = sorter.finish().await?;
        while let Some(row) = sorted.next().await? {
            out.place(schema, &row.id, row.seq, &row.attributes, written)
                .await?;
        }
    }
    let Out {
        mut writer,
        map,
        mut batch,
        ..
    } = out;
    batch.flush(&mut writer, written).await?;
    let map: Vec<RowPage> = map.into_iter().map(|page| page.sorted(1)).collect();
    let (hashes, sizes) = rows::store(storage, &map, written).await?;
    let rows_bytes = sizes.iter().sum();
    writer
        .finish(hashes, rows_bytes, live as u64, written)
        .await
}

struct Out<'a> {
    writer: Writer<'a>,
    map: Vec<RowPage>,
    batch: Batch,
    page_rows: usize,
}

impl Out<'_> {
    async fn place(
        &mut self,
        schema: &Schema,
        id: &Id,
        seq: u64,
        attributes: &Attributes,
        written: &mut Written,
    ) -> Result<()> {
        let page = self.writer.pages() as u32;
        let n = self.map.len();
        self.map[rows::page_of(id, n)].push(id.clone(), seq, &[page]);
        self.batch.push(schema, id, attributes);
        if self.batch.ids.len() == self.page_rows {
            self.batch.flush(&mut self.writer, written).await?;
        }
        Ok(())
    }
}

async fn grow(
    storage: &Storage,
    version: &Version,
    base: &Columns,
    page_rows: usize,
    written: &mut Written,
) -> Result<Columns> {
    let schema = &version.schema;
    let tail = Tail::load(storage, version).await?;
    let newest = tail.newest();
    let n = base.rows.len();
    let touched = rows::pages_of(storage, &base.rows, newest.keys().copied()).await?;
    let mut dirty = BTreeSet::new();
    let mut map: BTreeMap<usize, RowPage> = BTreeMap::new();
    for (&at, page) in &touched {
        let mut kept = RowPage::default();
        for (i, id) in page.ids.iter().enumerate() {
            match newest.contains_key(id) {
                true => {
                    dirty.insert(page.clusters[i] as usize);
                }
                false => kept.push(id.clone(), page.seqs[i], &page.clusters[i..i + 1]),
            }
        }
        map.insert(at, kept);
    }
    let removed = (touched.values())
        .flat_map(|page| page.ids.iter())
        .filter(|id| newest.contains_key(*id))
        .count() as u64;

    let old = Old::load(storage, base).await?;
    let mut writer = Writer::new(storage, schema, None, Some(&old));
    let mut read = stream::iter(0..base.pages as usize)
        .map(|at| {
            let (old, dirty) = (&old, &dirty);
            async move {
                match dirty.contains(&at) {
                    true => old.page(storage, at).await.map(|page| (at, Some(page))),
                    false => Ok((at, None)),
                }
            }
        })
        .buffered(PARALLELISM);
    while let Some((at, page)) = read.try_next().await? {
        let Some((ids, values)) = page else {
            writer.keep(at);
            continue;
        };
        let keep: Vec<usize> = (0..ids.len())
            .filter(|&row| !newest.contains_key(&ids[row]))
            .collect();
        let ids: Vec<Id> = keep.iter().map(|&row| ids[row].clone()).collect();
        let values: Values = (values.into_iter())
            .map(|(name, column)| {
                let column = keep.iter().map(|&row| column[row].clone()).collect();
                (name, column)
            })
            .collect();
        writer.add(&ids, &values, written).await?;
    }
    drop(read);

    let mut batch = Batch::default();
    let added = tail.live(&newest);
    for &(id, row) in &added {
        let page = writer.pages() as u32;
        let entry = map.get_mut(&rows::page_of(id, n));
        entry
            .expect("the row map page of every tail id was read")
            .push(id.clone(), row.seq, &[page]);
        batch.push(schema, id, &tail.segment(row).attributes[row.row]);
        if batch.ids.len() == page_rows {
            batch.flush(&mut writer, written).await?;
        }
    }
    batch.flush(&mut writer, written).await?;

    let (at, changed): (Vec<usize>, Vec<RowPage>) = (map.into_iter())
        .map(|(at, page)| (at, page.sorted(1)))
        .unzip();
    let replaced = (touched.values())
        .map(|page| postcard::to_stdvec(&**page).map(|bytes| bytes.len() as u64))
        .sum::<std::result::Result<u64, _>>()?;
    let (stored, sizes) = rows::store(storage, &changed, written).await?;
    let rows_bytes = base.rows_bytes - replaced + sizes.iter().sum::<u64>();
    let mut hashes = base.rows.clone();
    for (at, hash) in at.into_iter().zip(stored) {
        hashes[at] = hash;
    }
    let live = base.live - removed + added.len() as u64;
    writer.finish(hashes, rows_bytes, live, written).await
}

#[derive(Default)]
struct Batch {
    ids: Vec<Id>,
    values: Values,
}

impl Batch {
    fn push(&mut self, schema: &Schema, id: &Id, attributes: &Attributes) {
        self.ids.push(id.clone());
        for name in schema.attributes.keys() {
            let column = self.values.entry(name.clone()).or_default();
            column.push(attributes.get(name).cloned());
        }
    }

    async fn flush(&mut self, writer: &mut Writer<'_>, written: &mut Written) -> Result<()> {
        if self.ids.is_empty() {
            return Ok(());
        }
        let batch = std::mem::take(self);
        writer.add(&batch.ids, &batch.values, written).await
    }
}
