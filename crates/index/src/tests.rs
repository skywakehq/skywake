//! Tests of `Index` itself: which Version a read uses.

use std::sync::Arc;
use std::time::Duration;

use object_store::ObjectStore;
use object_store::memory::InMemory;

use crate::testing::{doc, ids, schema};
use crate::{Id, Index, KEEP_OPENED, Query};

#[tokio::test]
async fn a_query_long_after_open_sees_writes_made_since() {
    let store = Arc::new(InMemory::new());
    let writer = Index::create(store.clone(), schema()).await.unwrap();
    writer.upsert(vec![doc(1)]).await.unwrap();
    let reader = Index::open(store, "main").await.unwrap();
    writer.upsert(vec![doc(2)]).await.unwrap();
    tokio::time::sleep(KEEP_OPENED + Duration::from_millis(100)).await;
    assert_eq!(ids(&reader).await, vec![Id::from(1u64), Id::from(2u64)]);
}

#[tokio::test]
async fn a_read_for_an_epoch_reads_the_head_only_when_the_epoch_moves() {
    let store: Arc<dyn ObjectStore> = Arc::new(InMemory::new());
    let writer = Index::create(store.clone(), schema()).await.unwrap();
    writer.upsert(vec![doc(1)]).await.unwrap();
    let reader = Index::open(store, "main").await.unwrap();
    let all = Query::new("v", vec![0.0, 0.0], 10);
    let count = |epoch| {
        let reader = reader.clone();
        let all = all.clone();
        async move {
            let snapshot = reader.snapshot_for(epoch).await.unwrap();
            snapshot.query(&all).await.unwrap().len()
        }
    };
    assert_eq!(count(1).await, 1);
    writer.upsert(vec![doc(2)]).await.unwrap();
    assert_eq!(count(1).await, 1);
    assert_eq!(count(2).await, 2);
    // A slower read that saw an older epoch does not replace the newer head.
    writer.upsert(vec![doc(3)]).await.unwrap();
    assert_eq!(count(1).await, 3);
    assert_eq!(count(2).await, 2);
}

#[tokio::test]
async fn an_eventual_read_uses_the_version_last_seen() {
    let store: Arc<dyn ObjectStore> = Arc::new(InMemory::new());
    let writer = Index::create(store.clone(), schema()).await.unwrap();
    writer.upsert(vec![doc(1)]).await.unwrap();
    let reader = Index::open(store, "main").await.unwrap();
    let all = Query::new("v", vec![0.0, 0.0], 10);
    assert_eq!(reader.query(&all).await.unwrap().len(), 1);
    writer.upsert(vec![doc(2)]).await.unwrap();
    let recent = reader.recent_snapshot().await.unwrap();
    assert_eq!(recent.query(&all).await.unwrap().len(), 1);
    assert_eq!(reader.query(&all).await.unwrap().len(), 2);
}
