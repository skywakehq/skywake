//! Several writers on one branch at the same time.

mod common;

use std::sync::Arc;

use common::{Faulty, Op};
use object_store::memory::InMemory;
use skywake_core::{Content, Edit, Error, FILE_MODE, Repo};

fn put(path: &str, text: &str) -> Edit {
    Edit {
        path: path.to_string(),
        content: Content::Bytes(text.as_bytes().to_vec()),
        mode: FILE_MODE,
    }
}

async fn text(repo: &Repo, path: &str) -> String {
    let bytes = repo.read("main", None, path, 0, u64::MAX).await.unwrap();
    String::from_utf8(bytes).unwrap()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn writers_of_different_files_all_land() {
    let repo = Repo::new(Arc::new(InMemory::new()));
    repo.create_branch("main", None).await.unwrap();
    let writers: Vec<_> = (0..8)
        .map(|i| {
            let repo = repo.clone();
            tokio::spawn(async move {
                let path = format!("agent-{i}");
                repo.commit_files("main", &path, None, vec![put(&path, &path)])
                    .await
            })
        })
        .collect();
    for writer in writers {
        writer.await.unwrap().unwrap();
    }
    for i in 0..8 {
        let path = format!("agent-{i}");
        assert_eq!(text(&repo, &path).await, path);
    }
    assert_eq!(repo.log("main").await.unwrap().len(), 9);
}

#[tokio::test]
async fn a_retry_does_not_overwrite_a_concurrent_edit_of_the_same_file() {
    let store = Faulty::new();
    let repo = Repo::new(Arc::new(store.clone()));
    repo.create_branch("main", None).await.unwrap();
    repo.commit_files("main", "base", None, vec![put("shared", "base")])
        .await
        .unwrap();

    let gate = store.gate(Op::Put, "refs/main");
    let a = tokio::spawn({
        let repo = repo.clone();
        async move {
            repo.commit_files("main", "a", None, vec![put("shared", "from a")])
                .await
        }
    });
    gate.reached().await;
    repo.commit_files("main", "b", None, vec![put("shared", "from b")])
        .await
        .unwrap();
    gate.open();

    let a = a.await.unwrap();
    assert!(
        matches!(&a, Err(Error::EditConflict(path)) if path == "shared"),
        "{a:?}"
    );
    assert_eq!(text(&repo, "shared").await, "from b");
}

#[tokio::test]
async fn a_retry_still_lands_when_the_other_writer_touched_other_paths() {
    let store = Faulty::new();
    let repo = Repo::new(Arc::new(store.clone()));
    repo.create_branch("main", None).await.unwrap();
    let gate = store.gate(Op::Put, "refs/main");
    let a = tokio::spawn({
        let repo = repo.clone();
        async move {
            repo.commit_files("main", "a", None, vec![put("a", "a")])
                .await
        }
    });
    gate.reached().await;
    repo.commit_files("main", "b", None, vec![put("b", "b")])
        .await
        .unwrap();
    gate.open();
    a.await.unwrap().unwrap();
    assert_eq!(text(&repo, "a").await, "a");
    assert_eq!(text(&repo, "b").await, "b");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn racing_claims_leave_exactly_one_writer() {
    let repo = Repo::new(Arc::new(InMemory::new()));
    repo.create_branch("main", None).await.unwrap();
    let claims: Vec<_> = (0..6)
        .map(|_| {
            let repo = repo.clone();
            tokio::spawn(async move { repo.claim("main").await })
        })
        .collect();
    let mut holders = Vec::new();
    for claim in claims {
        if let Ok(claim) = claim.await.unwrap() {
            holders.push(claim);
        }
    }
    let mut saved = 0;
    for mut claim in holders {
        let tree = claim.tree;
        match repo.save(&mut claim, tree, None).await {
            Ok(_) => saved += 1,
            Err(Error::Conflict(_)) => {}
            Err(error) => panic!("{error}"),
        }
    }
    assert_eq!(saved, 1);
}
