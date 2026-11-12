//! Recall at scale, on synthetic clustered data, with and without
//! filters. Too slow for a debug build, so ignored unless asked for:
//!
//!     cargo test --release -p skywake-index --test recall -- --ignored

use std::collections::HashSet;

use skywake_index::{Doc, Filter, Id, Index, Kind, Metric, Query, Schema};
use tempfile::TempDir;

struct Random(u64);

impl Random {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    fn normal(&mut self) -> f32 {
        let unit = |r: &mut Self| (r.next() >> 40) as f32 / (1u64 << 24) as f32;
        let u = unit(self).max(1e-7);
        (-2.0 * u.ln()).sqrt() * (std::f32::consts::TAU * unit(self)).cos()
    }
}

/// Points around one random center per hundred rows, with noise larger
/// than the spread of the centers, as `index-bench gen` makes.
fn clustered(rows: usize, dims: usize, centers: usize, seed: u64) -> Vec<Vec<f32>> {
    let mut random = Random(42);
    let centers: Vec<Vec<f32>> = (0..centers)
        .map(|_| (0..dims).map(|_| random.normal()).collect())
        .collect();
    let mut random = Random(seed);
    (0..rows)
        .map(|_| {
            let center = &centers[random.next() as usize % centers.len()];
            center.iter().map(|x| x + 1.5 * random.normal()).collect()
        })
        .collect()
}

/// A built index of `rows` rows; one in ten has `ten`, one in a hundred
/// `hundred`.
async fn built(rows: usize, dims: usize, metric: Metric) -> (TempDir, Index) {
    let dir = tempfile::tempdir().unwrap();
    let store = skywake_core::open_store(dir.path().to_str().unwrap()).unwrap();
    let schema = Schema::new()
        .vector("v", dims, metric)
        .attribute("ten", Kind::Bool)
        .attribute("hundred", Kind::String);
    let index = Index::create(store, schema).await.unwrap();
    let vectors = clustered(rows, dims, rows / 100, 1);
    for (start, batch) in (0..).step_by(5000).zip(vectors.chunks(5000)) {
        let docs = (batch.iter().enumerate())
            .map(|(i, v)| {
                let id = (start + i) as u64;
                let hundred = if id % 100 == 7 { "yes" } else { "no" };
                Doc::new(id)
                    .vector("v", v.clone())
                    .attribute("ten", id % 10 == 3)
                    .attribute("hundred", hundred)
            })
            .collect();
        index.upsert(docs).await.unwrap();
    }
    index.build().await.unwrap();
    (dir, index)
}

/// The share of the true top 10 found, against reading every cluster.
async fn recall(index: &Index, queries: &[Vec<f32>], shape: impl Fn(Query) -> Query) -> f64 {
    let mut found = 0;
    for vector in queries {
        let query = shape(Query::new("v", vector.clone(), 10));
        let exact = index.query(&query.clone().probe(usize::MAX)).await.unwrap();
        assert_eq!(exact.len(), 10);
        let truth: HashSet<Id> = exact.into_iter().map(|hit| hit.id).collect();
        let hits = index.query(&query).await.unwrap();
        found += hits.iter().filter(|hit| truth.contains(&hit.id)).count();
    }
    found as f64 / (queries.len() * 10) as f64
}

/// Turns a plain query into the one a case measures.
type Shape = fn(Query) -> Query;

async fn check(rows: usize, dims: usize, metric: Metric) {
    let (_dir, index) = built(rows, dims, metric).await;
    let queries = clustered(100, dims, rows / 100, 2);
    let cases: [(&str, f64, Shape); 4] = [
        ("default", 0.95, |q| q),
        ("recall 0.99", 0.99, |q| q.recall(0.99)),
        ("10% filter", 0.95, |q| q.filter(Filter::eq("ten", true))),
        ("1% filter", 0.95, |q| {
            q.filter(Filter::eq("hundred", "yes"))
        }),
    ];
    for (name, wanted, shape) in cases {
        let found = recall(&index, &queries, shape).await;
        println!("{rows} x {dims}, {name}: recall@10 {found:.3}");
        assert!(found >= wanted, "{name}: recall@10 {found}");
    }
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn recall_at_100k_rows_of_128_dims() {
    check(100_000, 128, Metric::Euclidean).await;
}

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn recall_at_50k_rows_of_768_dims() {
    check(50_000, 768, Metric::Cosine).await;
}
