//! skywaked as a process, driven through its socket. Needs Linux, FUSE and root.
#![cfg(target_os = "linux")]

use std::io::Write;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use skywake_core::{Repo, open_store};
use skywake_daemon::manifest::recover;
use skywake_daemon::{Request, Response, call, socket_path};
use tempfile::{TempDir, tempdir};

struct Setup {
    store: TempDir,
    repo: Repo,
    dirs: TempDir,
}

async fn setup() -> Setup {
    let store = tempdir().unwrap();
    let repo = Repo::new(open_store(store.path().to_str().unwrap()).unwrap());
    repo.create_branch("main", None).await.unwrap();
    Setup {
        store,
        repo,
        dirs: tempdir().unwrap(),
    }
}

impl Setup {
    fn folder(&self, name: &str) -> PathBuf {
        let path = self.dirs.path().join(name);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    async fn daemon(&self, name: &str, save_ms: u64) -> Daemon {
        self.daemon_with(name, save_ms, &[]).await
    }

    async fn daemon_with(&self, name: &str, save_ms: u64, env: &[(&str, String)]) -> Daemon {
        let root = self.dirs.path().join(name);
        let mut daemon = self.spawn(&root, save_ms, env);
        let started = Instant::now();
        while !socket_path(&root).exists() {
            if let Some(status) = daemon.try_wait().unwrap() {
                panic!("skywaked exited: {status}");
            }
            assert!(started.elapsed() < Duration::from_secs(20), "no socket");
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        Daemon {
            child: daemon,
            root,
        }
    }

    fn spawn(&self, root: &Path, save_ms: u64, env: &[(&str, String)]) -> Child {
        let program = std::env::var("SKYWAKED").unwrap_or(env!("CARGO_BIN_EXE_skywaked").into());
        Command::new(program)
            .envs(env.iter().map(|(key, value)| (key, value)))
            .env("SKYWAKE_ROOT", root)
            .env("SKYWAKE_STORE", self.store.path())
            .env("SKYWAKE_SAVE_EVERY_MS", save_ms.to_string())
            .env("SKYWAKE_HEAD_CHECK_MS", "300")
            .spawn()
            .unwrap()
    }

    async fn read(&self, branch: &str, path: &str) -> Option<Vec<u8>> {
        self.repo.read(branch, None, path, 0, u64::MAX).await.ok()
    }

    async fn wait_for(&self, branch: &str, path: &str, content: &[u8], limit: Duration) -> bool {
        let started = Instant::now();
        while started.elapsed() < limit {
            if self.read(branch, path).await.as_deref() == Some(content) {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        false
    }
}

struct Daemon {
    child: Child,
    root: PathBuf,
}

impl Daemon {
    async fn call(&self, request: Request) -> Response {
        call(&self.root, &request).await.unwrap()
    }

    async fn mount(&self, branch: &str, path: &Path) {
        let request = Request::Mount {
            branch: branch.into(),
            path: path.into(),
            vm: false,
            read_only: false,
            owner: None,
            allow_other: false,
        };
        match self.call(request).await {
            Response::Done => {}
            other => panic!("mount failed: {other:?}"),
        }
    }

    async fn unmount(&self, path: &Path) -> Response {
        self.call(Request::Unmount { path: path.into() }).await
    }

    async fn moved(&self, path: &Path) -> bool {
        match self.call(Request::List).await {
            Response::Mounts(mounts) => mounts.iter().any(|m| m.path == path && m.moved),
            other => panic!("list failed: {other:?}"),
        }
    }
}

impl Drop for Daemon {
    fn drop(&mut self) {
        // SAFETY: kill only sends a signal to our own child.
        unsafe { libc::kill(self.child.id() as i32, libc::SIGTERM) };
        let _ = self.child.wait();
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn unmount_keeps_every_write_acknowledged_before_it() {
    let s = setup().await;
    let daemon = s.daemon("daemon", 2000).await;
    let mount = s.folder("mount");
    daemon.mount("main", &mount).await;

    let device = std::fs::metadata(&mount).unwrap().dev();
    let stop = Arc::new(AtomicBool::new(false));
    let writer = {
        let (mount, stop) = (mount.clone(), stop.clone());
        std::thread::spawn(move || {
            let mut written = Vec::new();
            for i in 0.. {
                if stop.load(Ordering::Relaxed) {
                    break;
                }
                let path = mount.join(format!("f{i}"));
                let Ok(mut file) = std::fs::File::create(&path) else {
                    break;
                };
                if file.metadata().unwrap().dev() != device {
                    let _ = std::fs::remove_file(&path);
                    break;
                }
                if file.write_all(format!("file {i}").as_bytes()).is_err() {
                    break;
                }
                drop(file);
                written.push(i);
                std::thread::sleep(Duration::from_millis(1));
            }
            written
        })
    };
    tokio::time::sleep(Duration::from_millis(300)).await;
    let started = Instant::now();
    loop {
        match daemon.unmount(&mount).await {
            Response::Done => break,
            Response::Error(error) if error.contains("busy") => {}
            other => panic!("unmount failed: {other:?}"),
        }
        assert!(started.elapsed() < Duration::from_secs(20));
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    stop.store(true, Ordering::Relaxed);
    let written = writer.join().unwrap();
    assert!(written.len() > 10, "only {} writes", written.len());
    let saved = s.folder("saved");
    s.repo.checkout("main", &saved).await.unwrap();
    for i in written {
        let path = format!("f{i}");
        let content = format!("file {i}");
        assert_eq!(
            std::fs::read(saved.join(&path)).ok().as_deref(),
            Some(content.as_bytes()),
            "{path} was acknowledged but lost"
        );
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_busy_mount_stays_mounted_and_keeps_saving() {
    let s = setup().await;
    let daemon = s.daemon("daemon", 200).await;
    let mount = s.folder("mount");
    daemon.mount("main", &mount).await;

    let held = std::fs::File::create(mount.join("held")).unwrap();
    match daemon.unmount(&mount).await {
        Response::Error(error) => assert!(error.contains("busy"), "{error}"),
        other => panic!("unmounted while busy: {other:?}"),
    }
    std::fs::write(mount.join("after"), "written after the failed unmount").unwrap();
    assert!(
        s.wait_for(
            "main",
            "after",
            b"written after the failed unmount",
            Duration::from_secs(5)
        )
        .await,
        "the busy mount stopped saving"
    );
    drop(held);
    assert!(matches!(daemon.unmount(&mount).await, Response::Done));
}

#[tokio::test(flavor = "multi_thread")]
async fn an_idle_mount_turns_read_only_when_its_branch_moves_and_keeps_its_changes() {
    let s = setup().await;
    let here = s.daemon("here", 600_000).await;
    let there = s.daemon("there", 200).await;
    let (mount, other) = (s.folder("mount"), s.folder("other"));
    here.mount("main", &mount).await;
    std::fs::write(mount.join("saved"), "saved").unwrap();
    assert!(matches!(
        here.call(Request::Sync {
            path: mount.clone()
        })
        .await,
        Response::Done
    ));
    std::fs::write(mount.join("unsaved"), "not saved yet").unwrap();

    there.mount("main", &other).await;
    let started = Instant::now();
    while !here.moved(&mount).await {
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "the move went unnoticed"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let refused = std::fs::write(mount.join("late"), "late").unwrap_err();
    assert_eq!(refused.raw_os_error(), Some(libc::EROFS));

    match here.unmount(&mount).await {
        Response::Error(error) => assert!(error.contains("skywake recover"), "{error}"),
        other => panic!("unmount lost the changes silently: {other:?}"),
    }
    let kept: Vec<PathBuf> = std::fs::read_dir(here.root.join("unsaved"))
        .unwrap()
        .map(|item| item.unwrap().path())
        .collect();
    assert_eq!(kept.len(), 1);
    recover(&s.repo, &kept[0], "rescued", "rescue")
        .await
        .unwrap();
    assert_eq!(
        s.read("rescued", "unsaved").await.unwrap(),
        b"not saved yet"
    );
    assert_eq!(s.read("rescued", "saved").await.unwrap(), b"saved");
    assert!(matches!(there.unmount(&other).await, Response::Done));
}

#[tokio::test(flavor = "multi_thread")]
async fn two_mounts_of_one_path_at_once_cannot_both_succeed() {
    let s = setup().await;
    s.repo.create_branch("second", None).await.unwrap();
    let daemon = s.daemon("daemon", 2000).await;
    let mount = s.folder("mount");
    let request = |branch: &str| Request::Mount {
        branch: branch.into(),
        path: mount.clone(),
        vm: false,
        read_only: false,
        owner: None,
        allow_other: false,
    };
    let (first, second) =
        tokio::join!(daemon.call(request("main")), daemon.call(request("second")));
    let done = [&first, &second]
        .iter()
        .filter(|response| matches!(response, Response::Done))
        .count();
    assert_eq!(done, 1, "{first:?} {second:?}");
    assert!(matches!(daemon.unmount(&mount).await, Response::Done));
    assert!(matches!(daemon.unmount(&mount).await, Response::NotMounted));
}

#[tokio::test(flavor = "multi_thread")]
async fn other_users_are_refused() {
    let s = setup().await;
    let daemon = s.daemon("daemon", 2000).await;
    let socket = socket_path(&daemon.root);
    let mode = |path: &Path| std::fs::metadata(path).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode(&daemon.root), 0o700);
    assert_eq!(mode(&socket), 0o600);

    let open = |path: &Path, mode| {
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode)).unwrap()
    };
    open(s.dirs.path(), 0o755);
    open(&daemon.root, 0o755);
    open(&socket, 0o666);
    let script = "import socket,sys\n\
        s=socket.socket(socket.AF_UNIX)\n\
        s.connect(sys.argv[1])\n\
        s.sendall(b'{\"op\":\"list\"}\\n')\n\
        print(s.makefile().readline())";
    let output = Command::new("python3")
        .args(["-c", script])
        .arg(&socket)
        .uid(65534)
        .gid(65534)
        .output()
        .unwrap();
    let reply = String::from_utf8_lossy(&output.stdout);
    assert!(reply.contains("permission denied"), "{reply} {output:?}");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_root_folder_owned_by_another_user_is_refused() {
    let s = setup().await;
    let root = s.folder("planted");
    std::os::unix::fs::chown(&root, Some(65534), Some(65534)).unwrap();
    let status = s.spawn(&root, 2000, &[]).wait().unwrap();
    assert!(!status.success());
    assert!(!socket_path(&root).exists());
}

async fn log_node(dir: &Path, zone: &str) -> String {
    let objects = skywake_core::Objects::new(Arc::new(object_store::memory::InMemory::new()));
    let cache = skywake_core::cache::ChunkCache::new(dir.join("chunks"), u64::MAX).unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let node = skywake_cache::Node::new(Arc::new(cache), objects, None)
        .with_log(dir.join("log"), zone.into())
        .unwrap();
    tokio::spawn(skywake_cache::serve(listener, node));
    url
}

#[tokio::test(flavor = "multi_thread")]
async fn a_write_synced_to_the_log_survives_a_crash_before_any_save() {
    let s = setup().await;
    let mut nodes = Vec::new();
    for zone in ["a", "b", "c"] {
        nodes.push(log_node(&s.folder(&format!("node-{zone}")), zone).await);
    }
    let env = [("SKYWAKE_CACHE_NODES", nodes.join(","))];
    let mut crashed = s.daemon_with("crashed", 600_000, &env).await;
    let mount = s.folder("mount");
    crashed.mount("main", &mount).await;
    let mut file = std::fs::File::create(mount.join("synced.txt")).unwrap();
    file.write_all(b"on the cache tier").unwrap();
    let started = Instant::now();
    file.sync_all().unwrap();
    assert!(started.elapsed() < Duration::from_millis(500));
    drop(file);
    std::fs::create_dir(mount.join("dir")).unwrap();
    std::fs::rename(mount.join("synced.txt"), mount.join("dir/moved.txt")).unwrap();
    std::fs::File::open(mount.join("dir"))
        .unwrap()
        .sync_all()
        .unwrap();

    crashed.child.kill().unwrap();
    crashed.child.wait().unwrap();
    let _ = Command::new("umount").arg("-l").arg(&mount).status();
    assert_eq!(s.read("main", "dir/moved.txt").await, None);

    let again = s.daemon_with("again", 600_000, &env).await;
    let other = s.folder("other");
    again.mount("main", &other).await;
    assert_eq!(
        std::fs::read(other.join("dir/moved.txt")).unwrap(),
        b"on the cache tier"
    );
    assert_eq!(
        s.read("main", "dir/moved.txt").await.unwrap(),
        b"on the cache tier"
    );
    assert!(matches!(again.unmount(&other).await, Response::Done));
}
