//! A branch mounted as a `BranchFs`, driven through its file operations.

use std::fs;
use std::sync::Arc;

use object_store::memory::InMemory;
use object_store::{ObjectStore, ObjectStoreExt};
use skywake_core::{Data, Entry, Hash, INLINE_BUDGET, Packs, Repo, Trees};
use skywake_mount::{Attr, BranchFs, ChunkCache, Kind, ROOT, Rename, SetAttr, SetXattr};
use tempfile::{TempDir, tempdir};

mod gate;
use gate::Gated;

struct Mounted {
    fs: BranchFs,
    repo: Repo,
    cache: Arc<ChunkCache>,
    big: Vec<u8>,
    _dirs: [TempDir; 3],
}

async fn mounted() -> Mounted {
    mounted_with_cache(u64::MAX).await
}

async fn mounted_with_cache(max_bytes: u64) -> Mounted {
    mounted_on(Arc::new(InMemory::new()), max_bytes).await
}

async fn mounted_on(store: Arc<dyn ObjectStore>, max_bytes: u64) -> Mounted {
    let repo = Repo::new(store);
    let work = tempdir().unwrap();
    let big = pseudo_random(5 << 20);
    fs::create_dir_all(work.path().join("src/deep")).unwrap();
    fs::write(work.path().join("README.md"), "hello").unwrap();
    fs::write(work.path().join("src/main.rs"), "fn main() {}").unwrap();
    fs::write(work.path().join("src/deep/big.bin"), &big).unwrap();
    std::os::unix::fs::symlink("src/main.rs", work.path().join("entry")).unwrap();
    repo.create_branch("main", None).await.unwrap();
    repo.commit("main", work.path(), "base").await.unwrap();

    let (cache_dir, scratch) = (tempdir().unwrap(), tempdir().unwrap());
    let cache = Arc::new(ChunkCache::new(cache_dir.path().into(), max_bytes).unwrap());
    let (root, trees) = repo.head_tree("main").await.unwrap();
    let fs = BranchFs::new(
        repo.objects().clone(),
        cache.clone(),
        scratch.path().into(),
        root,
        trees,
    )
    .unwrap();
    Mounted {
        fs,
        repo,
        cache,
        big,
        _dirs: [work, cache_dir, scratch],
    }
}

async fn commit(m: &Mounted, ignored: &[String], message: &str) -> Hash {
    commit_from(m, &m.fs, ignored, message).await
}

async fn commit_from(m: &Mounted, fs: &BranchFs, ignored: &[String], message: &str) -> Hash {
    let mut claim = m.repo.claim("main").await.unwrap();
    let save = fs.save(ignored).await.unwrap();
    for new_tree in save.trees.clone() {
        claim.trees.add(new_tree).unwrap();
    }
    m.repo
        .save(&mut claim, save.root, Some(message))
        .await
        .unwrap();
    fs.committed(&save);
    save.root
}

async fn remount(m: &Mounted) -> (BranchFs, TempDir) {
    let scratch = tempdir().unwrap();
    let (root, trees) = m.repo.head_tree("main").await.unwrap();
    let objects = m.repo.objects().clone();
    let fs = BranchFs::new(objects, m.cache.clone(), scratch.path().into(), root, trees).unwrap();
    (fs, scratch)
}

async fn resolve(fs: &BranchFs, path: &str) -> std::io::Result<Attr> {
    let mut attr = fs.getattr(ROOT)?;
    for name in path.split('/') {
        attr = fs.lookup(attr.ino, name).await?;
    }
    Ok(attr)
}

async fn read_all(fs: &BranchFs, path: &str) -> Vec<u8> {
    let attr = resolve(fs, path).await.unwrap();
    fs.read(attr.ino, 0, attr.size as u32).await.unwrap()
}

fn size(size: u64) -> SetAttr {
    SetAttr {
        size: Some(size),
        ..SetAttr::default()
    }
}

async fn names(fs: &BranchFs, dir: u64) -> Vec<String> {
    let entries = fs.readdir(dir, 0, usize::MAX).await.unwrap();
    entries
        .into_iter()
        .skip(2)
        .map(|entry| entry.name)
        .collect()
}

fn errno(result: std::io::Result<impl Sized>) -> i32 {
    result
        .err()
        .and_then(|error| error.raw_os_error())
        .unwrap_or(0)
}

fn pseudo_random(len: usize) -> Vec<u8> {
    let mut state: u64 = 0x2545_F491_4F6C_DD1D;
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
async fn reads_any_range_of_a_stored_file() {
    let m = mounted().await;
    let big = resolve(&m.fs, "src/deep/big.bin").await.unwrap();
    assert_eq!(big.size, m.big.len() as u64);

    for (offset, len) in [
        (0, 10),
        (1_000_000, 300_000),
        (4_000_000, 2_000_000),
        (5 << 20, 100),
    ] {
        let data = m.fs.read(big.ino, offset, len).await.unwrap();
        let end = (offset as usize + len as usize).min(m.big.len());
        assert_eq!(data, m.big[offset as usize..end], "offset {offset}");
    }
    assert_eq!(read_all(&m.fs, "README.md").await, b"hello");
}

#[tokio::test]
async fn lists_directories_and_symlinks() {
    let m = mounted().await;
    let names = names(&m.fs, ROOT).await;
    assert_eq!(names, ["README.md", "entry", "src"]);

    let link = resolve(&m.fs, "entry").await.unwrap();
    assert_eq!(link.kind, Kind::Symlink);
    assert_eq!(m.fs.readlink(link.ino).unwrap(), "src/main.rs");
    assert_eq!(errno(resolve(&m.fs, "src/missing").await), libc::ENOENT);
}

#[tokio::test]
async fn writes_into_the_middle_of_a_stored_file() {
    let m = mounted().await;
    let big = resolve(&m.fs, "src/deep/big.bin").await.unwrap();
    m.fs.write(big.ino, 3_000_000, b"agent was here")
        .await
        .unwrap();

    let mut expected = m.big.clone();
    expected[3_000_000..3_000_014].copy_from_slice(b"agent was here");
    assert_eq!(read_all(&m.fs, "src/deep/big.bin").await, expected);
}

#[tokio::test]
async fn creates_and_truncates_files() {
    let m = mounted().await;
    let file = m.fs.create(ROOT, "notes.txt", 0o644, None).await.unwrap();
    m.fs.write(file.ino, 0, b"first draft").await.unwrap();
    m.fs.setattr(file.ino, size(5)).await.unwrap();
    assert_eq!(read_all(&m.fs, "notes.txt").await, b"first");

    let readme = resolve(&m.fs, "README.md").await.unwrap();
    let changes = SetAttr {
        mode: Some(0o755),
        size: Some(0),
        ..SetAttr::default()
    };
    m.fs.setattr(readme.ino, changes).await.unwrap();
    let readme = resolve(&m.fs, "README.md").await.unwrap();
    assert_eq!((readme.size, readme.mode), (0, 0o755));
    assert_eq!(
        errno(m.fs.create(ROOT, "notes.txt", 0o644, None).await),
        libc::EEXIST
    );
}

#[tokio::test]
async fn renames_like_rename_2() {
    let m = mounted().await;
    let src = resolve(&m.fs, "src").await.unwrap();

    let tmp =
        m.fs.create(src.ino, "main.rs.tmp", 0o644, None)
            .await
            .unwrap();
    m.fs.write(tmp.ino, 0, b"fn main() { work() }")
        .await
        .unwrap();
    m.fs.rename(src.ino, "main.rs.tmp", src.ino, "main.rs", Rename::Replace)
        .await
        .unwrap();
    assert_eq!(
        read_all(&m.fs, "src/main.rs").await,
        b"fn main() { work() }"
    );
    assert_eq!(errno(resolve(&m.fs, "src/main.rs.tmp").await), libc::ENOENT);

    m.fs.rename(src.ino, "deep", ROOT, "moved", Rename::Replace)
        .await
        .unwrap();
    assert_eq!(read_all(&m.fs, "moved/big.bin").await, m.big);

    let docs = m.fs.mkdir(ROOT, "docs", 0o755, None).await.unwrap();
    m.fs.create(docs.ino, "a.md", 0o644, None).await.unwrap();
    assert_eq!(
        errno(
            m.fs.rename(ROOT, "moved", ROOT, "docs", Rename::Replace)
                .await
        ),
        libc::ENOTEMPTY
    );
    assert_eq!(
        errno(
            m.fs.rename(ROOT, "README.md", ROOT, "docs", Rename::Replace)
                .await
        ),
        libc::EISDIR
    );
    assert_eq!(
        errno(
            m.fs.rename(ROOT, "README.md", ROOT, "entry", Rename::NoReplace)
                .await
        ),
        libc::EEXIST
    );
}

#[tokio::test]
async fn removes_files_and_only_empty_directories() {
    let m = mounted().await;
    assert_eq!(errno(m.fs.rmdir(ROOT, "src").await), libc::ENOTEMPTY);
    assert_eq!(errno(m.fs.unlink(ROOT, "src").await), libc::EISDIR);

    let src = resolve(&m.fs, "src").await.unwrap();
    let deep = resolve(&m.fs, "src/deep").await.unwrap();
    m.fs.unlink(deep.ino, "big.bin").await.unwrap();
    m.fs.rmdir(src.ino, "deep").await.unwrap();
    m.fs.unlink(src.ino, "main.rs").await.unwrap();
    m.fs.rmdir(ROOT, "src").await.unwrap();

    let names = names(&m.fs, ROOT).await;
    assert_eq!(names, ["README.md", "entry"]);
}

#[tokio::test]
async fn deleted_files_are_freed_once_the_kernel_forgets_them() {
    let m = mounted().await;
    let scratch = m._dirs[2].path();
    let output = b"build output".repeat(1000);
    let kept = m.fs.create(ROOT, "kept", 0o644, None).await.unwrap();
    m.fs.write(kept.ino, 0, &output).await.unwrap();
    m.fs.rename(ROOT, "kept", ROOT, "moved", Rename::Replace)
        .await
        .unwrap();
    let gone = m.fs.create(ROOT, "gone", 0o644, None).await.unwrap();
    m.fs.write(gone.ino, 0, &output).await.unwrap();

    m.fs.unlink(ROOT, "gone").await.unwrap();
    assert_eq!(m.fs.read(gone.ino, 0, 12).await.unwrap(), b"build output"); // still open
    m.fs.forget(gone.ino, 1);
    m.fs.forget(kept.ino, 1);

    assert_eq!(errno(m.fs.getattr(gone.ino)), libc::ENOENT);
    assert!(m.fs.getattr(kept.ino).is_ok());
    assert_eq!(fs::read_dir(scratch).unwrap().count(), 1);
}

#[tokio::test]
async fn small_files_live_in_memory_until_they_grow() {
    let m = mounted().await;
    let scratch = m._dirs[2].path();
    let file = m.fs.create(ROOT, "notes.md", 0o644, None).await.unwrap();
    m.fs.write(file.ino, 0, b"hello world").await.unwrap();
    m.fs.write(file.ino, 6, b"there").await.unwrap(); // in the middle: the rest stays
    m.fs.write(file.ino, 11, b"!").await.unwrap();
    assert_eq!(read_all(&m.fs, "notes.md").await, b"hello there!");
    m.fs.setattr(file.ino, size(5)).await.unwrap();
    assert_eq!(read_all(&m.fs, "notes.md").await, b"hello");
    let copy = scratch.join(format!("{}.inline", file.ino));
    assert_eq!(fs::read(&copy).unwrap(), b"hello");
    assert_eq!(fs::read_dir(scratch).unwrap().count(), 1);

    m.fs.write(file.ino, 5, &[b'!'; 5000]).await.unwrap();
    assert!(!copy.exists());
    assert_eq!(fs::read_dir(scratch).unwrap().count(), 1);
    let mut expected = b"hello".to_vec();
    expected.extend([b'!'; 5000]);
    assert_eq!(read_all(&m.fs, "notes.md").await, expected);
}

#[tokio::test]
async fn saves_what_changed_from_memory() {
    let m = mounted().await;
    let big = resolve(&m.fs, "src/deep/big.bin").await.unwrap();
    m.fs.write(big.ino, 2_000_000, b"patched").await.unwrap();
    let src = resolve(&m.fs, "src").await.unwrap();
    let notes = m.fs.create(src.ino, "notes.md", 0o644, None).await.unwrap();
    m.fs.write(notes.ino, 0, b"todo").await.unwrap();
    let docs = m.fs.mkdir(ROOT, "docs", 0o755, None).await.unwrap();
    m.fs.symlink(docs.ino, "readme", "../README.md", None)
        .await
        .unwrap();
    m.fs.rename(src.ino, "main.rs", src.ino, "lib.rs", Rename::Replace)
        .await
        .unwrap();
    m.fs.unlink(ROOT, "entry").await.unwrap();

    let tree = commit(&m, &[], "from the mount").await;
    assert!(!m.fs.has_changes());

    let out = tempdir().unwrap();
    m.repo.checkout("main", out.path()).await.unwrap();
    let mut expected = m.big.clone();
    expected[2_000_000..2_000_007].copy_from_slice(b"patched");
    assert_eq!(
        fs::read(out.path().join("src/deep/big.bin")).unwrap(),
        expected
    );
    assert_eq!(fs::read(out.path().join("src/notes.md")).unwrap(), b"todo");
    assert_eq!(
        fs::read(out.path().join("src/lib.rs")).unwrap(),
        b"fn main() {}"
    );
    assert!(!out.path().join("src/main.rs").exists());
    assert!(!out.path().join("entry").exists());
    assert_eq!(
        fs::read_link(out.path().join("docs/readme"))
            .unwrap()
            .to_str(),
        Some("../README.md")
    );

    let save = m.fs.save(&[]).await.unwrap();
    assert_eq!((save.root, save.trees), (tree, Vec::new()));
}

#[tokio::test]
async fn saves_leave_out_ignored_paths() {
    let m = mounted().await;
    m.fs.symlink(ROOT, "target", "/var/tmp/build", None)
        .await
        .unwrap();
    let src = resolve(&m.fs, "src").await.unwrap();
    let deps =
        m.fs.mkdir(src.ino, "node_modules", 0o755, None)
            .await
            .unwrap();
    m.fs.create(deps.ino, "left-pad.js", 0o644, None)
        .await
        .unwrap();
    m.fs.create(src.ino, "kept.rs", 0o644, None).await.unwrap();

    let ignored = ["target".into(), "src/node_modules".into()];
    commit(&m, &ignored, "no build output").await;

    let out = tempdir().unwrap();
    m.repo.checkout("main", out.path()).await.unwrap();
    assert!(out.path().join("src/kept.rs").exists());
    assert!(out.path().join("target").symlink_metadata().is_err());
    assert!(!out.path().join("src/node_modules").exists());
}

#[tokio::test]
async fn saves_keep_small_files_inline_only_up_to_a_budget() {
    let m = mounted().await;
    let many = m.fs.mkdir(ROOT, "many", 0o755, None).await.unwrap();
    for i in 0..100 {
        let file =
            m.fs.create(many.ino, &format!("f{i:03}"), 0o644, None)
                .await
                .unwrap();
        m.fs.write(file.ino, 0, &pseudo_random(2000 + i))
            .await
            .unwrap();
    }
    let save = m.fs.save(&[]).await.unwrap();
    let (tree, new_trees) = (save.root, save.trees);
    let trees = Trees::new(m.repo.objects().clone(), &Packs::default()).unwrap();
    for new_tree in new_trees {
        trees.add(new_tree).unwrap();
    }

    let root = trees.get(tree).await.unwrap();
    let Some(Entry::Dir { tree: many }) = root.get("many") else {
        panic!("no folder")
    };
    let many = trees.get(*many).await.unwrap();
    let inline: usize = many
        .values()
        .map(|entry| match entry {
            Entry::File {
                data: Data::Inline(bytes),
                ..
            } => bytes.len(),
            _ => 0,
        })
        .sum();
    assert!(inline <= INLINE_BUDGET, "{inline} bytes inline");
    assert!(
        inline > INLINE_BUDGET / 2,
        "the budget is used, in name order"
    );
    assert_eq!(read_all(&m.fs, "many/f099").await, pseudo_random(2099));
}

#[tokio::test]
async fn read_only_mounts_refuse_changes() {
    let m = mounted().await;
    m.fs.set_read_only();
    assert_eq!(
        errno(m.fs.create(ROOT, "new", 0o644, None).await),
        libc::EROFS
    );
    assert_eq!(errno(m.fs.unlink(ROOT, "README.md").await), libc::EROFS);
    assert_eq!(read_all(&m.fs, "README.md").await, b"hello");
}

#[tokio::test]
async fn the_chunk_cache_stays_under_its_limit() {
    let max = 2_500_000;
    let m = mounted_with_cache(max).await;
    for _ in 0..2 {
        assert_eq!(read_all(&m.fs, "src/deep/big.bin").await, m.big);
        assert!(m.cache.bytes() <= max, "{} bytes cached", m.cache.bytes());
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
async fn parallel_first_writes_keep_every_write() {
    let m = Arc::new(mounted().await);
    let big = resolve(&m.fs, "src/deep/big.bin").await.unwrap();
    let writers: Vec<_> = (0..8u64)
        .map(|i| {
            let m = m.clone();
            tokio::spawn(async move {
                m.fs.write(big.ino, i * 600_000, &[b'a' + i as u8; 100])
                    .await
                    .unwrap();
            })
        })
        .collect();
    for writer in writers {
        writer.await.unwrap();
    }
    let mut expected = m.big.clone();
    for i in 0..8 {
        let at = i * 600_000;
        expected[at..at + 100].fill(b'a' + i as u8);
    }
    let data = read_all(&m.fs, "src/deep/big.bin").await;
    assert_eq!(data.len(), expected.len());
    assert!(data == expected, "a write was lost");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_save_is_a_snapshot_of_one_instant() {
    let store = Gated::new();
    let m = Arc::new(mounted_on(store.clone(), u64::MAX).await);
    let log = m.fs.create(ROOT, "log.bin", 0o644, None).await.unwrap();
    let before = pseudo_random(16 << 20);
    m.fs.write(log.ino, 0, &before).await.unwrap();

    store.close();
    let saving = {
        let m = m.clone();
        tokio::spawn(async move { m.fs.save(&[]).await.unwrap() })
    };
    store.waiting.notified().await;

    m.fs.write(log.ino, 12 << 20, &[7; 4096]).await.unwrap();
    m.fs.setattr(log.ino, size(14 << 20)).await.unwrap();
    let object = m.fs.create(ROOT, "object", 0o644, None).await.unwrap();
    m.fs.write(object.ino, 0, &pseudo_random(10_000))
        .await
        .unwrap();
    let tmp = m.fs.create(ROOT, "ref.tmp", 0o644, None).await.unwrap();
    m.fs.write(tmp.ino, 0, b"object").await.unwrap();
    m.fs.rename(ROOT, "ref.tmp", ROOT, "ref", Rename::Replace)
        .await
        .unwrap();
    store.open();

    let save = saving.await.unwrap();
    let mut claim = m.repo.claim("main").await.unwrap();
    for new_tree in save.trees.clone() {
        claim.trees.add(new_tree).unwrap();
    }
    m.repo
        .save(&mut claim, save.root, Some("snapshot"))
        .await
        .unwrap();
    m.fs.committed(&save);
    let out = tempdir().unwrap();
    m.repo.checkout("main", out.path()).await.unwrap();
    assert!(
        fs::read(out.path().join("log.bin")).unwrap() == before,
        "torn file"
    );
    assert!(!out.path().join("ref").exists(), "a later rename was saved");
    assert!(!out.path().join("object").exists());

    let mut after = before.clone();
    after[12 << 20..(12 << 20) + 4096].fill(7);
    after.truncate(14 << 20);
    assert!(read_all(&m.fs, "log.bin").await == after);
    commit(&m, &[], "next").await;
    let out = tempdir().unwrap();
    m.repo.checkout("main", out.path()).await.unwrap();
    assert!(fs::read(out.path().join("log.bin")).unwrap() == after);
    assert_eq!(fs::read(out.path().join("ref")).unwrap(), b"object");
    assert_eq!(
        fs::read(out.path().join("object")).unwrap(),
        pseudo_random(10_000)
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_truncate_racing_a_write_keeps_the_size_right() {
    let m = Arc::new(mounted().await);
    for round in 0..200 {
        let file =
            m.fs.create(ROOT, &format!("f{round}"), 0o644, None)
                .await
                .unwrap();
        m.fs.write(file.ino, 0, &[1; 8192]).await.unwrap();
        let writer = {
            let m = m.clone();
            tokio::spawn(async move { m.fs.write(file.ino, 16_384, &[2; 4096]).await })
        };
        let truncate = {
            let m = m.clone();
            tokio::spawn(async move { m.fs.setattr(file.ino, size(5000)).await })
        };
        writer.await.unwrap().unwrap();
        truncate.await.unwrap().unwrap();
        let attr = m.fs.getattr(file.ino).unwrap();
        let data = m.fs.read(file.ino, 0, 1 << 20).await.unwrap();
        assert_eq!(attr.size, data.len() as u64, "round {round}");
        assert!(attr.size == 5000 || attr.size == 20_480, "round {round}");
    }
}

#[tokio::test]
async fn hard_links_share_one_file_and_save_as_copies() {
    let m = mounted().await;
    let readme = resolve(&m.fs, "README.md").await.unwrap();
    let src = resolve(&m.fs, "src").await.unwrap();
    let link = m.fs.link(readme.ino, src.ino, "README.link").await.unwrap();
    assert_eq!((link.ino, link.nlink), (readme.ino, 2));
    assert_eq!(
        errno(m.fs.link(src.ino, ROOT, "dir-link").await),
        libc::EPERM
    );

    m.fs.write(link.ino, 0, b"HELLO, linked").await.unwrap();
    assert_eq!(read_all(&m.fs, "README.md").await, b"HELLO, linked");
    commit(&m, &[], "links").await;
    let out = tempdir().unwrap();
    m.repo.checkout("main", out.path()).await.unwrap();
    assert_eq!(
        fs::read(out.path().join("README.md")).unwrap(),
        b"HELLO, linked"
    );
    assert_eq!(
        fs::read(out.path().join("src/README.link")).unwrap(),
        b"HELLO, linked"
    );

    m.fs.unlink(ROOT, "README.md").await.unwrap();
    assert_eq!(m.fs.getattr(readme.ino).unwrap().nlink, 1);
    assert_eq!(read_all(&m.fs, "src/README.link").await, b"HELLO, linked");
}

#[tokio::test]
async fn rename_exchange_swaps_a_file_and_a_folder() {
    let m = mounted().await;
    let readme = resolve(&m.fs, "README.md").await.unwrap();
    let src = resolve(&m.fs, "src").await.unwrap();
    m.fs.rename(ROOT, "README.md", ROOT, "src", Rename::Exchange)
        .await
        .unwrap();
    assert_eq!(resolve(&m.fs, "src").await.unwrap().ino, readme.ino);
    assert_eq!(resolve(&m.fs, "README.md").await.unwrap().ino, src.ino);
    assert_eq!(read_all(&m.fs, "README.md/main.rs").await, b"fn main() {}");
    assert_eq!(
        errno(
            m.fs.rename(ROOT, "src", ROOT, "missing", Rename::Exchange)
                .await
        ),
        libc::ENOENT
    );
    let deep = resolve(&m.fs, "README.md/deep").await.unwrap();
    assert_eq!(
        errno(
            m.fs.rename(ROOT, "README.md", deep.ino, "loop", Rename::Replace)
                .await
        ),
        libc::EINVAL
    );
    assert_eq!(
        errno(
            m.fs.rename(src.ino, "deep", ROOT, "README.md", Rename::Exchange)
                .await
        ),
        libc::EINVAL
    );

    commit(&m, &[], "swapped").await;
    let out = tempdir().unwrap();
    m.repo.checkout("main", out.path()).await.unwrap();
    assert_eq!(fs::read(out.path().join("src")).unwrap(), b"hello");
    assert!(out.path().join("README.md/deep/big.bin").exists());
}

#[tokio::test]
async fn readdir_skips_nothing_when_entries_are_deleted_meanwhile() {
    let m = mounted().await;
    let dir = m.fs.mkdir(ROOT, "many", 0o755, None).await.unwrap();
    for i in 0..100 {
        m.fs.create(dir.ino, &format!("f{i:03}"), 0o644, None)
            .await
            .unwrap();
    }
    let mut offset = 0;
    let mut seen = 0;
    loop {
        let entries = m.fs.readdir(dir.ino, offset, 10).await.unwrap();
        let Some(last) = entries.last() else { break };
        offset = last.offset;
        for entry in entries.iter().filter(|entry| !entry.name.starts_with('.')) {
            m.fs.unlink(dir.ino, &entry.name).await.unwrap();
            seen += 1;
        }
    }
    assert_eq!(seen, 100);
    assert!(names(&m.fs, dir.ino).await.is_empty());
}

#[tokio::test]
async fn dot_dot_is_the_parent_folder() {
    let m = mounted().await;
    let src = resolve(&m.fs, "src").await.unwrap();
    let deep = resolve(&m.fs, "src/deep").await.unwrap();
    let entries = m.fs.readdir(deep.ino, 0, 2).await.unwrap();
    let dots: Vec<_> = entries
        .iter()
        .map(|entry| (entry.name.as_str(), entry.ino))
        .collect();
    assert_eq!(dots, [(".", deep.ino), ("..", src.ino)]);
    assert_eq!(m.fs.readdir(ROOT, 0, 2).await.unwrap()[1].ino, ROOT);
}

#[tokio::test]
async fn modes_survive_a_save_and_a_new_mount() {
    let m = mounted().await;
    let key = m.fs.create(ROOT, "id_ed25519", 0o600, None).await.unwrap();
    m.fs.write(key.ino, 0, b"secret").await.unwrap();
    let readme = resolve(&m.fs, "README.md").await.unwrap();
    let before = m.fs.getattr(readme.ino).unwrap();
    let changes = SetAttr {
        mode: Some(0o640),
        ..SetAttr::default()
    };
    let after = m.fs.setattr(readme.ino, changes).await.unwrap();
    assert_eq!(after.mode, 0o640);
    assert_eq!(after.modified, before.modified, "chmod keeps mtime");
    assert!(after.changed > before.changed, "chmod changes ctime");
    let script = resolve(&m.fs, "src/main.rs").await.unwrap();
    let changes = SetAttr {
        mode: Some(0o4755),
        ..SetAttr::default()
    };
    m.fs.setattr(script.ino, changes).await.unwrap();
    commit(&m, &[], "modes").await;

    let (again, _scratch) = remount(&m).await;
    assert_eq!(resolve(&again, "id_ed25519").await.unwrap().mode, 0o600);
    assert_eq!(resolve(&again, "README.md").await.unwrap().mode, 0o640);
    assert_eq!(resolve(&again, "src/main.rs").await.unwrap().mode, 0o4755);
}

#[tokio::test]
async fn inode_numbers_and_times_stay_the_same_across_mounts() {
    let m = mounted().await;
    let paths = ["README.md", "src", "src/deep/big.bin", "entry"];
    let mut first = Vec::new();
    for path in paths {
        let attr = resolve(&m.fs, path).await.unwrap();
        first.push((attr.ino, attr.changed));
    }
    let (again, _scratch) = remount(&m).await;
    again.create(ROOT, "new", 0o644, None).await.unwrap();
    for (path, (ino, changed)) in paths.into_iter().zip(&first) {
        let attr = resolve(&again, path).await.unwrap();
        assert_eq!(attr.ino, *ino, "{path}");
        if attr.kind == Kind::File {
            assert_eq!(attr.changed, *changed, "{path}");
        }
    }
}

#[tokio::test]
async fn fifos_and_sockets_stay_in_the_mount() {
    let m = mounted().await;
    let fifo = m.fs.mknod(ROOT, "pipe", 0o010644, 0, None).await.unwrap();
    assert_eq!((fifo.kind, fifo.mode), (Kind::Fifo, 0o644));
    let socket = m.fs.mknod(ROOT, "sock", 0o140755, 0, None).await.unwrap();
    assert_eq!(socket.kind, Kind::Socket);
    let file = m.fs.mknod(ROOT, "plain", 0o100644, 0, None).await.unwrap();
    assert_eq!(file.kind, Kind::File);
    commit(&m, &[], "special").await;

    let out = tempdir().unwrap();
    m.repo.checkout("main", out.path()).await.unwrap();
    assert!(out.path().join("plain").exists());
    assert!(out.path().join("pipe").symlink_metadata().is_err());
    assert!(out.path().join("sock").symlink_metadata().is_err());
}

#[tokio::test]
async fn extended_attributes_work_in_the_mount() {
    let m = mounted().await;
    let readme = resolve(&m.fs, "README.md").await.unwrap();
    assert_eq!(errno(m.fs.getxattr(readme.ino, b"user.a")), libc::ENODATA);
    m.fs.setxattr(readme.ino, b"user.a", b"1", SetXattr::Always)
        .unwrap();
    m.fs.setxattr(readme.ino, b"user.b", b"2", SetXattr::Create)
        .unwrap();
    assert_eq!(
        errno(m.fs.setxattr(readme.ino, b"user.b", b"3", SetXattr::Create)),
        libc::EEXIST
    );
    assert_eq!(
        errno(m.fs.setxattr(readme.ino, b"user.c", b"3", SetXattr::Replace)),
        libc::ENODATA
    );
    assert_eq!(m.fs.getxattr(readme.ino, b"user.b").unwrap(), b"2");
    assert_eq!(m.fs.listxattr(readme.ino).unwrap(), b"user.a\0user.b\0");
    m.fs.removexattr(readme.ino, b"user.a").unwrap();
    assert_eq!(m.fs.listxattr(readme.ino).unwrap(), b"user.b\0");
    assert_eq!(
        errno(m.fs.setxattr(
            readme.ino,
            b"system.posix_acl_access",
            b"",
            SetXattr::Always
        )),
        libc::EOPNOTSUPP
    );
}

#[tokio::test]
async fn files_deleted_without_kernel_references_are_freed() {
    let m = mounted().await;
    let scratch = m._dirs[2].path();
    let src = m.fs.readdir(ROOT, 0, usize::MAX).await.unwrap();
    let src = src.iter().find(|entry| entry.name == "src").unwrap().ino;
    let deep = m.fs.readdir(src, 0, usize::MAX).await.unwrap();
    let deep = deep.iter().find(|entry| entry.name == "deep").unwrap().ino;
    let big = m.fs.readdir(deep, 0, usize::MAX).await.unwrap();
    let big = big
        .iter()
        .find(|entry| entry.name == "big.bin")
        .unwrap()
        .ino;
    m.fs.write(big, 0, b"changed").await.unwrap();
    assert_eq!(fs::read_dir(scratch).unwrap().count(), 1);

    m.fs.unlink(deep, "big.bin").await.unwrap();
    m.fs.rmdir(src, "deep").await.unwrap();
    assert_eq!(errno(m.fs.getattr(big)), libc::ENOENT);
    assert_eq!(errno(m.fs.getattr(deep)), libc::ENOENT);
    assert_eq!(fs::read_dir(scratch).unwrap().count(), 0);
}

#[tokio::test(start_paused = true)]
async fn saved_files_go_back_to_the_store_when_idle() {
    let m = mounted().await;
    let scratch = m._dirs[2].path();
    let big = resolve(&m.fs, "src/deep/big.bin").await.unwrap();
    m.fs.write(big.ino, 10, b"patch").await.unwrap();
    commit(&m, &[], "patched").await;
    assert_eq!(fs::read_dir(scratch).unwrap().count(), 1);

    tokio::time::advance(std::time::Duration::from_secs(31)).await;
    m.fs.save(&[]).await.unwrap();
    assert_eq!(fs::read_dir(scratch).unwrap().count(), 0);
    let mut expected = m.big.clone();
    expected[10..15].copy_from_slice(b"patch");
    assert!(read_all(&m.fs, "src/deep/big.bin").await == expected);

    m.fs.write(big.ino, 20, b"again").await.unwrap();
    expected[20..25].copy_from_slice(b"again");
    assert!(read_all(&m.fs, "src/deep/big.bin").await == expected);
    commit(&m, &[], "again").await;
    let out = tempdir().unwrap();
    m.repo.checkout("main", out.path()).await.unwrap();
    assert!(fs::read(out.path().join("src/deep/big.bin")).unwrap() == expected);
}

#[tokio::test]
async fn truncating_a_large_stored_file_copies_nothing() {
    let m = mounted().await;
    let scratch = m._dirs[2].path();
    let big = resolve(&m.fs, "src/deep/big.bin").await.unwrap();
    m.fs.setattr(big.ino, size(0)).await.unwrap();
    assert_eq!(m.fs.getattr(big.ino).unwrap().size, 0);
    let names: Vec<_> = fs::read_dir(scratch)
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect();
    assert_eq!(names, [format!("{}.inline", big.ino).as_str()]);
    m.fs.write(big.ino, 0, b"new").await.unwrap();
    assert_eq!(read_all(&m.fs, "src/deep/big.bin").await, b"new");
}

#[tokio::test]
async fn changes_stay_pending_until_the_commit_lands() {
    let m = mounted().await;
    let notes = m.fs.create(ROOT, "notes.md", 0o644, None).await.unwrap();
    m.fs.write(notes.ino, 0, b"keep me").await.unwrap();
    let failed = m.fs.save(&[]).await.unwrap();
    assert!(m.fs.has_changes(), "a save without a commit cleared them");
    assert!(m.fs.unsaved_bytes() > 0);

    let tree = commit(&m, &[], "retry").await;
    assert_eq!(tree, failed.root);
    assert!(!m.fs.has_changes());
    assert_eq!(m.fs.unsaved_bytes(), 0);
    let out = tempdir().unwrap();
    m.repo.checkout("main", out.path()).await.unwrap();
    assert_eq!(fs::read(out.path().join("notes.md")).unwrap(), b"keep me");
}

#[tokio::test(start_paused = true)]
async fn reclaimed_files_are_read_from_the_cache() {
    let m = mounted().await;
    let data = pseudo_random(3 << 20);
    let file = m.fs.create(ROOT, "new.bin", 0o644, None).await.unwrap();
    m.fs.write(file.ino, 0, &data).await.unwrap();
    commit(&m, &[], "new file").await;

    tokio::time::advance(std::time::Duration::from_secs(31)).await;
    m.fs.save(&[]).await.unwrap();
    assert_eq!(fs::read_dir(m._dirs[2].path()).unwrap().count(), 0);
    let misses = m.cache.stats().misses;
    assert!(read_all(&m.fs, "new.bin").await == data);
    assert_eq!(m.cache.stats().misses, misses, "the file was downloaded");
}

#[tokio::test]
async fn a_snapshot_lists_the_mount_as_it_is() {
    use skywake_mount::Snapshot;

    let m = mounted().await;
    let big = resolve(&m.fs, "src/deep/big.bin").await.unwrap();
    m.fs.write(big.ino, 0, b"changed").await.unwrap();
    let notes = m.fs.create(ROOT, "notes.md", 0o644, None).await.unwrap();
    m.fs.write(notes.ino, 0, b"todo").await.unwrap();

    let snapshot = m.fs.snapshot().await.unwrap();
    let find = |path: &str| {
        snapshot
            .iter()
            .find(|(each, _)| each == path)
            .map(|(_, item)| item)
            .unwrap_or_else(|| panic!("{path} missing"))
    };
    assert!(matches!(find(""), Snapshot::Folder));
    assert!(matches!(find("src/deep"), Snapshot::Folder));
    assert!(matches!(
        find("notes.md"),
        Snapshot::Entry(Entry::File { data: Data::Inline(bytes), .. }) if bytes == b"todo"
    ));
    let Snapshot::Local { path, mode, .. } = find("src/deep/big.bin") else {
        panic!("not a local file")
    };
    assert_eq!(*mode, 0o644);
    let mut expected = m.big.clone();
    expected[..7].copy_from_slice(b"changed");
    assert!(fs::read(path).unwrap() == expected);
    let position = |path: &str| snapshot.iter().position(|(each, _)| each == path);
    assert!(position("src") < position("src/deep"));
}

#[tokio::test(start_paused = true)]
async fn ignored_files_keep_their_writes_when_idle() {
    let m = mounted().await;
    let data = pseudo_random(100 << 10);
    let target = m.fs.mkdir(ROOT, "target", 0o755, None).await.unwrap();
    let app = m.fs.create(target.ino, "app", 0o644, None).await.unwrap();
    m.fs.write(app.ino, 0, &data).await.unwrap();
    let big = resolve(&m.fs, "src/deep/big.bin").await.unwrap();
    m.fs.write(big.ino, 0, b"saved").await.unwrap();
    commit(&m, &["target".into()], "build").await;
    m.fs.write(big.ino, 0, b"later").await.unwrap();
    commit(&m, &["target".into(), "src/deep".into()], "ignore deep").await;

    tokio::time::advance(std::time::Duration::from_secs(31)).await;
    m.fs.save(&["target".into(), "src/deep".into()])
        .await
        .unwrap();
    assert!(read_all(&m.fs, "target/app").await == data);
    assert_eq!(&read_all(&m.fs, "src/deep/big.bin").await[..5], b"later");
}

#[tokio::test]
async fn truncate_grows_a_small_stored_file() {
    let m = mounted().await;
    for i in 0..20 {
        let name = format!("f{i:02}");
        let file = m.fs.create(ROOT, &name, 0o644, None).await.unwrap();
        m.fs.write(file.ino, 0, &[7; 4000]).await.unwrap();
    }
    commit(&m, &[], "small files").await;
    let (fs, _scratch) = remount(&m).await;
    let small = resolve(&fs, "f19").await.unwrap();
    fs.setattr(small.ino, size(4096)).await.unwrap();
    assert_eq!(fs.getattr(small.ino).unwrap().size, 4096);
    let mut expected = vec![7; 4000];
    expected.resize(4096, 0);
    assert_eq!(read_all(&fs, "f19").await, expected);
}

#[tokio::test]
async fn a_snapshot_lists_saved_files_by_their_stored_data() {
    use skywake_mount::Snapshot;

    let m = mounted().await;
    let big = resolve(&m.fs, "src/deep/big.bin").await.unwrap();
    m.fs.write(big.ino, 0, b"changed").await.unwrap();
    commit(&m, &[], "changed").await;
    let snapshot = m.fs.snapshot().await.unwrap();
    let (_, item) = snapshot
        .iter()
        .find(|(path, _)| path == "src/deep/big.bin")
        .unwrap();
    assert!(matches!(item, Snapshot::Entry(Entry::File { .. })));
}

#[tokio::test]
async fn stopping_writes_waits_for_writes_under_way() {
    let store = Gated::new();
    let m = mounted_on(store.clone(), u64::MAX).await;
    let big = resolve(&m.fs, "src/deep/big.bin").await.unwrap();
    store.close_reads();
    let waiting = store.waiting.notified();
    let written = std::sync::atomic::AtomicBool::new(false);
    let write = async {
        m.fs.write(big.ino, 0, b"late").await.unwrap();
        written.store(true, std::sync::atomic::Ordering::SeqCst);
    };
    let stop = async {
        waiting.await;
        let stopped = m.fs.stop_writes();
        store.open();
        stopped.await;
        written.load(std::sync::atomic::Ordering::SeqCst)
    };
    let ((), landed) = tokio::join!(write, stop);
    assert!(landed, "writes stopped while one was still under way");
    assert_eq!(errno(m.fs.write(big.ino, 0, b"later").await), libc::EROFS);
}

#[tokio::test]
async fn an_ignore_file_that_is_a_symlink_holds_no_rules() {
    let repo = Repo::new(Arc::new(InMemory::new()));
    let work = tempdir().unwrap();
    fs::write(work.path().join(".gitignore"), "build\n").unwrap();
    std::os::unix::fs::symlink(".gitignore", work.path().join(".skywakeignore")).unwrap();
    repo.create_branch("main", None).await.unwrap();
    repo.commit("main", work.path(), "rules").await.unwrap();
    let (cache_dir, scratch) = (tempdir().unwrap(), tempdir().unwrap());
    let cache = Arc::new(ChunkCache::new(cache_dir.path().into(), 1 << 30).unwrap());
    let (root, trees) = repo.head_tree("main").await.unwrap();
    let fs = BranchFs::new(
        repo.objects().clone(),
        cache,
        scratch.path().into(),
        root,
        trees,
    )
    .unwrap();
    let defaults = skywake_core::parse_ignored(None);
    assert_eq!(fs.ignored().await.unwrap(), defaults);
}

async fn chunk_names(store: &InMemory) -> Vec<object_store::path::Path> {
    use futures::TryStreamExt;
    let prefix = object_store::path::Path::from("chunks");
    store
        .list(Some(&prefix))
        .map_ok(|meta| meta.location)
        .try_collect()
        .await
        .unwrap()
}

#[tokio::test]
async fn a_failed_save_does_not_turn_small_files_into_chunks() {
    let store = Arc::new(InMemory::new());
    let m = mounted_on(store.clone(), u64::MAX).await;
    let many = m.fs.mkdir(ROOT, "many", 0o755, None).await.unwrap();
    for i in 0..100 {
        let file =
            m.fs.create(many.ino, &format!("f{i:03}"), 0o644, None)
                .await
                .unwrap();
        m.fs.write(file.ino, 0, &pseudo_random(2000 + i))
            .await
            .unwrap();
    }
    let before = chunk_names(&store).await;
    m.fs.save(&[]).await.unwrap();
    for name in chunk_names(&store).await {
        if !before.contains(&name) {
            store.delete(&name).await.unwrap();
        }
    }
    commit(&m, &[], "again").await;
    let (fs, _scratch) = remount(&m).await;
    for i in 0..100 {
        let path = format!("many/f{i:03}");
        assert_eq!(read_all(&fs, &path).await, pseudo_random(2000 + i));
    }
}

#[tokio::test]
async fn a_folder_moved_into_an_ignored_name_and_back_stays_readable() {
    let m = mounted().await;
    let mut claim = m.repo.claim("main").await.unwrap();
    let scratch = tempdir().unwrap();
    let fs = BranchFs::new(
        m.repo.objects().clone(),
        m.cache.clone(),
        scratch.path().into(),
        claim.tree,
        claim.trees.clone(),
    )
    .unwrap();
    let ignored: Vec<String> = vec!["__pycache__".into()];
    let src = resolve(&fs, "src").await.unwrap();
    fs.rename(src.ino, "deep", src.ino, "__pycache__", Rename::Replace)
        .await
        .unwrap();
    let save = fs.save(&ignored).await.unwrap();
    for tree in save.trees.clone() {
        claim.trees.add(tree).unwrap();
    }
    m.repo.save(&mut claim, save.root, None).await.unwrap();
    fs.committed(&save);

    fs.rename(src.ino, "__pycache__", src.ino, "deep", Rename::Replace)
        .await
        .unwrap();
    let big = resolve(&fs, "src/deep/big.bin").await;
    assert!(
        big.is_ok(),
        "the moved-back folder can't be opened: {:?}",
        big.err()
    );
    let save = fs.save(&ignored).await;
    assert!(save.is_ok(), "{:?}", save.err());
}

#[tokio::test]
async fn an_ignored_folder_in_the_branch_stays_readable_after_a_save() {
    let m = mounted().await;
    let mut claim = m.repo.claim("main").await.unwrap();
    let scratch = tempdir().unwrap();
    let fs = BranchFs::new(
        m.repo.objects().clone(),
        m.cache.clone(),
        scratch.path().into(),
        claim.tree,
        claim.trees.clone(),
    )
    .unwrap();
    let ignored: Vec<String> = vec!["deep".into()];
    let src = resolve(&fs, "src").await.unwrap();
    fs.create(src.ino, "notes.md", 0o644, None).await.unwrap();
    let save = fs.save(&ignored).await.unwrap();
    for tree in save.trees.clone() {
        claim.trees.add(tree).unwrap();
    }
    m.repo.save(&mut claim, save.root, None).await.unwrap();
    fs.committed(&save);
    let big = resolve(&fs, "src/deep/big.bin").await;
    assert!(
        big.is_ok(),
        "the ignored folder can't be opened: {:?}",
        big.err()
    );
}

#[tokio::test]
async fn a_failed_save_of_a_large_local_file_uploads_it_again() {
    let store = Arc::new(InMemory::new());
    let m = mounted_on(store.clone(), u64::MAX).await;
    let file = m.fs.create(ROOT, "big2", 0o644, None).await.unwrap();
    let bytes = pseudo_random(3 << 20);
    m.fs.write(file.ino, 0, &bytes).await.unwrap();
    let before = chunk_names(&store).await;
    m.fs.save(&[]).await.unwrap();
    for name in chunk_names(&store).await {
        if !before.contains(&name) {
            store.delete(&name).await.unwrap();
        }
    }
    commit(&m, &[], "again").await;
    let (fs, _scratch) = remount(&m).await;
    assert_eq!(read_all(&fs, "big2").await, bytes);
}

#[tokio::test]
async fn ignored_files_the_branch_holds_stay_as_they_were() {
    let m = mounted().await;
    let src = resolve(&m.fs, "src").await.unwrap();
    let store =
        m.fs.create(src.ino, ".DS_Store", 0o644, None)
            .await
            .unwrap();
    m.fs.write(store.ino, 0, b"finder").await.unwrap();
    m.fs.symlink(src.ino, "cache", "/tmp/cache", None)
        .await
        .unwrap();
    commit(&m, &[], "with .DS_Store").await;

    let ignored: Vec<String> = vec![".DS_Store".into(), "cache".into()];
    let (fs, _scratch) = remount(&m).await;
    let src = resolve(&fs, "src").await.unwrap();
    fs.create(src.ino, "new.rs", 0o644, None).await.unwrap();
    fs.create(ROOT, ".DS_Store", 0o644, None).await.unwrap();
    commit_from(&m, &fs, &ignored, "src changed").await;
    let out = tempdir().unwrap();
    m.repo.checkout("main", out.path()).await.unwrap();
    assert!(out.path().join("src/new.rs").exists());
    assert_eq!(
        fs::read(out.path().join("src/.DS_Store")).unwrap(),
        b"finder"
    );
    assert!(out.path().join("src/cache").symlink_metadata().is_ok());
    assert!(!out.path().join(".DS_Store").exists());

    let store = resolve(&fs, "src/.DS_Store").await.unwrap();
    fs.write(store.ino, 0, b"FINDER, changed").await.unwrap();
    fs.create(src.ino, "newer.rs", 0o644, None).await.unwrap();
    commit_from(&m, &fs, &ignored, "src changed again").await;
    let out = tempdir().unwrap();
    m.repo.checkout("main", out.path()).await.unwrap();
    assert!(out.path().join("src/newer.rs").exists());
    assert_eq!(
        fs::read(out.path().join("src/.DS_Store")).unwrap(),
        b"finder"
    );
    assert_eq!(read_all(&fs, "src/.DS_Store").await, b"FINDER, changed");
}

#[tokio::test]
async fn local_data_stays_under_the_mount_limit() {
    let mut m = mounted().await;
    m.fs = m.fs.with_local_limit(1 << 20);
    let file = m.fs.create(ROOT, "fill", 0o644, None).await.unwrap();
    m.fs.write(file.ino, 0, &[1; 600 << 10]).await.unwrap();
    let past = m.fs.write(file.ino, 600 << 10, &[2; 500 << 10]).await;
    assert_eq!(errno(past), libc::ENOSPC);
    assert_eq!(
        errno(m.fs.setattr(file.ino, size(2 << 20)).await),
        libc::ENOSPC
    );
    m.fs.write(file.ino, 0, &[3; 600 << 10]).await.unwrap();
    assert_eq!(m.fs.local_bytes(), 600 << 10);

    let small = m.fs.create(ROOT, "small", 0o644, None).await.unwrap();
    m.fs.write(small.ino, 0, &[4; 4000]).await.unwrap();
    assert_eq!(m.fs.local_bytes(), (600 << 10) + 4000);

    let big = resolve(&m.fs, "src/deep/big.bin").await.unwrap();
    assert_eq!(errno(m.fs.write(big.ino, 0, b"x").await), libc::ENOSPC);
    assert_eq!(read_all(&m.fs, "src/deep/big.bin").await, m.big);

    m.fs.setattr(file.ino, size(100 << 10)).await.unwrap();
    assert_eq!(m.fs.local_bytes(), (100 << 10) + 4000);
    m.fs.unlink(ROOT, "small").await.unwrap();
    m.fs.forget(small.ino, 1);
    m.fs.unlink(ROOT, "fill").await.unwrap();
    m.fs.forget(file.ino, 1);
    assert_eq!(m.fs.local_bytes(), 0);
    let file = m.fs.create(ROOT, "again", 0o644, None).await.unwrap();
    m.fs.write(file.ino, 0, &[5; 1 << 20]).await.unwrap();
}

#[tokio::test]
async fn saved_scratch_files_make_room_near_the_limit() {
    let mut m = mounted().await;
    m.fs = m.fs.with_local_limit(6 << 20);
    let big = resolve(&m.fs, "src/deep/big.bin").await.unwrap();
    m.fs.write(big.ino, 0, b"patched").await.unwrap();
    assert_eq!(m.fs.local_bytes(), 5 << 20);
    let new = m.fs.create(ROOT, "new", 0o644, None).await.unwrap();
    let data = pseudo_random(2 << 20);
    assert_eq!(errno(m.fs.write(new.ino, 0, &data).await), libc::ENOSPC);

    commit(&m, &[], "patched").await;
    m.fs.write(new.ino, 0, &data).await.unwrap();
    assert_eq!(m.fs.local_bytes(), 2 << 20);
    let mut expected = m.big.clone();
    expected[..7].copy_from_slice(b"patched");
    assert!(read_all(&m.fs, "src/deep/big.bin").await == expected);
    assert!(read_all(&m.fs, "new").await == data);
}

#[tokio::test]
async fn a_small_write_to_a_big_file_uploads_only_what_changed() {
    let store = Arc::new(InMemory::new());
    let m = mounted_on(store.clone(), u64::MAX).await;
    let before = chunk_times(&store).await;
    let big = resolve(&m.fs, "src/deep/big.bin").await.unwrap();
    m.fs.write(big.ino, 3 << 20, b"changed").await.unwrap();
    commit(&m, &[], "a small change").await;
    let after = chunk_times(&store).await;
    let again = before
        .iter()
        .filter(|(path, at)| after.get(*path) != Some(at));
    assert_eq!(again.count(), 0, "unchanged chunks were uploaded again");
    let new = after
        .keys()
        .filter(|path| !before.contains_key(*path))
        .count();
    assert!((1..=2).contains(&new), "{new} new chunks");
    let mut expected = m.big.clone();
    expected[3 << 20..(3 << 20) + 7].copy_from_slice(b"changed");
    let (fs, _scratch) = remount(&m).await;
    assert_eq!(read_all(&fs, "src/deep/big.bin").await, expected);
}

async fn chunk_times(store: &InMemory) -> std::collections::HashMap<String, Option<i64>> {
    use futures::TryStreamExt;
    let listing: Vec<_> = store
        .list(Some(&object_store::path::Path::from("chunks")))
        .try_collect()
        .await
        .unwrap();
    listing
        .into_iter()
        .map(|meta| {
            let at = meta.last_modified.timestamp_nanos_opt();
            (meta.location.to_string(), at)
        })
        .collect()
}

async fn tree_of(fs: &BranchFs, dir: u64, at: &str, found: &mut Vec<(String, Vec<u8>)>) {
    for entry in fs
        .readdir(dir, 0, usize::MAX)
        .await
        .unwrap()
        .into_iter()
        .skip(2)
    {
        let path = format!("{at}{}", entry.name);
        let attr = fs.lookup(dir, &entry.name).await.unwrap();
        match entry.kind {
            Kind::Dir => {
                found.push((format!("{path}/"), Vec::new()));
                Box::pin(tree_of(fs, attr.ino, &format!("{path}/"), found)).await;
            }
            Kind::Symlink => found.push((path, fs.readlink(attr.ino).unwrap().into_bytes())),
            _ => found.push((path, fs.read(attr.ino, 0, attr.size as u32).await.unwrap())),
        }
    }
}

#[tokio::test]
async fn a_replay_on_another_mount_rebuilds_every_change() {
    let m = mounted().await;
    m.fs.start_log();
    let src = resolve(&m.fs, "src").await.unwrap().ino;
    let big = resolve(&m.fs, "src/deep/big.bin").await.unwrap().ino;
    m.fs.write(big, 1 << 20, b"in the middle").await.unwrap();
    let new = m.fs.create(ROOT, "new.txt", 0o644, None).await.unwrap().ino;
    m.fs.write(new, 0, b"hello").await.unwrap();
    m.fs.mkdir(ROOT, "docs", 0o755, None).await.unwrap();
    let docs = resolve(&m.fs, "docs").await.unwrap().ino;
    m.fs.rename(ROOT, "README.md", docs, "README.md", Rename::Replace)
        .await
        .unwrap();
    m.fs.rename(src, "deep", src, "deeper", Rename::Replace)
        .await
        .unwrap();
    m.fs.write(big, 0, b"start").await.unwrap();
    let main = resolve(&m.fs, "src/main.rs").await.unwrap().ino;
    m.fs.setattr(main, size(3)).await.unwrap();
    m.fs.symlink(docs, "link", "../new.txt", None)
        .await
        .unwrap();
    m.fs.unlink(ROOT, "entry").await.unwrap();
    let gone =
        m.fs.create(ROOT, "gone.txt", 0o644, None)
            .await
            .unwrap()
            .ino;
    m.fs.write(gone, 0, b"bye").await.unwrap();
    m.fs.unlink(ROOT, "gone.txt").await.unwrap();
    m.fs.write(gone, 0, b"written after unlink").await.unwrap();

    let taken = m.fs.take_ops();
    assert_eq!(taken.lost, 0);
    let (other, _scratch) = remount(&m).await;
    let ops = taken.ops.into_iter().map(|(_, op)| op).collect();
    assert_eq!(other.replay(ops).await, 0);

    let (mut want, mut got) = (Vec::new(), Vec::new());
    tree_of(&m.fs, ROOT, "", &mut want).await;
    tree_of(&other, ROOT, "", &mut got).await;
    assert_eq!(got, want);
}

#[tokio::test]
async fn a_save_drops_the_logged_changes_it_holds() {
    let m = mounted().await;
    m.fs.start_log();
    let file = resolve(&m.fs, "README.md").await.unwrap().ino;
    m.fs.write(file, 0, b"one").await.unwrap();
    commit(&m, &[], "one").await;
    assert!(m.fs.take_ops().ops.is_empty());
    m.fs.write(file, 0, b"two").await.unwrap();
    let taken = m.fs.take_ops();
    assert_eq!(taken.ops.len(), 1);
    assert!(m.fs.take_ops().ops.is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn overlapping_writes_replay_in_the_order_they_landed() {
    let m = mounted().await;
    m.fs.start_log();
    let file =
        m.fs.create(ROOT, "race.bin", 0o644, None)
            .await
            .unwrap()
            .ino;
    let runtime = tokio::runtime::Handle::current();
    tokio::task::block_in_place(|| {
        std::thread::scope(|threads| {
            for i in 0..8u8 {
                let (fs, runtime) = (&m.fs, &runtime);
                threads.spawn(move || {
                    runtime.block_on(async {
                        for round in 0..16u64 {
                            fs.write(file, round * 1000, &vec![i; 300_000])
                                .await
                                .unwrap();
                            fs.setattr(file, size(200_000 + round * 1000 + u64::from(i)))
                                .await
                                .unwrap();
                        }
                    })
                });
            }
        })
    });

    let taken = m.fs.take_ops();
    let (other, _scratch) = remount(&m).await;
    let ops = taken.ops.into_iter().map(|(_, op)| op).collect();
    assert_eq!(other.replay(ops).await, 0);
    let (mut want, mut got) = (Vec::new(), Vec::new());
    tree_of(&m.fs, ROOT, "", &mut want).await;
    tree_of(&other, ROOT, "", &mut got).await;
    assert!(got == want, "the replay differs from the mount");
}
