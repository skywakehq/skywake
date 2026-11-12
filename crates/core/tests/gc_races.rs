//! Garbage collection never deletes data a branch can reach, whatever the timing.

mod common;

use std::sync::Arc;
use std::time::Duration;

use common::{Faulty, Op};
use futures::FutureExt;
use skywake_core::{Content, Edit, Error, FILE_MODE, Hash, Refs, Repo};
use tempfile::tempdir;

const GRACE: Duration = Duration::from_secs(8 * 24 * 3600);

fn put(path: &str, bytes: Vec<u8>) -> Edit {
    Edit {
        path: path.to_string(),
        content: Content::Bytes(bytes),
        mode: FILE_MODE,
    }
}

fn big(seed: u8) -> Vec<u8> {
    (0..20_000u32)
        .map(|i| (i.wrapping_mul(2654435761) >> 13) as u8 ^ seed)
        .collect()
}

async fn old_garbage(store: &Faulty, repo: &Repo) -> Hash {
    repo.create_branch("main", None).await.unwrap();
    repo.commit_files("main", "main", None, vec![put("main", vec![1])])
        .await
        .unwrap();
    repo.create_branch("old", None).await.unwrap();
    let commit = repo
        .commit_files("old", "old work", None, vec![put("dir/data", big(1))])
        .await
        .unwrap();
    repo.delete_branch("old").await.unwrap();
    store.age_everything().await;
    commit
}

async fn readable(repo: &Repo, branch: &str) {
    let out = tempdir().unwrap();
    repo.checkout(branch, out.path()).await.unwrap();
    assert_eq!(std::fs::read(out.path().join("dir/data")).unwrap(), big(1));
}

#[tokio::test]
async fn a_fork_at_an_old_commit_during_marking_keeps_its_data() {
    let store = Faulty::new();
    let repo = Repo::new(Arc::new(store.clone()));
    let commit = old_garbage(&store, &repo).await;

    let gate = store.gate(Op::Get, "commits/");
    let collecting = tokio::spawn({
        let repo = repo.clone();
        async move { repo.collect_garbage(GRACE, false).await }
    });
    gate.reached().await;
    repo.fork_at("revived", commit).await.unwrap();
    gate.open();
    collecting.await.unwrap().unwrap();
    readable(&repo, "revived").await;
}

#[tokio::test]
async fn a_fork_at_an_old_commit_during_the_sweep_never_points_to_deleted_data() {
    let store = Faulty::new();
    let repo = Repo::new(Arc::new(store.clone()));
    let commit = old_garbage(&store, &repo).await;

    let sweep = store.gate(Op::Delete, "commits/");
    let collecting = tokio::spawn({
        let repo = repo.clone();
        async move { repo.collect_garbage(GRACE, false).await }
    });
    sweep.reached().await;
    let waiting = store.gate(Op::Get, "gc/lock");
    let forking = tokio::spawn({
        let repo = repo.clone();
        async move { repo.fork_at("revived", commit).await }
    });
    let waited = waiting.reached_within(Duration::from_secs(2)).await;
    waiting.open();
    sweep.open();
    collecting.await.unwrap().unwrap();

    let forked = forking.await.unwrap();
    if forked.is_ok() {
        readable(&repo, "revived").await;
    }
    assert!(waited, "the fork did not wait for the collection");
    assert!(
        matches!(
            forked,
            Err(Error::Store(object_store::Error::NotFound { .. }))
        ),
        "{forked:?}"
    );
    assert!(!repo.branches().await.unwrap().contains(&"revived".into()));
}

#[tokio::test]
async fn a_copy_from_an_old_commit_during_the_sweep_never_points_to_deleted_data() {
    let store = Faulty::new();
    let repo = Repo::new(Arc::new(store.clone()));
    let commit = old_garbage(&store, &repo).await;

    let sweep = store.gate(Op::Delete, "commits/");
    let collecting = tokio::spawn({
        let repo = repo.clone();
        async move { repo.collect_garbage(GRACE, false).await }
    });
    sweep.reached().await;
    let waiting = store.gate(Op::Get, "gc/lock");
    let copy = Edit {
        path: "dir".into(),
        content: Content::From {
            path: "dir".into(),
            at: Some(commit),
        },
        mode: FILE_MODE,
    };
    let copying = tokio::spawn({
        let repo = repo.clone();
        async move { repo.commit_files("main", "copy", None, vec![copy]).await }
    });
    let waited = waiting.reached_within(Duration::from_secs(2)).await;
    waiting.open();
    sweep.open();
    collecting.await.unwrap().unwrap();

    let copied = copying.await.unwrap();
    if copied.is_ok() {
        readable(&repo, "main").await;
    }
    assert!(waited, "the copy did not wait for the collection");
    assert!(
        matches!(
            copied,
            Err(Error::Store(object_store::Error::NotFound { .. }))
        ),
        "{copied:?}"
    );
    assert!(repo.list("main", None, "dir").await.is_err());
}

#[tokio::test]
async fn a_fork_of_a_branch_deleted_during_marking_keeps_its_data() {
    let store = Faulty::new();
    let repo = Repo::new(Arc::new(store.clone()));
    repo.create_branch("source", None).await.unwrap();
    repo.commit_files("source", "work", None, vec![put("dir/data", big(1))])
        .await
        .unwrap();
    store.age_everything().await;

    let gate = store.gate(Op::Get, "refs/");
    let collecting = tokio::spawn({
        let repo = repo.clone();
        async move { repo.collect_garbage(GRACE, false).await }
    });
    gate.reached().await;
    let writer = Repo::new(store.0.inner.clone());
    writer.create_branch("fork", Some("source")).await.unwrap();
    writer.delete_branch("source").await.unwrap();
    gate.open();
    collecting.await.unwrap().unwrap();
    readable(&repo, "fork").await;
}

#[tokio::test]
async fn a_fork_of_an_autosave_that_is_replaced_keeps_its_data() {
    let store = Faulty::new();
    let repo = Repo::new(Arc::new(store.clone()));
    repo.create_branch("source", None).await.unwrap();
    let mut claim = repo.claim("source").await.unwrap();
    let file = skywake_core::files::store(repo.objects(), &big(1), FILE_MODE)
        .await
        .unwrap();
    let tree = skywake_core::files::put(&claim.trees, claim.tree, "dir/data", Some(file))
        .await
        .unwrap();
    repo.save(&mut claim, tree, None).await.unwrap();
    store.age_everything().await;

    let gate = store.gate(Op::Get, "refs/");
    let collecting = tokio::spawn({
        let repo = repo.clone();
        async move { repo.collect_garbage(GRACE, false).await }
    });
    gate.reached().await;
    let writer = Repo::new(store.0.inner.clone());
    let forked = writer.create_branch("fork", Some("source")).await.unwrap();
    let empty = skywake_core::files::put(&claim.trees, claim.tree, "dir", None)
        .await
        .unwrap();
    repo.save(&mut claim, empty, None).await.unwrap();
    gate.open();
    collecting.await.unwrap().unwrap();
    readable(&repo, "fork").await;
    repo.fork_at("again", forked).await.unwrap();
    readable(&repo, "again").await;
}

#[tokio::test]
async fn collection_ends_while_a_branch_keeps_moving() {
    let store = Faulty::new();
    let repo = Repo::new(Arc::new(store.clone()));
    repo.create_branch("busy", None).await.unwrap();
    let refs = Refs::new(store.0.inner.clone());
    store.on(Op::Get, "refs/busy", usize::MAX, move || {
        let refs = refs.clone();
        async move {
            let head = refs.head("busy").await.unwrap().unwrap();
            let mut commit = head.commit.clone();
            commit.autosave = true;
            commit.time += 1;
            refs.advance("busy", &head, commit).await.unwrap();
            tokio::task::yield_now().await;
        }
        .boxed()
    });
    let collected =
        tokio::time::timeout(Duration::from_secs(10), repo.collect_garbage(GRACE, false)).await;
    assert!(collected.is_ok(), "collection never ended");
    collected.unwrap().unwrap();
}
