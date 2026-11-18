//! Append builds: delta pieces, crashes, racing builds and older formats.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use crate::format::legacy::V14;
use crate::format::{FORMAT, decode_version};
use crate::store::head;
use crate::testing::{Gate, brute_force, clustered, table};
use crate::vector::groups::Groups;
use crate::{Doc, Id, Index, MAIN, Metric, Options, Query, Schema};

const DIMS: usize = 16;

async fn created(gate: &Arc<Gate>) -> Index {
    let options = Options {
        cluster_rows: 50,
        ..Options::default()
    };
    let schema = Schema::new().vector("v", DIMS, Metric::Euclidean);
    Index::create_with(gate.clone(), schema, options)
        .await
        .unwrap()
}

fn docs(ids: impl IntoIterator<Item = u64>, seed: u64) -> Vec<Doc> {
    let ids: Vec<u64> = ids.into_iter().collect();
    let vectors = clustered(ids.len(), DIMS, seed);
    (ids.into_iter().zip(vectors))
        .map(|(id, v)| Doc::new(id).vector("v", v))
        .collect()
}

fn number(id: &Id) -> u64 {
    match id {
        Id::Num(n) => *n,
        other => panic!("{other:?}"),
    }
}

async fn matches_exact(index: &Index) {
    for vector in clustered(8, DIMS, 77) {
        let query = Query::new("v", vector, 10);
        let want: Vec<Id> = (brute_force(index, &query).await.into_iter())
            .map(|(id, _)| id)
            .collect();
        let got: Vec<Id> = (index.query(&query.probe(usize::MAX)).await.unwrap())
            .into_iter()
            .map(|hit| hit.id)
            .collect();
        assert_eq!(got, want);
    }
}

struct Shape {
    groups: u64,
    pieces: usize,
    rows: u64,
    most_pieces: usize,
    full_rows: u64,
}

async fn shape(index: &Index) -> Shape {
    let version = index.version().await.unwrap();
    let ann = version.ann.as_ref().unwrap();
    let clusters = &ann.columns["v"];
    let pieces = table(index, &version).await;
    let centroids = index.storage.centroids(clusters.centroids).await.unwrap();
    let groups = Groups::new(&centroids, DIMS);
    let most_pieces = (groups.members.iter())
        .map(|members| {
            members
                .iter()
                .filter(|&&e| pieces[e as usize].rows > 0)
                .count()
        })
        .max()
        .unwrap_or(0);
    assert_eq!(groups.len() as u64, clusters.groups);
    Shape {
        groups: clusters.groups,
        pieces: pieces.len(),
        rows: pieces.iter().map(|piece| piece.rows).sum(),
        most_pieces,
        full_rows: ann.full_rows,
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn appends_keep_every_row_and_find_what_an_exact_search_finds() {
    let gate = Gate::new();
    let index = created(&gate).await;
    index.upsert(docs(0..1000, 1)).await.unwrap();
    index.build().await.unwrap();
    let trained = shape(&index).await.full_rows;
    let mut live: HashSet<u64> = (0..1000).collect();
    let mut deltas = false;
    for round in 0..12u64 {
        let fresh = 1000 + 150 * round..1150 + 150 * round;
        let again = 30 * round..30 * round + 30;
        let gone: Vec<Id> = (500 + 10 * round..510 + 10 * round).map(Id::from).collect();
        index.upsert(docs(fresh.clone(), 10 + round)).await.unwrap();
        index
            .upsert(docs(again.clone(), 100 + round))
            .await
            .unwrap();
        index.delete(gone.clone()).await.unwrap();
        live.extend(fresh.chain(again));
        for id in &gone {
            live.remove(&number(id));
        }
        index.build().await.unwrap();

        let now = shape(&index).await;
        assert_eq!(now.full_rows, trained, "a full build ran in round {round}");
        assert_eq!(now.rows, live.len() as u64);
        assert_eq!(index.stats().await.unwrap().rows, live.len() as u64);
        assert!(
            now.most_pieces <= 12,
            "{} pieces in one cluster",
            now.most_pieces
        );
        deltas |= now.pieces as u64 > now.groups;
        matches_exact(&index).await;
    }
    assert!(deltas, "no build appended a delta piece");
    let mut found = 0;
    let queries = clustered(50, DIMS, 78);
    for vector in &queries {
        let query = Query::new("v", vector.clone(), 10);
        let truth: HashSet<Id> = (brute_force(&index, &query).await.into_iter())
            .map(|(id, _)| id)
            .collect();
        let hits = index.query(&query).await.unwrap();
        let ids: HashSet<&Id> = hits.iter().map(|hit| &hit.id).collect();
        assert_eq!(ids.len(), hits.len(), "an id came back twice");
        found += hits.iter().filter(|hit| truth.contains(&hit.id)).count();
    }
    let recall = found as f64 / (queries.len() * 10) as f64;
    assert!(recall >= 0.9, "recall@10 {recall}");
}

#[tokio::test(flavor = "multi_thread")]
async fn an_id_upserted_again_and_again_keeps_only_its_last_vector() {
    let gate = Gate::new();
    let index = created(&gate).await;
    index.upsert(docs(0..1000, 1)).await.unwrap();
    index.build().await.unwrap();
    let mut last = Vec::new();
    for round in 0..8u64 {
        let doc = docs([7], 200 + round).remove(0);
        last = doc.vectors["v"].clone();
        index.upsert(vec![doc]).await.unwrap();
        index
            .upsert(docs(1000 + 50 * round..1050 + 50 * round, 300 + round))
            .await
            .unwrap();
        index.build().await.unwrap();
    }
    let hits = index
        .query(&Query::new("v", last.clone(), 5))
        .await
        .unwrap();
    assert_eq!(hits[0].id, Id::from(7u64));
    assert_eq!(
        hits.iter().filter(|hit| hit.id == Id::from(7u64)).count(),
        1
    );
    let snapshot = index.snapshot().await.unwrap();
    let found = snapshot.get_many(&[Id::from(7u64)]).await.unwrap();
    assert_eq!(found[0].vectors["v"], last);
    assert_eq!(index.stats().await.unwrap().rows, 1400);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_crash_anywhere_in_an_append_leaves_a_readable_index() {
    let gate = Gate::new();
    let index = created(&gate).await;
    index.upsert(docs(0..1000, 1)).await.unwrap();
    index.build().await.unwrap();
    for round in 0..3u64 {
        index
            .upsert(docs(1000 + 200 * round..1200 + 200 * round, 5 + round))
            .await
            .unwrap();
        index
            .upsert(docs(40 * round..40 * round + 40, 50 + round))
            .await
            .unwrap();
        index
            .delete((900 + round..910 + round).map(Id::from).collect())
            .await
            .unwrap();
        let rows = index.stats().await.unwrap().rows;
        let mut crashes = 0;
        loop {
            gate.fail_after(crashes);
            let built = index.build().await;
            gate.fail_after(usize::MAX);
            let reopened = Index::open(gate.clone(), MAIN).await.unwrap();
            assert_eq!(reopened.stats().await.unwrap().rows, rows);
            matches_exact(&reopened).await;
            if built.is_ok() {
                break;
            }
            crashes += 1;
        }
        assert!(crashes > 3, "the append wrote only {crashes} objects");
        assert_eq!(index.stats().await.unwrap().unindexed_rows, 0);
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn racing_builds_and_writers_lose_nothing() {
    let gate = Gate::new();
    let index = created(&gate).await;
    index.upsert(docs(0..1000, 1)).await.unwrap();
    index.build().await.unwrap();
    let writer = {
        let index = index.clone();
        tokio::spawn(async move {
            let mut latest: HashMap<u64, Vec<f32>> = HashMap::new();
            for round in 0..20u64 {
                let mut batch = docs(1000 + 40 * round..1040 + 40 * round, 400 + round);
                batch.extend(docs(round * 13 % 900..round * 13 % 900 + 20, 500 + round));
                for doc in &batch {
                    latest.insert(number(&doc.id), doc.vectors["v"].clone());
                }
                index.upsert(batch).await.unwrap();
                tokio::task::yield_now().await;
            }
            latest
        })
    };
    let builders: Vec<_> = (0..3)
        .map(|_| {
            let index = index.clone();
            tokio::spawn(async move {
                for _ in 0..10 {
                    index.build().await.unwrap();
                }
            })
        })
        .collect();
    let latest = writer.await.unwrap();
    for builder in builders {
        builder.await.unwrap();
    }
    while index.stats().await.unwrap().unindexed_rows > 0 {
        index.build().await.unwrap();
    }
    assert_eq!(index.stats().await.unwrap().rows, 1800);
    assert_eq!(shape(&index).await.rows, 1800);
    let ids: Vec<Id> = latest.keys().map(|&id| Id::from(id)).collect();
    let found = index
        .snapshot()
        .await
        .unwrap()
        .get_many(&ids)
        .await
        .unwrap();
    assert_eq!(found.len(), ids.len());
    for doc in found {
        assert_eq!(doc.vectors["v"], latest[&number(&doc.id)]);
    }
    matches_exact(&index).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn indexes_without_pieces_keep_the_old_format_and_old_ones_still_open() {
    let gate = Gate::new();
    let index = created(&gate).await;
    index.upsert(docs(0..1000, 1)).await.unwrap();
    index.build().await.unwrap();
    let format = |index: Index| async move {
        let head = head::read(index.storage.store.as_ref(), MAIN)
            .await
            .unwrap()
            .unwrap();
        let raw = index.storage.raw_version(head.version).await.unwrap();
        (
            decode_version(&raw).unwrap(),
            postcard::from_bytes::<(u32,)>(&raw).unwrap().0,
        )
    };
    let (version, written) = format(index.clone()).await;
    assert!(written < FORMAT);
    let clusters = &version.ann.as_ref().unwrap().columns["v"];
    assert_eq!(
        (clusters.groups, clusters.calibrated),
        (clusters.table.len, clusters.table.len)
    );

    let old = postcard::to_stdvec(&V14::from(&version)).unwrap();
    let back = decode_version(&old).unwrap();
    assert!(back.ann == version.ann);

    index.upsert(docs(1000..1100, 2)).await.unwrap();
    index.build().await.unwrap();
    let now = shape(&index).await;
    assert!(now.pieces as u64 > now.groups);
    let (_, written) = format(index.clone()).await;
    assert_eq!(written, FORMAT);
    let reopened = Index::open(gate.clone(), MAIN).await.unwrap();
    matches_exact(&reopened).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn calibration_follows_the_clusters_splits_add_even_beside_a_racing_append() {
    let gate = Gate::new();
    let index = created(&gate).await;
    index.upsert(docs(0..1000, 1)).await.unwrap();
    index.build().await.unwrap();
    for round in 0..5u64 {
        index
            .upsert(docs(1000 + 500 * round..1500 + 500 * round, 20 + round))
            .await
            .unwrap();
        index.build().await.unwrap();
    }
    let version = index.version().await.unwrap();
    let before = version.ann.as_ref().unwrap().columns["v"].clone();
    assert!(
        super::calibrate::wanted(&version),
        "{} groups, calibrated at {}",
        before.groups,
        before.calibrated
    );

    index.upsert(docs(3500..3700, 40)).await.unwrap();
    let (calibrated, appended) = tokio::join!(index.recalibrate(), index.build());
    assert!(calibrated.unwrap());
    appended.unwrap();
    while index.stats().await.unwrap().unindexed_rows > 0 {
        index.build().await.unwrap();
    }
    let version = index.version().await.unwrap();
    let after = &version.ann.as_ref().unwrap().columns["v"];
    assert!(after.calibrated > before.calibrated);
    assert_ne!(after.calibration, before.calibration);
    assert!(!super::calibrate::wanted(&version) || after.groups > after.calibrated);
    assert_eq!(index.stats().await.unwrap().rows, 3700);
    assert_eq!(shape(&index).await.full_rows, 1000, "a full build ran");

    let mut found = 0;
    let queries = clustered(50, DIMS, 79);
    for vector in &queries {
        let query = Query::new("v", vector.clone(), 10);
        let truth: HashSet<Id> = (brute_force(&index, &query).await.into_iter())
            .map(|(id, _)| id)
            .collect();
        let hits = index.query(&query).await.unwrap();
        found += hits.iter().filter(|hit| truth.contains(&hit.id)).count();
    }
    let recall = found as f64 / (queries.len() * 10) as f64;
    assert!(recall >= 0.9, "recall@10 {recall}");
}
