//! Garbage collection against writers that reuse old data, and halfway stops.

mod common;

use std::sync::Arc;
use std::time::Duration;

use common::{Fault, Faulty, Op};
use futures::{FutureExt, TryStreamExt};
use object_store::path::Path;
use object_store::{ObjectStore, ObjectStoreExt};
use skywake_core::{
    Chunk, Commit, Content, Data, Edit, Entry, Error, FILE_MODE, Hash, Merged, Pack, Packs, Refs,
    Repo, Tree, files,
};
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

async fn paths(store: &Faulty, prefix: &str) -> Vec<Path> {
    let listing: Vec<_> = store
        .0
        .inner
        .list(Some(&Path::from(prefix)))
        .try_collect()
        .await
        .unwrap();
    listing.into_iter().map(|meta| meta.location).collect()
}

fn large_folder() -> Tree {
    (0..3000)
        .map(|i| {
            let data = Data::Inline(format!("file {i}").into_bytes());
            (format!("file-{i}.txt"), files::file(data, FILE_MODE))
        })
        .collect()
}

#[tokio::test]
async fn a_claim_never_reuses_a_pack_only_a_replaced_autosave_used() {
    let store = Faulty::new();
    let repo = Repo::new(Arc::new(store.clone()));
    repo.create_branch("main", None).await.unwrap();
    let mut claim = repo.claim("main").await.unwrap();
    let folder = large_folder();
    let with_folder = |claim: &skywake_core::Claim| {
        let folder = claim.trees.add(folder.clone()).unwrap();
        let root = Tree::from([("dir".to_string(), Entry::Dir { tree: folder })]);
        claim.trees.add(root).unwrap()
    };

    let root = with_folder(&claim);
    repo.save(&mut claim, root, None).await.unwrap();
    assert!(!paths(&store, "objects").await.is_empty(), "no pack");
    let empty = claim.trees.add(Tree::new()).unwrap();
    repo.save(&mut claim, empty, None).await.unwrap();
    store.age_everything().await;
    repo.collect_garbage(GRACE, false).await.unwrap();

    let root = with_folder(&claim);
    repo.save(&mut claim, root, None).await.unwrap();
    let (entry, inside) = repo.list("main", None, "dir").await.unwrap();
    assert!(matches!(entry, Entry::Dir { .. }));
    assert_eq!(inside.len(), 3000);
}

#[tokio::test]
async fn a_young_commit_keeps_old_data_that_only_it_uses() {
    let store = Faulty::new();
    let repo = Repo::new(Arc::new(store.clone()));
    repo.create_branch("main", None).await.unwrap();
    let mut claim = repo.claim("main").await.unwrap();
    let file = files::store(repo.objects(), &big(1), FILE_MODE)
        .await
        .unwrap();
    let tree = files::put(&claim.trees, claim.tree, "dir/data", Some(file))
        .await
        .unwrap();
    repo.save(&mut claim, tree, None).await.unwrap();
    store.age_everything().await;

    let autosave = repo.head_commit("main").await.unwrap();
    let empty = files::put(&claim.trees, claim.tree, "dir", None)
        .await
        .unwrap();
    repo.save(&mut claim, empty, None).await.unwrap();
    repo.collect_garbage(GRACE, false).await.unwrap();

    repo.fork_at("back", autosave).await.unwrap();
    let out = tempdir().unwrap();
    repo.checkout("back", out.path()).await.unwrap();
    assert_eq!(std::fs::read(out.path().join("dir/data")).unwrap(), big(1));
}

#[tokio::test]
async fn a_collection_that_stops_halfway_leaves_no_commit_without_its_data() {
    let store = Faulty::new();
    let repo = Repo::new(Arc::new(store.clone()));
    repo.create_branch("old", None).await.unwrap();
    let commit = repo
        .commit_files("old", "old work", None, vec![put("dir/data", big(1))])
        .await
        .unwrap();
    repo.delete_branch("old").await.unwrap();
    repo.create_branch("main", None).await.unwrap();
    store.age_everything().await;

    let chunks = paths(&store, "chunks").await;
    let inner = store.0.inner.clone();
    store.on(Op::Delete, "chunks/", 1, move || {
        let (inner, chunk) = (inner.clone(), chunks[0].clone());
        async move { inner.delete(&chunk).await.unwrap() }.boxed()
    });
    store.fail(Op::Delete, "chunks/", Fault::Fail, 1);
    assert!(repo.collect_garbage(GRACE, false).await.is_err());

    match repo.fork_at("back", commit).await {
        Err(Error::Store(object_store::Error::NotFound { .. })) => {}
        forked => {
            forked.unwrap();
            let out = tempdir().unwrap();
            repo.checkout("back", out.path()).await.unwrap();
        }
    }
}

#[tokio::test]
async fn chunks_by_hash_must_exist() {
    let store = Faulty::new();
    let repo = Repo::new(Arc::new(store.clone()));
    repo.create_branch("main", None).await.unwrap();
    let made_up = Edit {
        path: "file".into(),
        content: Content::Chunks(vec![Chunk {
            hash: Hash::of(b"never stored"),
            size: 12,
        }]),
        mode: FILE_MODE,
    };
    let committed = repo.commit_files("main", "bad", None, vec![made_up]).await;
    assert!(
        matches!(
            committed,
            Err(Error::Store(object_store::Error::NotFound { .. }))
        ),
        "{committed:?}"
    );
}

#[tokio::test]
async fn old_chunks_by_hash_are_never_used_while_a_collection_deletes_them() {
    let store = Faulty::new();
    let repo = Repo::new(Arc::new(store.clone()));
    repo.create_branch("main", None).await.unwrap();
    let chunks = repo.store_part(&big(1)).await.unwrap();
    store.age_everything().await;

    let sweep = store.gate(Op::Delete, "chunks/");
    let collecting = tokio::spawn({
        let repo = repo.clone();
        async move { repo.collect_garbage(GRACE, false).await }
    });
    sweep.reached().await;
    let edit = Edit {
        path: "file".into(),
        content: Content::Chunks(chunks),
        mode: FILE_MODE,
    };
    let committing = tokio::spawn({
        let repo = repo.clone();
        async move { repo.commit_files("main", "late", None, vec![edit]).await }
    });
    tokio::time::sleep(Duration::from_millis(200)).await;
    sweep.open();
    collecting.await.unwrap().unwrap();

    let committed = committing.await.unwrap();
    assert!(
        matches!(
            committed,
            Err(Error::Store(object_store::Error::NotFound { .. }))
        ),
        "{committed:?}"
    );
}

#[tokio::test]
async fn a_fork_of_an_autosave_does_not_wait_for_a_collection() {
    let store = Faulty::new();
    let repo = Repo::new(Arc::new(store.clone()));
    repo.create_branch("source", None).await.unwrap();
    let mut claim = repo.claim("source").await.unwrap();
    let file = files::store(repo.objects(), b"data", FILE_MODE)
        .await
        .unwrap();
    let tree = files::put(&claim.trees, claim.tree, "file", Some(file))
        .await
        .unwrap();
    repo.save(&mut claim, tree, None).await.unwrap();

    let sweep = store.gate(Op::List, "commits");
    let collecting = tokio::spawn({
        let repo = repo.clone();
        async move { repo.collect_garbage(GRACE, false).await }
    });
    sweep.reached().await;
    let forked = tokio::time::timeout(
        Duration::from_secs(2),
        repo.create_branch("fork", Some("source")),
    )
    .await;
    sweep.open();
    collecting.await.unwrap().unwrap();
    forked.expect("the fork waited for the collection").unwrap();
}

#[tokio::test]
async fn a_failed_cleanup_still_frees_the_collection_lock() {
    let store = Faulty::new();
    let repo = Repo::new(Arc::new(store.clone()));
    repo.create_branch("gone", None).await.unwrap();
    repo.delete_branch("gone").await.unwrap();
    store.age_everything().await;

    store.fail(Op::Delete, "deleted/", Fault::Fail, 1);
    assert!(repo.collect_garbage(GRACE, false).await.is_err());
    repo.collect_garbage(GRACE, false).await.unwrap();
}

#[tokio::test]
async fn a_tree_that_does_not_match_its_hash_is_refused() {
    let store = Faulty::new();
    let repo = Repo::new(Arc::new(store.clone()));
    let real = Tree::from([(
        "a".to_string(),
        files::file(Data::Inline(b"real".to_vec()), FILE_MODE),
    )]);
    let fake = Tree::from([(
        "a".to_string(),
        files::file(Data::Inline(b"fake".to_vec()), FILE_MODE),
    )]);
    let claimed = Hash::of(&postcard::to_stdvec(&real).unwrap());
    let pack = Pack {
        trees: vec![(claimed, fake)],
        ..Pack::default()
    };
    let pack = repo.objects().put(&pack).await.unwrap();
    let packs = Packs {
        packed: vec![(claimed, pack)],
        ..Packs::default()
    };
    let commit = Commit::new(claimed, packs, None, "forged");
    Refs::new(store.0.inner.clone())
        .create("main", commit)
        .await
        .unwrap();

    let read = repo.read("main", None, "a", 0, 100).await;
    assert!(matches!(read, Err(Error::Corrupt(_))), "{read:?}");
}

#[tokio::test]
async fn a_head_write_whose_outcome_is_unknown_is_not_a_conflict() {
    let store = Faulty::new();
    let repo = Repo::new(Arc::new(store.clone()));
    repo.create_branch("main", None).await.unwrap();

    store.fail(Op::Put, "refs/main", Fault::PreconditionAfter, 1);
    let failing = store.clone();
    store.on(Op::Put, "refs/main", 1, move || {
        failing.fail(Op::Get, "refs/main", Fault::Fail, 1);
        async {}.boxed()
    });
    let committed = repo
        .commit_files("main", "one", None, vec![put("a", vec![1])])
        .await;
    assert!(
        matches!(committed, Err(Error::Unsettled(_))),
        "{committed:?}"
    );
}

#[tokio::test]
async fn a_delete_whose_outcome_is_unknown_keeps_the_record_of_the_head() {
    let store = Faulty::new();
    let repo = Repo::new(Arc::new(store.clone()));
    repo.create_branch("main", None).await.unwrap();

    store.fail(Op::Put, "refs/main", Fault::PreconditionAfter, 1);
    let failing = store.clone();
    store.on(Op::Put, "refs/main", 1, move || {
        failing.fail(Op::Get, "refs/main", Fault::Fail, 1);
        async {}.boxed()
    });
    let deleted = repo.delete_branch("main").await;
    assert!(matches!(deleted, Err(Error::Unsettled(_))), "{deleted:?}");
    assert!(
        repo.branches().await.unwrap().is_empty(),
        "the delete landed"
    );
    assert_eq!(paths(&store, "deleted").await.len(), 1);
}

#[tokio::test]
async fn credentials_that_may_not_delete_stop_the_collection_clearly() {
    let store = Faulty::new();
    let repo = Repo::new(Arc::new(store.clone()));
    repo.create_branch("old", None).await.unwrap();
    repo.commit_files("old", "old work", None, vec![put("data", big(1))])
        .await
        .unwrap();
    repo.delete_branch("old").await.unwrap();
    store.age_everything().await;

    store.fail(Op::Delete, "commits/", Fault::Denied, 1);
    let collected = repo.collect_garbage(GRACE, false).await;
    assert!(
        matches!(&collected, Err(Error::Collection(message)) if message.contains("may not delete")),
        "{collected:?}"
    );
    repo.collect_garbage(GRACE, false).await.unwrap();
}

fn open_when_a_writer_checks_the_lock(store: &Faulty, gate: &common::Gate) {
    let gate = gate.clone();
    store.on(Op::Get, "gc/lock", 1, move || {
        gate.open();
        async {}.boxed()
    });
}

#[tokio::test]
async fn chunks_stored_again_while_a_collection_deletes_them_survive() {
    let store = Faulty::new();
    let repo = Repo::new(Arc::new(store.clone()));
    repo.create_branch("main", None).await.unwrap();
    repo.create_branch("old", None).await.unwrap();
    repo.commit_files("old", "old", None, vec![put("dir/data", big(1))])
        .await
        .unwrap();
    repo.delete_branch("old").await.unwrap();
    store.age_everything().await;

    let sweep = store.gate(Op::Delete, "chunks/");
    let collecting = tokio::spawn({
        let repo = repo.clone();
        async move { repo.collect_garbage(GRACE, false).await }
    });
    sweep.reached().await;
    open_when_a_writer_checks_the_lock(&store, &sweep);
    repo.commit_files("main", "again", None, vec![put("dir/data", big(1))])
        .await
        .unwrap();
    sweep.open();
    collecting.await.unwrap().unwrap();

    let out = tempdir().unwrap();
    repo.checkout("main", out.path()).await.unwrap();
    assert_eq!(std::fs::read(out.path().join("dir/data")).unwrap(), big(1));
}

#[tokio::test]
async fn a_pack_stored_again_while_a_collection_deletes_it_is_never_used_missing() {
    let store = Faulty::new();
    let repo = Repo::new(Arc::new(store.clone()));
    let folder = large_folder();
    let with_folder = |claim: &skywake_core::Claim| {
        let folder = claim.trees.add(folder.clone()).unwrap();
        let root = Tree::from([("dir".to_string(), Entry::Dir { tree: folder })]);
        claim.trees.add(root).unwrap()
    };
    repo.create_branch("old", None).await.unwrap();
    let mut claim = repo.claim("old").await.unwrap();
    let root = with_folder(&claim);
    repo.save(&mut claim, root, Some("old")).await.unwrap();
    repo.delete_branch("old").await.unwrap();
    store.age_everything().await;
    let old_packs = paths(&store, "objects").await;
    assert_eq!(old_packs.len(), 1);

    repo.create_branch("main", None).await.unwrap();
    let mut claim = repo.claim("main").await.unwrap();
    let sweep = store.gate(Op::Delete, "objects/");
    let collecting = tokio::spawn({
        let repo = repo.clone();
        async move { repo.collect_garbage(GRACE, false).await }
    });
    sweep.reached().await;
    open_when_a_writer_checks_the_lock(&store, &sweep);
    let root = with_folder(&claim);
    let saved = repo.save(&mut claim, root, None).await;
    sweep.open();
    collecting.await.unwrap().unwrap();

    match saved {
        Err(Error::Store(object_store::Error::NotFound { path, .. })) => {
            assert_eq!(path, old_packs[0].to_string())
        }
        saved => {
            saved.unwrap();
            let (_, inside) = repo.list("main", None, "dir").await.unwrap();
            assert_eq!(inside.len(), 3000);
        }
    }
}

#[tokio::test]
async fn a_commit_whose_parent_a_stopped_collection_deleted_still_has_a_history() {
    let store = Faulty::new();
    let repo = Repo::new(Arc::new(store.clone()));
    repo.create_branch("main", None).await.unwrap();
    repo.commit_files("main", "main", None, vec![put("m", vec![1])])
        .await
        .unwrap();
    repo.create_branch("old", None).await.unwrap();
    let mut chain: Vec<Hash> = Vec::new();
    while chain.len() < 2 || chain.iter().min_by_key(|c| c.to_string()) == chain.last() {
        let i = chain.len() as u8;
        let edit = put("f", vec![i]);
        chain.push(
            repo.commit_files("old", "old", None, vec![edit])
                .await
                .unwrap(),
        );
    }
    repo.delete_branch("old").await.unwrap();
    store.age_everything().await;

    let newest = *chain.last().unwrap();
    store.fail(
        Op::Delete,
        &format!("commits/{newest}"),
        Fault::Fail,
        usize::MAX,
    );
    assert!(repo.collect_garbage(GRACE, false).await.is_err());
    let commits = paths(&store, "commits").await;
    let exists = |commit: &Hash| commits.contains(&Path::from(format!("commits/{commit}")));
    assert!(exists(&newest));
    assert!(!chain.iter().all(exists), "no older commit was deleted");

    repo.fork_at("back", newest).await.unwrap();
    let log = repo.log("back").await.unwrap();
    assert_eq!(log[0].0, newest);
    let history = repo.file_history("back", "f").await.unwrap();
    assert_eq!(history[0].0, newest);
    repo.changes_since("back", None, 100).await.unwrap();
    let merged = repo.merge("main", "back", "merge", None).await.unwrap();
    assert!(matches!(merged, Merged::Done(_)), "{merged:?}");
}

#[tokio::test]
async fn objects_whose_names_are_not_hashes_are_never_deleted() {
    let store = Faulty::new();
    let repo = Repo::new(Arc::new(store.clone()));
    repo.create_branch("main", None).await.unwrap();
    for name in ["chunks/notes.txt", "objects/README", "commits/x"] {
        store.put(&Path::from(name), vec![1].into()).await.unwrap();
    }
    store.age_everything().await;

    let collected = repo.collect_garbage(GRACE, false).await.unwrap();
    assert_eq!(collected.unknown, 3);
    for name in ["chunks/notes.txt", "objects/README", "commits/x"] {
        store.head(&Path::from(name)).await.unwrap();
    }
}

async fn bundled(repo: &Repo, names: &[(String, Vec<u8>)]) -> Vec<(String, Entry)> {
    let bundler = skywake_core::Bundler::new(repo.objects());
    let mut entries = Vec::new();
    for (name, bytes) in names {
        let data = bundler.add(bytes.clone()).await.unwrap();
        entries.push((name.clone(), files::file(data, FILE_MODE)));
    }
    bundler.finish().await.unwrap();
    entries
}

fn ten() -> Vec<(String, Vec<u8>)> {
    (0..10u8).map(|i| (format!("f{i}"), big(i))).collect()
}

async fn three_of_ten(store: &Faulty) -> (Repo, Vec<(String, Entry)>) {
    let repo = Repo::new(Arc::new(store.clone()));
    repo.create_branch("main", None).await.unwrap();
    let mut claim = repo.claim("main").await.unwrap();
    let entries = bundled(&repo, &ten()).await;
    let all = claim.trees.add(entries.iter().cloned().collect()).unwrap();
    repo.save(&mut claim, all, None).await.unwrap();
    let three = claim
        .trees
        .add(entries[..3].iter().cloned().collect())
        .unwrap();
    repo.save(&mut claim, three, Some("keep three"))
        .await
        .unwrap();
    store.age_everything().await;
    (repo, entries)
}

#[tokio::test]
async fn a_mostly_unused_bundle_is_compacted_and_its_files_still_read() {
    let store = Faulty::new();
    let (repo, _) = three_of_ten(&store).await;
    let collected = repo.collect_garbage(GRACE, false).await.unwrap();
    assert_eq!(collected.compacted, 1);
    assert_eq!(paths(&store, "bundles").await.len(), 1);
    assert_eq!(paths(&store, "moved").await.len(), 1);

    let fresh = Repo::new(Arc::new(store.clone()));
    for (name, bytes) in &ten()[..3] {
        assert_eq!(
            &fresh.read("main", None, name, 0, u64::MAX).await.unwrap(),
            bytes
        );
    }

    store.age_everything().await;
    let again = repo.collect_garbage(GRACE, false).await.unwrap();
    assert_eq!((again.compacted, again.deleted), (0, 0));
    assert_eq!(paths(&store, "moved").await.len(), 1);
}

#[tokio::test]
async fn a_commit_can_name_a_compacted_file_but_not_a_dropped_one() {
    let store = Faulty::new();
    let (repo, entries) = three_of_ten(&store).await;
    repo.collect_garbage(GRACE, false).await.unwrap();

    let mut claim = repo.claim("main").await.unwrap();
    let mut tree: Tree = entries[..3].iter().cloned().collect();
    tree.insert("copy".into(), entries[0].1.clone());
    let root = claim.trees.add(tree.clone()).unwrap();
    repo.save(&mut claim, root, Some("a copy")).await.unwrap();

    tree.insert("back".into(), entries[7].1.clone());
    let root = claim.trees.add(tree.clone()).unwrap();
    assert!(
        repo.save(&mut claim, root, Some("bring one back"))
            .await
            .is_err()
    );
    let again = bundled(&repo, &[("back".into(), big(7))]).await;
    tree.extend(again);
    let root = claim.trees.add(tree).unwrap();
    repo.save(&mut claim, root, Some("bring one back"))
        .await
        .unwrap();

    store.age_everything().await;
    repo.collect_garbage(GRACE, false).await.unwrap();
    let fresh = Repo::new(Arc::new(store.clone()));
    assert_eq!(
        fresh.read("main", None, "copy", 0, u64::MAX).await.unwrap(),
        big(0)
    );
    assert_eq!(
        fresh.read("main", None, "back", 0, u64::MAX).await.unwrap(),
        big(7)
    );
}

#[tokio::test]
async fn bundles_and_moved_records_go_when_no_branch_uses_them() {
    let store = Faulty::new();
    let (repo, _) = three_of_ten(&store).await;
    repo.collect_garbage(GRACE, false).await.unwrap();
    repo.delete_branch("main").await.unwrap();
    store.age_everything().await;
    repo.collect_garbage(GRACE, false).await.unwrap();
    store.age_everything().await;
    repo.collect_garbage(GRACE, false).await.unwrap();
    assert!(paths(&store, "bundles").await.is_empty());
    assert!(paths(&store, "moved").await.is_empty());
}
