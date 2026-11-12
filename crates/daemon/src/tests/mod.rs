//! Tests that reach inside the daemon. They need Linux, FUSE and root.

mod ignored;
mod members;
mod saving;

use std::ffi::OsStr;
use std::fmt;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use async_trait::async_trait;
use clap::Parser;
use futures::stream::BoxStream;
use object_store::path::Path as Key;
use object_store::{
    CopyOptions, GetOptions, GetResult, ListResult, MultipartUpload, ObjectMeta, ObjectStore,
    PutMultipartOptions, PutOptions, PutPayload, PutResult, RenameOptions, Result,
};
use skywake_core::{Repo, open_store};
use skywake_daemon::{Request, Response};
use tokio::sync::Notify;

use crate::server::{Args, Caller, Daemon};

const ADMIN: Caller = Caller {
    uid: 0,
    gid: 0,
    admin: true,
};

#[derive(Debug)]
struct StallOne {
    inner: Arc<dyn ObjectStore>,
    key: Key,
    stalled: AtomicBool,
    failing: AtomicBool,
    unsettle: AtomicBool,
    fail_next_read: AtomicBool,
    hanging: Notify,
    released: Notify,
}

impl fmt::Display for StallOne {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "StallOne({})", self.inner)
    }
}

#[async_trait]
impl ObjectStore for StallOne {
    async fn put_opts(
        &self,
        key: &Key,
        payload: PutPayload,
        opts: PutOptions,
    ) -> Result<PutResult> {
        if self.failing.load(Ordering::SeqCst) {
            return Err(object_store::Error::Generic {
                store: "test",
                source: "the bucket is down".into(),
            });
        }
        if *key == self.key && self.stalled.load(Ordering::SeqCst) {
            let released = self.released.notified();
            self.hanging.notify_one();
            released.await;
        }
        let written = self.inner.put_opts(key, payload, opts).await;
        if *key == self.key && self.unsettle.swap(false, Ordering::SeqCst) {
            self.fail_next_read.store(true, Ordering::SeqCst);
            return Err(object_store::Error::Generic {
                store: "test",
                source: "timed out".into(),
            });
        }
        written
    }

    async fn put_multipart_opts(
        &self,
        key: &Key,
        opts: PutMultipartOptions,
    ) -> Result<Box<dyn MultipartUpload>> {
        self.inner.put_multipart_opts(key, opts).await
    }

    async fn get_opts(&self, key: &Key, options: GetOptions) -> Result<GetResult> {
        if *key == self.key && self.fail_next_read.swap(false, Ordering::SeqCst) {
            return Err(object_store::Error::Generic {
                store: "test",
                source: "timed out".into(),
            });
        }
        self.inner.get_opts(key, options).await
    }

    fn delete_stream(
        &self,
        keys: BoxStream<'static, Result<Key>>,
    ) -> BoxStream<'static, Result<Key>> {
        self.inner.delete_stream(keys)
    }

    fn list(&self, prefix: Option<&Key>) -> BoxStream<'static, Result<ObjectMeta>> {
        self.inner.list(prefix)
    }

    fn list_with_offset(
        &self,
        prefix: Option<&Key>,
        offset: &Key,
    ) -> BoxStream<'static, Result<ObjectMeta>> {
        self.inner.list_with_offset(prefix, offset)
    }

    async fn list_with_delimiter(&self, prefix: Option<&Key>) -> Result<ListResult> {
        self.inner.list_with_delimiter(prefix).await
    }

    async fn copy_opts(&self, from: &Key, to: &Key, options: CopyOptions) -> Result<()> {
        self.inner.copy_opts(from, to, options).await
    }

    async fn rename_opts(&self, from: &Key, to: &Key, options: RenameOptions) -> Result<()> {
        self.inner.rename_opts(from, to, options).await
    }
}

async fn mount(daemon: &Daemon, branch: &str, path: &Path) {
    let request = Request::Mount {
        branch: branch.into(),
        path: path.into(),
        vm: false,
        read_only: false,
        owner: None,
        allow_other: false,
    };
    match daemon.handle(ADMIN, request).await {
        Response::Done => {}
        other => panic!("mount failed: {other:?}"),
    }
}

async fn stalling_main() -> Arc<StallOne> {
    let stall = Arc::new(StallOne {
        inner: Arc::new(object_store::memory::InMemory::new()),
        key: Key::from("refs/main"),
        stalled: AtomicBool::new(false),
        failing: AtomicBool::new(false),
        unsettle: AtomicBool::new(false),
        fail_next_read: AtomicBool::new(false),
        hanging: Notify::new(),
        released: Notify::new(),
    });
    Repo::new(stall.clone())
        .create_branch("main", None)
        .await
        .unwrap();
    stall
}

fn args(root: &Path, extra: &[&str]) -> Args {
    let mut all = vec![
        OsStr::new("skywaked"),
        OsStr::new("--root"),
        root.as_os_str(),
    ];
    all.extend(extra.iter().map(OsStr::new));
    Args::parse_from(all)
}

fn daemon(root: &Path, store: Arc<dyn ObjectStore>, extra: &[&str]) -> Daemon {
    Daemon::start(&args(root, extra), store, None).unwrap()
}

fn daemon_with_group(root: &Path, store: Arc<StallOne>) -> Daemon {
    daemon(root, store, &["--group", "users"])
}

const MEMBER: Caller = Caller {
    uid: 1000,
    gid: USERS,
    admin: false,
};

fn detach(path: &Path) {
    let path = std::ffi::CString::new(path.as_os_str().as_encoded_bytes()).unwrap();
    // SAFETY: `path` is a valid C string that outlives the call.
    unsafe { libc::umount2(path.as_ptr(), libc::MNT_DETACH) };
}

fn is_mounted(path: &Path) -> bool {
    let mounts = std::fs::read_to_string("/proc/self/mountinfo").unwrap();
    let path = path.to_str().unwrap();
    mounts
        .lines()
        .any(|line| line.split(' ').nth(4) == Some(path))
}

const USERS: u32 = 100;

fn run_as(uid: u32, folder: &Path, script: &str) -> std::process::Output {
    use std::os::unix::process::CommandExt;
    std::process::Command::new("sh")
        .arg("-c")
        .arg(script)
        .current_dir(folder)
        .uid(uid)
        .gid(USERS)
        .output()
        .unwrap()
}

fn run_as_member(folder: &Path, script: &str) -> std::process::Output {
    run_as(MEMBER.uid, folder, script)
}

fn member_dirs() -> (tempfile::TempDir, std::path::PathBuf) {
    use std::os::unix::fs::PermissionsExt;
    let dirs = tempfile::tempdir().unwrap();
    std::fs::set_permissions(dirs.path(), std::fs::Permissions::from_mode(0o755)).unwrap();
    let folder = dirs.path().join("mnt");
    std::fs::create_dir(&folder).unwrap();
    std::os::unix::fs::chown(&folder, Some(MEMBER.uid), Some(MEMBER.gid)).unwrap();
    (dirs, folder)
}

fn mount_request(path: &Path, vm: bool) -> Request {
    Request::Mount {
        branch: "main".into(),
        path: path.into(),
        vm,
        read_only: false,
        owner: None,
        allow_other: true,
    }
}
