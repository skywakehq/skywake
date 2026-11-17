use std::cmp::Ordering;
use std::collections::HashMap;
use std::ops::RangeBounds;
use std::sync::Arc;

use super::resolve::Resolved;
use crate::format::columns::chunk::Chunk;
use crate::format::columns::select::Bits;
use crate::{Filter, Id, Value};

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

impl Page<'_> {
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

pub(crate) fn uses_ids(filter: &Filter) -> bool {
    match filter {
        Filter::Ids(_) | Filter::IdRange(..) => true,
        Filter::And(all) | Filter::Or(all) => all.iter().any(uses_ids),
        Filter::Not(inner) => uses_ids(inner),
        _ => false,
    }
}
