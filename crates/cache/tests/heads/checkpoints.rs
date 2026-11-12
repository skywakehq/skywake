//! Checkpoints whose objects an owner holds, and collections that run alongside them.

use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::Duration;

use object_store::ObjectStoreExt;
use object_store::path::Path;
use skywake_core::lock::Lease;

use super::blocking::Blocking;
use super::{big, checked_out, tier, tier_on, tier_without_one};

#[tokio::test(flavor = "multi_thread")]
async fn a_checkpoint_survives_its_owner_dying_before_the_bucket_has_its_objects() {
    let store = Arc::new(Blocking::default());
    let tier = tier_on(store.clone()).await;
    tier.repo().create_branch("work", None).await.unwrap();
    tier.in_bucket("work", 0).await;
    store.objects_blocked.store(true, Ordering::SeqCst);
    let commit = tier
        .checkpoint("work", &[("a.txt", &big("one"))], "one")
        .await;
    let path = Path::from(format!("commits/{commit}"));
    assert!(
        store.inner.head(&path).await.is_err(),
        "the commit reached the bucket before the answer"
    );
    tokio::time::sleep(Duration::from_millis(300)).await;
    tier.crash_all();
    store.objects_blocked.store(false, Ordering::SeqCst);

    let tier = tier_without_one(tier).await;
    assert_eq!(tier.refs().head("work").await.unwrap().unwrap().seq, 1);
    tier.in_bucket("work", 1).await;
    store.inner.head(&path).await.unwrap();
    assert_eq!(
        checked_out(tier.store.clone(), "work", "a.txt").await,
        big("one")
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn after_a_collection_the_writer_checks_its_own_checkpoint() {
    let tier = tier().await;
    tier.repo().create_branch("work", None).await.unwrap();
    tier.in_bucket("work", 0).await;
    let mut lease = Lease::take(tier.store.as_ref()).await.unwrap();
    lease.deleting(true).await.unwrap();
    lease.deleting(false).await.unwrap();
    lease.release().await;
    tokio::time::sleep(Duration::from_millis(1500)).await;
    let commit = tier
        .checkpoint("work", &[("a.txt", &big("two"))], "two")
        .await;
    tier.store
        .head(&Path::from(format!("commits/{commit}")))
        .await
        .unwrap();
    tier.in_bucket("work", 1).await;
    assert_eq!(
        checked_out(tier.store.clone(), "work", "a.txt").await,
        big("two")
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_collection_keeps_what_owners_still_hold() {
    let store = Arc::new(Blocking::default());
    let tier = tier_on(store.clone()).await;
    let repo = tier.repo();
    repo.create_branch("work", None).await.unwrap();
    tier.in_bucket("work", 0).await;
    tier.checkpoint("work", &[("a.txt", &big("old"))], "old")
        .await;
    tier.in_bucket("work", 1).await;
    repo.create_branch("trash", None).await.unwrap();
    tier.checkpoint("trash", &[("t.txt", &big("trash"))], "trash")
        .await;
    tier.in_bucket("trash", 1).await;
    repo.delete_branch("trash").await.unwrap();
    store.objects_blocked.store(true, Ordering::SeqCst);
    tier.checkpoint("work", &[("a.txt", &big("new"))], "new")
        .await;

    let collecting = tokio::spawn(async move { repo.collect_garbage(Duration::ZERO, false).await });
    tokio::time::sleep(Duration::from_secs(2)).await;
    assert!(
        !collecting.is_finished(),
        "the collection did not wait for the owner"
    );
    store.objects_blocked.store(false, Ordering::SeqCst);
    let collected = collecting.await.unwrap().unwrap();
    assert!(
        collected.deleted > 0,
        "the deleted branch's data should go: {collected:?}"
    );
    tier.in_bucket("work", 2).await;
    assert_eq!(
        checked_out(tier.store.clone(), "work", "a.txt").await,
        big("new")
    );
}
