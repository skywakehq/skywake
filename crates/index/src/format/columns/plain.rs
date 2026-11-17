use std::collections::{BTreeMap, BTreeSet, HashMap};

use futures::{StreamExt, TryStreamExt, stream};

use super::Columns;
use super::writer::{Old, Values, Writer, covers};
use crate::format::pages::Paged;
use crate::format::rows::{self, RowPage};
use crate::format::{SegmentRef, Version};
use crate::read::tail::Tail;
use crate::store::{PARALLELISM, Storage, Written};
use crate::{Attributes, Id, Result, Schema};

const SAMPLE_ROWS: usize = 65_536;

pub(crate) async fn build(
    storage: &Storage,
    version: &Version,
    page_rows: usize,
    full: bool,
    written: &mut Written,
) -> Result<Columns> {
    let base = (version.columns.as_ref())
        .filter(|base| !full && !base.rows.is_empty() && covers(base, &version.schema))
        .filter(|base| small_tail(base, version));
    match base {
        Some(base) => grow(storage, version, base, page_rows, written).await,
        None => rebuild(storage, version, page_rows, written).await,
    }
}

fn small_tail(base: &Columns, version: &Version) -> bool {
    let tail: u64 = version.tail.iter().map(|segment| segment.rows).sum();
    base.live > 0 && tail * 2 <= base.live
}

async fn rebuild(
    storage: &Storage,
    version: &Version,
    page_rows: usize,
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
    let mut map = vec![RowPage::default(); n];
    let mut writer = Writer::new(storage, schema, Some(&sample.values), None);
    let mut batch = Batch::default();
    let mut read = crate::build::segments(storage, &refs);
    while let Some((first, segment)) = read.try_next().await? {
        for (seq, id, row) in segment.writes(first) {
            let Some(row) = row else { continue };
            if latest.get(id) != Some(&(seq, true)) {
                continue;
            }
            let page = writer.pages() as u32;
            map[rows::page_of(id, n)].push(id.clone(), seq, &[page]);
            batch.push(schema, id, &segment.attributes[row]);
            if batch.ids.len() == page_rows {
                batch.flush(&mut writer, written).await?;
            }
        }
    }
    drop(read);
    batch.flush(&mut writer, written).await?;
    let map: Vec<RowPage> = map.into_iter().map(|page| page.sorted(1)).collect();
    let (hashes, sizes) = rows::store(storage, &map, written).await?;
    let rows_bytes = sizes.iter().sum();
    writer
        .finish(hashes, rows_bytes, live as u64, written)
        .await
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
