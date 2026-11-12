//! Garbage collection, restores and history windows.

use std::sync::Arc;
use std::time::Duration;

use object_store::memory::InMemory;
use object_store::path::Path;
use object_store::{ObjectStore, ObjectStoreExt};

use super::gc;
use crate::format::cluster::ClusterRef;
use crate::testing::{Gate, built, clustered, doc, ids, schema, table};
use crate::{Doc, Error, Id, Index, Options, Query, Shards};

fn history(index: &Index) -> Shards {
    Shards {
        shards: vec![index.clone()],
        ids: crate::IdKind::Any,
    }
}

#[tokio::test]
async fn collection_keeps_the_blobs_of_a_write_in_flight_while_they_are_young() {
    let gate = Gate::new();
    let index = Index::create(gate.clone(), schema()).await.unwrap();
    index.upsert(vec![doc(1)]).await.unwrap();
    gate.hold_next("gc/lock", false);
    let write = tokio::spawn({
        let index = index.clone();
        async move { index.upsert(vec![doc(2)]).await }
    });
    gate.held.notified().await;
    let collected = gc::collect(gate.clone(), Duration::from_secs(3600), false).await;
    assert_eq!(collected.unwrap().deleted, 0);
    gate.open();
    write.await.unwrap().unwrap();
    assert_eq!(ids(&index).await, vec![Id::from(1), Id::from(2)]);
}

#[tokio::test]
async fn a_write_whose_blobs_a_collection_deleted_fails_instead_of_moving_the_head() {
    let gate = Gate::new();
    let index = Index::create(gate.clone(), schema()).await.unwrap();
    index.upsert(vec![doc(1)]).await.unwrap();
    gate.hold_next("gc/lock", false);
    let write = tokio::spawn({
        let index = index.clone();
        async move { index.upsert(vec![doc(2)]).await }
    });
    gate.held.notified().await;
    let collected = gc::collect(gate.clone(), Duration::ZERO, false)
        .await
        .unwrap();
    assert_eq!(collected.deleted, 2);
    gate.open();
    assert!(write.await.unwrap().is_err());
    assert_eq!(ids(&index).await, vec![Id::from(1)]);
    index.upsert(vec![doc(3)]).await.unwrap();
    assert_eq!(ids(&index).await, vec![Id::from(1), Id::from(3)]);
}

#[tokio::test(flavor = "multi_thread")]
async fn collection_walks_pages_and_keeps_only_what_branches_name() {
    let gate = Gate::new();
    let index = built(&gate, 3000, 32, 500).await;
    let fork = index.fork("fork").await.unwrap();
    let docs = (clustered(50, 32, 4).into_iter().enumerate())
        .map(|(i, v)| Doc::new(10_000 + i as u64).vector("v", v))
        .collect();
    fork.upsert(docs).await.unwrap();
    fork.build().await.unwrap();
    let main_version = index.version().await.unwrap();
    let main_blobs: Vec<ClusterRef> = table(&index, &main_version).await;
    let fork_version = fork.version().await.unwrap();
    let fork_only: Vec<ClusterRef> = (table(&fork, &fork_version).await.into_iter())
        .filter(|c| !main_blobs.contains(c))
        .collect();
    assert!(!fork_only.is_empty());

    let collected = gc::collect(gate.clone(), Duration::ZERO, false)
        .await
        .unwrap();
    assert_eq!((collected.deleted, collected.missing), (0, 0));

    let query = Query::new("v", clustered(1, 32, 5).remove(0), 10).probe(usize::MAX);
    let expected = index.query(&query).await.unwrap();
    index.delete_branch("fork").await.unwrap();
    let collected = gc::collect(gate.clone(), Duration::ZERO, false)
        .await
        .unwrap();
    assert_eq!(collected.missing, 0);
    assert!(collected.deleted as usize >= fork_only.len());
    let exists = async |hash: skywake_core::Hash| {
        gate.head(&Path::from(format!("blobs/{hash}")))
            .await
            .is_ok()
    };
    for cluster in &fork_only {
        assert!(!exists(cluster.hash).await);
    }
    for cluster in &main_blobs {
        assert!(exists(cluster.hash).await);
    }
    let fresh = Index::open(gate.clone(), "main").await.unwrap();
    assert_eq!(fresh.query(&query).await.unwrap(), expected);
}

#[tokio::test]
async fn a_branch_goes_back_to_an_older_version_and_forks_from_one() {
    let index = Index::create(Arc::new(InMemory::new()), schema())
        .await
        .unwrap();
    let history = history(&index);
    index.upsert(vec![doc(1), doc(2)]).await.unwrap();
    index.upsert(vec![doc(3)]).await.unwrap();
    index.delete(vec![Id::from(1)]).await.unwrap();
    let moments = history.versions(None, 10).await.unwrap();
    let rows: Vec<u64> = moments.iter().map(|m| m.rows).collect();
    assert_eq!(rows, [2, 3, 2, 0]);
    assert!(moments.windows(2).all(|m| m[0].time >= m[1].time));
    let page = history.versions(Some(moments[0].version), 2).await.unwrap();
    assert_eq!(page, moments[1..3]);

    let two = moments[2].version;
    let fork = history.fork_at("past", two, None).await.unwrap();
    assert_eq!(ids(&fork.shards[0]).await, [Id::from(1), Id::from(2)]);
    let now = history
        .restore(two, Some(Duration::from_secs(3600)))
        .await
        .unwrap();
    assert_eq!(ids(&index).await, [Id::from(1), Id::from(2)]);
    let after = history.versions(None, 10).await.unwrap();
    assert_eq!((after[0].version, after[0].rows), (now, 2));
    assert_eq!(after[1..], moments[..]);
    index.delete(vec![Id::from(2)]).await.unwrap();
    index.upsert(vec![doc(4)]).await.unwrap();
    assert_eq!(ids(&index).await, [Id::from(1), Id::from(4)]);

    let past_retention = history.restore(moments[3].version, Some(Duration::ZERO));
    assert!(matches!(past_retention.await, Err(Error::Invalid(_))));
    let unknown = history.restore(skywake_core::Hash::of(b"no"), None);
    assert!(matches!(unknown.await, Err(Error::VersionNotFound(_))));
}

#[tokio::test]
async fn a_sharded_branch_goes_back_to_a_moment_of_every_shard() {
    let stores: Vec<Arc<dyn ObjectStore>> = (0..2)
        .map(|_| Arc::new(InMemory::new()) as Arc<dyn ObjectStore>)
        .collect();
    let shards = Shards::create(stores, schema(), Options::default())
        .await
        .unwrap();
    shards.upsert((1..=6).map(doc).collect()).await.unwrap();
    let moment = shards.versions(None, 1).await.unwrap().remove(0);
    assert_eq!(moment.rows, 6);
    shards.upsert((7..=12).map(doc).collect()).await.unwrap();
    let scanned = async |shards: &Shards| -> Vec<Id> {
        let docs = shards.scan(None, 100).await.unwrap();
        docs.into_iter().map(|doc| doc.id).collect()
    };
    let fork = shards.fork_at("old", moment.version, None).await.unwrap();
    assert_eq!(
        scanned(&fork).await,
        (1..=6).map(Id::from).collect::<Vec<_>>()
    );
    shards.restore(moment.version, None).await.unwrap();
    assert_eq!(
        scanned(&shards).await,
        (1..=6).map(Id::from).collect::<Vec<_>>()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn collection_with_retention_drops_old_versions_and_keeps_every_branch_whole() {
    let gate = Gate::new();
    let main = built(&gate, 3000, 32, 500).await;
    let first = table(&main, &main.version().await.unwrap()).await;
    let past = history(&main).versions(None, 1).await.unwrap()[0].version;
    let fork = main.fork("fork").await.unwrap();
    let more = |seed: u64| -> Vec<Doc> {
        (clustered(500, 32, seed).into_iter().enumerate())
            .map(|(i, v)| Doc::new(seed * 10_000 + i as u64).vector("v", v))
            .collect()
    };
    main.upsert(more(2)).await.unwrap();
    main.rebuild().await.unwrap();
    fork.upsert(more(3)).await.unwrap();
    fork.rebuild().await.unwrap();
    let mut live = table(&main, &main.version().await.unwrap()).await;
    live.extend(table(&fork, &fork.version().await.unwrap()).await);
    let old: Vec<&ClusterRef> = first.iter().filter(|c| !live.contains(c)).collect();
    assert!(!old.is_empty());
    let query = Query::new("v", clustered(1, 32, 5).remove(0), 10).probe(usize::MAX);
    let expected = (
        main.query(&query).await.unwrap(),
        fork.query(&query).await.unwrap(),
    );

    let collected = gc::collect_keeping(gate.clone(), Duration::ZERO, Some(Duration::ZERO), false)
        .await
        .unwrap();
    assert_eq!(collected.missing, 0);
    let exists = async |hash: skywake_core::Hash| {
        gate.head(&Path::from(format!("blobs/{hash}")))
            .await
            .is_ok()
    };
    for cluster in old {
        assert!(!exists(cluster.hash).await);
    }
    for cluster in &live {
        assert!(exists(cluster.hash).await);
    }
    let fresh = |branch| Index::open(gate.clone(), branch);
    let main = fresh("main").await.unwrap();
    let fork = fresh("fork").await.unwrap();
    assert_eq!(main.query(&query).await.unwrap(), expected.0);
    assert_eq!(fork.query(&query).await.unwrap(), expected.1);
    assert_eq!(history(&main).versions(None, 10).await.unwrap().len(), 1);
    let gone = history(&main).restore(past, Some(Duration::ZERO)).await;
    assert!(matches!(gone, Err(Error::VersionNotFound(_))));
    main.upsert(more(4)).await.unwrap();
    main.build().await.unwrap();
    assert_eq!(main.query(&query).await.unwrap().len(), 10);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_restore_whose_blobs_a_collection_deleted_meanwhile_is_undone() {
    let gate = Gate::new();
    let index = Index::create(gate.clone(), schema()).await.unwrap();
    index.upsert(vec![doc(1)]).await.unwrap();
    let old = history(&index).versions(None, 1).await.unwrap()[0].version;
    index.upsert(vec![doc(2)]).await.unwrap();
    gate.hold_next("refs/", true);
    let restore = tokio::spawn({
        let history = history(&index);
        async move { history.restore(old, None).await }
    });
    gate.held.notified().await;
    let collected = gc::collect_keeping(gate.clone(), Duration::ZERO, Some(Duration::ZERO), false)
        .await
        .unwrap();
    assert!(collected.deleted > 0);
    gate.open();
    assert!(matches!(
        restore.await.unwrap(),
        Err(Error::VersionNotFound(_))
    ));
    let fresh = Index::open(gate.clone(), "main").await.unwrap();
    assert_eq!(ids(&fresh).await, [Id::from(1), Id::from(2)]);
}

#[tokio::test(flavor = "multi_thread")]
async fn collecting_an_index_goes_shard_by_shard_and_drops_only_history_past_the_window() {
    use object_store::prefix::PrefixStore;

    let bucket: Arc<dyn ObjectStore> = Arc::new(InMemory::new());
    let index_store: Arc<dyn ObjectStore> = Arc::new(PrefixStore::new(bucket.clone(), "ix"));
    let stores: Vec<Arc<dyn ObjectStore>> = (0..2)
        .map(|n| {
            let folder = format!("ix/{}", crate::shard_folder(n));
            Arc::new(PrefixStore::new(bucket.clone(), folder)) as Arc<dyn ObjectStore>
        })
        .collect();
    let schema = crate::Schema::new().vector("v", 16, crate::Metric::Euclidean);
    let options = Options {
        cluster_rows: 100,
        ..Options::default()
    };
    let main = Shards::create(stores.clone(), schema, options)
        .await
        .unwrap();
    let more = |seed: u64| -> Vec<Doc> {
        (clustered(600, 16, seed).into_iter().enumerate())
            .map(|(i, v)| Doc::new(seed * 10_000 + i as u64).vector("v", v))
            .collect()
    };
    main.upsert(more(1)).await.unwrap();
    main.build().await.unwrap();
    let mut first = Vec::new();
    for shard in &main.shards {
        first.push(table(shard, &shard.version().await.unwrap()).await);
    }
    let fork = main.fork("fork").await.unwrap();
    main.upsert(more(2)).await.unwrap();
    fork.upsert(more(3)).await.unwrap();
    for shard in main.shards.iter().chain(&fork.shards) {
        shard.rebuild().await.unwrap();
    }
    let query = Query::new("v", clustered(1, 16, 5).remove(0), 10).probe(usize::MAX);
    let expected = (
        main.query(&query).await.unwrap(),
        fork.query(&query).await.unwrap(),
    );

    let collected = gc::collect_index(index_store.clone(), Duration::ZERO, gc::HISTORY, false)
        .await
        .unwrap();
    assert_eq!((collected.deleted, collected.missing), (0, 0));

    let collected = gc::collect_index(index_store.clone(), Duration::ZERO, Duration::ZERO, false)
        .await
        .unwrap();
    assert_eq!(collected.missing, 0);
    assert!(collected.deleted > 0);
    for (n, (store, first)) in stores.iter().zip(&first).enumerate() {
        let (main, fork) = (&main.shards[n], &fork.shards[n]);
        let mut live = table(main, &main.version().await.unwrap()).await;
        live.extend(table(fork, &fork.version().await.unwrap()).await);
        let exists = async |hash| {
            let path = Path::from(format!("blobs/{hash}"));
            store.head(&path).await.is_ok()
        };
        for cluster in &live {
            assert!(exists(cluster.hash).await);
        }
        for cluster in first.iter().filter(|c| !live.contains(c)) {
            assert!(!exists(cluster.hash).await);
        }
    }
    let fresh = |branch| Shards::open(stores.clone(), branch, Options::default());
    let (main, fork) = (fresh("main").await.unwrap(), fresh("fork").await.unwrap());
    assert_eq!(main.query(&query).await.unwrap(), expected.0);
    assert_eq!(fork.query(&query).await.unwrap(), expected.1);
    assert_eq!(main.versions(None, 10).await.unwrap().len(), 1);
}
