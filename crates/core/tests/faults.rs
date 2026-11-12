//! Requests that fail in unclear ways.

mod common;

use std::sync::Arc;
use std::time::Duration;

use common::{Fault, Faulty, Op};
use object_store::ObjectStoreExt;
use object_store::path::Path;
use skywake_core::{Content, Edit, Error, FILE_MODE, Refs, Repo};

fn setup() -> (Faulty, Repo) {
    let store = Faulty::new();
    (store.clone(), Repo::new(Arc::new(store)))
}

fn put(path: &str, text: &str) -> Edit {
    Edit {
        path: path.to_string(),
        content: Content::Bytes(text.as_bytes().to_vec()),
        mode: FILE_MODE,
    }
}

async fn text(repo: &Repo, branch: &str, path: &str) -> String {
    let bytes = repo.read(branch, None, path, 0, u64::MAX).await.unwrap();
    String::from_utf8(bytes).unwrap()
}

#[tokio::test]
async fn a_create_that_landed_before_its_retry_failed_is_a_success() {
    let (store, repo) = setup();
    store.fail(Op::Put, "refs/", Fault::PreconditionAfter, 1);
    repo.create_branch("main", None).await.unwrap();

    store.fail(Op::Put, "refs/", Fault::TimeoutAfter, 1);
    repo.create_branch("fork", Some("main")).await.unwrap();
    assert_eq!(repo.branches().await.unwrap(), ["fork", "main"]);
}

#[tokio::test]
async fn a_save_that_timed_out_after_it_landed_is_a_success() {
    let (store, repo) = setup();
    repo.create_branch("main", None).await.unwrap();

    store.fail(Op::Put, "refs/", Fault::TimeoutAfter, 1);
    let mut claim = repo.claim("main").await.unwrap();
    store.fail(Op::Put, "refs/", Fault::PreconditionAfter, 1);
    repo.commit_files("main", "one", None, vec![put("a", "1")])
        .await
        .unwrap();
    assert_eq!(text(&repo, "main", "a").await, "1");

    let tree = claim.tree;
    let lost = repo.save(&mut claim, tree, None).await;
    assert!(matches!(lost, Err(Error::Conflict(_))), "{lost:?}");
}

#[tokio::test]
async fn a_claim_that_landed_before_its_retry_failed_still_holds_the_branch() {
    let (store, repo) = setup();
    repo.create_branch("main", None).await.unwrap();
    store.fail(Op::Put, "refs/", Fault::PreconditionAfter, 1);
    let mut claim = repo.claim("main").await.unwrap();
    store.fail(Op::Put, "refs/", Fault::TimeoutAfter, 1);
    let tree = claim.tree;
    repo.save(&mut claim, tree, None).await.unwrap();
    repo.save(&mut claim, tree, Some("done")).await.unwrap();
    assert_eq!(repo.log("main").await.unwrap()[0].1.message, "done");
}

#[tokio::test]
async fn a_write_that_never_landed_is_an_error() {
    let (store, repo) = setup();
    repo.create_branch("main", None).await.unwrap();
    let before = repo.head_commit("main").await.unwrap();

    store.fail(Op::Put, "refs/", Fault::Fail, 1);
    let failed = repo
        .commit_files("main", "one", None, vec![put("a", "1")])
        .await;
    assert!(matches!(failed, Err(Error::Store(_))), "{failed:?}");
    assert_eq!(repo.head_commit("main").await.unwrap(), before);

    store.fail(Op::Put, "commits/", Fault::Fail, 1);
    let failed = repo
        .commit_files("main", "two", None, vec![put("b", "2")])
        .await;
    assert!(failed.is_err());
    assert_eq!(repo.head_commit("main").await.unwrap(), before);
}

#[tokio::test]
async fn a_delete_does_not_erase_a_commit_that_landed_after_it_read_the_head() {
    let (store, repo) = setup();
    repo.create_branch("main", None).await.unwrap();
    let gate = store.gate(Op::Delete, "");
    let read = store.gate(Op::Put, "refs/main");
    let deleting = tokio::spawn({
        let repo = repo.clone();
        async move { repo.delete_branch("main").await }
    });
    let writer = Repo::new(store.0.inner.clone());
    tokio::select! {
        _ = read.reached() => {}
        _ = gate.reached() => {}
    }
    writer
        .commit_files("main", "late", None, vec![put("a", "1")])
        .await
        .unwrap();
    read.open();
    gate.open();

    let deleted = deleting.await.unwrap();
    assert!(matches!(deleted, Err(Error::Conflict(_))), "{deleted:?}");
    assert_eq!(text(&repo, "main", "a").await, "1");
    repo.delete_branch("main").await.unwrap();
    assert!(repo.branches().await.unwrap().is_empty());
    assert!(matches!(
        repo.delete_branch("main").await,
        Err(Error::BranchNotFound(_))
    ));
    repo.create_branch("main", None).await.unwrap();
    assert_eq!(repo.branches().await.unwrap(), ["main"]);
}

#[tokio::test]
async fn deleted_branches_are_not_listed_or_read() {
    let (_, repo) = setup();
    repo.create_branch("a", None).await.unwrap();
    repo.create_branch("b", None).await.unwrap();
    repo.delete_branch("a").await.unwrap();
    assert_eq!(repo.branches().await.unwrap(), ["b"]);
    assert!(matches!(
        repo.head_commit("a").await,
        Err(Error::BranchNotFound(_))
    ));
    let refs = Refs::new(Arc::new(Faulty::new()));
    assert!(refs.head("a").await.unwrap().is_none());
}

#[tokio::test]
async fn garbage_collection_skips_a_missing_parent_instead_of_stopping() {
    let (store, repo) = setup();
    repo.create_branch("main", None).await.unwrap();
    repo.commit_files("main", "one", None, vec![put("a", "1")])
        .await
        .unwrap();
    repo.commit_files("main", "two", None, vec![put("b", "2")])
        .await
        .unwrap();
    let log = repo.log("main").await.unwrap();
    let lost = &log[1].0; // "one", the parent of the head
    store
        .0
        .inner
        .delete(&Path::from(format!("commits/{lost}")))
        .await
        .unwrap();

    let collected = repo.collect_garbage(Duration::ZERO, false).await.unwrap();
    assert_eq!(collected.missing, 1);
    assert_eq!(text(&repo, "main", "b").await, "2");
    repo.collect_garbage(Duration::ZERO, false).await.unwrap();
}
