//! Microbenchmarks of a chunk cache hit, read directly and through a node over HTTP.

use std::sync::Arc;

use criterion::{Criterion, Throughput, criterion_group, criterion_main};
use object_store::memory::InMemory;
use skywake_cache::{Node, serve};
use skywake_core::cache::ChunkCache;
use skywake_core::{Hash, Objects};
use tokio::net::TcpListener;

const CHUNKS: u64 = 1000;
const SIZE: usize = 64 << 10;

fn chunk(seed: u64) -> Vec<u8> {
    let mut state = seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1;
    (0..SIZE)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            state as u8
        })
        .collect()
}

fn chunks(c: &mut Criterion) {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap();
    let dir = tempfile::tempdir().unwrap();
    let cache = Arc::new(ChunkCache::new(dir.path().to_path_buf(), 1 << 30).unwrap());
    let hashes: Vec<Hash> = (0..CHUNKS)
        .map(|seed| {
            let data = chunk(seed);
            let hash = Hash::of(&data);
            cache.insert(hash, &data).unwrap();
            hash
        })
        .collect();
    let objects = Objects::new(Arc::new(InMemory::new()));
    let listener = runtime.block_on(TcpListener::bind("127.0.0.1:0")).unwrap();
    let address = listener.local_addr().unwrap();
    let node = Node::new(cache.clone(), objects.clone(), None);
    runtime.spawn(serve(listener, node));
    let client = reqwest::Client::new();
    let mut group = c.benchmark_group("chunk");
    group.throughput(Throughput::Bytes(SIZE as u64));
    let mut next = hashes.iter().cycle();
    group.bench_function("cache-hit", |b| {
        b.iter(|| {
            let hash = *next.next().unwrap();
            runtime.block_on(cache.get(&objects, hash)).unwrap()
        })
    });
    group.bench_function("node-hit", |b| {
        b.iter(|| {
            let url = format!("http://{address}/chunks/{}", next.next().unwrap());
            runtime.block_on(async {
                let response = client.get(url).send().await.unwrap();
                response.error_for_status().unwrap().bytes().await.unwrap()
            })
        })
    });
    group.finish();
}

criterion_group!(benches, chunks);
criterion_main!(benches);
