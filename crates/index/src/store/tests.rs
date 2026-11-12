use std::sync::Arc;
use std::time::Duration;

use object_store::ObjectStore;
use object_store::memory::InMemory;
use skywake_core::cache::ChunkCache;

use crate::testing::{Gate, built, clustered, doc, schema};
use crate::{Index, Options, Query};

#[tokio::test]
async fn the_cache_stays_within_its_bound() {
    let options = Options {
        cache_bytes: 16 << 10,
        ..Options::default()
    };
    let index = Index::create_with(Arc::new(InMemory::new()), schema(), options)
        .await
        .unwrap();
    for batch in 0..20u64 {
        let docs = (0..100).map(|i| doc(batch * 100 + i)).collect();
        index.upsert(docs).await.unwrap();
    }
    index.build().await.unwrap();
    for x in 0..50 {
        let query = Query::new("v", vec![x as f32 * 40.0, 0.0], 10).probe(usize::MAX);
        assert_eq!(index.query(&query).await.unwrap().len(), 10);
        assert!(index.storage.cache_used() <= 16 << 10);
    }
    assert!(index.storage.cache_used() > 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_warm_disk_cache_serves_a_new_handle_without_the_bucket() {
    let gate = Gate::new();
    built(&gate, 10_000, 128, 2000).await;
    let dir = tempfile::tempdir().unwrap();
    let options = Options {
        disk: Some(Arc::new(
            ChunkCache::new(dir.path().into(), u64::MAX).unwrap(),
        )),
        ..Options::default()
    };
    let query = Query::new("v", clustered(1, 128, 4).remove(0), 10);
    let expected = Index::open(gate.clone(), "main")
        .await
        .unwrap()
        .query(&query)
        .await
        .unwrap();
    for _ in 0..200 {
        gate.reads.lock().unwrap().clear();
        let index = Index::open_with(gate.clone(), "main", options.clone())
            .await
            .unwrap();
        assert_eq!(index.query(&query).await.unwrap(), expected);
        let reads = std::mem::take(&mut *gate.reads.lock().unwrap());
        if !reads
            .iter()
            .any(|(path, _)| path.starts_with("blobs/") || path.starts_with("chunks/"))
        {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("queries still read blobs from the bucket");
}

#[tokio::test]
async fn reads_are_counted_by_where_they_came_from() {
    let store: Arc<dyn ObjectStore> = Arc::new(InMemory::new());
    let writer = Index::create(store.clone(), schema()).await.unwrap();
    writer.upsert((0..50).map(doc).collect()).await.unwrap();
    writer.build().await.unwrap();
    let query = Query::new("v", vec![0.0, 0.0], 5);
    let (reader, cold) = crate::counted(async {
        let reader = Index::open(store.clone(), "main").await.unwrap();
        reader.query(&query).await.unwrap();
        reader
    })
    .await;
    assert_eq!(cold.temperature(), "cold", "{cold:?}");
    let (_, again) = crate::counted(reader.query(&query)).await;
    assert!(
        again.store < cold.store && again.memory > cold.memory,
        "{again:?}"
    );
    assert!(again.hit_ratio() > cold.hit_ratio());

    let warmed = Index::open(store, "main").await.unwrap();
    warmed.snapshot().await.unwrap().warm().await.unwrap();
    let (_, first) = crate::counted(warmed.query(&query)).await;
    assert_eq!(first.store, again.store, "{first:?}");
}

#[tokio::test(flavor = "multi_thread")]
async fn warming_puts_every_blob_on_the_disk() {
    let gate = Gate::new();
    built(&gate, 10_000, 128, 2000).await;
    let dir = tempfile::tempdir().unwrap();
    let options = Options {
        disk: Some(Arc::new(
            ChunkCache::new(dir.path().into(), u64::MAX).unwrap(),
        )),
        ..Options::default()
    };
    let warmed = Index::open_with(gate.clone(), "main", options.clone())
        .await
        .unwrap();
    warmed.snapshot().await.unwrap().warm().await.unwrap();

    gate.reads.lock().unwrap().clear();
    let fresh = Index::open_with(gate.clone(), "main", options)
        .await
        .unwrap();
    for seed in 0..5 {
        let query = Query::new("v", clustered(1, 128, seed).remove(0), 10).probe(usize::MAX);
        assert_eq!(fresh.query(&query).await.unwrap().len(), 10);
    }
    let reads = gate.reads.lock().unwrap();
    let from_bucket: Vec<_> = (reads.iter())
        .filter(|(path, _)| path.starts_with("blobs/") || path.starts_with("chunks/"))
        .collect();
    assert!(from_bucket.is_empty(), "{from_bucket:?}");
}
