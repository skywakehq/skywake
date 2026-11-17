use std::cmp::{Ordering, Reverse};
use std::collections::{BinaryHeap, HashMap};
use std::ops::Range;
use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering as Atomic};
use std::sync::{Arc, OnceLock};

use tantivy::query::Bm25Weight;

use super::cursor::{Cursor, DONE};
use super::span::Span;

const SLACK: f32 = 1.00001;

const PRIMED: f32 = 0.9999;

const POSTINGS_A_THREAD: u64 = 400_000;

const MAX_THREADS: usize = 8;

pub(crate) struct Term {
    pub span: Arc<Span>,
    pub weight: Bm25Weight,
}

impl Term {
    fn score(&self, tf: u32, norm: u8) -> f32 {
        self.weight.score(norm, tf)
    }

    fn bound(&self, tf: u32, norm: u8) -> f32 {
        self.score(tf, norm) * SLACK
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Hit {
    pub score: f32,
    pub doc: u32,
}

impl Eq for Hit {}

impl PartialOrd for Hit {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Hit {
    fn cmp(&self, other: &Self) -> Ordering {
        (self.score.total_cmp(&other.score)).then(other.doc.cmp(&self.doc))
    }
}

struct Kept {
    k: usize,
    heap: BinaryHeap<Reverse<Hit>>,
}

impl Kept {
    fn new(k: usize) -> Self {
        Self {
            k,
            heap: BinaryHeap::with_capacity(k.min(1 << 16) + 1),
        }
    }

    fn worst(&self) -> f32 {
        match self.heap.len() < self.k {
            true => 0.0,
            false => self.heap.peek().map_or(0.0, |worst| worst.0.score),
        }
    }

    fn offer(&mut self, hit: Hit) -> bool {
        if self.heap.len() < self.k {
            self.heap.push(Reverse(hit));
        } else if self.heap.peek().is_some_and(|worst| hit > worst.0) {
            self.heap.pop();
            self.heap.push(Reverse(hit));
        }
        self.heap.len() == self.k
    }
}

struct Shared(AtomicU32);

impl Shared {
    fn new(floor: f32) -> Self {
        let shared = Self(AtomicU32::new(0));
        shared.raise(floor);
        shared
    }

    fn get(&self) -> f32 {
        f32::from_bits(self.0.load(Atomic::Relaxed))
    }

    fn raise(&self, score: f32) {
        if score > 0.0 {
            self.0.fetch_max(score.to_bits(), Atomic::Relaxed);
        }
    }
}

struct Ranked<'a> {
    term: &'a Term,
    bound: f32,
}

impl Ranked<'_> {
    fn block_bound(&self, cursor: &Cursor, memo: &mut (usize, f32)) -> f32 {
        let block = cursor.block();
        if memo.0 != block {
            let bound = (self.term.span.metas.get(block))
                .map_or(0.0, |meta| self.term.bound(meta.max_tf, meta.min_norm));
            *memo = (block, bound);
        }
        memo.1
    }
}

pub(crate) fn search(
    terms: &[Term],
    docs: u32,
    blocked: Option<&[u64]>,
    k: usize,
    floor: f32,
) -> Vec<Hit> {
    search_on(terms, docs, blocked, k, floor, None)
}

pub(super) fn search_on(
    terms: &[Term],
    docs: u32,
    blocked: Option<&[u64]>,
    k: usize,
    floor: f32,
    threads: Option<usize>,
) -> Vec<Hit> {
    let mut ranked: Vec<Ranked> = (terms.iter())
        .filter(|term| term.span.head.df > 0)
        .map(|term| Ranked {
            term,
            bound: term.bound(term.span.head.max_tf, term.span.head.min_norm),
        })
        .collect();
    if ranked.is_empty() || k == 0 || docs == 0 {
        return Vec::new();
    }
    ranked.sort_by(|a, b| a.bound.total_cmp(&b.bound));
    let shared = Shared::new(floor);
    shared.raise(primed(&ranked, blocked, k));
    let wanted = threads.unwrap_or_else(|| self::threads(&ranked)).max(1);
    let extra = Extra::take(wanted - 1, threads.is_some());
    let ranges = ranges(docs, extra.0 + 1);
    let Some((own, others)) = ranges.split_last() else {
        return Vec::new();
    };
    let mut hits = std::thread::scope(|scope| {
        let (ranked, shared) = (&ranked, &shared);
        let workers: Vec<_> = (others.iter().cloned())
            .map(|range| scope.spawn(move || scan(ranked, range, blocked, k, shared)))
            .collect();
        let mut hits = scan(ranked, own.clone(), blocked, k, shared);
        for worker in workers {
            match worker.join() {
                Ok(found) => hits.extend(found),
                Err(panic) => std::panic::resume_unwind(panic),
            }
        }
        hits
    });
    hits.retain(|hit| hit.score >= floor || floor.is_nan());
    hits.sort_by(|a, b| b.cmp(a));
    hits.truncate(k);
    hits
}

fn cores() -> usize {
    static CORES: OnceLock<usize> = OnceLock::new();
    *CORES.get_or_init(|| std::thread::available_parallelism().map_or(1, |n| n.get()))
}

static BUSY: AtomicUsize = AtomicUsize::new(0);

struct Extra(usize);

impl Extra {
    fn take(wanted: usize, forced: bool) -> Self {
        let busy = BUSY.fetch_add(wanted, Atomic::Relaxed);
        let granted = match forced {
            true => wanted,
            false => wanted.min(cores().saturating_sub(busy)),
        };
        BUSY.fetch_sub(wanted - granted, Atomic::Relaxed);
        Self(granted)
    }
}

impl Drop for Extra {
    fn drop(&mut self) {
        BUSY.fetch_sub(self.0, Atomic::Relaxed);
    }
}

fn threads(ranked: &[Ranked]) -> usize {
    let cores = cores();
    let postings: u64 = ranked.iter().map(|r| r.term.span.head.df as u64).sum();
    ((postings / POSTINGS_A_THREAD) as usize).clamp(1, cores.min(MAX_THREADS))
}

fn ranges(docs: u32, threads: usize) -> Vec<Range<u32>> {
    let width = (docs as u64).div_ceil(threads as u64).max(1);
    (0..threads as u64)
        .map(|i| (i * width).min(docs as u64) as u32..((i + 1) * width).min(docs as u64) as u32)
        .filter(|range| !range.is_empty())
        .collect()
}

fn is_blocked(blocked: Option<&[u64]>, doc: u32) -> bool {
    blocked.is_some_and(|words| {
        (words.get(doc as usize / 64)).is_some_and(|word| word >> (doc % 64) & 1 == 1)
    })
}

fn primed(ranked: &[Ranked], blocked: Option<&[u64]>, k: usize) -> f32 {
    let mut known: HashMap<u32, f32> = HashMap::new();
    for Ranked { term, .. } in ranked {
        for best in &term.span.head.best {
            if !is_blocked(blocked, best.doc) {
                *known.entry(best.doc).or_default() += term.score(best.tf, best.norm);
            }
        }
    }
    if known.len() < k {
        return 0.0;
    }
    let mut scores: Vec<f32> = known.into_values().collect();
    let (_, kth, _) = scores.select_nth_unstable_by(k - 1, |a, b| b.total_cmp(a));
    *kth * PRIMED
}

fn scan(
    ranked: &[Ranked],
    range: Range<u32>,
    blocked: Option<&[u64]>,
    k: usize,
    shared: &Shared,
) -> Vec<Hit> {
    let n = ranked.len();
    let mut below = vec![0.0f32; n + 1];
    for (i, list) in ranked.iter().enumerate() {
        below[i + 1] = below[i] + list.bound;
    }
    let mut cursors: Vec<Cursor> = ranked.iter().map(|r| Cursor::new(&r.term.span)).collect();
    cursors
        .iter_mut()
        .for_each(|cursor| cursor.seek(range.start));
    let mut memo = vec![(usize::MAX, 0.0f32); n];
    let mut kept = Kept::new(k);
    let mut first = 0;
    loop {
        let limit = shared.get().max(kept.worst());
        while first < n && below[first + 1] < limit {
            first += 1;
        }
        let doc = cursors[first..].iter().map(|c| c.doc).min().unwrap_or(DONE);
        if doc >= range.end {
            break;
        }
        let (mut bound, mut edge) = (below[first], DONE);
        for i in first..n {
            if cursors[i].doc != DONE {
                bound += ranked[i].block_bound(&cursors[i], &mut memo[i]);
                edge = edge.min(cursors[i].last());
            }
        }
        if bound < limit {
            let next = edge.max(doc).saturating_add(1);
            cursors[first..].iter_mut().for_each(|c| c.seek(next));
            continue;
        }
        let dead = is_blocked(blocked, doc);
        let mut score = 0.0f64;
        for i in first..n {
            if cursors[i].doc == doc {
                if !dead {
                    score += ranked[i].term.score(cursors[i].tf(), cursors[i].norm()) as f64;
                }
                cursors[i].next();
            }
        }
        if dead
            || !rest(
                ranked,
                &mut cursors[..first],
                &mut memo,
                &below,
                doc,
                limit,
                &mut score,
            )
        {
            continue;
        }
        let score = score as f32;
        if kept.offer(Hit { score, doc }) {
            shared.raise(kept.worst());
        }
    }
    kept.heap.into_iter().map(|hit| hit.0).collect()
}

fn rest(
    ranked: &[Ranked],
    cursors: &mut [Cursor],
    memo: &mut [(usize, f32)],
    below: &[f32],
    doc: u32,
    limit: f32,
    score: &mut f64,
) -> bool {
    for i in (0..cursors.len()).rev() {
        if *score as f32 + below[i + 1] < limit {
            return false;
        }
        let cursor = &mut cursors[i];
        if !cursor.shallow(doc) {
            continue;
        }
        if *score as f32 + below[i] + ranked[i].block_bound(cursor, &mut memo[i]) < limit {
            return false;
        }
        cursor.seek(doc);
        if cursor.doc == doc {
            *score += ranked[i].term.score(cursor.tf(), cursor.norm()) as f64;
        }
    }
    true
}
