//! Tests for branches, commits, files and history through `Repo`.

use std::fs;
use std::os::unix::fs::{PermissionsExt, symlink};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use futures::TryStreamExt;
use object_store::memory::InMemory;
use object_store::path::Path as StorePath;
use object_store::{ObjectStore, ObjectStoreExt};
use skywake_core::{Change, Data, Entry, Error, INLINE_BUDGET, Refs, Repo, Trees, open_store};
use tempfile::tempdir;

fn setup() -> (Arc<InMemory>, Repo) {
    let store = Arc::new(InMemory::new());
    (store.clone(), Repo::new(store))
}

async fn count(store: &InMemory, prefix: &str) -> usize {
    let listing: Vec<_> = store
        .list(Some(&StorePath::from(prefix)))
        .try_collect()
        .await
        .unwrap();
    listing.len()
}

fn write_project(dir: &Path) {
    fs::create_dir_all(dir.join("src/nested")).unwrap();
    fs::write(dir.join("README.md"), "hello").unwrap();
    fs::write(dir.join("src/main.rs"), "fn main() {}").unwrap();
    fs::write(dir.join("src/nested/big.bin"), pseudo_random(1 << 20)).unwrap();
    fs::write(dir.join("run.sh"), "#!/bin/sh\necho hi").unwrap();
    fs::set_permissions(dir.join("run.sh"), fs::Permissions::from_mode(0o755)).unwrap();
    fs::write(dir.join("key"), "secret").unwrap();
    fs::set_permissions(dir.join("key"), fs::Permissions::from_mode(0o600)).unwrap();
    symlink("src/main.rs", dir.join("entry")).unwrap();
}

fn pseudo_random(len: usize) -> Vec<u8> {
    let mut state: u64 = 0x9E37_79B9_7F4A_7C15;
    (0..len)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            state as u8
        })
        .collect()
}

#[tokio::test]
async fn checkout_restores_what_was_committed() {
    let (_, repo) = setup();
    let work = tempdir().unwrap();
    write_project(work.path());

    repo.create_branch("main", None).await.unwrap();
    repo.commit("main", work.path(), "first").await.unwrap();

    let out = tempdir().unwrap();
    repo.checkout("main", out.path()).await.unwrap();

    for file in ["README.md", "src/main.rs", "src/nested/big.bin", "run.sh"] {
        assert_eq!(
            fs::read(work.path().join(file)).unwrap(),
            fs::read(out.path().join(file)).unwrap(),
            "{file}"
        );
    }
    let mode = fs::metadata(out.path().join("run.sh"))
        .unwrap()
        .permissions()
        .mode();
    assert_ne!(mode & 0o111, 0, "executable bit survives");
    let key = fs::metadata(out.path().join("key")).unwrap().permissions();
    assert_eq!(key.mode() & 0o777, 0o600, "private files stay private");
    assert_eq!(
        fs::read_link(out.path().join("entry")).unwrap(),
        Path::new("src/main.rs")
    );
}

#[tokio::test]
async fn deep_trees_do_not_run_out_of_open_files() {
    let (_, repo) = setup();
    let dir = tempdir().unwrap();
    for i in 0..16 * 16 * 16 {
        let folder = dir.path().join(format!("a{}/b{}", i / 256, i / 16 % 16));
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join(format!("f{i}")), pseudo_random(5000 + i)).unwrap();
    }
    repo.create_branch("main", None).await.unwrap();
    repo.commit("main", dir.path(), "deep").await.unwrap();
    let out = tempdir().unwrap();
    repo.checkout("main", out.path()).await.unwrap();
    assert_eq!(
        fs::read(out.path().join("a15/b15/f4095")).unwrap(),
        pseudo_random(5000 + 4095)
    );
}

#[tokio::test]
async fn commits_keep_small_files_inline_only_up_to_a_budget() {
    let (_, repo) = setup();
    let dir = tempdir().unwrap();
    for i in 0..100 {
        fs::write(dir.path().join(format!("f{i:03}")), pseudo_random(2000 + i)).unwrap();
    }
    repo.create_branch("main", None).await.unwrap();
    repo.commit("main", dir.path(), "many small files")
        .await
        .unwrap();

    let (root, trees) = repo.head_tree("main").await.unwrap();
    let tree = trees.get(root).await.unwrap();
    let inline: usize = tree
        .values()
        .map(|entry| match entry {
            Entry::File {
                data: Data::Inline(bytes),
                ..
            } => bytes.len(),
            _ => 0,
        })
        .sum();
    assert!(inline <= INLINE_BUDGET && inline > INLINE_BUDGET / 2);
    let out = tempdir().unwrap();
    repo.checkout("main", out.path()).await.unwrap();
    for i in 0..100 {
        assert_eq!(
            fs::read(out.path().join(format!("f{i:03}"))).unwrap(),
            pseudo_random(2000 + i)
        );
    }
}

#[tokio::test]
async fn fork_copies_no_data() {
    let (store, repo) = setup();
    let work = tempdir().unwrap();
    write_project(work.path());
    repo.create_branch("main", None).await.unwrap();
    let head = repo.commit("main", work.path(), "base").await.unwrap();

    let chunks = count(&store, "chunks").await;
    let objects = count(&store, "objects").await;
    for agent in 0..100 {
        let fork = repo
            .create_branch(&format!("agent-{agent}"), Some("main"))
            .await
            .unwrap();
        assert_eq!(fork, head);
    }

    assert_eq!(count(&store, "chunks").await, chunks);
    assert_eq!(count(&store, "objects").await, objects);
    assert_eq!(repo.branches().await.unwrap().len(), 101);
}

#[tokio::test]
async fn diff_shows_only_what_a_fork_changed() {
    let (_, repo) = setup();
    let work = tempdir().unwrap();
    write_project(work.path());
    repo.create_branch("main", None).await.unwrap();
    repo.commit("main", work.path(), "base").await.unwrap();
    repo.create_branch("agent", Some("main")).await.unwrap();

    let agent = tempdir().unwrap();
    let agent = agent.path().join("tree");
    repo.checkout("agent", &agent).await.unwrap();
    fs::write(agent.join("src/main.rs"), "fn main() { work() }").unwrap();
    fs::remove_file(agent.join("README.md")).unwrap();
    fs::write(agent.join("src/nested/notes.txt"), "done").unwrap();
    repo.commit("agent", &agent, "agent work").await.unwrap();

    assert_eq!(
        repo.diff("main", "agent").await.unwrap(),
        vec![
            Change::Removed("README.md".into()),
            Change::Modified("src/main.rs".into()),
            Change::Added("src/nested/notes.txt".into()),
        ]
    );
    assert!(repo.diff("main", "main").await.unwrap().is_empty());
}

#[tokio::test]
async fn small_edits_to_large_files_reuse_chunks() {
    let (store, repo) = setup();
    let work = tempdir().unwrap();
    let mut data = pseudo_random(4 << 20);
    fs::write(work.path().join("model.bin"), &data).unwrap();
    repo.create_branch("main", None).await.unwrap();
    repo.commit("main", work.path(), "v1").await.unwrap();
    let before = count(&store, "chunks").await;

    data[2 << 20] ^= 0xFF;
    fs::write(work.path().join("model.bin"), &data).unwrap();
    repo.commit("main", work.path(), "v2").await.unwrap();

    let added = count(&store, "chunks").await - before;
    assert!(
        added <= 2,
        "one flipped byte added {added} of {before} chunks"
    );
}

#[tokio::test]
async fn log_walks_history_newest_first() {
    let (_, repo) = setup();
    let work = tempdir().unwrap();
    repo.create_branch("main", None).await.unwrap();
    for message in ["one", "three"] {
        fs::write(work.path().join("file"), message).unwrap();
        repo.commit("main", work.path(), message).await.unwrap();
    }
    let messages: Vec<String> = repo
        .log("main")
        .await
        .unwrap()
        .into_iter()
        .map(|(_, commit)| commit.message)
        .collect();
    assert_eq!(messages, ["three", "one", "empty"]);
}

#[tokio::test]
async fn file_history_lists_only_commits_that_changed_the_file() {
    let (_, repo) = setup();
    let work = tempdir().unwrap();
    let (logo, other) = (work.path().join("logo.png"), work.path().join("other"));
    repo.create_branch("main", None).await.unwrap();
    let steps: [(&str, Option<&str>, &str); 5] = [
        ("add logo", Some("v1"), "a"),
        ("edit other", Some("v1"), "ab"),
        ("same logo again", Some("v1"), "abc"),
        ("new logo", Some("v2-bigger"), "abcd"),
        ("remove logo", None, "abcde"),
    ];
    for (message, logo_bytes, other_bytes) in steps {
        match logo_bytes {
            Some(bytes) => fs::write(&logo, bytes).unwrap(),
            None => fs::remove_file(&logo).unwrap(),
        }
        fs::write(&other, other_bytes).unwrap();
        repo.commit("main", work.path(), message).await.unwrap();
    }

    let versions = repo.file_history("main", "logo.png").await.unwrap();
    let seen: Vec<(String, Option<u64>)> = versions
        .into_iter()
        .map(|(_, commit, entry)| {
            let size = match entry {
                Some(Entry::File { size, .. }) => Some(size),
                _ => None,
            };
            (commit.message, size)
        })
        .collect();
    assert_eq!(
        seen,
        [
            ("remove logo".to_string(), None),
            ("new logo".to_string(), Some(9)),
            ("add logo".to_string(), Some(2)),
        ]
    );
    assert!(
        repo.file_history("main", "missing")
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn racing_writers_cannot_both_advance_a_branch() {
    let dir = tempdir().unwrap();
    let local = open_store(dir.path().to_str().unwrap()).unwrap();
    for store in [Arc::new(InMemory::new()) as Arc<dyn ObjectStore>, local] {
        let (repo, refs) = (Repo::new(store.clone()), Refs::new(store));
        repo.create_branch("main", None).await.unwrap();
        let head = refs.head("main").await.unwrap().unwrap();

        refs.advance("main", &head, head.commit.clone())
            .await
            .unwrap();
        let loser = refs.advance("main", &head, head.commit.clone()).await;

        assert!(matches!(loser, Err(Error::Conflict(_))), "{loser:?}");
        assert!(matches!(
            repo.create_branch("main", None).await,
            Err(Error::BranchExists(_))
        ));
    }
}

#[tokio::test]
async fn branch_names_are_unique_and_safe() {
    let (_, repo) = setup();
    repo.create_branch("main", None).await.unwrap();

    assert!(matches!(
        repo.create_branch("main", None).await,
        Err(Error::BranchExists(_))
    ));
    assert!(matches!(
        repo.create_branch("../escape", None).await,
        Err(Error::InvalidBranchName(_))
    ));
    assert!(matches!(
        repo.create_branch("x", Some("missing")).await,
        Err(Error::BranchNotFound(_))
    ));
    for bad in ["agents/", "/agents", "agents//1", "agents/.hidden"] {
        assert!(matches!(
            repo.create_branch(bad, None).await,
            Err(Error::InvalidBranchName(_))
        ));
    }
    repo.create_branch("agents/fix-1", Some("main"))
        .await
        .unwrap();
    assert_eq!(repo.branches().await.unwrap(), ["agents/fix-1", "main"]);
}

#[tokio::test]
async fn recommit_trusts_size_and_timestamp() {
    let (_, repo) = setup();
    let work = tempdir().unwrap();
    let file = work.path().join("data.txt");
    fs::write(&file, "aaaa").unwrap();
    repo.create_branch("main", None).await.unwrap();
    repo.commit("main", work.path(), "v1").await.unwrap();

    let stamp = fs::metadata(&file).unwrap().modified().unwrap();
    fs::write(&file, "bbbb").unwrap();
    fs::File::options()
        .write(true)
        .open(&file)
        .unwrap()
        .set_modified(stamp)
        .unwrap();
    repo.commit("main", work.path(), "v2").await.unwrap();

    let out = tempdir().unwrap();
    repo.checkout("main", out.path()).await.unwrap();
    assert_eq!(
        fs::read_to_string(out.path().join("data.txt")).unwrap(),
        "aaaa"
    );
}

#[tokio::test]
async fn untouched_checkout_commits_without_new_data() {
    let (store, repo) = setup();
    let work = tempdir().unwrap();
    write_project(work.path());
    repo.create_branch("main", None).await.unwrap();
    repo.commit("main", work.path(), "base").await.unwrap();
    repo.create_branch("agent", Some("main")).await.unwrap();

    let agent = tempdir().unwrap();
    repo.checkout("agent", agent.path()).await.unwrap();
    let chunks = count(&store, "chunks").await;
    repo.commit("agent", agent.path(), "nothing changed")
        .await
        .unwrap();

    assert_eq!(count(&store, "chunks").await, chunks);
    assert!(repo.diff("main", "agent").await.unwrap().is_empty());
}

#[tokio::test]
async fn small_trees_travel_in_the_head_and_large_ones_in_packs() {
    let (store, repo) = setup();
    repo.create_branch("main", None).await.unwrap();
    let work = tempdir().unwrap();
    write_project(work.path());
    repo.commit("main", work.path(), "small").await.unwrap();
    assert_eq!(count(&store, "commits").await, 2);
    assert_eq!(count(&store, "objects").await, 0);

    for i in 0..200 {
        let folder = work.path().join(format!("pkg{i}"));
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("index.js"), pseudo_random(1000 + i)).unwrap();
    }
    repo.commit("main", work.path(), "large").await.unwrap();
    assert_eq!(count(&store, "commits").await, 3);
    assert_eq!(count(&store, "objects").await, 1, "a pack");
    let out = tempdir().unwrap();
    repo.checkout("main", out.path()).await.unwrap();
    assert_eq!(
        fs::read(out.path().join("pkg199/index.js")).unwrap(),
        pseudo_random(1199)
    );
}

#[tokio::test]
async fn large_trees_split_into_packs_fetched_as_folders_open() {
    let (store, repo) = setup();
    repo.create_branch("main", None).await.unwrap();
    let work = tempdir().unwrap();
    let file = |folder: usize, i: usize| pseudo_random(1500 + folder * 40 + i);
    for folder in 0..40 {
        fs::create_dir_all(work.path().join(format!("d{folder}"))).unwrap();
        for i in 0..40 {
            fs::write(work.path().join(format!("d{folder}/f{i}")), file(folder, i)).unwrap();
        }
    }
    repo.commit("main", work.path(), "large").await.unwrap();
    let out = tempdir().unwrap();
    repo.checkout("main", out.path()).await.unwrap();
    assert_eq!(fs::read(out.path().join("d39/f39")).unwrap(), file(39, 39));

    let head = Refs::new(store.clone())
        .head("main")
        .await
        .unwrap()
        .unwrap();
    let [(root, root_pack)] = head.commit.packs.packed[..] else {
        panic!("the root should be in a pack")
    };
    let objects: Vec<_> = store
        .list(Some(&StorePath::from("objects")))
        .try_collect()
        .await
        .unwrap();
    assert!(objects.len() > 4, "only {} objects", objects.len());
    for object in objects {
        if object.location.filename() != Some(&root_pack.to_string()) {
            store.delete(&object.location).await.unwrap();
        }
    }
    let trees = Trees::new(repo.objects().clone(), &head.commit.packs).unwrap();
    let top = trees.get(root).await.unwrap();
    assert_eq!(top.len(), 40);
    let mut elsewhere = 0;
    for entry in top.values() {
        if let Entry::Dir { tree } = entry
            && trees.get(*tree).await.is_err()
        {
            elsewhere += 1;
        }
    }
    assert!(
        elsewhere > 0 && elsewhere < 40,
        "{elsewhere} folders in other packs"
    );
}

#[tokio::test]
async fn edits_to_a_split_tree_store_only_what_changed() {
    let (store, repo) = setup();
    repo.create_branch("main", None).await.unwrap();
    let work = tempdir().unwrap();
    for folder in 0..40 {
        fs::create_dir_all(work.path().join(format!("d{folder}"))).unwrap();
        for i in 0..40 {
            let path = work.path().join(format!("d{folder}/f{i}"));
            fs::write(path, pseudo_random(1500 + folder * 40 + i)).unwrap();
        }
    }
    repo.commit("main", work.path(), "large").await.unwrap();
    let before = count(&store, "objects").await;

    fs::write(work.path().join("d5/f0"), "changed").unwrap();
    fs::write(work.path().join("d30/f0"), "changed too").unwrap();
    repo.commit("main", work.path(), "edit").await.unwrap();
    let written = count(&store, "objects").await - before;
    assert!(written <= 3, "{written} objects for two small edits");

    let out = tempdir().unwrap();
    repo.checkout("main", out.path()).await.unwrap();
    assert_eq!(fs::read(out.path().join("d5/f0")).unwrap(), b"changed");
    assert_eq!(fs::read(out.path().join("d30/f0")).unwrap(), b"changed too");
    assert_eq!(
        fs::read(out.path().join("d39/f39")).unwrap(),
        pseudo_random(1500 + 39 * 40 + 39)
    );
}

fn other_random(len: usize) -> Vec<u8> {
    pseudo_random(len).into_iter().rev().collect()
}

#[tokio::test]
async fn gc_deletes_only_what_no_branch_uses() {
    let (store, repo) = setup();
    let work = tempdir().unwrap();
    write_project(work.path());
    repo.create_branch("main", None).await.unwrap();
    repo.commit("main", work.path(), "base").await.unwrap();
    let main_alone = count(&store, "chunks").await;

    repo.create_branch("agent", Some("main")).await.unwrap();
    fs::write(work.path().join("agent.bin"), other_random(3 << 20)).unwrap();
    repo.commit("agent", work.path(), "agent's work")
        .await
        .unwrap();
    assert!(count(&store, "chunks").await > main_alone);

    repo.delete_branch("agent").await.unwrap();
    let collected = repo.collect_garbage(Duration::ZERO, false).await.unwrap();
    assert!(collected.deleted > 0);
    assert_eq!(count(&store, "chunks").await, main_alone);
    let out = tempdir().unwrap();
    repo.checkout("main", out.path()).await.unwrap();
    assert_eq!(
        fs::read(out.path().join("src/nested/big.bin")).unwrap(),
        pseudo_random(1 << 20)
    );
    assert!(!out.path().join("agent.bin").exists());
}

#[tokio::test]
async fn gc_keeps_history() {
    let (store, repo) = setup();
    let work = tempdir().unwrap();
    write_project(work.path());
    repo.create_branch("main", None).await.unwrap();
    repo.commit("main", work.path(), "with big.bin")
        .await
        .unwrap();
    fs::remove_file(work.path().join("src/nested/big.bin")).unwrap();
    repo.commit("main", work.path(), "without").await.unwrap();
    let before = (
        count(&store, "chunks").await,
        count(&store, "objects").await,
    );

    let collected = repo.collect_garbage(Duration::ZERO, false).await.unwrap();
    assert_eq!(collected.deleted, 0);
    let after = (
        count(&store, "chunks").await,
        count(&store, "objects").await,
    );
    assert_eq!(before, after);
}

#[tokio::test]
async fn gc_leaves_young_objects_alone() {
    let (store, repo) = setup();
    let work = tempdir().unwrap();
    write_project(work.path());
    repo.create_branch("main", None).await.unwrap();
    repo.commit("main", work.path(), "base").await.unwrap();
    repo.delete_branch("main").await.unwrap();
    let chunks = count(&store, "chunks").await;

    let hour = Duration::from_secs(3600);
    let collected = repo.collect_garbage(hour, false).await.unwrap();
    assert_eq!(collected.deleted, 0);
    assert_eq!(count(&store, "chunks").await, chunks);
    assert!(matches!(
        repo.delete_branch("main").await,
        Err(Error::BranchNotFound(_))
    ));
}

#[tokio::test]
async fn trees_are_repacked_once_new_packs_outgrow_the_last_repack() {
    let (store, repo) = setup();
    repo.create_branch("main", None).await.unwrap();
    let work = tempdir().unwrap();
    let file = |round: usize, i: usize| pseudo_random(1500 + round * 400 + i);
    let refs = Refs::new(store);
    let mut repacked = false;
    for round in 0..12 {
        for i in 0..400 {
            let folder = work.path().join(format!("r{round}/d{i}"));
            fs::create_dir_all(&folder).unwrap();
            fs::write(folder.join("f"), file(round, i)).unwrap();
        }
        repo.commit("main", work.path(), "more").await.unwrap();
        let packs = refs.head("main").await.unwrap().unwrap().commit.packs;
        assert!(packs.written <= packs.repacked.max(4 << 20), "{packs:?}");
        repacked |= packs.repacked > 0;
    }
    assert!(repacked, "never repacked");

    let out = tempdir().unwrap();
    repo.checkout("main", out.path()).await.unwrap();
    for round in 0..12 {
        let path = out.path().join(format!("r{round}/d399/f"));
        assert_eq!(fs::read(path).unwrap(), file(round, 399));
    }
}

#[tokio::test]
async fn corrupted_chunks_are_detected() {
    let (store, repo) = setup();
    let work = tempdir().unwrap();
    fs::write(work.path().join("file"), pseudo_random(512 << 10)).unwrap();
    repo.create_branch("main", None).await.unwrap();
    repo.commit("main", work.path(), "v1").await.unwrap();

    let chunks: Vec<_> = store
        .list(Some(&StorePath::from("chunks")))
        .try_collect()
        .await
        .unwrap();
    let mut forged = vec![1u8];
    forged.extend(zstd::bulk::compress(b"tampered", 3).unwrap());
    store.put(&chunks[0].location, forged.into()).await.unwrap();

    let out = tempdir().unwrap();
    let result = repo.checkout("main", out.path()).await;
    assert!(matches!(result, Err(Error::Corrupt(_))), "{result:?}");
}

#[tokio::test]
async fn corrupted_bundles_are_detected() {
    let (store, repo) = setup();
    let work = tempdir().unwrap();
    fs::write(work.path().join("file"), pseudo_random(64 << 10)).unwrap();
    repo.create_branch("main", None).await.unwrap();
    repo.commit("main", work.path(), "v1").await.unwrap();

    let bundles: Vec<_> = store
        .list(Some(&StorePath::from("bundles")))
        .try_collect()
        .await
        .unwrap();
    let mut bytes = store
        .get(&bundles[0].location)
        .await
        .unwrap()
        .bytes()
        .await
        .unwrap()
        .to_vec();
    let last = bytes.len() - 1;
    bytes[last] ^= 1;
    store.put(&bundles[0].location, bytes.into()).await.unwrap();

    let out = tempdir().unwrap();
    let result = Repo::new(store.clone()).checkout("main", out.path()).await;
    assert!(result.is_err(), "{result:?}");
}

#[tokio::test]
async fn commits_skip_build_output() {
    let (_, repo) = setup();
    repo.create_branch("main", None).await.unwrap();
    let work = tempdir().unwrap();
    write_project(work.path());
    for dir in [
        "target/debug",
        "node_modules/left-pad",
        "src/target",
        "src/__pycache__",
    ] {
        fs::create_dir_all(work.path().join(dir)).unwrap();
        fs::write(work.path().join(dir).join("out"), "built").unwrap();
    }
    let out = tempdir().unwrap();
    repo.commit("main", work.path(), "defaults").await.unwrap();
    repo.checkout("main", out.path()).await.unwrap();
    assert!(!out.path().join("target").exists());
    assert!(!out.path().join("node_modules").exists());
    assert!(out.path().join("src/target/out").exists());
    assert!(!out.path().join("src/__pycache__").exists());

    fs::write(work.path().join(".skywakeignore"), "# ours\n/src/target/\n").unwrap();
    let out = tempdir().unwrap();
    repo.commit("main", work.path(), "own list").await.unwrap();
    repo.checkout("main", out.path()).await.unwrap();
    assert!(out.path().join("target/debug/out").exists());
    assert!(!out.path().join("src/target").exists());
}

#[tokio::test]
async fn a_new_claim_shuts_out_the_old_writer() {
    let (_, repo) = setup();
    repo.create_branch("main", None).await.unwrap();
    let work = tempdir().unwrap();
    write_project(work.path());
    repo.commit("main", work.path(), "base").await.unwrap();
    let (tree, _) = repo.head_tree("main").await.unwrap();

    let mut old = repo.claim("main").await.unwrap();
    repo.save(&mut old, tree, None).await.unwrap();
    let mut new = repo.claim("main").await.unwrap();

    let result = repo.save(&mut old, tree, None).await;
    assert!(matches!(result, Err(Error::Conflict(_))), "{result:?}");
    repo.save(&mut new, tree, None).await.unwrap();
}

#[tokio::test]
async fn history_skips_autosaves() {
    let (_, repo) = setup();
    repo.create_branch("main", None).await.unwrap();
    let work = tempdir().unwrap();
    write_project(work.path());
    repo.commit("main", work.path(), "base").await.unwrap();

    let mut claim = repo.claim("main").await.unwrap();
    for _ in 0..3 {
        fs::write(work.path().join("README.md"), pseudo_random(100)).unwrap();
        let (tree, _) = repo.head_tree("main").await.unwrap();
        repo.save(&mut claim, tree, None).await.unwrap();
    }
    let (tree, _) = repo.head_tree("main").await.unwrap();
    repo.save(&mut claim, tree, Some("done")).await.unwrap();
    repo.save(&mut claim, tree, None).await.unwrap();

    let messages: Vec<String> = repo
        .log("main")
        .await
        .unwrap()
        .into_iter()
        .map(|(_, commit)| commit.message)
        .collect();
    assert_eq!(messages, ["done", "base", "empty"]);

    repo.commit("main", work.path(), "after").await.unwrap();
    let log = repo.log("main").await.unwrap();
    assert_eq!(log[0].1.parent, Some(log[1].0));
    assert_eq!(log[1].1.message, "done");
}

#[tokio::test]
async fn a_commit_with_nothing_changed_writes_nothing() {
    let (store, repo) = setup();
    let work = tempdir().unwrap();
    write_project(work.path());
    repo.create_branch("main", None).await.unwrap();
    let first = repo.commit("main", work.path(), "first").await.unwrap();
    let objects = count(&store, "objects").await;

    let again = repo.commit("main", work.path(), "again").await.unwrap();
    assert_eq!(again, first);
    assert_eq!(count(&store, "objects").await, objects);
    assert_eq!(repo.log("main").await.unwrap().len(), 2); // "first" and "empty"
}

#[tokio::test]
async fn cached_commits_are_read_without_the_bucket() {
    let (store, repo) = setup();
    let cache = tempdir().unwrap();
    let repo = repo.with_cache(cache.path().to_path_buf());
    let work = tempdir().unwrap();
    write_project(work.path());
    repo.create_branch("main", None).await.unwrap();
    repo.commit("main", work.path(), "first").await.unwrap();

    let listing: Vec<_> = store
        .list(None)
        .try_filter(|meta| {
            let name = meta.location.as_ref();
            futures::future::ready(name.starts_with("commits/") || name.starts_with("objects/"))
        })
        .try_collect()
        .await
        .unwrap();
    for meta in listing {
        store.delete(&meta.location).await.unwrap();
    }
    let log = repo.log("main").await.unwrap();
    assert_eq!(log.len(), 2);

    for item in fs::read_dir(cache.path()).unwrap() {
        fs::write(item.unwrap().path(), b"damaged").unwrap();
    }
    assert!(repo.objects().get_commit(log[1].0).await.is_err());
}

#[tokio::test]
async fn small_files_share_one_bundle_and_read_back_anywhere() {
    let (store, repo) = setup();
    let work = tempdir().unwrap();
    fs::create_dir_all(work.path().join("a/b")).unwrap();
    for i in 0..200usize {
        let folder = if i % 2 == 0 { "a" } else { "a/b" };
        let mut bytes = pseudo_random(10_000 + i);
        bytes[..8].copy_from_slice(&(i as u64).to_le_bytes());
        fs::write(work.path().join(format!("{folder}/{i}.txt")), bytes).unwrap();
    }
    repo.create_branch("main", None).await.unwrap();
    repo.commit("main", work.path(), "first").await.unwrap();
    assert_eq!(count(&store, "bundles").await, 1);
    assert_eq!(count(&store, "chunks").await, 0);

    repo.commit("main", work.path(), "again").await.unwrap();
    assert_eq!(count(&store, "bundles").await, 1);

    let fresh = Repo::new(store.clone());
    let out = tempdir().unwrap();
    fresh.checkout("main", out.path()).await.unwrap();
    for i in 0..200usize {
        let folder = if i % 2 == 0 { "a" } else { "a/b" };
        let name = format!("{folder}/{i}.txt");
        assert_eq!(
            fs::read(out.path().join(&name)).unwrap(),
            fs::read(work.path().join(&name)).unwrap(),
            "{name}"
        );
    }
    let (root, trees) = fresh.head_tree("main").await.unwrap();
    let Entry::Dir { tree } = trees.get(root).await.unwrap()["a"].clone() else {
        panic!("a is a folder")
    };
    let a = trees.get(tree).await.unwrap();
    assert!(matches!(
        &a["0.txt"],
        Entry::File {
            data: Data::Bundled(_),
            ..
        }
    ));
}
