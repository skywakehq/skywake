use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Arc;

use futures::{StreamExt, TryStreamExt, stream};
use skywake_core::Hash;

use super::chunk::{Chunk, Layout};
use super::dictionary::{Coder, Dictionary, Word};
use super::stats::{Stats, Totals};
use super::{ColumnRef, Columns, DIRECTORY_PAGE, PageRef, Span, directory};
use crate::filter::attrs::Attrs;
use crate::format::Ann;
use crate::format::cluster::{ClusterRef, checksum};
use crate::store::{PARALLELISM, Storage, Written};
use crate::{Error, Kind, Result, Schema, Value};

const PIECE: usize = 64 << 20;
const DICTIONARY_SHARE: usize = 4;
const DICTIONARY_SAMPLE: usize = 16_384;

pub(crate) struct Base<'a> {
    pub ann: &'a Ann,
    pub columns: &'a Columns,
}

pub(crate) async fn build(
    storage: &Storage,
    schema: &Schema,
    ann: &Ann,
    base: Option<Base<'_>>,
    written: &mut Written,
) -> Result<Columns> {
    let (first, column) = (schema.vectors.iter().next())
        .ok_or_else(|| Error::Corrupt("columns need a vector column".into()))?;
    let dims = column.dims;
    let table = clusters(storage, ann, first).await?;
    let names: Vec<String> = schema.attributes.keys().cloned().collect();
    let base = base.filter(|base| names.iter().all(|n| base.columns.columns.contains_key(n)));
    let old = match &base {
        Some(base) => Some(Old::load(storage, base, first, &names).await?),
        None => None,
    };
    let sample: Arc<Attrs> = storage.get(ann.filters).await?;
    let mut columns: Vec<Building> = Vec::new();
    for name in &names {
        let previous = old.as_ref().map(|old| &old.columns[name]);
        let layout = match previous {
            Some((layout, ..)) => *layout,
            None => layout(schema.attributes[name], sample.columns.get(name)),
        };
        let dictionary = previous.map(|(_, d, _)| (**d).clone()).unwrap_or_default();
        columns.push(Building {
            name: name.clone(),
            layout,
            coder: Coder::new(dictionary),
            pages: Vec::with_capacity(table.len()),
        });
    }
    let mut ids: Vec<Pending> = Vec::with_capacity(table.len());
    let mut out = Pieces::default();
    let mut read = stream::iter(table.iter().cloned())
        .map(|cluster| {
            let reused = old
                .as_ref()
                .and_then(|old| old.at.get(&cluster.hash).copied());
            async move {
                match reused {
                    Some(at) => Ok::<_, Error>(Page::Kept(at)),
                    None => {
                        let (codes, attrs) = storage.codes_and_attrs(&cluster, dims).await?;
                        Ok(Page::Read(codes.ids.clone(), attrs))
                    }
                }
            }
        })
        .buffered(PARALLELISM);
    while let Some(page) = read.try_next().await? {
        match page {
            Page::Kept(at) => {
                let old = old.as_ref().expect("a kept page has an old version");
                ids.push(Pending::Done(old.ids[at].clone()));
                for building in &mut columns {
                    let kept = old.columns[&building.name].2[at].clone();
                    building.pages.push((Pending::Done(kept.span), kept.stats));
                }
            }
            Page::Read(page_ids, attrs) => {
                let rows = page_ids.len();
                ids.push(
                    out.add(postcard::to_stdvec(&page_ids)?, storage, written)
                        .await?,
                );
                for building in &mut columns {
                    let values = match attrs.columns.get(&building.name) {
                        Some(values) => values.clone(),
                        None => vec![None; rows],
                    };
                    let chunk = Chunk::encode(&values, building.layout, &mut building.coder);
                    let stats = Stats::of(&chunk, &values);
                    let pending = out
                        .add(postcard::to_stdvec(&chunk)?, storage, written)
                        .await?;
                    building.pages.push((pending, stats));
                }
            }
        }
    }
    drop(read);
    let blobs = out.finish(storage, written).await?;
    let ids: Vec<Span> = ids.into_iter().map(|p| p.into_span(&blobs)).collect();
    let mut refs = BTreeMap::new();
    for building in columns {
        refs.insert(
            building.name.clone(),
            building.store(storage, &blobs, written).await?,
        );
    }
    Ok(Columns {
        pages: table.len() as u64,
        ids: put_directory(storage, &ids, written).await?,
        columns: refs,
    })
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
        written: &mut Written,
    ) -> Result<ColumnRef> {
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
        let dictionary = self.coder.finish();
        let dictionary = put(storage, &dictionary, written).await?;
        let totals = put(storage, &totals, written).await?;
        Ok(ColumnRef {
            layout: self.layout,
            dictionary,
            totals,
            directory: put_directory(storage, &pages, written).await?,
        })
    }
}

enum Page {
    Kept(usize),
    Read(Vec<crate::Id>, Arc<Attrs>),
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

struct Old {
    at: HashMap<Hash, usize>,
    ids: Vec<Span>,
    columns: BTreeMap<String, (Layout, Arc<Dictionary>, Vec<PageRef>)>,
}

impl Old {
    async fn load(
        storage: &Storage,
        base: &Base<'_>,
        first: &str,
        names: &[String],
    ) -> Result<Self> {
        let table = clusters(storage, base.ann, first).await?;
        let at = (table.iter().enumerate())
            .map(|(i, cluster)| (cluster.hash, i))
            .collect();
        let mut columns = BTreeMap::new();
        for name in names {
            let column = &base.columns.columns[name];
            let dictionary = super::dictionary(storage, column).await?;
            let pages = super::pages(storage, column).await?;
            columns.insert(name.clone(), (column.layout, dictionary, pages));
        }
        Ok(Self {
            at,
            ids: directory(storage, &base.columns.ids).await?,
            columns,
        })
    }
}

async fn clusters(storage: &Storage, ann: &Ann, first: &str) -> Result<Vec<ClusterRef>> {
    let clusters = (ann.columns.get(first))
        .ok_or_else(|| Error::Corrupt(format!("no clusters for `{first}`")))?;
    let table = clusters.table.open::<ClusterRef>(storage).await?;
    Ok(table.iter().cloned().collect())
}

fn layout(kind: Kind, sample: Option<&Vec<Option<Value>>>) -> Layout {
    let repeating = || {
        let values = sample.map_or(&[][..], Vec::as_slice);
        let present: Vec<&Value> = values.iter().flatten().collect();
        let distinct: HashSet<Word> = present.iter().filter_map(|v| Word::of(v)).collect();
        distinct.len() <= DICTIONARY_SAMPLE && distinct.len() * DICTIONARY_SHARE <= present.len()
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

async fn put<T: serde::Serialize>(
    storage: &Storage,
    value: &T,
    written: &mut Written,
) -> Result<Hash> {
    let hash = storage.put(postcard::to_stdvec(value)?).await?;
    written.chunks([hash]);
    Ok(hash)
}

async fn put_directory<T: serde::Serialize + Sync>(
    storage: &Storage,
    entries: &[T],
    written: &mut Written,
) -> Result<Vec<Hash>> {
    let encoded = (entries.chunks(DIRECTORY_PAGE))
        .map(postcard::to_stdvec)
        .collect::<Result<Vec<_>, _>>()?;
    let hashes: Vec<Hash> = stream::iter(encoded)
        .map(|page| storage.put(page))
        .buffered(PARALLELISM)
        .try_collect()
        .await?;
    written.chunks(hashes.iter().copied());
    Ok(hashes)
}
