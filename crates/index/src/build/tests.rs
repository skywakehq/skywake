//! Incremental and full builds, in memory and in fixed memory.

use std::sync::Arc;

use super::full::runs::{Runs, Sorter};
use crate::store::Storage;
use crate::testing::{Gate, built, clustered, table};
use crate::{Doc, Id, Index, Kind, Metric, Options, Query, Schema};

async fn budgeted(gate: &Arc<Gate>, build_bytes: usize, spill: bool) -> Index {
    let schema = (Schema::new().vector("v", 16, Metric::Euclidean)).attribute("n", Kind::Int);
    let options = Options {
        cluster_rows: 200,
        build_bytes,
        spill,
        ..Options::default()
    };
    Index::create_with(gate.clone(), schema, options)
        .await
        .unwrap()
}

async fn sizes(index: &Index) -> Vec<u64> {
    let version = index.version().await.unwrap();
    table(index, &version)
        .await
        .iter()
        .map(|c| c.rows)
        .collect()
}

async fn nearest(index: &Index, vector: Vec<f32>) -> Vec<Id> {
    let query = Query::new("v", vector, 10).probe(usize::MAX);
    (index.query(&query).await.unwrap().into_iter())
        .map(|hit| hit.id)
        .collect()
}

#[tokio::test(flavor = "multi_thread")]
async fn writes_crowding_one_cluster_split_it_without_a_full_build() {
    let gate = Gate::new();
    let index = built(&gate, 4000, 16, 4000).await;
    let before = index.version().await.unwrap().ann.clone().unwrap();
    let crowd: Vec<Doc> = (4000..5000u64)
        .map(|id| Doc::new(id).vector("v", vec![30.0 + id as f32 * 1e-3; 16]))
        .collect();
    index.upsert(crowd).await.unwrap();
    index.build().await.unwrap();

    let after = index.version().await.unwrap().ann.clone().unwrap();
    let (old, new) = (&before.columns["v"], &after.columns["v"]);
    assert_eq!(after.full_rows, before.full_rows, "a full build ran");
    assert!(new.table.len > old.table.len, "no cluster split");
    assert!(new.origin.is_some() && new.centroids != old.centroids);
    assert_eq!(sizes(&index).await.iter().sum::<u64>(), 5000);

    let near = Query::new("v", vec![34.5; 16], 5).probe(usize::MAX);
    assert_eq!(index.query(&near).await.unwrap()[0].id, Id::from(4500u64));
    let ids: Vec<Id> = (3990..4010u64).map(Id::from).collect();
    assert_eq!(
        index
            .snapshot()
            .await
            .unwrap()
            .get_many(&ids)
            .await
            .unwrap()
            .len(),
        20
    );

    let again: Vec<Doc> = (4000..4100u64)
        .map(|id| Doc::new(id).vector("v", vec![-30.0; 16]))
        .collect();
    index.upsert(again).await.unwrap();
    index.build().await.unwrap();
    assert_eq!(sizes(&index).await.iter().sum::<u64>(), 5000);
    assert_eq!(index.stats().await.unwrap().rows, 5000);
    let last = index.version().await.unwrap().ann.clone().unwrap();
    assert_eq!(last.full_rows, before.full_rows, "a full build ran");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_small_cluster_folds_away_to_make_room_for_a_split() {
    let gate = Gate::new();
    let index = built(&gate, 4000, 16, 4000).await;
    let version = index.version().await.unwrap();
    let before = version.ann.clone().unwrap();
    let clusters = table(&index, &version).await;
    let (place, smallest) = (clusters.iter().enumerate())
        .min_by_key(|(_, c)| c.rows)
        .unwrap();
    let (codes, _) = index.storage.codes_and_attrs(smallest, 16).await.unwrap();
    let (kept, gone) = codes.ids.split_at(2);
    index.delete(gone.to_vec()).await.unwrap();
    let centroids = (index.storage.centroids(before.columns["v"].centroids))
        .await
        .unwrap();
    let largest = (0..clusters.len())
        .max_by_key(|&c| clusters[c].rows)
        .unwrap();
    let at = &centroids[largest * 16..(largest + 1) * 16];
    let crowd: Vec<Doc> = (4000..5000u64)
        .map(|id| Doc::new(id).vector("v", at.iter().map(|x| x + id as f32 * 1e-6).collect()))
        .collect();
    index.upsert(crowd).await.unwrap();
    index.build().await.unwrap();

    let after = index.version().await.unwrap().ann.clone().unwrap();
    let (old, new) = (&before.columns["v"], &after.columns["v"]);
    assert_eq!(after.full_rows, before.full_rows, "a full build ran");
    assert_ne!(new.centroids, old.centroids);
    let live = 5000 - gone.len() as u64;
    let sizes = table(&index, &index.version().await.unwrap()).await;
    assert_eq!(sizes.iter().map(|c| c.rows).sum::<u64>(), live);
    assert!(sizes[place].rows > 2, "{} rows", sizes[place].rows);
    let (codes, _) = (index.storage.codes_and_attrs(&sizes[place], 16).await).unwrap();
    assert!(kept.iter().all(|id| !codes.ids.contains(id)));
    let snapshot = index.snapshot().await.unwrap();
    assert_eq!(snapshot.get_many(kept).await.unwrap().len(), 2);
    assert!(snapshot.get_many(gone).await.unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn an_incremental_build_rewrites_only_the_pages_it_touches() {
    let gate = Gate::new();
    let index = built(&gate, 20_020, 32, 20).await;
    let before = index.version().await.unwrap();
    assert_eq!(before.built.hashes.len(), 2);
    let rows_before = before.ann.as_ref().unwrap().rows.clone();
    assert_eq!(rows_before.len(), 21);
    let clusters_before = table(&index, &before).await;

    let more = clustered(3, 32, 9).into_iter().enumerate();
    let docs = more.map(|(i, v)| Doc::new(30_000 + i as u64).vector("v", v));
    index.upsert(docs.collect()).await.unwrap();
    index.delete(vec![Id::from(5)]).await.unwrap();
    index.build().await.unwrap();
    let after = index.version().await.unwrap();

    assert_eq!(after.built.len, before.built.len + 2);
    assert_eq!(after.built.hashes[0], before.built.hashes[0]);
    assert_ne!(after.built.hashes[1], before.built.hashes[1]);
    let rows_after = &after.ann.as_ref().unwrap().rows;
    let changed = rows_before.iter().zip(rows_after).filter(|(a, b)| a != b);
    assert!((1..=4).contains(&changed.count()));
    let clusters_after = table(&index, &after).await;
    let changed = (clusters_before.iter().zip(&clusters_after)).filter(|(a, b)| a != b);
    assert!((1..=4).contains(&changed.count()));
    assert!(index.storage.cache_used() > 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_build_too_big_for_memory_makes_the_same_clusters_either_way() {
    let docs: Vec<Doc> = (clustered(3000, 16, 1).into_iter().enumerate())
        .map(|(id, v)| Doc::new(id as u64).vector("v", v).attribute("n", id as i64))
        .collect();
    let mut found = Vec::new();
    for (budget, spill) in [(1 << 30, true), (8_000, true), (8_000, false)] {
        let index = budgeted(&Gate::new(), budget, spill).await;
        index.upsert(docs.clone()).await.unwrap();
        index.build().await.unwrap();
        let hits = nearest(&index, docs[7].vectors["v"].clone()).await;
        found.push((sizes(&index).await, hits));
    }
    assert_eq!(found[0].1[0], Id::from(7u64));
    assert_eq!(found[0], found[1]);
    assert_eq!(found[0], found[2]);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_sorter_holding_a_few_items_sorts_any_number_on_disk_or_in_the_bucket() {
    let storage = Storage::new(Gate::new(), 1 << 20, None, None);
    let items: Vec<(u64, String)> = (0..5000u64)
        .map(|i| (i.wrapping_mul(0x9e37_79b9_7f4a_7c15) % 997, format!("x{i}")))
        .collect();
    let mut expected = items.clone();
    expected.sort();
    for local in [true, false] {
        let runs = Runs::new(&storage, local).unwrap();
        let mut sorter = Sorter::new(&runs, 16);
        for item in items.clone() {
            sorter.push(item).await.unwrap();
        }
        let mut merged = sorter.finish().await.unwrap();
        let mut sorted = Vec::new();
        while let Some(item) = merged.next().await.unwrap() {
            sorted.push(item);
        }
        assert_eq!(sorted, expected);
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_full_build_in_tiny_memory_writes_the_same_index_as_one_in_memory() {
    let vectors = clustered(3000, 16, 2);
    let docs = |range: std::ops::Range<usize>, shift: f32| -> Vec<Doc> {
        range
            .map(|i| {
                let v = vectors[i].iter().map(|x| x + shift).collect();
                Doc::new(i as u64).vector("v", v).attribute("n", i as i64)
            })
            .collect()
    };
    let mut found = Vec::new();
    for (budget, spill) in [(1 << 30, true), (4_000, true), (4_000, false)] {
        let index = budgeted(&Gate::new(), budget, spill).await;
        for start in (0..3000).step_by(500) {
            index.upsert(docs(start..start + 500, 0.0)).await.unwrap();
        }
        index.upsert(docs(1000..1600, 0.5)).await.unwrap();
        index
            .delete((2000..2300u64).map(Id::from).collect())
            .await
            .unwrap();
        index.upsert(docs(2100..2150, 0.0)).await.unwrap();
        index.rebuild().await.unwrap();

        let version = index.version().await.unwrap();
        let ann = version.ann.clone().unwrap();
        assert_eq!(ann.live, 2750);
        let clusters = table(&index, &version).await;
        let hits = nearest(&index, vectors[1200].clone()).await;
        let ids: Vec<Id> = (1990..2160u64).map(Id::from).collect();
        let got = index
            .snapshot()
            .await
            .unwrap()
            .get_many(&ids)
            .await
            .unwrap();
        found.push((ann.rows, clusters, hits, got.len()));
    }
    assert_eq!(found[0].3, 10 + 50);
    assert_eq!(found[0], found[1]);
    assert_eq!(found[0], found[2]);
}
