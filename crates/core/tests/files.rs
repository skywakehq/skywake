//! Reading and changing single files, and merging branches.

use std::sync::Arc;

use object_store::memory::InMemory;
use skywake_core::{Change, Entry, Error, FILE_MODE, Merged, Repo, Resolution, Take, files};

fn setup() -> Repo {
    Repo::new(Arc::new(InMemory::new()))
}

async fn write(repo: &Repo, branch: &str, path: &str, text: &str) {
    let mut position = repo.position(branch).await.unwrap();
    let file = files::store(repo.objects(), text.as_bytes(), FILE_MODE)
        .await
        .unwrap();
    let tree = files::put(&position.trees, position.tree, path, Some(file))
        .await
        .unwrap();
    repo.save(&mut position, tree, Some(path)).await.unwrap();
}

async fn read(repo: &Repo, branch: &str, path: &str) -> Option<String> {
    let (root, trees) = repo.head_tree(branch).await.unwrap();
    let Entry::File { data, size, .. } = files::find(&trees, root, path).await.unwrap()? else {
        panic!("{path} is not a file");
    };
    let bytes = files::read(repo.objects(), &data, 0, size).await.unwrap();
    Some(String::from_utf8(bytes).unwrap())
}

#[tokio::test]
async fn files_can_be_written_read_and_removed_without_a_folder() {
    let repo = setup();
    repo.create_branch("main", None).await.unwrap();
    write(&repo, "main", "a/b/c.txt", "hello").await;
    assert_eq!(read(&repo, "main", "a/b/c.txt").await.unwrap(), "hello");
    assert_eq!(read(&repo, "main", "a/missing").await, None);

    let big: String = (0..300_000).map(|i| format!("{i}\n")).collect();
    write(&repo, "main", "big.txt", &big).await;
    let (root, trees) = repo.head_tree("main").await.unwrap();
    let Some(Entry::File { data, .. }) = files::find(&trees, root, "big.txt").await.unwrap() else {
        panic!("big.txt is missing");
    };
    let middle = files::read(repo.objects(), &data, 1_000_000, 10)
        .await
        .unwrap();
    assert_eq!(middle, big.as_bytes()[1_000_000..1_000_010]);

    let paths: Vec<String> = files::walk(&trees, root)
        .await
        .unwrap()
        .into_iter()
        .map(|(path, _)| path)
        .collect();
    assert_eq!(paths, ["a/b/c.txt", "big.txt"]);

    let mut position = repo.position("main").await.unwrap();
    assert!(matches!(
        files::put(&position.trees, position.tree, "a/b/c.txt/d", None).await,
        Err(Error::NotAFolder(_))
    ));
    assert!(matches!(
        files::put(&position.trees, position.tree, "../x", None).await,
        Err(Error::InvalidPath(_))
    ));
    let tree = files::put(&position.trees, position.tree, "a/b/c.txt", None)
        .await
        .unwrap();
    repo.save(&mut position, tree, Some("remove"))
        .await
        .unwrap();
    assert_eq!(read(&repo, "main", "a/b/c.txt").await, None);
}

#[tokio::test]
async fn merge_combines_changes_from_both_sides() {
    let repo = setup();
    repo.create_branch("main", None).await.unwrap();
    write(&repo, "main", "notes.txt", "one\ntwo\nthree\nfour\nfive\n").await;
    write(&repo, "main", "keep.txt", "same").await;
    repo.create_branch("agent", Some("main")).await.unwrap();

    write(&repo, "main", "notes.txt", "ONE\ntwo\nthree\nfour\nfive\n").await;
    write(&repo, "main", "main-only.txt", "m").await;
    write(&repo, "agent", "notes.txt", "one\ntwo\nthree\nfour\nFIVE\n").await;
    write(&repo, "agent", "src/agent.txt", "a").await;

    let Merged::Done(_) = repo
        .merge("main", "agent", "merge agent", Some("s-1"))
        .await
        .unwrap()
    else {
        panic!("the merge should be clean");
    };
    assert_eq!(
        read(&repo, "main", "notes.txt").await.unwrap(),
        "ONE\ntwo\nthree\nfour\nFIVE\n"
    );
    assert_eq!(read(&repo, "main", "src/agent.txt").await.unwrap(), "a");
    assert_eq!(read(&repo, "main", "main-only.txt").await.unwrap(), "m");
    assert_eq!(read(&repo, "main", "keep.txt").await.unwrap(), "same");

    let log = repo.log("main").await.unwrap();
    let (_, merge) = &log[0];
    assert_eq!(merge.session.as_deref(), Some("s-1"));
    assert_eq!(merge.merged, Some(repo.head_commit("agent").await.unwrap()));
    let changes = repo.changes(merge).await.unwrap();
    assert_eq!(
        changes,
        [
            Change::Modified("notes.txt".into()),
            Change::Added("src".into())
        ]
    );

    let head = repo.head_commit("main").await.unwrap();
    assert_eq!(
        repo.merge("main", "agent", "again", None).await.unwrap(),
        Merged::Done(head)
    );
    write(&repo, "agent", "notes.txt", "one\ntwo\nTHREE\nfour\nFIVE\n").await;
    repo.merge("main", "agent", "again", None).await.unwrap();
    assert_eq!(
        read(&repo, "main", "notes.txt").await.unwrap(),
        "ONE\ntwo\nTHREE\nfour\nFIVE\n"
    );
}

#[tokio::test]
async fn merge_reports_conflicts_and_saves_nothing() {
    let repo = setup();
    repo.create_branch("main", None).await.unwrap();
    write(&repo, "main", "config", "port = 1\n").await;
    repo.create_branch("agent", Some("main")).await.unwrap();
    write(&repo, "main", "config", "port = 2\n").await;
    write(&repo, "agent", "config", "port = 3\n").await;
    write(&repo, "agent", "other", "fine").await;

    let head = repo.head_commit("main").await.unwrap();
    assert_eq!(
        repo.merge("main", "agent", "merge", None).await.unwrap(),
        Merged::Conflicts(vec!["config".into()])
    );
    assert_eq!(repo.head_commit("main").await.unwrap(), head);
}

#[tokio::test]
async fn merge_into_an_unchanged_branch_takes_the_other_tree() {
    let repo = setup();
    repo.create_branch("main", None).await.unwrap();
    write(&repo, "main", "a", "1").await;
    repo.create_branch("agent", Some("main")).await.unwrap();
    write(&repo, "agent", "a", "2").await;
    repo.merge("main", "agent", "merge", None).await.unwrap();
    let (main, _) = repo.head_tree("main").await.unwrap();
    let (agent, _) = repo.head_tree("agent").await.unwrap();
    assert_eq!(main, agent);
}

#[tokio::test]
async fn a_resolved_merge_lands_with_both_parents() {
    let repo = setup();
    repo.create_branch("main", None).await.unwrap();
    write(&repo, "main", "a", "base").await;
    write(&repo, "main", "b", "base").await;
    write(&repo, "main", "c", "base").await;
    repo.create_branch("agent", Some("main")).await.unwrap();
    for path in ["a", "b", "c"] {
        write(&repo, "main", path, "ours").await;
        write(&repo, "agent", path, "theirs").await;
    }
    let resolve = |path: &str, take| Resolution {
        path: path.into(),
        take,
    };

    let partial = vec![resolve("a", Take::Ours)];
    assert_eq!(
        repo.merge_resolved("main", "agent", "m", None, partial)
            .await
            .unwrap(),
        Merged::Conflicts(vec!["b".into(), "c".into()])
    );

    let all = vec![
        resolve("a", Take::Ours),
        resolve("b", Take::Theirs),
        resolve("c", Take::Bytes(b"both".to_vec(), FILE_MODE)),
    ];
    let Merged::Done(head) = repo
        .merge_resolved("main", "agent", "m", None, all)
        .await
        .unwrap()
    else {
        panic!("the merge did not land");
    };
    assert_eq!(read(&repo, "main", "a").await.unwrap(), "ours");
    assert_eq!(read(&repo, "main", "b").await.unwrap(), "theirs");
    assert_eq!(read(&repo, "main", "c").await.unwrap(), "both");
    let (hash, merge) = &repo.log("main").await.unwrap()[0];
    assert_eq!(*hash, head);
    assert_eq!(merge.merged, Some(repo.head_commit("agent").await.unwrap()));
    // Merged once, the same branch has nothing new.
    assert_eq!(
        repo.merge("main", "agent", "again", None).await.unwrap(),
        Merged::Done(head)
    );
}

#[tokio::test]
async fn the_merge_base_is_where_branches_last_met() {
    let repo = setup();
    repo.create_branch("main", None).await.unwrap();
    write(&repo, "main", "a", "1").await;
    repo.create_branch("agent", Some("main")).await.unwrap();
    let fork = repo.head_commit("main").await.unwrap();
    write(&repo, "main", "b", "1").await;
    write(&repo, "agent", "c", "1").await;
    assert_eq!(
        repo.merge_base_of("agent", "main").await.unwrap(),
        Some(fork)
    );
    let agent = repo.head_commit("agent").await.unwrap();
    assert_eq!(
        repo.diff_commits(fork, agent).await.unwrap(),
        [Change::Added("c".into())]
    );

    repo.merge("agent", "main", "sync", None).await.unwrap();
    let main = repo.head_commit("main").await.unwrap();
    assert_eq!(
        repo.merge_base_of("agent", "main").await.unwrap(),
        Some(main)
    );
}
