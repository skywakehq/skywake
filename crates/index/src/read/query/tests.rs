//! Paged centroid directories give the same hits as the flat layout.

use std::collections::BTreeSet;
use std::sync::Arc;

use skywake_core::Hash;

use crate::build::directory;
use crate::format::Version;
use crate::format::directory::{Directory, Page};
use crate::store::{Written, head};
use crate::testing::{Gate, brute_force, table};
use crate::vector::ivf::Random;
use crate::{Doc, Filter, Hit, Index, Kind, Metric, Options, Query, Schema};

async fn branch(gate: &Arc<Gate>, index: &Index, name: &str, version: &Version) -> Index {
    let hash = index.storage.put_version(version).await.unwrap();
    head::create(gate.as_ref(), name, hash, &[]).await.unwrap();
    Index::open(gate.clone(), name).await.unwrap()
}

async fn paged(gate: &Arc<Gate>, index: &Index, per_page: usize) -> Arc<Directory> {
    let storage = &index.storage;
    let now = index.version().await.unwrap();
    branch(gate, index, "flat", &now).await;
    let mut written = Written::new();
    let mut ann = now.ann.clone().unwrap();
    let column = now.schema.vectors["v"];
    let clusters = ann.columns["v"].clone();
    let clusters = directory::write(storage, &column, clusters, per_page, &mut written)
        .await
        .unwrap();
    let hash = clusters.directory.unwrap();
    ann.columns.insert("v".into(), clusters);
    let next = Version {
        ann: Some(ann),
        ..(*now).clone()
    };
    assert!(
        storage
            .save("main", &written, |_| Some(next.clone()))
            .await
            .unwrap()
    );
    storage.get(hash).await.unwrap()
}

const DIMS: usize = 4;

fn spread(rows: usize, seed: u64) -> Vec<Vec<f32>> {
    let mut random = Random(seed);
    let mut unit = move || (random.next() >> 40) as f32 / (1u64 << 24) as f32;
    (0..rows)
        .map(|_| (0..DIMS).map(|_| 100.0 * unit()).collect())
        .collect()
}

async fn index(gate: &Arc<Gate>, rows: usize) -> Index {
    let schema = (Schema::new().vector("v", DIMS, Metric::Euclidean))
        .attribute("tag", Kind::Int)
        .filter_index("tag");
    let options = Options {
        cluster_rows: 100,
        ..Options::default()
    };
    let index = Index::create_with(gate.clone(), schema, options)
        .await
        .unwrap();
    let docs: Vec<Doc> = (spread(rows, 1).into_iter().enumerate())
        .map(|(id, v)| {
            Doc::new(id as u64)
                .vector("v", v)
                .attribute("tag", id as i64 % 100)
        })
        .collect();
    index.upsert(docs).await.unwrap();
    index.build().await.unwrap();
    index
}

fn queries() -> Vec<Query> {
    let mut all = Vec::new();
    for (i, vector) in spread(10, 77).into_iter().enumerate() {
        let query = Query::new("v", vector, 10);
        all.push(match i % 5 {
            0 => query,
            1 => query.recall(1.0),
            2 => query.recall(0.8),
            3 => query.probe(3),
            _ => Query {
                filter: Some(Filter::eq("tag", 7i64)),
                ..query
            },
        });
    }
    all
}

fn same(a: &[Hit], b: &[Hit]) -> bool {
    a.len() == b.len()
        && a.iter()
            .zip(b)
            .all(|(a, b)| a.id == b.id && (a.distance - b.distance).abs() <= 1e-4)
}

#[tokio::test(flavor = "multi_thread")]
async fn a_paged_directory_reads_a_few_pages_and_finds_the_same_hits() {
    let gate = Gate::new();
    let index = index(&gate, 20_000).await;
    let before = index.version().await.unwrap();
    let clusters = &before.ann.as_ref().unwrap().columns["v"];
    let directory = paged(&gate, &index, 4).await;
    assert!(directory.pages.len() as u64 >= clusters.table.len / 4);
    let pages: BTreeSet<String> = (directory.pages.iter())
        .map(|hash| format!("chunks/{hash}"))
        .collect();
    let mut flat_only: BTreeSet<String> = (clusters.table.hashes.iter())
        .map(|hash| format!("chunks/{hash}"))
        .collect();
    flat_only.insert(format!("objects/{}", clusters.centroids));
    let flat = Index::open(gate.clone(), "flat").await.unwrap();

    for query in queries() {
        gate.reads.lock().unwrap().clear();
        let cold = Index::open(gate.clone(), "main").await.unwrap();
        let got = cold.query(&query).await.unwrap();
        let reads = std::mem::take(&mut *gate.reads.lock().unwrap());
        assert!(!reads.iter().any(|(path, _)| flat_only.contains(path)));
        let read = reads
            .iter()
            .filter(|(path, _)| pages.contains(path))
            .count();
        let most = match (query.probe, query.recall, &query.filter) {
            (Some(_), _, _) => pages.len() / 6,
            (None, Some(1.0), _) | (None, _, Some(_)) => pages.len(),
            (None, _, None) => pages.len() / 3,
        };
        assert!(read <= most, "{read} of {} pages", pages.len());
        let want = flat.query(&query).await.unwrap();
        assert!(same(&got, &want), "{got:?}\n{want:?}");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn an_incremental_build_keeps_the_directory_in_step() {
    let gate = Gate::new();
    let index = index(&gate, 20_000).await;
    let old = paged(&gate, &index, 4).await;
    let docs: Vec<Doc> = (spread(3000, 5).into_iter().enumerate())
        .map(|(i, v)| Doc::new(100_000 + i as u64).vector("v", v))
        .chain(
            (spread(500, 6).into_iter().enumerate())
                .map(|(id, v)| Doc::new(id as u64).vector("v", v)),
        )
        .collect();
    index.upsert(docs).await.unwrap();
    index.build().await.unwrap();
    let now = index.version().await.unwrap();
    let clusters = &now.ann.as_ref().unwrap().columns["v"];
    let hash: Hash = clusters.directory.expect("the directory was dropped");
    let new: Arc<Directory> = index.storage.get(hash).await.unwrap();
    assert_ne!(new.pages, old.pages);
    let table = table(&index, &now).await;
    let mut seen = vec![0; table.len()];
    for hash in &new.pages {
        let page: Arc<Page> = index.storage.get(*hash).await.unwrap();
        for (i, &c) in page.clusters.iter().enumerate() {
            seen[c as usize] += 1;
            assert!(page.table[i] == table[c as usize], "stale entry for {c}");
        }
    }
    assert!(seen.iter().all(|&n| n == 1), "{seen:?}");
    assert_eq!(new.slots.len, clusters.table.len);
    let mut plain = (*now).clone();
    let ann = plain.ann.as_mut().unwrap();
    ann.columns.get_mut("v").unwrap().directory = None;
    let plain = branch(&gate, &index, "plain", &plain).await;
    for query in queries() {
        let query = Query {
            probe: None,
            ..query.recall(1.0)
        };
        let got = index.query(&query).await.unwrap();
        let flat = plain.query(&query).await.unwrap();
        assert!(same(&got, &flat), "paged and flat differ");
        let want = brute_force(&index, &query).await;
        let got: Vec<_> = got.iter().map(|h| h.id.clone()).collect();
        let want: Vec<_> = want.into_iter().map(|(id, _)| id).collect();
        assert_eq!(got, want);
    }
}
