//! The index end to end, in a local folder.

use std::collections::HashSet;
use std::sync::Arc;

use futures::StreamExt;
use object_store::memory::InMemory;
use object_store::path::Path;
use object_store::{ObjectStore, ObjectStoreExt};
use std::time::Duration;

use skywake_index::{
    BuildPolicy, Doc, Error, Filter, Hit, Id, Index, Kind, Metric, Options, Query, Schema, Stats,
    Value, gc,
};
use tempfile::TempDir;

fn folder() -> (TempDir, Arc<dyn ObjectStore>) {
    let dir = tempfile::tempdir().unwrap();
    let store = skywake_core::open_store(dir.path().to_str().unwrap()).unwrap();
    (dir, store)
}

fn schema(metric: Metric) -> Schema {
    Schema::new()
        .vector("v", 2, metric)
        .attribute("lang", Kind::String)
        .attribute("stars", Kind::Number)
        .attribute("public", Kind::Bool)
        .attribute("tags", Kind::Strings)
}

fn doc(id: u64, x: f32, y: f32) -> Doc {
    Doc::new(id).vector("v", vec![x, y])
}

fn ids(hits: &[Hit]) -> Vec<Id> {
    hits.iter().map(|hit| hit.id.clone()).collect()
}

fn nums(ids: &[u64]) -> Vec<Id> {
    ids.iter().map(|&id| Id::Num(id)).collect()
}

async fn near(index: &Index, x: f32, y: f32, k: usize) -> Vec<Id> {
    ids(&index.query(&Query::new("v", vec![x, y], k)).await.unwrap())
}

/// A small random number generator, so tests need no new dependency.
struct Random(u64);

impl Random {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    fn unit(&mut self) -> f32 {
        (self.next() >> 40) as f32 / (1u64 << 24) as f32
    }

    /// Normal, by Box-Muller.
    fn normal(&mut self) -> f32 {
        let u = self.unit().max(1e-7);
        (-2.0 * u.ln()).sqrt() * (std::f32::consts::TAU * self.unit()).cos()
    }

    fn vector(&mut self, dims: usize) -> Vec<f32> {
        (0..dims).map(|_| self.normal()).collect()
    }
}

/// Points around `centers` random centers, like embeddings of a few
/// topics.
fn clustered(rows: usize, dims: usize, centers: usize, seed: u64) -> Vec<Vec<f32>> {
    let mut random = Random(42);
    let centers: Vec<Vec<f32>> = (0..centers).map(|_| random.vector(dims)).collect();
    let mut random = Random(seed);
    (0..rows)
        .map(|_| {
            let center = &centers[random.next() as usize % centers.len()];
            center.iter().map(|x| x + 1.5 * random.normal()).collect()
        })
        .collect()
}

#[tokio::test]
async fn upsert_then_query_finds_the_nearest() {
    let (_dir, store) = folder();
    let index = Index::create(store, schema(Metric::Euclidean))
        .await
        .unwrap();
    index
        .upsert(vec![doc(1, 0.0, 0.0), doc(2, 5.0, 5.0), doc(3, 1.0, 0.0)])
        .await
        .unwrap();
    assert_eq!(near(&index, 0.9, 0.0, 2).await, nums(&[3, 1]));
    let hits = index
        .query(&Query::new("v", vec![0.0, 0.0], 10))
        .await
        .unwrap();
    assert_eq!(ids(&hits), nums(&[1, 3, 2]));
    assert_eq!(hits[1].distance, 1.0);
}

#[tokio::test]
async fn string_and_number_ids() {
    let (_dir, store) = folder();
    let index = Index::create(store, schema(Metric::Euclidean))
        .await
        .unwrap();
    index
        .upsert(vec![
            Doc::new("a").vector("v", vec![0.0, 0.0]),
            Doc::new(7).vector("v", vec![1.0, 0.0]),
        ])
        .await
        .unwrap();
    assert_eq!(
        near(&index, 0.0, 0.0, 2).await,
        [Id::from("a"), Id::from(7)]
    );
}

#[tokio::test]
async fn the_newest_write_of_an_id_wins() {
    let (_dir, store) = folder();
    let index = Index::create(store, schema(Metric::Euclidean))
        .await
        .unwrap();
    index
        .upsert(vec![
            doc(1, 0.0, 0.0).attribute("lang", "go"),
            doc(2, 3.0, 0.0),
        ])
        .await
        .unwrap();
    // Moved far away, in a later batch, and twice in one batch.
    index
        .upsert(vec![
            doc(1, 9.0, 9.0).attribute("lang", "c"),
            doc(1, 10.0, 0.0).attribute("lang", "rust"),
        ])
        .await
        .unwrap();
    let hits = index
        .query(&Query::new("v", vec![0.0, 0.0], 10).include(&["lang"]))
        .await
        .unwrap();
    assert_eq!(ids(&hits), nums(&[2, 1]));
    assert_eq!(hits[1].attributes["lang"], Value::from("rust"));
}

#[tokio::test]
async fn deletes_hide_rows_until_written_again() {
    let (_dir, store) = folder();
    let index = Index::create(store, schema(Metric::Euclidean))
        .await
        .unwrap();
    index
        .upsert(vec![doc(1, 0.0, 0.0), doc(2, 1.0, 0.0)])
        .await
        .unwrap();
    index.delete(vec![Id::from(1), Id::from(99)]).await.unwrap();
    assert_eq!(near(&index, 0.0, 0.0, 10).await, nums(&[2]));
    index.upsert(vec![doc(1, 0.0, 0.0)]).await.unwrap();
    assert_eq!(near(&index, 0.0, 0.0, 10).await, nums(&[1, 2]));
}

#[tokio::test]
async fn filters() {
    let (_dir, store) = folder();
    let index = Index::create(store, schema(Metric::Euclidean))
        .await
        .unwrap();
    let tags = |list: &[&str]| Value::Strings(list.iter().map(|t| t.to_string()).collect());
    index
        .upsert(vec![
            doc(1, 0.0, 0.0)
                .attribute("lang", "rust")
                .attribute("stars", 10.0)
                .attribute("public", true)
                .attribute("tags", tags(&["db", "search"])),
            doc(2, 1.0, 0.0)
                .attribute("lang", "go")
                .attribute("stars", 50.0)
                .attribute("public", false)
                .attribute("tags", tags(&["web"])),
            doc(3, 2.0, 0.0)
                .attribute("lang", "rust")
                .attribute("stars", 100.0)
                .attribute("public", true),
            // No attributes at all.
            doc(4, 3.0, 0.0),
        ])
        .await
        .unwrap();
    let find = async |filter: Filter| {
        let query = Query::new("v", vec![0.0, 0.0], 10).filter(filter);
        ids(&index.query(&query).await.unwrap())
    };
    assert_eq!(find(Filter::eq("lang", "rust")).await, nums(&[1, 3]));
    assert_eq!(find(Filter::eq("public", false)).await, nums(&[2]));
    assert_eq!(find(Filter::eq("tags", "web")).await, nums(&[2]));
    assert_eq!(
        find(Filter::is_in("lang", vec!["go".into(), "c".into()])).await,
        nums(&[2])
    );
    assert_eq!(
        find(Filter::is_in("tags", vec!["search".into(), "web".into()])).await,
        nums(&[1, 2])
    );
    assert_eq!(find(Filter::lt("stars", 50.0)).await, nums(&[1]));
    assert_eq!(find(Filter::lte("stars", 50.0)).await, nums(&[1, 2]));
    assert_eq!(find(Filter::gt("stars", 50.0)).await, nums(&[3]));
    assert_eq!(find(Filter::gte("stars", 50.0)).await, nums(&[2, 3]));
    // A string is never compared with a number, nor a name the schema lacks.
    for filter in [Filter::gt("lang", 0.0), Filter::eq("nope", 1.0)] {
        let query = Query::new("v", vec![0.0, 0.0], 10).filter(filter);
        assert!(matches!(index.query(&query).await, Err(Error::Invalid(_))));
    }
    assert_eq!(
        find(Filter::And(vec![
            Filter::eq("lang", "rust"),
            Filter::gt("stars", 20.0)
        ]))
        .await,
        nums(&[3])
    );
    assert_eq!(
        find(Filter::Or(vec![
            Filter::eq("lang", "go"),
            Filter::gte("stars", 100.0)
        ]))
        .await,
        nums(&[2, 3])
    );
    // A document without the attribute passes a negated filter.
    assert_eq!(
        find(Filter::eq("lang", "rust").negate()).await,
        nums(&[2, 4])
    );
}

#[tokio::test]
async fn include_returns_only_the_named_attributes() {
    let (_dir, store) = folder();
    let index = Index::create(store, schema(Metric::Euclidean))
        .await
        .unwrap();
    index
        .upsert(vec![
            doc(1, 0.0, 0.0)
                .attribute("lang", "rust")
                .attribute("stars", 3.0),
        ])
        .await
        .unwrap();
    let query = Query::new("v", vec![0.0, 0.0], 1).include(&["stars", "public"]);
    let hits = index.query(&query).await.unwrap();
    assert_eq!(hits[0].attributes.len(), 1);
    assert_eq!(hits[0].attributes["stars"], Value::Number(3.0));
    let none = index
        .query(&Query::new("v", vec![0.0, 0.0], 1))
        .await
        .unwrap();
    assert!(none[0].attributes.is_empty());
}

#[tokio::test]
async fn bad_input_is_refused() {
    let (_dir, store) = folder();
    let index = Index::create(store.clone(), schema(Metric::Euclidean))
        .await
        .unwrap();
    let refused = async |docs: Vec<Doc>| matches!(index.upsert(docs).await, Err(Error::Invalid(_)));
    assert!(refused(vec![Doc::new(1).vector("v", vec![1.0])]).await);
    assert!(refused(vec![Doc::new(1)]).await);
    assert!(refused(vec![doc(1, 0.0, 0.0).vector("w", vec![1.0])]).await);
    assert!(refused(vec![doc(1, 0.0, 0.0).attribute("color", "red")]).await);
    assert!(refused(vec![doc(1, 0.0, 0.0).attribute("stars", "many")]).await);
    let query = async |q: Query| matches!(index.query(&q).await, Err(Error::Invalid(_)));
    assert!(query(Query::new("v", vec![1.0], 1)).await);
    assert!(query(Query::new("w", vec![1.0, 0.0], 1)).await);
    assert!(query(Query::new("v", vec![1.0, 0.0], 1).include(&["color"])).await);
    // Nothing was written.
    assert!(near(&index, 0.0, 0.0, 10).await.is_empty());

    assert!(matches!(
        Index::create(store.clone(), schema(Metric::Euclidean)).await,
        Err(Error::BranchExists(_))
    ));
    assert!(matches!(
        Index::open(store.clone(), "nope").await,
        Err(Error::BranchNotFound(_))
    ));
    assert!(matches!(
        Index::open(store, "../x").await,
        Err(Error::InvalidBranchName(_))
    ));
}

#[tokio::test]
async fn a_reopened_index_sees_every_write() {
    let (_dir, store) = folder();
    let index = Index::create(store.clone(), schema(Metric::Euclidean))
        .await
        .unwrap();
    index
        .upsert(vec![doc(1, 0.0, 0.0), doc(2, 1.0, 1.0)])
        .await
        .unwrap();
    let again = Index::open(store, "main").await.unwrap();
    assert_eq!(again.schema().await.unwrap(), schema(Metric::Euclidean));
    assert_eq!(near(&again, 0.0, 0.0, 10).await, nums(&[1, 2]));
}

#[tokio::test]
async fn writes_on_a_fork_and_on_main_do_not_see_each_other() {
    let (_dir, store) = folder();
    let main = Index::create(store.clone(), schema(Metric::Euclidean))
        .await
        .unwrap();
    main.upsert(vec![doc(1, 0.0, 0.0), doc(2, 1.0, 0.0)])
        .await
        .unwrap();
    let fork = main.fork("agents/fix-1").await.unwrap();
    assert!(matches!(
        main.fork("agents/fix-1").await,
        Err(Error::BranchExists(_))
    ));
    fork.upsert(vec![doc(3, 0.5, 0.0)]).await.unwrap();
    fork.delete(vec![Id::from(1)]).await.unwrap();
    main.upsert(vec![doc(4, 0.2, 0.0)]).await.unwrap();

    assert_eq!(near(&main, 0.0, 0.0, 10).await, nums(&[1, 4, 2]));
    assert_eq!(near(&fork, 0.0, 0.0, 10).await, nums(&[3, 2]));
    let reopened = Index::open(store, "agents/fix-1").await.unwrap();
    assert_eq!(near(&reopened, 0.0, 0.0, 10).await, nums(&[3, 2]));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_writers_all_land() {
    let (_dir, store) = folder();
    Index::create(store.clone(), schema(Metric::Euclidean))
        .await
        .unwrap();
    // Each writer opens its own handle, as separate processes would.
    let writers: Vec<_> = (0..8u64)
        .map(|w| {
            let store = store.clone();
            tokio::spawn(async move {
                let index = Index::open(store, "main").await.unwrap();
                for i in 0..5u64 {
                    let id = w * 100 + i;
                    index.upsert(vec![doc(id, id as f32, 0.0)]).await.unwrap();
                }
            })
        })
        .collect();
    for writer in writers {
        writer.await.unwrap();
    }
    let index = Index::open(store, "main").await.unwrap();
    let found: HashSet<Id> = near(&index, 0.0, 0.0, 1000).await.into_iter().collect();
    let expected: HashSet<Id> = (0..8u64)
        .flat_map(|w| (0..5u64).map(move |i| Id::from(w * 100 + i)))
        .collect();
    assert_eq!(found, expected);
}

#[tokio::test]
async fn a_large_batch_is_split_into_several_segments() {
    let store: Arc<dyn ObjectStore> = Arc::new(InMemory::new());
    let schema = Schema::new().vector("v", 768, Metric::Dot);
    let index = Index::create(store.clone(), schema).await.unwrap();
    let mut random = Random(7);
    let docs: Vec<Doc> = (0..3000u64)
        .map(|id| Doc::new(id).vector("v", random.vector(768)))
        .collect();
    let probe = docs[2999].vectors["v"].clone();
    index.upsert(docs).await.unwrap();
    let count = store.list(Some(&"chunks".into())).count().await;
    assert!(count >= 3, "{count} segments");
    let hits = index.query(&Query::new("v", probe, 3000)).await.unwrap();
    assert_eq!(hits.len(), 3000);
    assert_eq!(hits[0].id, Id::from(2999));
}

/// Clustered data, some of it written after the build, overwritten and
/// deleted, so a query reads clusters and a tail together. Also returns
/// a fork made before the build, with the same writes and no clusters.
async fn built(metric: Metric, rows: usize, dims: usize) -> (TempDir, Index, Index) {
    built_with(small_clusters(), metric, rows, dims).await
}

/// Clusters of about 40 rows, so the small test indexes have many.
fn small_clusters() -> Options {
    Options {
        cluster_rows: 40,
        ..Options::default()
    }
}

async fn built_with(
    options: Options,
    metric: Metric,
    rows: usize,
    dims: usize,
) -> (TempDir, Index, Index) {
    let (dir, store) = folder();
    let schema = Schema::new()
        .vector("v", dims, metric)
        .attribute("even", Kind::Bool)
        .attribute("n", Kind::Number);
    let index = Index::create_with(store, schema, options).await.unwrap();
    let vectors = clustered(rows, dims, 50, 1);
    let docs: Vec<Doc> = vectors
        .iter()
        .enumerate()
        .map(|(id, v)| {
            Doc::new(id as u64)
                .vector("v", v.clone())
                .attribute("even", id % 2 == 0)
                .attribute("n", id as f64)
        })
        .collect();
    let (first, later) = docs.split_at(rows * 3 / 4);
    for batch in first.chunks(500) {
        index.upsert(batch.to_vec()).await.unwrap();
    }
    let exact = index.fork("exact").await.unwrap();
    index.build().await.unwrap();
    for branch in [&index, &exact] {
        branch.upsert(later.to_vec()).await.unwrap();
        // Overwrite and delete rows that are inside the clusters.
        let moved = Doc::new(0u64)
            .vector("v", vectors[1].clone())
            .attribute("even", false);
        branch.upsert(vec![moved]).await.unwrap();
        branch
            .delete((1..20u64).map(Id::from).collect())
            .await
            .unwrap();
    }
    (dir, index, exact)
}

#[tokio::test]
async fn a_full_probe_after_build_matches_exact_search() {
    for metric in [Metric::Cosine, Metric::Euclidean, Metric::Dot] {
        let (_dir, index, exact) = built(metric, 2000, 16).await;
        matches_exact(&index, &exact).await;
    }
}

/// With a memory budget of a few rows, a build writes one cluster per
/// pass over the segments, and must find the same rows.
#[tokio::test]
async fn a_build_in_many_small_passes_matches_exact_search() {
    let options = Options {
        build_bytes: 4 << 10,
        ..small_clusters()
    };
    let (_dir, index, exact) = built_with(options, Metric::Cosine, 2000, 16).await;
    matches_exact(&index, &exact).await;
    // Then the tail too goes into the clusters.
    index.build().await.unwrap();
    assert_eq!(index.stats().await.unwrap().unindexed_rows, 0);
    matches_exact(&index, &exact).await;
}

async fn matches_exact(index: &Index, exact: &Index) {
    let dims = index.schema().await.unwrap().vectors["v"].dims;
    let filter = Filter::eq("even", true);
    for vector in clustered(30, dims, 50, 2) {
        {
            let all = Query::new("v", vector.clone(), 10).include(&["even"]);
            let expected = exact.query(&all).await.unwrap();
            assert_eq!(expected.len(), 10);
            assert!(!ids(&expected).contains(&Id::from(1)));
            assert_eq!(
                index.query(&all.clone().probe(usize::MAX)).await.unwrap(),
                expected
            );

            let filtered = all.filter(filter.clone());
            let expected = exact.query(&filtered).await.unwrap();
            assert!(
                expected
                    .iter()
                    .all(|hit| hit.attributes["even"] == Value::Bool(true))
            );
            assert_eq!(
                index.query(&filtered.probe(usize::MAX)).await.unwrap(),
                expected
            );

            // Eight rows pass (20 to 27; `built` deleted 1 to 19), fewer
            // than ten, so the query falls back to reading every cluster.
            let rare = Query::new("v", vector.clone(), 10).filter(Filter::lt("n", 28.0));
            let expected = exact.query(&rare).await.unwrap();
            assert_eq!(expected.len(), 8);
            assert_eq!(index.query(&rare.probe(1)).await.unwrap(), expected);
        }
    }
}

/// How many objects the store holds under `prefix`.
async fn count(store: &Arc<dyn ObjectStore>, prefix: &str) -> usize {
    store.list(Some(&prefix.into())).count().await
}

#[tokio::test]
async fn an_incremental_build_rewrites_only_the_clusters_it_touches() {
    let (_dir, store) = folder();
    let schema = Schema::new()
        .vector("v", 16, Metric::Cosine)
        .attribute("n", Kind::Number);
    let index = Index::create_with(store.clone(), schema, small_clusters())
        .await
        .unwrap();
    let vectors = clustered(2000, 16, 50, 1);
    let docs: Vec<Doc> = (vectors.iter().enumerate())
        .map(|(id, v)| {
            Doc::new(id as u64)
                .vector("v", v.clone())
                .attribute("n", id as f64)
        })
        .collect();
    index.upsert(docs[..1990].to_vec()).await.unwrap();
    let exact = index.fork("exact").await.unwrap();
    index.build().await.unwrap();
    let clusters = index.stats().await.unwrap().clusters;
    assert_eq!(clusters, 50);

    // Three new rows, one moved and one deleted: six clusters at most
    // change.
    for branch in [&index, &exact] {
        branch.upsert(docs[1990..1993].to_vec()).await.unwrap();
        let moved = Doc::new(5u64).vector("v", vectors[1999].clone());
        branch.upsert(vec![moved]).await.unwrap();
        branch.delete(vec![Id::from(7)]).await.unwrap();
    }
    let (clusters_before, pages_before) =
        (count(&store, "blobs").await, count(&store, "chunks").await);
    index.build().await.unwrap();
    let clusters_written = count(&store, "blobs").await - clusters_before;
    let pages_written = count(&store, "chunks").await - pages_before;
    // Six clusters at most, against 50 for a full build; and a page each
    // of the cluster table, the segment list and the row map (2 pages).
    assert!(clusters_written <= 6, "{clusters_written} clusters written");
    assert!(pages_written <= 4, "{pages_written} pages written");

    let stats = index.stats().await.unwrap();
    assert_eq!(stats.clusters, clusters);
    assert_eq!(
        (stats.rows, stats.unindexed_rows, stats.deleted_rows),
        (1992, 0, 0)
    );
    for vector in clustered(30, 16, 50, 2) {
        let query = Query::new("v", vector, 10);
        let expected = exact.query(&query).await.unwrap();
        assert_eq!(
            index.query(&query.probe(usize::MAX)).await.unwrap(),
            expected
        );
    }
}

#[tokio::test]
async fn an_incremental_build_keeps_recall() {
    let (_dir, index, exact) = built(Metric::Cosine, 6000, 64).await;
    // `built` wrote a quarter of the rows after the first build; this
    // build puts them in the clusters there are.
    let clusters = index.stats().await.unwrap().clusters;
    index.build().await.unwrap();
    let stats = index.stats().await.unwrap();
    assert_eq!(stats.clusters, clusters);
    assert_eq!(stats.unindexed_rows, 0);
    let queries = clustered(100, 64, 50, 3);
    let mut found = 0;
    for vector in &queries {
        let query = Query::new("v", vector.clone(), 10);
        let truth: HashSet<Id> = ids(&exact.query(&query).await.unwrap())
            .into_iter()
            .collect();
        let hits = index.query(&query).await.unwrap();
        found += hits.iter().filter(|hit| truth.contains(&hit.id)).count();
    }
    let recall = found as f64 / (queries.len() * 10) as f64;
    assert!(recall >= 0.95, "recall@10 {recall}");
    matches_exact(&index, &exact).await;
}

#[tokio::test]
async fn many_deletes_make_the_next_build_a_full_one() {
    let (_dir, store) = folder();
    let schema = Schema::new().vector("v", 16, Metric::Euclidean);
    let index = Index::create_with(store, schema, small_clusters())
        .await
        .unwrap();
    let docs: Vec<Doc> = (clustered(2000, 16, 50, 1).into_iter().enumerate())
        .map(|(id, v)| Doc::new(id as u64).vector("v", v))
        .collect();
    index.upsert(docs).await.unwrap();
    index.build().await.unwrap();
    assert_eq!(index.stats().await.unwrap().clusters, 50);
    // A third of the rows go: more than a fifth.
    index
        .delete((0..700u64).map(Id::from).collect())
        .await
        .unwrap();
    index.build().await.unwrap();
    // Clustered anew for 1300 rows.
    let stats = index.stats().await.unwrap();
    assert_eq!((stats.rows, stats.clusters), (1300, 33));
}

#[tokio::test]
async fn the_background_builder_builds_once_the_tail_is_long_enough() {
    let (_dir, store) = folder();
    let index = Index::create(store, schema(Metric::Euclidean))
        .await
        .unwrap();
    let mut builder = index.spawn_builder(BuildPolicy {
        tail_rows: 100,
        tail_bytes: u64::MAX,
        interval: Duration::from_secs(3600),
    });
    let docs = |ids: std::ops::Range<u64>| ids.map(|id| doc(id, id as f32, 0.0)).collect();
    index.upsert(docs(0..60)).await.unwrap();
    // Below the threshold, so it cannot have built.
    assert_eq!(builder.builds(), 0);
    index.upsert(docs(60..120)).await.unwrap();
    tokio::time::timeout(Duration::from_secs(60), builder.wait_for(1))
        .await
        .expect("the builder did not build");
    let stats = index.stats().await.unwrap();
    assert_eq!((stats.indexed_rows, stats.unindexed_rows), (120, 0));
    assert_eq!(near(&index, 0.0, 0.0, 3).await, nums(&[0, 1, 2]));
}

#[tokio::test]
async fn stats_count_rows_the_tail_and_clusters() {
    let (_dir, store) = folder();
    let index = Index::create(store, schema(Metric::Euclidean))
        .await
        .unwrap();
    assert_eq!(index.stats().await.unwrap(), Stats::default());
    let docs = (0..10u64).map(|id| doc(id, id as f32, 0.0)).collect();
    index.upsert(docs).await.unwrap();
    let stats = index.stats().await.unwrap();
    assert_eq!(
        (
            stats.rows,
            stats.segments,
            stats.indexed_rows,
            stats.unindexed_rows
        ),
        (10, 1, 0, 10)
    );
    index.build().await.unwrap();
    let stats = index.stats().await.unwrap();
    assert_eq!(
        (
            stats.rows,
            stats.indexed_rows,
            stats.unindexed_rows,
            stats.clusters
        ),
        (10, 10, 0, 1)
    );
    index.upsert(vec![doc(0, 5.0, 5.0)]).await.unwrap();
    index.delete(vec![Id::from(1), Id::from(99)]).await.unwrap();
    let stats = index.stats().await.unwrap();
    assert_eq!(
        (
            stats.rows,
            stats.deleted_rows,
            stats.indexed_rows,
            stats.unindexed_rows
        ),
        (9, 2, 8, 1)
    );
    assert_eq!(stats.segments, 3);
    assert!(stats.bytes > 0);
}

#[tokio::test]
async fn branches_are_listed_and_deleted() {
    let (_dir, store) = folder();
    let index = Index::create(store.clone(), schema(Metric::Euclidean))
        .await
        .unwrap();
    index.fork("agents/a").await.unwrap();
    index.fork("b").await.unwrap();
    assert_eq!(
        index.list_branches().await.unwrap(),
        ["agents/a", "b", "main"]
    );
    index.delete_branch("b").await.unwrap();
    assert_eq!(index.list_branches().await.unwrap(), ["agents/a", "main"]);
    assert!(matches!(
        Index::open(store, "b").await,
        Err(Error::BranchNotFound(_))
    ));
}

#[tokio::test]
async fn collection_keeps_what_branches_use_and_deletes_the_rest() {
    let (_dir, store) = folder();
    let schema = Schema::new().vector("v", 16, Metric::Cosine);
    let index = Index::create(store.clone(), schema).await.unwrap();
    let exact = {
        let docs: Vec<Doc> = (clustered(1000, 16, 20, 1).into_iter().enumerate())
            .map(|(id, v)| Doc::new(id as u64).vector("v", v))
            .collect();
        index.upsert(docs[..800].to_vec()).await.unwrap();
        let exact = index.fork("exact").await.unwrap();
        index.build().await.unwrap();
        index.upsert(docs[800..].to_vec()).await.unwrap();
        index.build().await.unwrap();
        index.rebuild().await.unwrap();
        exact.upsert(docs[800..].to_vec()).await.unwrap();
        exact
    };
    // Garbage: blobs nothing names, and a file that is not the index's.
    let junk = |n: u8| skywake_core::Hash::of(&[n]).to_string();
    for (path, byte) in [
        (format!("chunks/{}", junk(1)), 1u8),
        (format!("objects/{}", junk(2)), 2),
        ("chunks/notes.txt".to_string(), 3),
    ] {
        store
            .put(&Path::from(path), vec![byte].into())
            .await
            .unwrap();
    }
    let queries = clustered(10, 16, 20, 2);
    let mut before = Vec::new();
    for vector in &queries {
        let query = Query::new("v", vector.clone(), 10).probe(usize::MAX);
        before.push((
            index.query(&query).await.unwrap(),
            exact.query(&query).await.unwrap(),
        ));
    }

    let dry = gc::collect(store.clone(), Duration::ZERO, true)
        .await
        .unwrap();
    assert_eq!(dry.deleted, 2);
    // Young garbage stays.
    let young = gc::collect(store.clone(), Duration::from_secs(3600), false)
        .await
        .unwrap();
    assert_eq!(young.deleted, 0);
    let collected = gc::collect(store.clone(), Duration::ZERO, false)
        .await
        .unwrap();
    assert_eq!(
        (collected.deleted, collected.unknown, collected.missing),
        (2, 1, 0)
    );

    // Fresh handles, so nothing comes from a cache.
    let index = Index::open(store.clone(), "main").await.unwrap();
    let exact = Index::open(store.clone(), "exact").await.unwrap();
    for (vector, (main, fork)) in queries.iter().zip(before) {
        let query = Query::new("v", vector.clone(), 10).probe(usize::MAX);
        assert_eq!(index.query(&query).await.unwrap(), main);
        assert_eq!(exact.query(&query).await.unwrap(), fork);
    }
    index.build().await.unwrap();
    let again = gc::collect(store.clone(), Duration::ZERO, false)
        .await
        .unwrap();
    assert_eq!(again.deleted, 0);

    // A deleted branch's blobs go once its record is older than the
    // grace period.
    exact
        .upsert(vec![Doc::new(5000u64).vector("v", vec![1.0; 16])])
        .await
        .unwrap();
    index.delete_branch("exact").await.unwrap();
    let collected = gc::collect(store.clone(), Duration::ZERO, false)
        .await
        .unwrap();
    assert!(collected.deleted >= 2, "{collected:?}");
    assert_eq!(store.list(Some(&"deleted".into())).count().await, 0);
}

/// The binding runs these futures on other threads.
#[allow(dead_code)]
fn futures_are_send(index: &Index, query: &Query) {
    fn send<T: Send>(_: T) {}
    send(index.upsert(Vec::new()));
    send(index.delete(Vec::new()));
    send(index.query(query));
    send(index.build());
    send(index.stats());
    send(index.fork("x"));
    send(index.alter(&Schema::new()));
    send(index.merge("x"));
    send(async { index.snapshot().await?.warm().await });
    send(gc::collect(Arc::new(InMemory::new()), Duration::ZERO, true));
}

#[tokio::test]
async fn the_default_probe_finds_95_percent_of_the_true_top_10() {
    let (_dir, index, exact) = built(Metric::Cosine, 6000, 64).await;
    let queries = clustered(100, 64, 50, 3);
    let mut found = 0;
    for vector in &queries {
        let query = Query::new("v", vector.clone(), 10);
        let truth: HashSet<Id> = ids(&exact.query(&query).await.unwrap())
            .into_iter()
            .collect();
        let hits = index.query(&query).await.unwrap();
        found += hits.iter().filter(|hit| truth.contains(&hit.id)).count();
    }
    let recall = found as f64 / (queries.len() * 10) as f64;
    assert!(recall >= 0.95, "recall@10 {recall}");
}

#[tokio::test]
async fn a_build_with_nothing_new_changes_nothing() {
    let (_dir, store) = folder();
    let index = Index::create(store, schema(Metric::Euclidean))
        .await
        .unwrap();
    index.build().await.unwrap();
    assert!(near(&index, 0.0, 0.0, 10).await.is_empty());
    index.upsert(vec![doc(1, 0.0, 0.0)]).await.unwrap();
    index.build().await.unwrap();
    index.build().await.unwrap();
    assert_eq!(near(&index, 0.0, 0.0, 10).await, nums(&[1]));
}

/// Files and an index may share a bucket, never a folder: each garbage
/// collector refuses the other's folder, and one holding both, deleting nothing.
#[tokio::test]
async fn garbage_collectors_keep_to_their_own_kind_of_folder() {
    let (_dir, store) = folder();
    let index = Index::create(store.clone(), schema(Metric::Euclidean))
        .await
        .unwrap();
    index.upsert(vec![doc(1, 0.0, 0.0)]).await.unwrap();
    let repo = skywake_core::Repo::new(store.clone());
    assert!(matches!(
        repo.create_branch("main", None).await,
        Err(skywake_core::Error::WrongKind(_))
    ));
    let core_gc = repo.collect_garbage(Duration::ZERO, false).await;
    assert!(matches!(core_gc, Err(skywake_core::Error::WrongKind(_))));
    let hits = index.query(&Query::new("v", vec![0.0, 0.0], 5)).await.unwrap();
    assert_eq!(ids(&hits), [Id::Num(1)]);

    // A filesystem made before markers: judged by what it holds, then marked.
    let (_dir, files) = folder();
    let repo = skywake_core::Repo::new(files.clone());
    repo.create_branch("main", None).await.unwrap();
    files.delete(&Path::from(skywake_core::kind::MARKER)).await.unwrap();
    let index_gc = gc::collect(files.clone(), Duration::ZERO, false).await;
    assert!(matches!(index_gc, Err(Error::Core(skywake_core::Error::WrongKind(_)))));
    repo.collect_garbage(Duration::ZERO, false).await.unwrap();
    assert!(files.head(&Path::from(skywake_core::kind::MARKER)).await.is_ok());
    assert_eq!(repo.branches().await.unwrap(), ["main"]);
}
