use std::thread;

use serde_json::{Value as Json, json};
use skywake_index::Value;

use crate::datasets::random::{Random, mix};
use crate::workloads::attrs::data::{CATEGORIES, CATEGORY, VECTOR, category_name, doc};

const PROBES: u64 = 0x5eed_0f9a_0be5;

pub(super) struct Truth {
    pub all: Vec<Vec<u64>>,
    pub filtered: Vec<Vec<u64>>,
}

pub(super) fn body(n: u64, dims: usize, k: usize, filtered: bool) -> Json {
    let mut body = json!({ "vector": probe(n, dims), "limit": k, "fields": [] });
    if filtered {
        body["filter"] = json!({ CATEGORY: { "eq": wanted(n) } });
    }
    body
}

pub(super) fn ids(answer: &Json) -> Vec<u64> {
    (answer["data"].as_array().into_iter().flatten())
        .filter_map(|hit| hit["id"].as_u64())
        .collect()
}

pub(super) fn recall(found: &[u64], truth: &[u64]) -> f64 {
    match truth.len() {
        0 => 1.0,
        n => found.iter().filter(|id| truth.contains(id)).count() as f64 / n as f64,
    }
}

pub(super) fn truth(rows: u64, dims: usize, k: usize, queries: u64) -> Truth {
    let probes: Vec<Vec<f32>> = (0..queries).map(|n| unit(probe(n, dims))).collect();
    let categories: Vec<String> = (0..queries).map(wanted).collect();
    let threads = thread::available_parallelism().map_or(4, |n| n.get()) as u64;
    let parts: Vec<(Vec<Best>, Vec<Best>)> = thread::scope(|scope| {
        let workers: Vec<_> = (0..threads)
            .map(|first| {
                let (probes, categories) = (&probes, &categories);
                scope.spawn(move || scan(rows, dims, k, first, threads, probes, categories))
            })
            .collect();
        (workers.into_iter())
            .map(|worker| worker.join().expect("a scan thread panicked"))
            .collect()
    });
    let mut all = vec![Best::new(k); queries as usize];
    let mut filtered = vec![Best::new(k); queries as usize];
    for (part_all, part_filtered) in parts {
        for (best, part) in all.iter_mut().zip(part_all) {
            best.merge(part);
        }
        for (best, part) in filtered.iter_mut().zip(part_filtered) {
            best.merge(part);
        }
    }
    Truth {
        all: all.into_iter().map(Best::ids).collect(),
        filtered: filtered.into_iter().map(Best::ids).collect(),
    }
}

fn scan(
    rows: u64,
    dims: usize,
    k: usize,
    first: u64,
    step: u64,
    probes: &[Vec<f32>],
    categories: &[String],
) -> (Vec<Best>, Vec<Best>) {
    let mut all = vec![Best::new(k); probes.len()];
    let mut filtered = vec![Best::new(k); probes.len()];
    for id in (first..rows).step_by(step as usize) {
        let mut row = doc(id, dims);
        let vector = unit(row.vectors.remove(VECTOR).unwrap_or_default());
        let category = match row.attributes.get(CATEGORY) {
            Some(Value::String(category)) => category.as_str(),
            _ => "",
        };
        for (q, probe) in probes.iter().enumerate() {
            let score = dot(probe, &vector);
            all[q].push(score, id);
            if categories[q] == category {
                filtered[q].push(score, id);
            }
        }
    }
    (all, filtered)
}

fn probe(n: u64, dims: usize) -> Vec<f32> {
    let mut random = Random(mix(n ^ PROBES));
    (0..dims).map(|_| random.normal()).collect()
}

fn wanted(n: u64) -> String {
    category_name(n % CATEGORIES)
}

fn unit(mut vector: Vec<f32>) -> Vec<f32> {
    let norm = dot(&vector, &vector).sqrt();
    if norm > 0.0 {
        vector.iter_mut().for_each(|x| *x /= norm);
    }
    vector
}

fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

#[derive(Clone)]
struct Best {
    k: usize,
    kept: Vec<(f32, u64)>,
}

impl Best {
    fn new(k: usize) -> Self {
        Self {
            k,
            kept: Vec::with_capacity(k + 1),
        }
    }

    fn push(&mut self, score: f32, id: u64) {
        if self.kept.len() == self.k && self.kept.last().is_some_and(|&(low, _)| score <= low) {
            return;
        }
        let at = self.kept.partition_point(|&(kept, _)| kept >= score);
        self.kept.insert(at, (score, id));
        self.kept.truncate(self.k);
    }

    fn merge(&mut self, other: Best) {
        other
            .kept
            .into_iter()
            .for_each(|(score, id)| self.push(score, id));
    }

    fn ids(self) -> Vec<u64> {
        self.kept.into_iter().map(|(_, id)| id).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_search_finds_a_row_from_its_own_vector() {
        let truth = truth(2_000, 16, 5, 3);
        assert_eq!(truth.all.len(), 3);
        assert!(truth.all.iter().all(|ids| ids.len() == 5));
        assert!(truth.filtered.iter().all(|ids| ids.len() <= 5));
        let mut best = Best::new(2);
        [(0.1, 1), (0.9, 2), (0.5, 3)]
            .into_iter()
            .for_each(|(s, id)| best.push(s, id));
        assert_eq!(best.ids(), vec![2, 3]);
        assert_eq!(recall(&[1, 2], &[2, 3]), 0.5);
    }
}
