//! Three-way merges, one case at a time.

use std::sync::Arc;

use object_store::memory::InMemory;
use skywake_core::{Content, EXECUTABLE_MODE, Edit, Entry, FILE_MODE, Merged, Repo, files};

fn setup() -> Repo {
    Repo::new(Arc::new(InMemory::new()))
}

fn write(path: &str, text: &str, mode: u32) -> Edit {
    Edit {
        path: path.to_string(),
        content: Content::Bytes(text.as_bytes().to_vec()),
        mode,
    }
}

fn remove(path: &str) -> Edit {
    Edit {
        path: path.to_string(),
        content: Content::Remove,
        mode: FILE_MODE,
    }
}

async fn commit(repo: &Repo, branch: &str, edits: Vec<Edit>) {
    repo.commit_files(branch, "edit", None, edits)
        .await
        .unwrap();
}

async fn set(repo: &Repo, branch: &str, path: &str, entry: Option<Entry>) {
    let mut position = repo.position(branch).await.unwrap();
    let tree = files::put(&position.trees, position.tree, path, entry)
        .await
        .unwrap();
    repo.save(&mut position, tree, Some("set")).await.unwrap();
}

async fn entry(repo: &Repo, branch: &str, path: &str) -> Option<Entry> {
    let (root, trees) = repo.head_tree(branch).await.unwrap();
    files::find(&trees, root, path).await.unwrap()
}

async fn text(repo: &Repo, branch: &str, path: &str) -> String {
    let bytes = repo.read(branch, None, path, 0, u64::MAX).await.unwrap();
    String::from_utf8(bytes).unwrap()
}

fn mode(entry: Option<Entry>) -> u32 {
    match entry {
        Some(Entry::File { mode, .. }) => mode,
        other => panic!("not a file: {other:?}"),
    }
}

async fn base(repo: &Repo, edits: Vec<Edit>) {
    repo.create_branch("main", None).await.unwrap();
    commit(repo, "main", edits).await;
    repo.create_branch("other", Some("main")).await.unwrap();
}

async fn merge(repo: &Repo) -> Merged {
    repo.merge("main", "other", "merge", None).await.unwrap()
}

#[tokio::test]
async fn a_mode_change_on_one_side_survives_an_edit_on_the_other() {
    let repo = setup();
    base(&repo, vec![write("run.sh", "a\nb\nc\n", FILE_MODE)]).await;
    commit(&repo, "main", vec![write("run.sh", "a\nb\nC\n", FILE_MODE)]).await;
    commit(
        &repo,
        "other",
        vec![write("run.sh", "a\nb\nc\n", EXECUTABLE_MODE)],
    )
    .await;

    assert!(matches!(merge(&repo).await, Merged::Done(_)));
    assert_eq!(text(&repo, "main", "run.sh").await, "a\nb\nC\n");
    assert_eq!(mode(entry(&repo, "main", "run.sh").await), EXECUTABLE_MODE);
}

#[tokio::test]
async fn a_mode_change_merges_with_a_text_merge() {
    let repo = setup();
    base(&repo, vec![write("run.sh", "a\nb\nc\n", FILE_MODE)]).await;
    commit(&repo, "main", vec![write("run.sh", "A\nb\nc\n", FILE_MODE)]).await;
    commit(
        &repo,
        "other",
        vec![write("run.sh", "a\nb\nC\n", EXECUTABLE_MODE)],
    )
    .await;

    assert!(matches!(merge(&repo).await, Merged::Done(_)));
    assert_eq!(text(&repo, "main", "run.sh").await, "A\nb\nC\n");
    assert_eq!(mode(entry(&repo, "main", "run.sh").await), EXECUTABLE_MODE);
}

#[tokio::test]
async fn different_mode_changes_on_both_sides_conflict() {
    let repo = setup();
    base(&repo, vec![write("key", "k", FILE_MODE)]).await;
    commit(&repo, "main", vec![write("key", "k", 0o600)]).await;
    commit(&repo, "other", vec![write("key", "k", EXECUTABLE_MODE)]).await;
    assert_eq!(merge(&repo).await, Merged::Conflicts(vec!["key".into()]));
}

#[tokio::test]
async fn symlinks_changed_on_both_sides_conflict() {
    let repo = setup();
    let link = |target: &str| {
        Some(Entry::Symlink {
            target: target.into(),
        })
    };
    repo.create_branch("main", None).await.unwrap();
    set(&repo, "main", "link", link("a")).await;
    repo.create_branch("other", Some("main")).await.unwrap();
    set(&repo, "main", "link", link("b")).await;
    set(&repo, "other", "link", link("c")).await;
    assert_eq!(merge(&repo).await, Merged::Conflicts(vec!["link".into()]));

    set(&repo, "other", "link", link("b")).await;
    assert!(matches!(merge(&repo).await, Merged::Done(_)));
    assert_eq!(entry(&repo, "main", "link").await, link("b"));
}

#[tokio::test]
async fn a_file_against_a_folder_conflicts() {
    let repo = setup();
    base(&repo, vec![write("keep", "k", FILE_MODE)]).await;
    commit(&repo, "main", vec![write("x", "file", FILE_MODE)]).await;
    commit(&repo, "other", vec![write("x/inside", "folder", FILE_MODE)]).await;
    assert_eq!(merge(&repo).await, Merged::Conflicts(vec!["x".into()]));
}

#[tokio::test]
async fn a_delete_against_an_edit_conflicts() {
    let repo = setup();
    base(
        &repo,
        vec![write("f", "1", FILE_MODE), write("g", "1", FILE_MODE)],
    )
    .await;
    commit(&repo, "main", vec![remove("f"), remove("g")]).await;
    commit(&repo, "other", vec![write("f", "2", FILE_MODE)]).await;
    assert_eq!(merge(&repo).await, Merged::Conflicts(vec!["f".into()]));
}

#[tokio::test]
async fn the_merge_base_is_the_lowest_common_commit() {
    let repo = setup();
    repo.create_branch("x", None).await.unwrap();
    commit(&repo, "x", vec![write("f", "1", FILE_MODE)]).await; // O
    repo.create_branch("y", Some("x")).await.unwrap();
    repo.create_branch("z", Some("x")).await.unwrap();
    for text in ["2", "3", "4"] {
        commit(&repo, "x", vec![write("f", text, FILE_MODE)]).await; // X1..X3
    }
    repo.create_branch("t", Some("x")).await.unwrap();
    commit(&repo, "t", vec![write("f", "5", FILE_MODE)]).await; // T1
    commit(&repo, "y", vec![write("y", "y", FILE_MODE)]).await; // Y1
    commit(&repo, "z", vec![write("z", "z", FILE_MODE)]).await; // Z1
    assert!(matches!(
        repo.merge("x", "y", "M1", None).await.unwrap(),
        Merged::Done(_)
    ));
    assert!(matches!(
        repo.merge("z", "t", "M2", None).await.unwrap(),
        Merged::Done(_)
    ));

    let merged = repo.merge("x", "z", "M3", None).await.unwrap();
    assert!(matches!(merged, Merged::Done(_)), "{merged:?}");
    assert_eq!(text(&repo, "x", "f").await, "5");
}

#[tokio::test]
async fn a_criss_cross_merge_uses_one_of_the_best_bases() {
    let repo = setup();
    repo.create_branch("a", None).await.unwrap();
    commit(&repo, "a", vec![write("f", "1\n2\n3\n", FILE_MODE)]).await; // O
    repo.create_branch("b", Some("a")).await.unwrap();
    commit(&repo, "a", vec![write("a", "a", FILE_MODE)]).await; // A1
    commit(&repo, "b", vec![write("b", "b", FILE_MODE)]).await; // B1
    repo.create_branch("b1", Some("b")).await.unwrap();
    repo.create_branch("a1", Some("a")).await.unwrap();
    repo.merge("a", "b1", "A2", None).await.unwrap();
    repo.merge("b", "a1", "B2", None).await.unwrap();
    commit(&repo, "a", vec![write("f", "one\n2\n3\n", FILE_MODE)]).await;
    commit(&repo, "b", vec![write("f", "1\n2\nthree\n", FILE_MODE)]).await;

    let merged = repo.merge("a", "b", "both", None).await.unwrap();
    assert!(matches!(merged, Merged::Done(_)), "{merged:?}");
    assert_eq!(text(&repo, "a", "f").await, "one\n2\nthree\n");
    for path in ["a", "b"] {
        assert_eq!(text(&repo, "a", path).await, path);
    }
}
