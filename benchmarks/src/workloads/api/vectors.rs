use std::path::{Path, PathBuf};
use std::thread;

use anyhow::{Result, ensure};
use serde_json::{Value as Json, json};
use skywake_index::{Doc, Id, Value};

use crate::datasets::files::Vectors;
use crate::datasets::random::{Random, mix};
use crate::workloads::attrs::data::{CATEGORIES, CATEGORY, VECTOR, category_name, doc};

const PROBES: u64 = 0x5eed_0f9a_0be5;
const BLOCK: usize = 20_000;

#[derive(Clone, Copy, Debug, clap::ValueEnum)]
pub(super) enum Probes {
    Uniform,
    Normal,
}

pub(super) struct Source {
    file: Option<Vectors>,
    pub rows: u64,
    pub dims: usize,
    next: u64,
}

impl Source {
    pub(super) fn open(dataset: Option<&Path>, rows: u64, dims: usize) -> Result<Self> {
        let Some(dir) = dataset else {
            return Ok(Self {
                file: None,
                rows,
                dims,
                next: 0,
            });
        };
        let file = Vectors::open(&base(dir), Some(rows as usize))?;
        ensure!(file.rows > 0, "{} holds no rows", base(dir).display());
        Ok(Self {
            rows: file.rows as u64,
            dims: file.dims,
            file: Some(file),
            next: 0,
        })
    }

    pub(super) fn next_block(&mut self, max: usize) -> Result<Vec<Doc>> {
        let first = self.next;
        let count = (max as u64).min(self.rows - first);
        self.next += count;
        let ids = first..first + count;
        match &mut self.file {
            None => Ok(ids.map(|id| doc(id, self.dims)).collect()),
            Some(file) => {
                let flat = file.next_block(count as usize)?;
                Ok(ids
                    .zip(flat.chunks_exact(self.dims))
                    .map(|(id, vector)| doc(id, 0).vector(VECTOR, vector.to_vec()))
                    .collect())
            }
        }
    }
}

pub(super) fn base(dir: &Path) -> PathBuf {
    dir.join("base.fbin")
}

pub(super) struct Truth {
    pub all: Vec<Vec<u64>>,
    pub filtered: Vec<Vec<u64>>,
}

pub(super) fn body(n: u64, dims: usize, k: usize, filtered: bool, probes: Probes) -> Json {
    let mut body = json!({ "vector": probe(n, dims, probes), "limit": k, "fields": [] });
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

pub(super) fn truth(mut source: Source, k: usize, queries: u64, probes: Probes) -> Result<Truth> {
    let dims = source.dims;
    let probes: Vec<Vec<f32>> = (0..queries).map(|n| unit(probe(n, dims, probes))).collect();
    let categories: Vec<String> = (0..queries).map(wanted).collect();
    let mut all = vec![Best::new(k); probes.len()];
    let mut filtered = vec![Best::new(k); probes.len()];
    let threads = thread::available_parallelism().map_or(4, |n| n.get());
    let share = probes.len().div_ceil(threads).max(1);
    loop {
        let block = source.next_block(BLOCK)?;
        if block.is_empty() {
            break;
        }
        let rows: Vec<(u64, Vec<f32>, &str)> = block.iter().map(scanned).collect();
        thread::scope(|scope| {
            let chunks = (all.chunks_mut(share))
                .zip(filtered.chunks_mut(share))
                .zip(probes.chunks(share).zip(categories.chunks(share)));
            for ((all, filtered), (probes, categories)) in chunks {
                let rows = &rows;
                scope.spawn(move || {
                    for (id, vector, category) in rows {
                        for (q, probe) in probes.iter().enumerate() {
                            let score = dot(probe, vector);
                            all[q].push(score, *id);
                            if categories[q] == *category {
                                filtered[q].push(score, *id);
                            }
                        }
                    }
                });
            }
        });
    }
    Ok(Truth {
        all: all.into_iter().map(Best::ids).collect(),
        filtered: filtered.into_iter().map(Best::ids).collect(),
    })
}

fn scanned(row: &Doc) -> (u64, Vec<f32>, &str) {
    let id = match row.id {
        Id::Num(id) => id,
        _ => unreachable!("benchmark rows have numeric ids"),
    };
    let vector = unit(row.vectors.get(VECTOR).cloned().unwrap_or_default());
    let category = match row.attributes.get(CATEGORY) {
        Some(Value::String(category)) => category.as_str(),
        _ => "",
    };
    (id, vector, category)
}

fn probe(n: u64, dims: usize, probes: Probes) -> Vec<f32> {
    let mut random = Random(mix(n ^ PROBES));
    match probes {
        Probes::Uniform => (0..dims).map(|_| random.unit() as f32).collect(),
        Probes::Normal => (0..dims).map(|_| random.normal()).collect(),
    }
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

    fn ids(self) -> Vec<u64> {
        self.kept.into_iter().map(|(_, id)| id).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::datasets::files::Writer;

    #[test]
    fn exact_search_finds_the_nearest_rows() {
        let source = Source::open(None, 2_000, 16).unwrap();
        let truth = truth(source, 5, 3, Probes::Normal).unwrap();
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

    #[test]
    fn reads_rows_from_a_dataset() {
        let dir = tempfile::tempdir().unwrap();
        let mut writer = Writer::create(&base(dir.path()), 3, 2).unwrap();
        writer.f32s(&[1.0, 0.0, 0.0, 1.0, 0.7, 0.7]).unwrap();
        writer.finish().unwrap();
        let mut source = Source::open(Some(dir.path()), 10, 99).unwrap();
        assert_eq!((source.rows, source.dims), (3, 2));
        let rows = source.next_block(2).unwrap();
        assert_eq!(rows[1].vectors[VECTOR], vec![0.0, 1.0]);
        assert!(rows[1].attributes.contains_key(CATEGORY));
        assert_eq!(source.next_block(5).unwrap().len(), 1);
        let source = Source::open(Some(dir.path()), 10, 0).unwrap();
        let truth = truth(source, 1, 2, Probes::Uniform).unwrap();
        assert!(truth.all.iter().all(|ids| ids == &vec![2]));
    }
}
