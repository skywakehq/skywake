//! Checkout never writes outside its folder, whatever a stored tree holds.

use std::fs;
use std::os::unix::fs::symlink;
use std::sync::Arc;

use object_store::memory::InMemory;
use skywake_core::{Content, Data, Edit, Entry, Error, FILE_MODE, Repo, Tree};
use tempfile::tempdir;

fn file(text: &str) -> Entry {
    Entry::File {
        size: text.len() as u64,
        modified_ns: 0,
        mode: FILE_MODE,
        data: Data::Inline(text.as_bytes().to_vec()),
    }
}

async fn branch_with(repo: &Repo, root: Tree) {
    repo.create_branch("main", None).await.unwrap();
    let mut claim = repo.claim("main").await.unwrap();
    let root = claim.trees.add(root).unwrap();
    repo.save(&mut claim, root, Some("hostile")).await.unwrap();
}

#[tokio::test]
async fn names_that_leave_the_folder_are_refused() {
    let base = tempdir().unwrap();
    let outside = base.path().join("outside");
    for name in [
        "..".to_string(),
        "../outside".to_string(),
        outside.display().to_string(),
        "a/../../outside".to_string(),
        "nul\0name".to_string(),
        ".".to_string(),
        String::new(),
    ] {
        let repo = Repo::new(Arc::new(InMemory::new()));
        branch_with(&repo, Tree::from([(name.clone(), file("escaped"))])).await;
        let out = base.path().join("out");
        let _ = fs::remove_dir_all(&out);
        let result = repo.checkout("main", &out).await;
        assert!(result.is_err(), "{name:?} was written");
        assert!(!outside.exists(), "{name:?} escaped");
    }
}

#[tokio::test]
async fn a_symlink_cannot_redirect_a_later_write() {
    let base = tempdir().unwrap();
    let target = base.path().join("target");
    fs::create_dir(&target).unwrap();
    let repo = Repo::new(Arc::new(InMemory::new()));
    repo.create_branch("main", None).await.unwrap();
    let mut claim = repo.claim("main").await.unwrap();
    let inner = claim
        .trees
        .add(Tree::from([("x".to_string(), file("escaped"))]))
        .unwrap();
    let root = Tree::from([
        (
            "A".to_string(),
            Entry::Symlink {
                target: target.display().to_string(),
            },
        ),
        ("a".to_string(), Entry::Dir { tree: inner }),
    ]);
    let root = claim.trees.add(root).unwrap();
    repo.save(&mut claim, root, Some("hostile")).await.unwrap();

    let _ = repo.checkout("main", &base.path().join("out")).await;
    assert!(!target.join("x").exists(), "wrote through the symlink");
}

#[tokio::test]
async fn checkout_never_opens_an_existing_file() {
    let base = tempdir().unwrap();
    let out = base.path().join("out");
    fs::create_dir(&out).unwrap();
    let repo = Repo::new(Arc::new(InMemory::new()));
    repo.create_branch("main", None).await.unwrap();
    let edit = Edit {
        path: "f".into(),
        content: Content::Bytes(b"new".to_vec()),
        mode: FILE_MODE,
    };
    repo.commit_files("main", "f", None, vec![edit])
        .await
        .unwrap();
    let victim = base.path().join("victim");
    fs::write(&victim, "keep").unwrap();
    symlink(&victim, out.join("f")).unwrap();
    assert!(matches!(
        repo.checkout("main", &out).await,
        Err(Error::NotEmpty(_))
    ));
    assert_eq!(fs::read_to_string(&victim).unwrap(), "keep");
}

#[tokio::test]
async fn paths_with_unsafe_parts_are_refused_by_the_file_api() {
    let repo = Repo::new(Arc::new(InMemory::new()));
    repo.create_branch("main", None).await.unwrap();
    for path in ["a/../b", "a\0b", "./a"] {
        let edit = Edit {
            path: path.into(),
            content: Content::Bytes(b"x".to_vec()),
            mode: FILE_MODE,
        };
        let result = repo.commit_files("main", "x", None, vec![edit]).await;
        assert!(matches!(result, Err(Error::InvalidPath(_))), "{path:?}");
    }
}
