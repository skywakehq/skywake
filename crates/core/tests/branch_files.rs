//! The engine functions behind the HTTP API.

use std::sync::Arc;

use object_store::ObjectStoreExt;
use object_store::memory::InMemory;
use object_store::path::Path;
use skywake_core::{
    Change, Commit, Content, Data, EXECUTABLE_MODE, Edit, Entry, Error, FILE_MODE, Repo,
};

fn put(path: &str, text: &str) -> Edit {
    edit(path, Content::Bytes(text.as_bytes().to_vec()))
}

fn edit(path: &str, content: Content) -> Edit {
    Edit {
        path: path.to_string(),
        content,
        mode: FILE_MODE,
    }
}

fn copy(path: &str, from: &str) -> Edit {
    let from = from.to_string();
    edit(
        path,
        Content::From {
            path: from,
            at: None,
        },
    )
}

async fn text(repo: &Repo, path: &str) -> String {
    let bytes = repo.read("main", None, path, 0, u64::MAX).await.unwrap();
    String::from_utf8(bytes).unwrap()
}

async fn names(repo: &Repo, path: &str) -> Vec<String> {
    let (_, inside) = repo.list("main", None, path).await.unwrap();
    inside.into_iter().map(|(name, _)| name).collect()
}

fn noise(len: usize, seed: u64) -> Vec<u8> {
    let mut state = seed;
    (0..len)
        .map(|_| {
            state = state
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            (state >> 33) as u8
        })
        .collect()
}

async fn setup() -> Repo {
    let repo = Repo::new(Arc::new(InMemory::new()));
    repo.create_branch("main", None).await.unwrap();
    repo
}

#[tokio::test]
async fn edits_land_as_one_commit() {
    let repo = setup().await;
    let first = repo
        .commit_files(
            "main",
            "add",
            Some("s1"),
            vec![put("src/a.rs", "fn a() {}"), put("b.txt", "hi")],
        )
        .await
        .unwrap();
    let remove = edit("b.txt", Content::Remove);
    repo.commit_files("main", "remove b", None, vec![remove])
        .await
        .unwrap();

    let (root, inside) = repo.list("main", None, "").await.unwrap();
    assert!(matches!(root, Entry::Dir { .. }));
    let names: Vec<_> = inside.iter().map(|(name, _)| name.as_str()).collect();
    assert_eq!(names, ["src"]);

    let bytes = repo.read("main", None, "src/a.rs", 3, 1).await.unwrap();
    assert_eq!(bytes, b"a");
    let old = repo
        .read("main", Some(first), "b.txt", 0, u64::MAX)
        .await
        .unwrap();
    assert_eq!(old, b"hi");
    assert!(matches!(
        repo.read("main", None, "b.txt", 0, 10).await,
        Err(Error::NotFound(_))
    ));

    let log = repo.log("main").await.unwrap();
    assert_eq!(log[1].1.session.as_deref(), Some("s1"));
}

#[tokio::test]
async fn search_finds_lines_like_grep() {
    let repo = setup().await;
    let edits = vec![
        put("src/a.rs", "fn a() {}\n// TODO: b\n"),
        put("src/b.rs", "fn b() {}\n"),
        put("notes.md", "TODO: docs\n"),
    ];
    repo.commit_files("main", "add", None, edits).await.unwrap();

    let found = repo.search("main", "src", "TODO", 10).await.unwrap();
    let found: Vec<_> = found
        .iter()
        .map(|found| (found.path.as_str(), found.line, found.text.as_str()))
        .collect();
    assert_eq!(found, [("src/a.rs", 2, "// TODO: b")]);
    assert_eq!(repo.search("main", "", "fn ", 1).await.unwrap().len(), 1);
    assert!(matches!(
        repo.search("main", "", "(", 1).await,
        Err(Error::BadPattern(_))
    ));
    assert!(matches!(
        repo.search("main", "notes.md", "x", 1).await,
        Err(Error::NotAFolder(_))
    ));
}

#[tokio::test]
async fn the_change_feed_starts_after_the_last_hash_seen() {
    let repo = setup().await;
    let one = repo
        .commit_files("main", "one", None, vec![put("a", "1")])
        .await
        .unwrap();
    repo.commit_files("main", "two", None, vec![put("a", "2"), put("b", "2")])
        .await
        .unwrap();

    let feed = repo.changes_since("main", Some(one), 50).await.unwrap();
    assert_eq!(feed.len(), 1);
    let (_, commit, changes) = &feed[0];
    assert_eq!(commit.message, "two");
    assert_eq!(
        changes,
        &[Change::Modified("a".into()), Change::Added("b".into())]
    );

    let feed = repo.changes_since("main", None, 2).await.unwrap();
    let messages: Vec<_> = feed
        .iter()
        .map(|(_, commit, _)| commit.message.as_str())
        .collect();
    assert_eq!(messages, ["one", "two"]);
}

#[tokio::test]
async fn parts_join_into_one_file() {
    let store = Arc::new(InMemory::new());
    let repo = Repo::new(store.clone());
    repo.create_branch("main", None).await.unwrap();
    let (one, two) = (noise(6_000_000, 1), noise(1_000_000, 2));
    let mut chunks = repo.store_part(&one).await.unwrap();
    assert!(chunks.len() > 1);
    let last = *chunks.last().unwrap();
    chunks.extend(repo.store_part(&two).await.unwrap());
    let file = Edit {
        mode: EXECUTABLE_MODE,
        ..edit("big.bin", Content::Chunks(chunks))
    };
    repo.commit_files("main", "add", None, vec![file])
        .await
        .unwrap();

    let (entry, _) = repo.list("main", None, "big.bin").await.unwrap();
    let Entry::File {
        size,
        mode,
        data: Data::Chunks(_),
        ..
    } = entry
    else {
        panic!("not a chunked file: {entry:?}");
    };
    assert_eq!((size, mode), (7_000_000, EXECUTABLE_MODE));
    let whole = [one, two].concat();
    let middle = repo
        .read("main", None, "big.bin", 5_990_000, 20_000)
        .await
        .unwrap();
    assert_eq!(middle, whole[5_990_000..6_010_000]);
    let all = repo.read("main", None, "big.bin", 0, u64::MAX).await;
    assert_eq!(all.unwrap(), whole);

    let path = Path::from(format!("chunks/{}", last.hash));
    store.delete(&path).await.unwrap();
    let start = repo.read("main", None, "big.bin", 0, 1000).await.unwrap();
    assert_eq!(start, whole[..1000]);
    assert!(
        repo.read("main", None, "big.bin", 0, u64::MAX)
            .await
            .is_err()
    );
}

#[tokio::test]
async fn copies_move_files_and_folders_without_data() {
    let repo = setup().await;
    let edits = vec![
        put("docs/a.md", "a"),
        put("docs/deep/b.md", "b"),
        put("x", "x"),
        put("y", "y"),
    ];
    repo.commit_files("main", "add", None, edits).await.unwrap();

    let moved = vec![
        copy("notes", "docs"),
        edit("docs", Content::Remove),
        copy("x", "y"),
        copy("y", "x"),
    ];
    repo.commit_files("main", "move", None, moved)
        .await
        .unwrap();
    assert_eq!(names(&repo, "").await, ["notes", "x", "y"]);
    assert_eq!(text(&repo, "notes/deep/b.md").await, "b");
    assert_eq!(
        (text(&repo, "x").await, text(&repo, "y").await),
        ("y".into(), "x".into())
    );

    let missing = repo
        .commit_files("main", "bad", None, vec![copy("z", "nope")])
        .await;
    assert!(matches!(missing, Err(Error::MissingSource(path)) if path == "nope"));
}

#[tokio::test]
async fn copies_restore_older_versions() {
    let repo = setup().await;
    let mut edits = vec![put("a", "1"), put("dir/b", "1")];
    for folder in 0..50 {
        for file in 0..50 {
            edits.push(put(&format!("dir/sub-{folder}/file-{file}.txt"), "x"));
        }
    }
    let first = repo.commit_files("main", "one", None, edits).await.unwrap();
    let stored = repo.objects().get_commit(first).await.unwrap();
    assert!(!stored.packs.packed.is_empty());
    repo.commit_files(
        "main",
        "two",
        None,
        vec![put("a", "2"), edit("dir", Content::Remove)],
    )
    .await
    .unwrap();

    let restore = |path: &str| {
        let from = path.to_string();
        edit(
            path,
            Content::From {
                path: from,
                at: Some(first),
            },
        )
    };
    repo.commit_files("main", "restore", None, vec![restore("a"), restore("dir")])
        .await
        .unwrap();
    assert_eq!(text(&repo, "a").await, "1");
    assert_eq!(text(&repo, "dir/b").await, "1");
    assert_eq!(text(&repo, "dir/sub-49/file-49.txt").await, "x");
}

#[tokio::test]
async fn folders_can_be_empty() {
    let repo = setup().await;
    repo.commit_files("main", "add", None, vec![put("full/a", "a")])
        .await
        .unwrap();
    let folders = vec![
        edit("empty", Content::Folder),
        edit("full", Content::Folder),
        edit("nested/empty", Content::Folder),
    ];
    repo.commit_files("main", "folders", None, folders)
        .await
        .unwrap();

    assert_eq!(names(&repo, "").await, ["empty", "full", "nested"]);
    assert!(names(&repo, "empty").await.is_empty());
    assert_eq!(names(&repo, "nested").await, ["empty"]);
    assert_eq!(text(&repo, "full/a").await, "a");
}

#[tokio::test]
async fn the_same_bytes_again_make_no_commit() {
    let repo = setup().await;
    let first = repo
        .commit_files("main", "add", None, vec![put("a.txt", "a")])
        .await
        .unwrap();
    let again = repo
        .commit_files("main", "again", None, vec![put("a.txt", "a")])
        .await
        .unwrap();
    assert_eq!(again, first);
    let commits = repo.log("main").await.unwrap().len();

    repo.commit_files(
        "main",
        "mixed",
        None,
        vec![put("a.txt", "a"), put("b.txt", "b")],
    )
    .await
    .unwrap();
    assert_eq!(repo.log("main").await.unwrap().len(), commits + 1);
    assert_eq!(repo.file_history("main", "a.txt").await.unwrap().len(), 1);
}

#[tokio::test]
async fn a_folder_edit_on_a_file_is_an_error() {
    let repo = setup().await;
    repo.commit_files("main", "file", None, vec![put("x", "file")])
        .await
        .unwrap();
    let result = repo
        .commit_files("main", "folder", None, vec![edit("x", Content::Folder)])
        .await;
    assert!(matches!(result, Err(Error::NotAFolder(_))), "{result:?}");
    assert_eq!(text(&repo, "x").await, "file");
}

#[tokio::test]
async fn a_chunk_shorter_than_its_file_says_is_an_error() {
    let repo = setup().await;
    let mut chunks = repo.store_part(&noise(100_000, 1)).await.unwrap();
    chunks[0].size += 10; // the file claims more than the chunk holds
    repo.commit_files(
        "main",
        "lie",
        None,
        vec![edit("f", Content::Chunks(chunks))],
    )
    .await
    .unwrap();
    let read = repo.read("main", None, "f", 0, u64::MAX).await;
    assert!(
        matches!(read, Err(Error::Corrupt(_))),
        "{:?}",
        read.map(|b| b.len())
    );
}

#[tokio::test]
async fn an_object_that_expands_too_far_is_refused_before_its_hash_is_checked() {
    let store = Arc::new(InMemory::new());
    let repo = Repo::new(store.clone());
    let mut stored = vec![1u8];
    stored.extend(zstd::bulk::compress(&vec![0u8; 200 << 20], 19).unwrap());
    let hash = skywake_core::Hash::of(b"anything");
    store
        .put(&Path::from(format!("objects/{hash}")), stored.into())
        .await
        .unwrap();
    let read: Result<Commit, Error> = repo.objects().get(hash).await;
    let error = read.unwrap_err().to_string();
    assert!(error.contains("more than"), "{error}");
}

#[tokio::test]
async fn the_hash_of_an_autosave_head_can_be_used_later() {
    let repo = setup().await;
    repo.commit_files("main", "base", None, vec![put("a", "1")])
        .await
        .unwrap();
    let mut claim = repo.claim("main").await.unwrap();
    let file = skywake_core::files::store(repo.objects(), b"2", FILE_MODE)
        .await
        .unwrap();
    let tree = skywake_core::files::put(&claim.trees, claim.tree, "a", Some(file))
        .await
        .unwrap();
    repo.save(&mut claim, tree, None).await.unwrap();

    let forked = repo.create_branch("fork", Some("main")).await.unwrap();
    let head = repo.head_commit("main").await.unwrap();
    assert_eq!(forked, head);
    repo.fork_at("again", head).await.unwrap();
    let copy = edit(
        "copy",
        Content::From {
            path: "a".into(),
            at: Some(head),
        },
    );
    repo.commit_files("main", "copy", None, vec![copy])
        .await
        .unwrap();
    let bytes = repo.read("again", None, "a", 0, 10).await.unwrap();
    assert_eq!(bytes, b"2");
    assert_eq!(text(&repo, "copy").await, "2");
}
