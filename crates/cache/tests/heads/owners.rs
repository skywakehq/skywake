//! Owners answer for heads, survive dying, and spread over the servers.

use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::Duration;

use futures::TryStreamExt;
use object_store::ObjectStoreExt;
use object_store::path::Path;
use skywake_core::Error;
use skywake_core::store::refs::{self, Slot};

use super::blocking::Blocking;
use super::{commit, tier, tier_on, tier_without_one};

#[tokio::test(flavor = "multi_thread")]
async fn owners_answer_for_heads_and_copy_them_to_the_bucket() {
    let tier = tier().await;
    let refs = tier.refs();
    let main = refs.create("main", commit("one")).await.unwrap();
    assert!(matches!(
        refs.create("main", commit("again")).await,
        Err(Error::BranchExists(_))
    ));
    let next = refs.advance("main", &main, commit("two")).await.unwrap();
    assert_eq!(next.seq, 1);
    assert!(matches!(
        refs.advance("main", &main, commit("stale")).await,
        Err(Error::Conflict(_))
    ));
    assert_eq!(
        refs.head("main").await.unwrap().unwrap().commit.message,
        "two"
    );
    refs.create("other", commit("x")).await.unwrap();
    assert_eq!(refs.list().await.unwrap(), vec!["main", "other"]);
    refs.delete("other").await.unwrap();
    assert!(refs.head("other").await.unwrap().is_none());
    tier.in_bucket("main", 1).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_head_survives_its_owner_dying_before_the_bucket_has_it() {
    let store = Arc::new(Blocking::default());
    let tier = tier_on(store.clone()).await;
    let refs = tier.refs();
    store.blocked.store(true, Ordering::SeqCst);
    refs.create("warm", commit("up")).await.unwrap();
    tokio::time::sleep(Duration::from_millis(300)).await;
    tier.crash_all();
    store.blocked.store(false, Ordering::SeqCst);
    assert!(matches!(
        refs::read(tier.store.as_ref(), "warm").await.unwrap(),
        Slot::Missing
    ));

    let tier = tier_without_one(tier).await;
    let head = tier.refs().head("warm").await.unwrap().unwrap();
    assert_eq!(head.commit.message, "up");
    tier.in_bucket("warm", 0).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_new_branch_costs_no_bucket_read_once_owners_have_listed() {
    let store = Arc::new(Blocking::default());
    let tier = tier_on(store.clone()).await;
    let repo = tier.repo();
    repo.create_branch("first", None).await.unwrap();
    tokio::time::sleep(Duration::from_secs(10)).await;
    store.ref_reads.store(0, Ordering::SeqCst);
    for n in 0..20 {
        repo.create_branch(&format!("agent-{n}"), None)
            .await
            .unwrap();
    }
    assert_eq!(store.ref_reads.load(Ordering::SeqCst), 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn slots_spread_over_the_servers() {
    let tier = tier().await;
    let refs = tier.refs();
    let mut created = Vec::new();
    for i in 0..40 {
        let name = format!("agent-{i}");
        refs.create(&name, commit(&name)).await.unwrap();
        created.push(name);
    }
    tokio::time::sleep(Duration::from_secs(5)).await;
    let mut names = refs.list().await.unwrap();
    names.sort();
    created.sort();
    assert_eq!(names, created);
    let claims: Vec<_> = tier
        .store
        .list(Some(&Path::from("slots/heads")))
        .try_collect()
        .await
        .unwrap();
    let mut owners = String::new();
    for claim in claims {
        let bytes = tier
            .store
            .get(&claim.location)
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap();
        owners.push_str(&String::from_utf8_lossy(&bytes));
    }
    for url in &tier.urls {
        let owned = owners.matches(url.as_str()).count();
        assert!((250..430).contains(&owned), "{url} owns {owned} slots");
    }
}
