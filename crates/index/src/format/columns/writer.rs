use std::collections::{BTreeMap, HashSet};
use std::sync::Arc;

use futures::{StreamExt, TryStreamExt, future, stream};
use skywake_core::Hash;

use super::chunk::{Chunk, Layout};
use super::dictionary::{Coder, Dictionary, Word};
use super::stats::{Stats, Totals};
use super::{ColumnRef, Columns, DIRECTORY_PAGE, PageRef, Span, directory};
use crate::format::cluster::checksum;
use crate::store::{PARALLELISM, Storage, Written};
use crate::{Attributes, Id, Kind, Result, Schema, Value};

const PIECE: usize = 64 << 20;
const DICTIONARY_SHARE: usize = 4;
const DICTIONARY_SAMPLE: usize = 16_384;

pub(crate) type Values = BTreeMap<String, Vec<Option<Value>>>;

pub(crate) struct Old {
    pub ids: Vec<Span>,
    pub columns: BTreeMap<String, (Layout, Arc<Dictionary>, Vec<PageRef>)>,
}

impl Old {
    pub(crate) async fn load(storage: &Storage, columns: &Columns) -> Result<Self> {
        let loads = columns.columns.iter().map(|(name, column)| async move {
            let (dictionary, pages) = futures::try_join!(
                super::dictionary(storage, column),
                super::pages(storage, column),
            )?;
            Ok::<_, crate::Error>((name.clone(), (column.layout, dictionary, pages)))
        });
        let (ids, loaded) = futures::try_join!(
            directory(storage, &columns.ids),
            future::try_join_all(loads),
        )?;
        Ok(Self {
            ids,
            columns: loaded.into_iter().collect(),
        })
    }

    pub(crate) async fn page(&self, storage: &Storage, at: usize) -> Result<(Vec<Id>, Values)> {
        let spans: Vec<Span> = (self.columns.values())
            .map(|(_, _, pages)| pages[at].span.clone())
            .collect();
        let (ids, chunks) = futures::try_join!(
            super::ids(storage, &self.ids[at]),
            super::chunks(storage, &spans),
        )?;
        let values = (self.columns.iter().zip(chunks))
            .map(|((name, (layout, dictionary, _)), chunk)| {
                (name.clone(), chunk.values(*layout, dictionary))
            })
            .collect();
        Ok(((*ids).clone(), values))
    }
}

pub(crate) fn covers(columns: &Columns, schema: &Schema) -> bool {
    columns.columns.keys().eq(schema.attributes.keys())
}

pub(crate) struct Writer<'a> {
    storage: &'a Storage,
    old: Option<&'a Old>,
    columns: Vec<Building>,
    ids: Vec<Pending>,
    out: Pieces,
}

fn length(span: &Span) -> u64 {
    span.end - span.start
}

impl<'a> Writer<'a> {
    pub(crate) fn new(
        storage: &'a Storage,
        schema: &Schema,
        sample: Option<&Values>,
        old: Option<&'a Old>,
    ) -> Self {
        let columns = (schema.attributes.iter())
            .map(|(name, &kind)| {
                let previous = old.and_then(|old| old.columns.get(name));
                let layout = match previous {
                    Some((layout, ..)) => *layout,
                    None => layout(kind, sample.and_then(|s| s.get(name))),
                };
                let dictionary = previous.map(|(_, d, _)| (**d).clone()).unwrap_or_default();
                Building {
                    name: name.clone(),
                    layout,
                    coder: Coder::new(dictionary),
                    pages: Vec::new(),
                }
            })
            .collect();
        Self {
            storage,
            old,
            columns,
            ids: Vec::new(),
            out: Pieces::default(),
        }
    }

    pub(crate) fn pages(&self) -> usize {
        self.ids.len()
    }

    pub(crate) fn keep(&mut self, at: usize) {
        let old = self.old.expect("a kept page has an old version");
        self.ids.push(Pending::Done(old.ids[at].clone()));
        for building in &mut self.columns {
            let kept = old.columns[&building.name].2[at].clone();
            building.pages.push((Pending::Done(kept.span), kept.stats));
        }
    }

    pub(crate) async fn add(
        &mut self,
        ids: &[Id],
        values: &Values,
        written: &mut Written,
    ) -> Result<()> {
        let encoded = postcard::to_stdvec(ids)?;
        let pending = self.out.add(encoded, self.storage, written).await?;
        self.ids.push(pending);
        let blank = vec![None; ids.len()];
        for building in &mut self.columns {
            let values = values.get(&building.name).unwrap_or(&blank);
            let chunk = Chunk::encode(values, building.layout, &mut building.coder);
            let stats = Stats::of(&chunk, values);
            let encoded = postcard::to_stdvec(&chunk)?;
            let pending = self.out.add(encoded, self.storage, written).await?;
            building.pages.push((pending, stats));
        }
        Ok(())
    }

    pub(crate) async fn add_rows(
        &mut self,
        ids: &[Id],
        rows: &[Attributes],
        written: &mut Written,
    ) -> Result<()> {
        let values: Values = (self.columns.iter())
            .map(|building| {
                let name = &building.name;
                let column = rows.iter().map(|row| row.get(name).cloned()).collect();
                (name.clone(), column)
            })
            .collect();
        self.add(ids, &values, written).await
    }

    pub(crate) async fn finish(
        self,
        rows: Vec<Hash>,
        rows_bytes: u64,
        live: u64,
        written: &mut Written,
    ) -> Result<Columns> {
        let storage = self.storage;
        let blobs = self.out.finish(storage, written).await?;
        let pages = self.ids.len() as u64;
        let ids: Vec<Span> = (self.ids.into_iter())
            .map(|p| p.into_span(&blobs))
            .collect();
        let stores = (self.columns.into_iter()).map(|building| building.store(storage, &blobs));
        let (stored, (directory, size)) =
            futures::try_join!(future::try_join_all(stores), put_directory(storage, &ids),)?;
        written.chunks(directory.iter().copied());
        let mut bytes = rows_bytes + size + ids.iter().map(length).sum::<u64>();
        let mut refs = BTreeMap::new();
        for (name, column, size, hashes) in stored {
            written.chunks(hashes);
            bytes += size;
            refs.insert(name, column);
        }
        Ok(Columns {
            pages,
            live,
            bytes,
            rows,
            rows_bytes,
            ids: directory,
            columns: refs,
        })
    }
}

struct Building {
    name: String,
    layout: Layout,
    coder: Coder,
    pages: Vec<(Pending, Stats)>,
}

impl Building {
    async fn store(
        self,
        storage: &Storage,
        blobs: &[Hash],
    ) -> Result<(String, ColumnRef, u64, Vec<Hash>)> {
        let mut totals = Totals::default();
        let pages: Vec<PageRef> = (self.pages.into_iter())
            .map(|(pending, stats)| {
                totals.add(&stats);
                PageRef {
                    span: pending.into_span(blobs),
                    stats,
                }
            })
            .collect();
        let chunks: u64 = pages.iter().map(|page| length(&page.span)).sum();
        let dictionary = self.coder.finish();
        let ((dictionary, a), (totals, b), (directory, c)) = futures::try_join!(
            put(storage, &dictionary),
            put(storage, &totals),
            put_directory(storage, &pages),
        )?;
        let mut hashes = vec![dictionary, totals];
        hashes.extend(directory.iter().copied());
        let column = ColumnRef {
            layout: self.layout,
            dictionary,
            totals,
            directory,
        };
        Ok((self.name, column, chunks + a + b + c, hashes))
    }
}

#[derive(Clone)]
enum Pending {
    Done(Span),
    Waiting {
        piece: usize,
        start: u64,
        end: u64,
        check: u64,
    },
}

impl Pending {
    fn into_span(self, blobs: &[Hash]) -> Span {
        match self {
            Pending::Done(span) => span,
            Pending::Waiting {
                piece,
                start,
                end,
                check,
            } => Span {
                blob: blobs[piece],
                start,
                end,
                check,
            },
        }
    }
}

#[derive(Default)]
struct Pieces {
    piece: Vec<u8>,
    blobs: Vec<Hash>,
}

impl Pieces {
    async fn add(
        &mut self,
        bytes: Vec<u8>,
        storage: &Storage,
        written: &mut Written,
    ) -> Result<Pending> {
        if !self.piece.is_empty() && self.piece.len() + bytes.len() > PIECE {
            self.flush(storage, written).await?;
        }
        let start = self.piece.len() as u64;
        let check = checksum(&bytes);
        self.piece.extend(bytes);
        Ok(Pending::Waiting {
            piece: self.blobs.len(),
            start,
            end: self.piece.len() as u64,
            check,
        })
    }

    async fn flush(&mut self, storage: &Storage, written: &mut Written) -> Result<()> {
        let piece = std::mem::take(&mut self.piece);
        let hash = storage.put_blob(piece).await?;
        written.blobs([hash]);
        self.blobs.push(hash);
        Ok(())
    }

    async fn finish(mut self, storage: &Storage, written: &mut Written) -> Result<Vec<Hash>> {
        if !self.piece.is_empty() {
            self.flush(storage, written).await?;
        }
        Ok(self.blobs)
    }
}

fn layout(kind: Kind, sample: Option<&Vec<Option<Value>>>) -> Layout {
    let repeating = || {
        let values = sample.map_or(&[][..], Vec::as_slice);
        let present: Vec<&Value> = values.iter().flatten().collect();
        let distinct: HashSet<Word> = present.iter().filter_map(|v| Word::of(v)).collect();
        !present.is_empty()
            && distinct.len() <= DICTIONARY_SAMPLE
            && distinct.len() * DICTIONARY_SHARE <= present.len()
    };
    match kind {
        Kind::String | Kind::Bool | Kind::Uuid => Layout::Dictionary,
        Kind::Int | Kind::Datetime | Kind::Number if repeating() => Layout::Dictionary,
        Kind::Int => Layout::Ints,
        Kind::Datetime => Layout::Datetimes,
        Kind::Number => Layout::Floats,
        _ => Layout::Values,
    }
}

async fn put<T: serde::Serialize>(storage: &Storage, value: &T) -> Result<(Hash, u64)> {
    let encoded = postcard::to_stdvec(value)?;
    let size = encoded.len() as u64;
    Ok((storage.put(encoded).await?, size))
}

async fn put_directory<T: serde::Serialize + Sync>(
    storage: &Storage,
    entries: &[T],
) -> Result<(Vec<Hash>, u64)> {
    let encoded = (entries.chunks(DIRECTORY_PAGE))
        .map(postcard::to_stdvec)
        .collect::<Result<Vec<_>, _>>()?;
    let size = encoded.iter().map(|page| page.len() as u64).sum();
    let hashes: Vec<Hash> = stream::iter(encoded)
        .map(|page| storage.put(page))
        .buffered(PARALLELISM)
        .try_collect()
        .await?;
    Ok((hashes, size))
}
