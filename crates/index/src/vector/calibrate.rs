//! Measures at build time how many clusters a query must read.

use std::cmp::Ordering;
use std::collections::BinaryHeap;

use serde::{Deserialize, Serialize};

use super::ivf::{self, TILE};
use crate::Column;

const RECALLS: [f32; 8] = [0.5, 0.8, 0.9, 0.95, 0.97, 0.99, 0.995, 0.999];

const KS: [usize; 6] = [1, 10, 100, 1000, 3000, 10_000];

const MARGIN: f32 = 0.6;

pub(crate) const QUERIES: usize = 200;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub(crate) struct Calibration {
    pub ks: Vec<u32>,
    pub shares: Vec<Vec<f32>>,
}

impl Calibration {
    pub(crate) fn share(&self, k: f64, recall: f32) -> f32 {
        let aim = 1.0 - (1.0 - recall) * MARGIN;
        let Some(j) = RECALLS.iter().position(|&r| r >= aim) else {
            return 1.0;
        };
        let i = match self.ks.iter().position(|&c| c as f64 >= k) {
            Some(0) => return self.shares[0][j],
            Some(i) => i,
            None if self.ks.len() >= 2 => self.ks.len() - 1,
            None => return 1.0,
        };
        let (low, high) = (self.ks[i - 1] as f64, self.ks[i] as f64);
        let at = ((k.ln() - low.ln()) / (high.ln() - low.ln())).max(0.0) as f32;
        let share = self.shares[i - 1][j] + at * (self.shares[i][j] - self.shares[i - 1][j]);
        share.min(1.0)
    }
}

#[derive(Default)]
pub(crate) struct Calibrator {
    column: Option<Column>,
    queries: Vec<f32>,
    seqs: Vec<u64>,
    keep: usize,
    best: Vec<BinaryHeap<Near>>,
}

#[derive(PartialEq)]
struct Near(f32, u32);

fn offer(best: &mut BinaryHeap<Near>, keep: usize, near: Near) {
    if best.len() < keep {
        best.push(near);
    } else if best.peek().is_some_and(|worst| near.0 < worst.0) {
        best.pop();
        best.push(near);
    }
}

impl Eq for Near {}

impl PartialOrd for Near {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Near {
    fn cmp(&self, other: &Self) -> Ordering {
        self.0.total_cmp(&other.0).then(self.1.cmp(&other.1))
    }
}

impl Calibrator {
    pub(crate) fn new(column: Column, queries: Vec<f32>, seqs: Vec<u64>, rows: usize) -> Self {
        let keep = KS[KS.len() - 1].min(rows.saturating_sub(1));
        Self {
            column: Some(column),
            best: seqs.iter().map(|_| BinaryHeap::new()).collect(),
            queries,
            seqs,
            keep,
        }
    }

    pub(crate) fn add(&mut self, vectors: &[f32], seqs: &[u64], clusters: &[u32]) {
        let Some(column) = self.column else { return };
        if self.keep == 0 {
            return;
        }
        let dims = column.dims;
        let threads = std::thread::available_parallelism().map_or(1, |n| n.get());
        let size = self.seqs.len().div_ceil(threads).max(1);
        let keep = self.keep;
        std::thread::scope(|scope| {
            let parts = (self.queries.chunks(size * dims))
                .zip(self.seqs.chunks(size))
                .zip(self.best.chunks_mut(size));
            for ((queries, own), best) in parts {
                scope.spawn(move || {
                    let rows = || vectors.chunks_exact(dims).zip(seqs).zip(clusters);
                    let tiles = (queries.chunks(TILE * dims))
                        .zip(own.chunks(TILE))
                        .zip(best.chunks_mut(TILE));
                    for ((queries, own), best) in tiles {
                        if best.len() < TILE {
                            for ((query, own), best) in
                                queries.chunks_exact(dims).zip(own).zip(best)
                            {
                                for ((row, seq), &cluster) in rows() {
                                    if seq != own {
                                        let d = ivf::distance(column.metric, query, row);
                                        offer(best, keep, Near(d, cluster));
                                    }
                                }
                            }
                            continue;
                        }
                        let tile: [&[f32]; TILE] =
                            std::array::from_fn(|t| &queries[t * dims..(t + 1) * dims]);
                        for ((row, seq), &cluster) in rows() {
                            let found = ivf::distances(column.metric, row, tile);
                            for t in 0..TILE {
                                if *seq != own[t] {
                                    offer(&mut best[t], keep, Near(found[t], cluster));
                                }
                            }
                        }
                    }
                });
            }
        });
    }

    pub(crate) fn finish(self, centroids: &[f32]) -> Calibration {
        let Some(column) = self.column else {
            return Calibration::default();
        };
        let dims = column.dims;
        let clusters = centroids.len() / dims;
        let ks: Vec<usize> = KS.into_iter().filter(|&k| k <= self.keep).collect();
        if clusters == 0 || ks.is_empty() || self.seqs.is_empty() {
            return Calibration::default();
        }
        let mut ranks: Vec<Vec<u32>> = vec![Vec::new(); ks.len()];
        for (query, best) in self.queries.chunks_exact(dims).zip(self.best) {
            let mut order: Vec<(f32, usize)> = centroids
                .chunks_exact(dims)
                .map(|c| ivf::distance(column.metric, query, c))
                .zip(0..)
                .collect();
            order.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
            let mut rank = vec![0u32; clusters];
            for (r, &(_, c)) in order.iter().enumerate() {
                rank[c] = r as u32;
            }
            let near = best.into_sorted_vec();
            for (i, &k) in ks.iter().enumerate() {
                ranks[i].extend(near.iter().take(k).map(|n| rank[n.1 as usize]));
            }
        }
        let shares = ranks
            .into_iter()
            .map(|mut ranks| {
                ranks.sort_unstable();
                RECALLS
                    .iter()
                    .map(|&recall| {
                        let needed = (recall as f64 * ranks.len() as f64).ceil() as usize;
                        let rank = ranks[needed.clamp(1, ranks.len()) - 1];
                        (rank + 1) as f32 / clusters as f32
                    })
                    .collect()
            })
            .collect();
        Calibration {
            ks: ks.into_iter().map(|k| k as u32).collect(),
            shares,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Element, Metric};

    #[test]
    fn tiled_calibration_finds_the_same_neighbours() {
        let mut random = ivf::Random(9);
        let mut numbers = |n: usize| -> Vec<f32> {
            (0..n)
                .map(|_| (random.next() % 2001) as f32 / 1000.0 - 1.0)
                .collect()
        };
        for (dims, queries, rows) in [(13, 203, 900), (1024, 37, 300)] {
            for metric in [Metric::Cosine, Metric::Euclidean, Metric::Dot] {
                let column = Column {
                    dims,
                    metric,
                    element: Element::F32,
                };
                let asked = numbers(queries * dims);
                let own: Vec<u64> = (0..queries as u64).map(|q| q * 3).collect();
                let vectors = numbers(rows * dims);
                let seqs: Vec<u64> = (0..rows as u64).collect();
                let clusters: Vec<u32> = (0..rows as u32).map(|r| r % 17).collect();
                let mut tiled = Calibrator::new(column, asked.clone(), own.clone(), rows);
                tiled.add(&vectors, &seqs, &clusters);
                let keep = tiled.keep;
                for (q, query) in asked.chunks_exact(dims).enumerate() {
                    let mut best = BinaryHeap::new();
                    for ((row, seq), &cluster) in
                        vectors.chunks_exact(dims).zip(&seqs).zip(&clusters)
                    {
                        if *seq != own[q] {
                            offer(
                                &mut best,
                                keep,
                                Near(ivf::distance(metric, query, row), cluster),
                            );
                        }
                    }
                    let want: Vec<(u32, u32)> = best
                        .into_sorted_vec()
                        .iter()
                        .map(|n| (n.0.to_bits(), n.1))
                        .collect();
                    let got: Vec<(u32, u32)> =
                        (std::mem::take(&mut tiled.best[q]).into_sorted_vec().iter())
                            .map(|n| (n.0.to_bits(), n.1))
                            .collect();
                    assert_eq!(got, want);
                }
            }
        }
    }

    #[test]
    fn a_share_past_the_largest_k_goes_on_along_the_last_line() {
        let calibration = Calibration {
            ks: vec![3000, 10_000],
            shares: vec![vec![0.1; RECALLS.len()], vec![0.2; RECALLS.len()]],
        };
        let share = |k: f64| calibration.share(k, 0.95);
        assert!((share(3000.0) - 0.1).abs() < 1e-6);
        assert!((share(10_000.0) - 0.2).abs() < 1e-6);
        let past = share(11_000.0);
        assert!(past > 0.2 && past < 0.21, "{past}");
        assert_eq!(share(1e12), 1.0);
        let one = Calibration {
            ks: vec![1],
            shares: vec![vec![0.1; RECALLS.len()]],
        };
        assert_eq!(one.share(10.0, 0.95), 1.0);
    }
}
