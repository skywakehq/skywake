//! The mount through the kernel's FUSE device. Needs Linux and /dev/fuse;
//! run it in the dev container (scripts/shell.sh).
#![cfg(target_os = "linux")]

use std::ffi::CString;
use std::fs;
use std::io::Write;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{FileExt, MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

#[allow(dead_code)] // fs.rs uses the rest
mod gate;

use gate::Gated;
use skywake_core::Repo;
use skywake_mount::{
    BackgroundSession, BranchFs, ChunkCache, MountOptions, mount_with_options, sync_kernel,
};
use tempfile::{TempDir, tempdir};
use tokio::runtime::Runtime;
use tokio::sync::mpsc;

/// A branch mounted over FUSE. `fsync` saves and commits, as the daemon
/// does, and counts the saves.
struct Mounted {
    runtime: Runtime,
    /// Can hold chunk downloads, so a write can be held in the mount.
    store: Arc<Gated>,
    repo: Repo,
    cache: Arc<ChunkCache>,
    session: Option<BackgroundSession>,
    /// The filesystem behind the mount, to see what reached it.
    fs: Option<Arc<BranchFs>>,
    path: TempDir,
    saves: Arc<AtomicUsize>,
    big: Vec<u8>,
    _dirs: Vec<TempDir>,
}

impl Mounted {
    fn new() -> Self {
        Self::with_options(MountOptions::default())
    }

    fn with_options(options: MountOptions) -> Self {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(4)
            .enable_all()
            .build()
            .unwrap();
        let store = Gated::new();
        let repo = Repo::new(store.clone());
        let work = tempdir().unwrap();
        let big = pseudo_random(5 << 20);
        fs::create_dir_all(work.path().join("src")).unwrap();
        fs::write(work.path().join("README.md"), "hello").unwrap();
        fs::write(work.path().join("src/big.bin"), &big).unwrap();
        runtime.block_on(async {
            repo.create_branch("main", None).await.unwrap();
            repo.commit("main", work.path(), "base").await.unwrap();
        });
        let cache_dir = tempdir().unwrap();
        let cache = Arc::new(ChunkCache::new(cache_dir.path().into(), u64::MAX).unwrap());
        let mut mounted = Self {
            runtime,
            store,
            repo,
            cache,
            session: None,
            fs: None,
            path: tempdir().unwrap(),
            saves: Arc::default(),
            big,
            _dirs: vec![work, cache_dir],
        };
        mounted.mount(&options);
        mounted
    }

    fn mount(&mut self, options: &MountOptions) {
        let scratch = tempdir().unwrap();
        let (root, trees) = self.runtime.block_on(self.repo.head_tree("main")).unwrap();
        let fs = Arc::new(
            BranchFs::new(
                self.repo.objects().clone(),
                self.cache.clone(),
                scratch.path().into(),
                root,
                trees,
            )
            .unwrap(),
        );
        let (fsyncs, mut waiting) = mpsc::unbounded_channel::<tokio::sync::oneshot::Sender<_>>();
        let (repo, saves, saving) = (self.repo.clone(), self.saves.clone(), fs.clone());
        self.runtime.spawn(async move {
            while let Some(done) = waiting.recv().await {
                let mut claim = repo.claim("main").await.unwrap();
                let save = saving.save(&[]).await.unwrap();
                for new_tree in save.trees.clone() {
                    claim.trees.add(new_tree).unwrap();
                }
                repo.save(&mut claim, save.root, Some("fsync"))
                    .await
                    .unwrap();
                saving.committed(&save);
                saves.fetch_add(1, Ordering::SeqCst);
                let _ = done.send(Ok(()));
            }
        });
        self.fs = Some(fs.clone());
        let _entered = self.runtime.enter();
        self.session = Some(mount_with_options(fs, self.path.path(), fsyncs, options).unwrap());
        self._dirs.push(scratch);
    }

    /// Saves everything, unmounts, and mounts the saved branch again.
    fn remount(&mut self) {
        sync(self.path.path());
        self.session.take().unwrap().umount_and_join().unwrap();
        self.mount(&MountOptions::default());
    }

    fn at(&self, path: &str) -> PathBuf {
        self.path.path().join(path)
    }

    /// The branch as last saved, checked out to a new folder.
    fn checkout(&self) -> TempDir {
        let out = tempdir().unwrap();
        self.runtime
            .block_on(self.repo.checkout("main", out.path()))
            .unwrap();
        out
    }
}

impl Drop for Mounted {
    fn drop(&mut self) {
        if let Some(session) = self.session.take() {
            let _ = session.umount_and_join();
        }
    }
}

/// Sends the kernel's cached writes, then saves everything with an
/// `fsync` of the root folder.
fn sync(path: &Path) {
    let root = fs::File::open(path).unwrap();
    sync_kernel(&root).unwrap();
    root.sync_all().unwrap();
}

fn c(path: &Path) -> CString {
    CString::new(path.as_os_str().as_bytes()).unwrap()
}

fn check(result: i32) {
    assert_eq!(result, 0, "{}", std::io::Error::last_os_error());
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

#[test]
fn parallel_first_writes_through_the_kernel_keep_every_write() {
    let m = Mounted::new();
    let path = m.at("src/big.bin");
    std::thread::scope(|scope| {
        for i in 0..8u64 {
            let path = &path;
            scope.spawn(move || {
                let file = fs::OpenOptions::new().write(true).open(path).unwrap();
                file.write_all_at(&[b'a' + i as u8; 100], i * 600_000)
                    .unwrap();
            });
        }
    });
    let mut expected = m.big.clone();
    for i in 0..8 {
        expected[i * 600_000..i * 600_000 + 100].fill(b'a' + i as u8);
    }
    sync(m.path.path());
    assert!(fs::read(&path).unwrap() == expected, "a write was lost");
    let out = m.checkout();
    assert!(fs::read(out.path().join("src/big.bin")).unwrap() == expected);
}

#[test]
fn fsync_of_a_folder_saves_a_rename() {
    let m = Mounted::new();
    let mut tmp = fs::File::create(m.at("config.tmp")).unwrap();
    tmp.write_all(b"new config").unwrap();
    tmp.sync_all().unwrap();
    let saves = m.saves.load(Ordering::SeqCst);
    fs::rename(m.at("config.tmp"), m.at("config")).unwrap();
    fs::File::open(m.path.path()).unwrap().sync_all().unwrap();
    assert_eq!(m.saves.load(Ordering::SeqCst), saves + 1, "fsyncdir saved");
    let out = m.checkout();
    assert_eq!(fs::read(out.path().join("config")).unwrap(), b"new config");
}

#[test]
fn rm_rf_style_deletes_every_entry_in_one_pass() {
    let m = Mounted::new();
    let dir = m.at("many");
    fs::create_dir(&dir).unwrap();
    for i in 0..2000 {
        fs::write(
            dir.join(format!("a-long-file-name-to-fill-the-buffer-{i:05}")),
            "x",
        )
        .unwrap();
    }
    // One pass of readdir, deleting each entry as it is read.
    let mut deleted = 0;
    for entry in fs::read_dir(&dir).unwrap() {
        fs::remove_file(entry.unwrap().path()).unwrap();
        deleted += 1;
    }
    assert_eq!(deleted, 2000);
    fs::remove_dir(&dir).unwrap();
}

#[test]
fn hard_links_are_one_file() {
    let m = Mounted::new();
    fs::hard_link(m.at("README.md"), m.at("src/linked")).unwrap();
    let (a, b) = (
        fs::metadata(m.at("README.md")).unwrap(),
        fs::metadata(m.at("src/linked")).unwrap(),
    );
    assert_eq!((a.ino(), a.nlink()), (b.ino(), 2));
    fs::write(m.at("src/linked"), "changed through the link").unwrap();
    assert_eq!(
        fs::read(m.at("README.md")).unwrap(),
        b"changed through the link"
    );
    fs::remove_file(m.at("README.md")).unwrap();
    assert_eq!(fs::metadata(m.at("src/linked")).unwrap().nlink(), 1);
}

#[test]
fn rename_exchange_swaps_two_names() {
    let m = Mounted::new();
    fs::write(m.at("a"), "A").unwrap();
    // SAFETY: both paths are valid C strings that outlive the call.
    check(unsafe {
        libc::renameat2(
            libc::AT_FDCWD,
            c(&m.at("a")).as_ptr(),
            libc::AT_FDCWD,
            c(&m.at("src")).as_ptr(),
            libc::RENAME_EXCHANGE,
        )
    });
    assert_eq!(fs::read(m.at("src")).unwrap(), b"A");
    assert!(m.at("a/big.bin").exists());
}

#[test]
fn modes_survive_a_remount() {
    let mut m = Mounted::new();
    // SAFETY: umask only changes this process's mask.
    unsafe { libc::umask(0o022) };
    fs::write(m.at("id_ed25519"), "key").unwrap();
    fs::set_permissions(m.at("id_ed25519"), fs::Permissions::from_mode(0o600)).unwrap();
    fs::write(m.at("open"), "x").unwrap();
    let mode = |path: &str| fs::metadata(m.at(path)).unwrap().permissions().mode() & 0o7777;
    assert_eq!((mode("id_ed25519"), mode("open")), (0o600, 0o644));

    let before = fs::metadata(m.at("README.md")).unwrap();
    fs::set_permissions(m.at("README.md"), fs::Permissions::from_mode(0o640)).unwrap();
    let after = fs::metadata(m.at("README.md")).unwrap();
    assert_eq!(after.mtime_nsec(), before.mtime_nsec());
    assert!((after.ctime(), after.ctime_nsec()) > (before.ctime(), before.ctime_nsec()));

    m.remount();
    let mode = |path: &str| fs::metadata(m.at(path)).unwrap().permissions().mode() & 0o7777;
    assert_eq!(mode("id_ed25519"), 0o600);
    assert_eq!(mode("README.md"), 0o640);
}

#[test]
fn inode_numbers_stay_the_same_across_mounts() {
    let mut m = Mounted::new();
    let ino = |path: &str| fs::metadata(m.at(path)).unwrap().ino();
    let before = [ino("README.md"), ino("src"), ino("src/big.bin")];
    m.remount();
    // Use the mount differently this time.
    fs::write(m.at("new"), "x").unwrap();
    let ino = |path: &str| fs::metadata(m.at(path)).unwrap().ino();
    assert_eq!([ino("README.md"), ino("src"), ino("src/big.bin")], before);
}

#[test]
fn dot_dot_names_the_parent() {
    let m = Mounted::new();
    let root = fs::metadata(m.path.path()).unwrap().ino();
    let path = c(&m.at("src"));
    let mut found = None;
    // SAFETY: the directory stream is used only between opendir and
    // closedir, and each entry only before the next readdir.
    unsafe {
        let dir = libc::opendir(path.as_ptr());
        assert!(!dir.is_null());
        loop {
            let entry = libc::readdir(dir);
            if entry.is_null() {
                break;
            }
            let name = std::ffi::CStr::from_ptr((*entry).d_name.as_ptr());
            if name.to_bytes() == b".." {
                found = Some((*entry).d_ino);
            }
        }
        libc::closedir(dir);
    }
    assert_eq!(found, Some(root));
}

#[test]
fn fifos_work_and_are_not_saved() {
    let m = Mounted::new();
    // SAFETY: a valid C string that outlives the call.
    check(unsafe { libc::mkfifo(c(&m.at("pipe")).as_ptr(), 0o644) });
    let reader = std::thread::spawn({
        let path = m.at("pipe");
        move || fs::read(path).unwrap()
    });
    fs::write(m.at("pipe"), "through the pipe").unwrap();
    assert_eq!(reader.join().unwrap(), b"through the pipe");
    sync(m.path.path());
    assert!(m.checkout().path().join("pipe").symlink_metadata().is_err());
}

#[test]
fn extended_attributes_can_be_set_and_read() {
    let m = Mounted::new();
    let path = c(&m.at("README.md"));
    let (name, value) = (c(Path::new("user.origin")), b"agent");
    // SAFETY: valid C strings and a buffer of the given length.
    unsafe {
        check(libc::setxattr(
            path.as_ptr(),
            name.as_ptr(),
            value.as_ptr().cast(),
            value.len(),
            0,
        ));
        let mut buffer = [0u8; 64];
        let len = libc::getxattr(
            path.as_ptr(),
            name.as_ptr(),
            buffer.as_mut_ptr().cast(),
            buffer.len(),
        );
        assert_eq!(&buffer[..len as usize], value);
        let len = libc::listxattr(path.as_ptr(), buffer.as_mut_ptr().cast(), buffer.len());
        assert_eq!(&buffer[..len as usize], b"user.origin\0");
    }
}

#[test]
fn an_owner_and_allow_other_can_be_set() {
    let m = Mounted::with_options(MountOptions {
        owner: Some((1234, 5678)),
        allow_other: true,
    });
    let readme = fs::metadata(m.at("README.md")).unwrap();
    assert_eq!((readme.uid(), readme.gid()), (1234, 5678));
    fs::write(m.at("mine"), "x").unwrap();
    // SAFETY: getuid can't fail.
    let me = unsafe { libc::getuid() };
    assert_eq!(fs::metadata(m.at("mine")).unwrap().uid(), me);
    std::os::unix::fs::chown(m.at("mine"), Some(42), Some(43)).unwrap();
    let mine = fs::metadata(m.at("mine")).unwrap();
    assert_eq!((mine.uid(), mine.gid()), (42, 43));
}

/// The kernel keeps writes in its cache, and those through `mmap`, and
/// sends them when a save asks. They may still be on their way when
/// `syncfs` returns; `sync_kernel` waits for them, so a save never misses
/// what a program wrote before it.
#[test]
fn sync_kernel_waits_for_writes_still_on_their_way() {
    let m = Mounted::new();
    // A whole page needs no read first. Copying the rest of the file
    // to scratch waits at the closed gate, so this write is slow.
    let big = fs::OpenOptions::new()
        .write(true)
        .open(m.at("src/big.bin"))
        .unwrap();
    big.write_all_at(&[7; 4096], 0).unwrap();
    let mapped = fs::File::options()
        .read(true)
        .write(true)
        .create(true)
        .truncate(true)
        .open(m.at("mapped"))
        .unwrap();
    let len = 64 * 1024;
    mapped.set_len(len as u64).unwrap();
    // SAFETY: a new shared mapping of an open file, used only below.
    let map = unsafe {
        libc::mmap(
            std::ptr::null_mut(),
            len,
            libc::PROT_READ | libc::PROT_WRITE,
            libc::MAP_SHARED,
            std::os::fd::AsRawFd::as_raw_fd(&mapped),
            0,
        )
    };
    assert_ne!(map, libc::MAP_FAILED);
    // SAFETY: the mapping is `len` bytes long.
    unsafe { std::slice::from_raw_parts_mut(map.cast::<u8>(), len) }.fill(b'm');

    m.store.close_reads();
    std::thread::scope(|scope| {
        scope.spawn(|| {
            std::thread::sleep(std::time::Duration::from_millis(300));
            m.store.open();
        });
        sync_kernel(&fs::File::open(m.path.path()).unwrap()).unwrap();
        let fs = m.fs.as_ref().unwrap();
        let read = |file: &fs::File, len| {
            let ino = file.metadata().unwrap().ino();
            m.runtime.block_on(fs.read(ino, 0, len)).unwrap()
        };
        assert!(
            read(&mapped, len as u32) == vec![b'm'; len],
            "mmap writes are missing"
        );
        assert!(read(&big, 4096) == [7; 4096], "a cached write is missing");
    });
    // SAFETY: the mapping is not used after this.
    unsafe { libc::munmap(map, len) };
}
