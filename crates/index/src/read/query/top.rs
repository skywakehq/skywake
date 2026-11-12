//! The best rows a query has seen so far.

use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap};
use std::sync::Arc;

use futures::{StreamExt, TryStreamExt, stream};

use super::known::Known;
use crate::filter::attrs::Attrs;
use crate::read::tail::{Row, Tail};
use crate::store::{PARALLELISM, Storage};
use crate::{Hit, Id, Result};

pub(super) struct Kth {
    k: usize,
    pub(super) limit: f32,
    heap: BinaryHeap<Far>,
}

#[derive(PartialEq)]
struct Far(f32);

impl Eq for Far {}

impl Ord for Far {
    fn cmp(&self, other: &Self) -> Ordering {
        self.0.total_cmp(&other.0)
    }
}

impl PartialOrd for Far {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Kth {
    pub(super) fn new(k: usize, limit: f32) -> Self {
        Self {
            k,
            limit,
            heap: BinaryHeap::with_capacity(k + 1),
        }
    }

    pub(super) fn offer(&mut self, upper: f32) {
        if self.k == 0 {
            return;
        }
        self.heap.push(Far(upper));
        if self.heap.len() > self.k {
            self.heap.pop();
        }
    }

    pub(super) fn get(&self) -> f32 {
        match self.heap.len() < self.k {
            true => self.limit,
            false => self
                .limit
                .min(self.heap.peek().map_or(f32::INFINITY, |f| f.0)),
        }
    }
}

pub(super) fn kth(uppers: impl Iterator<Item = f32>, top: &Top) -> f32 {
    let k = top.k;
    let mut all: Vec<f32> = uppers.collect();
    all.extend(top.heap.iter().map(|entry| entry.distance));
    if k == 0 || all.len() < k {
        return f32::INFINITY;
    }
    let (_, kth, _) = all.select_nth_unstable_by(k - 1, f32::total_cmp);
    *kth
}

#[derive(Clone, Copy)]
pub(super) enum From {
    Tail(Row),
    Cluster(usize, usize),
}

pub(super) struct Top {
    k: usize,
    heap: BinaryHeap<Entry>,
}

struct Entry {
    distance: f32,
    id: Id,
    from: From,
}

impl Ord for Entry {
    fn cmp(&self, other: &Self) -> Ordering {
        (self.distance.total_cmp(&other.distance)).then_with(|| self.id.cmp(&other.id))
    }
}

impl PartialOrd for Entry {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl PartialEq for Entry {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}

impl Eq for Entry {}

impl Top {
    pub(super) fn new(k: usize) -> Self {
        Self {
            k,
            heap: BinaryHeap::new(),
        }
    }

    pub(super) fn offer(&mut self, distance: f32, id: &Id, from: From) {
        if self.k == 0 {
            return;
        }
        if self.heap.len() == self.k
            && let Some(worst) = self.heap.peek()
            && distance
                .total_cmp(&worst.distance)
                .then_with(|| id.cmp(&worst.id))
                .is_ge()
        {
            return;
        }
        self.heap.push(Entry {
            distance,
            id: id.clone(),
            from,
        });
        if self.heap.len() > self.k {
            self.heap.pop();
        }
    }

    pub(super) fn kth(&self) -> f32 {
        match self.heap.len() < self.k {
            true => f32::INFINITY,
            false => self.heap.peek().map_or(f32::INFINITY, |e| e.distance),
        }
    }
}

pub(super) async fn hits(
    storage: &Storage,
    tail: &Tail,
    table: Option<&Known>,
    top: Top,
    include: &[String],
) -> Result<Vec<Hit>> {
    let entries = top.heap.into_sorted_vec();
    let mut attrs: HashMap<usize, Arc<Attrs>> = HashMap::new();
    if let Some(table) = table
        && !include.is_empty()
    {
        let mut clusters: Vec<usize> = (entries.iter())
            .filter_map(|e| match e.from {
                From::Cluster(c, _) => Some(c),
                From::Tail(_) => None,
            })
            .collect();
        clusters.sort_unstable();
        clusters.dedup();
        let read: Vec<Arc<Attrs>> = stream::iter(clusters.clone())
            .map(|c| storage.attrs(table.get(c)))
            .buffered(PARALLELISM)
            .try_collect()
            .await?;
        attrs = clusters.into_iter().zip(read).collect();
    }
    let hits = entries
        .into_iter()
        .map(|entry| {
            let attributes = match (include.is_empty(), entry.from) {
                (true, _) => Default::default(),
                (false, From::Tail(row)) => {
                    let all = &tail.segment(row).attributes[row.row];
                    (include.iter())
                        .filter_map(|name| Some((name.clone(), all.get(name)?.clone())))
                        .collect()
                }
                (false, From::Cluster(c, row)) => attrs[&c].row(row, Some(include)),
            };
            Hit {
                id: entry.id,
                distance: entry.distance,
                attributes,
            }
        })
        .collect();
    Ok(hits)
}
