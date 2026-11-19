use std::cmp::Ordering;
use std::collections::HashMap;
use std::ops::RangeBounds;
use std::sync::Arc;

use futures::{Stream, StreamExt, stream};

use super::resolve::Resolved;
use crate::format::columns::chunk::Chunk;
use crate::format::columns::select::Bits;
use crate::format::columns::{self, Span};
use crate::store::Storage;
use crate::{Filter, Id, Result, Value};
use skywake_core::Hash;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Proof {
    None,
    All,
    Some,
}

pub(crate) fn prove(filter: &Filter, resolved: &Resolved, page: usize) -> Proof {
    match filter {
        Filter::And(all) => {
            let proofs: Vec<Proof> = all.iter().map(|f| prove(f, resolved, page)).collect();
            match () {
                _ if proofs.contains(&Proof::None) => Proof::None,
                _ if proofs.iter().all(|p| *p == Proof::All) => Proof::All,
                _ => Proof::Some,
            }
        }
        Filter::Or(any) => {
            let proofs: Vec<Proof> = any.iter().map(|f| prove(f, resolved, page)).collect();
            match () {
                _ if proofs.contains(&Proof::All) => Proof::All,
                _ if proofs.iter().all(|p| *p == Proof::None) => Proof::None,
                _ => Proof::Some,
            }
        }
        Filter::Not(inner) => match prove(inner, resolved, page) {
            Proof::None => Proof::All,
            Proof::All => Proof::None,
            Proof::Some => Proof::Some,
        },
        Filter::Ids(_) | Filter::IdRange(..) => Proof::Some,
        leaf => prove_leaf(leaf, resolved, page),
    }
}

pub(crate) fn share(filter: &Filter, resolved: &Resolved, page: usize) -> f64 {
    match prove(filter, resolved, page) {
        Proof::None => return 0.0,
        Proof::All => return 1.0,
        Proof::Some => {}
    }
    match filter {
        Filter::And(all) => all.iter().map(|f| share(f, resolved, page)).product(),
        Filter::Or(any) => (any.iter().map(|f| share(f, resolved, page)).sum::<f64>()).min(1.0),
        Filter::Not(_) | Filter::Ids(_) | Filter::IdRange(..) => 1.0,
        leaf => leaf_share(leaf, resolved, page),
    }
}

fn leaf_share(leaf: &Filter, resolved: &Resolved, page: usize) -> f64 {
    let mut names = Vec::new();
    leaf.names(&mut names);
    let Some(column) = names.first().and_then(|name| resolved.columns.get(*name)) else {
        return 1.0;
    };
    let stats = &column.pages[page].stats;
    let Some(histogram) = &stats.histogram else {
        return 1.0;
    };
    let values = &column.dictionary.values;
    let passing: u32 = (histogram.iter())
        .filter(|(code, _)| leaf.test(Some(&values[*code as usize])))
        .map(|(_, n)| n)
        .sum();
    passing as f64 / stats.rows.max(1) as f64
}

fn prove_leaf(leaf: &Filter, resolved: &Resolved, page: usize) -> Proof {
    let mut names = Vec::new();
    leaf.names(&mut names);
    let Some(column) = names.first().and_then(|name| resolved.columns.get(*name)) else {
        return Proof::Some;
    };
    let stats = &column.pages[page].stats;
    let complete = stats.missing == 0;
    if stats.rows == 0 || stats.missing == stats.rows {
        return Proof::None;
    }
    if let Filter::Exists(_) = leaf {
        return if complete { Proof::All } else { Proof::Some };
    }
    if let Some(histogram) = &stats.histogram {
        let values = &column.dictionary.values;
        let passing = (histogram.iter())
            .filter(|(code, _)| leaf.test(Some(&values[*code as usize])))
            .count();
        return match passing {
            0 => Proof::None,
            n if n == histogram.len() && complete => Proof::All,
            _ => Proof::Some,
        };
    }
    let (Some(min), Some(max)) = (&stats.min, &stats.max) else {
        return Proof::Some;
    };
    let range = |x: &Value, holds: fn(Ordering) -> bool| -> Proof {
        let (low, high) = (min.compare(x), max.compare(x));
        match (low, high) {
            (Some(low), Some(high)) if !holds(low) && !holds(high) => Proof::None,
            (Some(low), Some(high)) if holds(low) && holds(high) && complete => Proof::All,
            _ => Proof::Some,
        }
    };
    let equal = |x: &Value| -> Proof {
        match (min.compare(x), max.compare(x)) {
            (Some(Ordering::Greater), _) | (_, Some(Ordering::Less)) => Proof::None,
            (Some(Ordering::Equal), Some(Ordering::Equal)) if complete => Proof::All,
            _ => Proof::Some,
        }
    };
    match leaf {
        Filter::Eq(_, x) => equal(x),
        Filter::In(_, xs) => any_of(xs.iter().map(equal)),
        Filter::Lt(_, x) => range(x, Ordering::is_lt),
        Filter::Lte(_, x) => range(x, Ordering::is_le),
        Filter::Gt(_, x) => range(x, Ordering::is_gt),
        Filter::Gte(_, x) => range(x, Ordering::is_ge),
        _ => Proof::Some,
    }
}

fn any_of(proofs: impl Iterator<Item = Proof>) -> Proof {
    let proofs: Vec<Proof> = proofs.collect();
    match () {
        _ if proofs.contains(&Proof::All) => Proof::All,
        _ if proofs.iter().all(|p| *p == Proof::None) => Proof::None,
        _ => Proof::Some,
    }
}

pub(crate) struct Page<'a> {
    pub resolved: &'a Resolved,
    pub page: usize,
    pub rows: usize,
    pub chunks: HashMap<String, Arc<Chunk>>,
    pub ids: Option<Arc<Vec<Id>>>,
}

impl<'a> Page<'a> {
    pub(crate) async fn load(
        storage: &Storage,
        resolved: &'a Resolved,
        pages: &[usize],
        names: &[&str],
        ids: bool,
    ) -> Result<Vec<Page<'a>>> {
        let spans: Vec<Span> = (pages.iter())
            .flat_map(|&page| {
                (names.iter()).map(move |name| resolved.columns[*name].pages[page].span.clone())
            })
            .collect();
        let id_spans: Vec<Span> = match ids {
            true => {
                let spans = resolved.ids(storage).await?;
                pages.iter().map(|&page| spans[page].clone()).collect()
            }
            false => Vec::new(),
        };
        let (chunks, ids) = futures::try_join!(
            columns::chunks(storage, &spans),
            columns::ids_many(storage, &id_spans),
        )?;
        let rows = resolved.rows(storage).await?;
        let mut chunks = chunks.into_iter();
        let mut ids = ids.into_iter();
        Ok((pages.iter())
            .map(|&page| Page {
                resolved,
                page,
                rows: rows[page],
                chunks: (names.iter().map(|name| name.to_string()))
                    .zip(chunks.by_ref())
                    .collect(),
                ids: ids.next(),
            })
            .collect())
    }

    pub(crate) fn stream<'b>(
        storage: &'b Storage,
        resolved: &'a Resolved,
        pages: &'b [usize],
        names: &'b [&'b str],
        ids: bool,
    ) -> impl Stream<Item = Result<Vec<Page<'a>>>> + 'b
    where
        'a: 'b,
    {
        stream::iter(pages.chunks(LOAD))
            .map(move |batch| Page::load(storage, resolved, batch, names, ids))
            .buffered(LOADS)
    }

    pub(crate) fn select_with(&self, filter: &Filter, partial: Option<&Partial>) -> Bits {
        let Some(partial) = partial else {
            return self.select(filter);
        };
        let spans: Vec<(Hash, Hash)> = (partial.names.iter())
            .map(|name| {
                let column = &self.resolved.columns[name.as_str()];
                (columns::key(&column.pages[self.page].span), column.source)
            })
            .collect();
        let key = Hash::of(&postcard::to_stdvec(&(partial.predicate, spans)).unwrap_or_default());
        let cache = partial.storage.cache();
        if let Some(found) = cache.get::<Bits>(key) {
            return (*found).clone();
        }
        let bits = self.select(filter);
        cache.insert(key, Arc::new(bits.clone()), 8 * bits.len() + 64);
        bits
    }

    pub(crate) fn select(&self, filter: &Filter) -> Bits {
        match prove(filter, self.resolved, self.page) {
            Proof::None => return vec![0; self.rows.div_ceil(64)],
            Proof::All => return ones(self.rows),
            Proof::Some => {}
        }
        match filter {
            Filter::And(all) => all.iter().fold(ones(self.rows), |mut bits, f| {
                and(&mut bits, &self.select(f));
                bits
            }),
            Filter::Or(any) => any
                .iter()
                .fold(vec![0; self.rows.div_ceil(64)], |mut bits, f| {
                    for (word, other) in bits.iter_mut().zip(self.select(f)) {
                        *word |= other;
                    }
                    bits
                }),
            Filter::Not(inner) => {
                let mut bits = self.select(inner);
                let all = ones(self.rows);
                for (word, mask) in bits.iter_mut().zip(all) {
                    *word = !*word & mask;
                }
                bits
            }
            Filter::Ids(wanted) => self.by_id(|id| wanted.binary_search(id).is_ok()),
            Filter::IdRange(low, high) => {
                self.by_id(|id| (low.as_ref(), high.as_ref()).contains(id))
            }
            leaf => {
                let mut names = Vec::new();
                leaf.names(&mut names);
                let name = names[0];
                let column = &self.resolved.columns[name];
                self.chunks[name].select(leaf, column.layout, &column.dictionary)
            }
        }
    }

    fn by_id(&self, keep: impl Fn(&Id) -> bool) -> Bits {
        let ids = self
            .ids
            .as_ref()
            .expect("an id filter loads the page's ids");
        let mut bits = vec![0u64; self.rows.div_ceil(64)];
        for (row, id) in ids.iter().enumerate() {
            if keep(id) {
                bits[row / 64] |= 1 << (row % 64);
            }
        }
        bits
    }
}

const LOAD: usize = 256;

const LOADS: usize = 4;

pub(crate) fn ones(rows: usize) -> Bits {
    let mut bits = vec![u64::MAX; rows.div_ceil(64)];
    if !rows.is_multiple_of(64) {
        let last = bits.len() - 1;
        bits[last] = (1u64 << (rows % 64)) - 1;
    }
    bits
}

pub(crate) fn and(bits: &mut Bits, other: &[u64]) {
    for (word, other) in bits.iter_mut().zip(other) {
        *word &= other;
    }
}

pub(crate) fn rows_of(bits: &[u64], rows: usize) -> impl Iterator<Item = usize> + '_ {
    bits.iter().enumerate().flat_map(move |(w, &word)| {
        let mut word = word;
        std::iter::from_fn(move || {
            if word == 0 {
                return None;
            }
            let bit = word.trailing_zeros() as usize;
            word &= word - 1;
            Some(w * 64 + bit)
        })
        .take_while(move |&row| row < rows)
    })
}

pub(crate) struct Partial<'s> {
    storage: &'s Storage,
    predicate: Hash,
    names: Vec<String>,
}

impl<'s> Partial<'s> {
    pub(crate) fn of(storage: &'s Storage, filter: Option<&Filter>) -> Option<Self> {
        let filter = filter.filter(|f| storage.partials() && !uses_ids(f))?;
        let mut names = Vec::new();
        filter.names(&mut names);
        names.sort_unstable();
        names.dedup();
        Some(Self {
            storage,
            predicate: Hash::of(format!("{filter:?}").as_bytes()),
            names: names.into_iter().map(str::to_string).collect(),
        })
    }
}

pub(crate) fn uses_ids(filter: &Filter) -> bool {
    match filter {
        Filter::Ids(_) | Filter::IdRange(..) => true,
        Filter::And(all) | Filter::Or(all) => all.iter().any(uses_ids),
        Filter::Not(inner) => uses_ids(inner),
        _ => false,
    }
}
