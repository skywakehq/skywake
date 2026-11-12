//! The true nearest rows of each query by brute force, for every selection at once, saved next to the dataset.

use std::cmp::Ordering;
use std::collections::BinaryHeap;
use std::path::{Path, PathBuf};

use anyhow::Result;
use skywake_index::Metric;

use super::files::{Vectors, Writer, read_ids};
use super::filters::Selection;

const DEPTH: usize = 100;

const BLOCK_BYTES: usize = 4 << 20;

pub(crate) fn load(
    dir: &Path,
    rows: usize,
    metric: Metric,
    queries: &[Vec<f32>],
    selections: &[Selection],
) -> Result<Vec<Vec<Vec<u32>>>> {
    let base = dir.join("base.fbin");
    let full = Vectors::open(&base, None)?.rows;
    let given = dir.join("groundtruth.ibin");
    let mut found = Vec::new();
    let mut missing = Vec::new();
    for (i, &selection) in selections.iter().enumerate() {
        let path = match selection == Selection::ALL && rows == full && given.exists() {
            true => given.clone(),
            false => saved(dir, rows, metric, queries.len(), selection),
        };
        match path.exists() {
            true => found.push(read_ids(&path, Some(queries.len()))?),
            false => {
                found.push(Vec::new());
                missing.push(i);
            }
        }
    }
    if missing.is_empty() {
        return Ok(found);
    }
    let sets: Vec<Selection> = missing.iter().map(|&i| selections[i]).collect();
    let step = crate::progress::start(
        "truth",
        &format!(
            "brute force over {rows} rows for {} queries, {} selections",
            queries.len(),
            sets.len()
        ),
    );
    let computed = brute_force(&base, rows, metric, queries, &sets)?;
    step.done("");
    for (i, ids) in missing.into_iter().zip(computed) {
        let path = saved(dir, rows, metric, queries.len(), selections[i]);
        let mut writer = Writer::create(&path, ids.len(), DEPTH)?;
        for row in &ids {
            let mut row = row.clone();
            row.resize(DEPTH, u32::MAX);
            writer.u32s(&row)?;
        }
        writer.finish()?;
        found[i] = ids;
    }
    Ok(found)
}

fn saved(dir: &Path, rows: usize, metric: Metric, queries: usize, selection: Selection) -> PathBuf {
    let metric = format!("{metric:?}").to_lowercase();
    let selection = selection
        .below
        .map_or("all".to_string(), |b| format!("lt{b}"));
    dir.join(format!(
        "truth.{metric}.{rows}r.{queries}q.{selection}.ibin"
    ))
}

fn brute_force(
    base: &Path,
    rows: usize,
    metric: Metric,
    queries: &[Vec<f32>],
    sets: &[Selection],
) -> Result<Vec<Vec<Vec<u32>>>> {
    let mut queries = queries.to_vec();
    if metric == Metric::Cosine {
        queries.iter_mut().for_each(|q| normalize(q));
    }
    let mut best: Vec<Vec<BinaryHeap<Near>>> = (queries.iter())
        .map(|_| sets.iter().map(|_| BinaryHeap::new()).collect())
        .collect();
    let mut vectors = Vectors::open(base, Some(rows))?;
    let dims = vectors.dims;
    let threads = std::thread::available_parallelism().map_or(1, |n| n.get());
    let share = queries.len().div_ceil(threads).max(1);
    let mut first = 0;
    loop {
        let mut block = vectors.next_block((BLOCK_BYTES / (4 * dims)).max(1))?;
        if block.is_empty() {
            break;
        }
        if metric == Metric::Cosine {
            block.chunks_exact_mut(dims).for_each(normalize);
        }
        let passes: Vec<u64> = (0..block.len() / dims)
            .map(|r| {
                let id = (first + r) as u64;
                (sets.iter().enumerate())
                    .filter(|(_, set)| set.passes(id))
                    .fold(0, |mask, (s, _)| mask | 1 << s)
            })
            .collect();
        std::thread::scope(|scope| {
            for (queries, best) in queries.chunks(share).zip(best.chunks_mut(share)) {
                let (block, passes) = (&block, &passes);
                scope.spawn(move || {
                    for (query, best) in queries.iter().zip(best) {
                        for (r, row) in block.chunks_exact(dims).enumerate() {
                            let mut mask = passes[r];
                            if mask == 0 {
                                continue;
                            }
                            let near = Near(distance(metric, query, row), (first + r) as u32);
                            while mask != 0 {
                                offer(&mut best[mask.trailing_zeros() as usize], &near);
                                mask &= mask - 1;
                            }
                        }
                    }
                });
            }
        });
        first += block.len() / dims;
    }
    let mut by_set = vec![Vec::new(); sets.len()];
    for of_query in best {
        for (set, heap) in by_set.iter_mut().zip(of_query) {
            set.push(heap.into_sorted_vec().into_iter().map(|n| n.1).collect());
        }
    }
    Ok(by_set)
}

fn offer(heap: &mut BinaryHeap<Near>, near: &Near) {
    if heap.len() < DEPTH {
        heap.push(Near(near.0, near.1));
    } else if heap.peek().is_some_and(|worst| near < worst) {
        heap.pop();
        heap.push(Near(near.0, near.1));
    }
}

#[derive(PartialEq)]
struct Near(f32, u32);

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

fn distance(metric: Metric, a: &[f32], b: &[f32]) -> f32 {
    match metric {
        Metric::Cosine => 1.0 - dot(a, b),
        Metric::Dot => -dot(a, b),
        Metric::Euclidean => squared(a, b),
    }
}

fn dot(a: &[f32], b: &[f32]) -> f32 {
    let mut sums = [0.0f32; 8];
    let ((x, x_rest), (y, y_rest)) = (a.as_chunks::<8>(), b.as_chunks::<8>());
    let rest: f32 = (x_rest.iter().zip(y_rest)).map(|(p, q)| p * q).sum();
    for (x, y) in x.iter().zip(y) {
        for i in 0..8 {
            sums[i] += x[i] * y[i];
        }
    }
    sums.iter().sum::<f32>() + rest
}

fn squared(a: &[f32], b: &[f32]) -> f32 {
    let mut sums = [0.0f32; 8];
    let ((x, x_rest), (y, y_rest)) = (a.as_chunks::<8>(), b.as_chunks::<8>());
    let rest: f32 = (x_rest.iter().zip(y_rest))
        .map(|(p, q)| (p - q) * (p - q))
        .sum();
    for (x, y) in x.iter().zip(y) {
        for i in 0..8 {
            let d = x[i] - y[i];
            sums[i] += d * d;
        }
    }
    sums.iter().sum::<f32>() + rest
}

fn normalize(v: &mut [f32]) {
    let norm = dot(v, v).sqrt().max(f32::MIN_POSITIVE);
    v.iter_mut().for_each(|x| *x /= norm);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_nearest_rows_of_each_selection() {
        let dir = tempfile::tempdir().unwrap();
        let rows = 3000;
        let mut writer = Writer::create(&dir.path().join("base.fbin"), rows, 2).unwrap();
        for i in 0..rows {
            writer.f32s(&[i as f32, 0.0]).unwrap();
        }
        writer.finish().unwrap();
        let queries = vec![vec![10.2, 0.0], vec![2000.0, 1.0]];
        let half = Selection::percent("50").unwrap();
        let sets = [Selection::ALL, half];
        let truth = load(dir.path(), rows, Metric::Euclidean, &queries, &sets).unwrap();
        assert_eq!(truth[0][0][..3], [10, 11, 9]);
        assert_eq!(truth[0][1][0], 2000);
        let passing: Vec<u32> = (0..rows as u32)
            .filter(|&id| half.passes(id as u64))
            .collect();
        let mut expected = passing.clone();
        expected.sort_by_key(|&id| (id as i64 - 2000).abs() * 2 + (id > 2000) as i64);
        assert_eq!(truth[1][1][..10], expected[..10]);
        assert_eq!(
            load(dir.path(), rows, Metric::Euclidean, &queries, &sets).unwrap(),
            truth
        );
    }
}
