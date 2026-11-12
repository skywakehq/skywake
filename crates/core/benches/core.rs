//! Microbenchmarks of hashing, tree objects and pack layout, through the public API.

use std::hint::black_box;
use std::sync::Arc;

use criterion::{Criterion, Throughput, criterion_group, criterion_main};
use object_store::memory::InMemory;
use skywake_core::{Chunk, Data, Entry, FILE_MODE, Hash, Objects, Packs, Tree, Trees};
use tokio::runtime::Runtime;

fn runtime() -> Runtime {
    tokio::runtime::Builder::new_current_thread()
        .build()
        .unwrap()
}

fn objects() -> Objects {
    Objects::new(Arc::new(InMemory::new()))
}

fn file(name: &str, size: u64) -> Entry {
    Entry::File {
        size,
        modified_ns: 1_700_000_000_000_000_000,
        mode: FILE_MODE,
        data: Data::Chunks(vec![Chunk {
            hash: Hash::of(name.as_bytes()),
            size: size as u32,
        }]),
    }
}

fn folder(prefix: &str, files: usize) -> Tree {
    (0..files)
        .map(|i| {
            let name = format!("{prefix}-{i:04}.rs");
            let entry = file(&name, 1000 + i as u64 * 37);
            (name, entry)
        })
        .collect()
}

fn hashing(c: &mut Criterion) {
    let mut group = c.benchmark_group("hash");
    for (name, size) in [("4KiB", 4 << 10), ("64KiB", 64 << 10), ("1MiB", 1 << 20)] {
        let bytes: Vec<u8> = (0..size).map(|i| (i * 31 % 251) as u8).collect();
        group.throughput(Throughput::Bytes(size as u64));
        group.bench_function(name, |b| b.iter(|| Hash::of(black_box(&bytes))));
    }
    group.finish();
}

fn trees(c: &mut Criterion) {
    let runtime = runtime();
    let objects = objects();
    let tree = folder("file", 1000);
    let hash = runtime.block_on(objects.put(&tree)).unwrap();
    let mut group = c.benchmark_group("tree");
    group.throughput(Throughput::Elements(tree.len() as u64));
    group.bench_function("address", |b| {
        b.iter(|| Objects::address(black_box(&tree)).unwrap())
    });
    group.bench_function("encode", |b| {
        b.iter(|| runtime.block_on(objects.put(black_box(&tree))).unwrap())
    });
    group.bench_function("decode", |b| {
        b.iter(|| runtime.block_on(objects.get::<Tree>(hash)).unwrap())
    });
    group.finish();
}

fn packs(c: &mut Criterion) {
    let trees = Trees::new(objects(), &Packs::default()).unwrap();
    let mut root = Tree::new();
    for top in 0..64 {
        let mut middle = Tree::new();
        for leaf in 0..64 {
            let tree = trees.add(folder(&format!("leaf{top}-{leaf}"), 8)).unwrap();
            middle.insert(format!("dir{leaf:02}"), Entry::Dir { tree });
        }
        let tree = trees.add(middle).unwrap();
        root.insert(format!("dir{top:02}"), Entry::Dir { tree });
    }
    let root = trees.add(root).unwrap();
    let runtime = runtime();
    let mut group = c.benchmark_group("pack");
    group.throughput(Throughput::Elements(1 + 64 + 64 * 64));
    group.bench_function("layout-new", |b| {
        b.iter(|| {
            let layout = runtime.block_on(trees.layout(root, &Packs::default()));
            layout.unwrap()
        })
    });
    group.finish();
}

criterion_group!(benches, hashing, trees, packs);
criterion_main!(benches);
