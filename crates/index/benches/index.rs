//! Microbenchmarks of RaBitQ codes, filter-part lookup and warm in-memory BM25 search.

use std::hint::black_box;
use std::sync::Arc;

use criterion::{Criterion, Throughput, criterion_group, criterion_main};
use object_store::memory::InMemory;
use skywake_index::bench::{Blocks, Coder};
use skywake_index::{Doc, Filter, Index, Metric, Schema, TextOptions, TextQuery, Value};

const DIMS: usize = 768;
const ROWS: usize = 1000;

struct SplitMix(u64);

impl SplitMix {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    fn unit(&mut self) -> f32 {
        (self.next() >> 40) as f32 / (1u64 << 23) as f32 - 1.0
    }

    fn vector(&mut self, around: &[f32], spread: f32) -> Vec<f32> {
        around.iter().map(|x| x + spread * self.unit()).collect()
    }
}

fn rabitq(c: &mut Criterion) {
    let mut random = SplitMix(7);
    let zero = vec![0.0; DIMS];
    let centroid = random.vector(&zero, 1.0);
    let origin = random.vector(&zero, 0.3);
    let rows: Vec<Vec<f32>> = (0..ROWS).map(|_| random.vector(&centroid, 0.5)).collect();
    let query = random.vector(&centroid, 1.0);
    let coder = Coder::new(3, centroid, origin);
    let words = coder.words();
    let mut bits = vec![0u64; ROWS * words];
    let factors: Vec<[f32; 4]> = (rows.iter())
        .zip(bits.chunks_exact_mut(words))
        .map(|(row, out)| coder.encode(row, out))
        .collect();
    let mut group = c.benchmark_group("rabitq");
    group.throughput(Throughput::Elements(ROWS as u64));
    group.bench_function("encode", |b| {
        let mut out = vec![0u64; words];
        b.iter(|| {
            for row in &rows {
                black_box(coder.encode(row, &mut out));
            }
        })
    });
    let scorer = coder.scorer(Metric::Euclidean, &query);
    group.bench_function("score", |b| {
        b.iter(|| {
            for (code, factors) in bits.chunks_exact(words).zip(&factors) {
                black_box(scorer.estimate(code, factors));
            }
        })
    });
    group.finish();
}

fn filter(c: &mut Criterion) {
    let blocks = Blocks::numbers((0..10_000).map(|i| i as f64 * 10.0));
    let clauses = [
        ("eq", Filter::Eq("n".into(), Value::Number(50_005.0))),
        ("lt", Filter::Lt("n".into(), Value::Number(25_000.0))),
        (
            "in",
            Filter::In(
                "n".into(),
                (0..16).map(|i| Value::Number(i as f64 * 6_007.0)).collect(),
            ),
        ),
    ];
    let mut group = c.benchmark_group("filter/lookup");
    for (name, clause) in &clauses {
        group.bench_function(*name, |b| b.iter(|| blocks.find(black_box(clause))));
    }
    group.finish();
}

fn bm25(c: &mut Criterion) {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .build()
        .unwrap();
    let schema = Schema::new().text("body", TextOptions::default());
    let mut random = SplitMix(11);
    let mut word = || {
        let skewed = random.next() % 500 * (random.next() % 500) / 500;
        format!("w{skewed}")
    };
    let docs: Vec<Doc> = (0..4000u64)
        .map(|id| {
            let body: Vec<String> = (0..16).map(|_| word()).collect();
            Doc::new(id).attribute("body", body.join(" "))
        })
        .collect();
    let snapshot = runtime.block_on(async {
        let index = Index::create(Arc::new(InMemory::new()), schema).await?;
        index.upsert(docs).await?;
        index.build().await?;
        index.snapshot().await
    });
    let snapshot = snapshot.unwrap();
    let query = TextQuery::new("w3 w42 w250", 10);
    runtime.block_on(snapshot.search(&query)).unwrap();
    c.bench_function("bm25/search-warm-memory", |b| {
        b.iter(|| {
            runtime
                .block_on(snapshot.search(black_box(&query)))
                .unwrap()
        })
    });
}

criterion_group!(benches, rabitq, filter, bm25);
criterion_main!(benches);
