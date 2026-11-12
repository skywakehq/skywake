//! Saves, crashes and shutdown.

use super::*;

#[tokio::test(flavor = "multi_thread")]
async fn a_stuck_save_does_not_delay_other_mounts() {
    let dirs = tempfile::tempdir().unwrap();
    let store = dirs.path().join("store");
    std::fs::create_dir(&store).unwrap();
    let stall = Arc::new(StallOne {
        inner: open_store(store.to_str().unwrap()).unwrap(),
        key: Key::from("refs/slow"),
        stalled: AtomicBool::new(false),
        failing: AtomicBool::new(false),
        unsettle: AtomicBool::new(false),
        fail_next_read: AtomicBool::new(false),
        hanging: Notify::new(),
        released: Notify::new(),
    });
    let repo = Repo::new(stall.clone());
    repo.create_branch("slow", None).await.unwrap();
    repo.create_branch("fast", None).await.unwrap();

    let root = dirs.path().join("root");
    let daemon = daemon(&root, stall.clone(), &["--save-every-ms", "100"]);
    let (slow, fast) = (dirs.path().join("slow"), dirs.path().join("fast"));
    std::fs::create_dir(&slow).unwrap();
    std::fs::create_dir(&fast).unwrap();
    mount(&daemon, "slow", &slow).await;
    mount(&daemon, "fast", &fast).await;

    stall.stalled.store(true, Ordering::SeqCst);
    let hanging = stall.hanging.notified();
    std::fs::write(slow.join("file"), "slow").unwrap();
    hanging.await;

    std::fs::write(fast.join("file"), "fast").unwrap();
    let started = Instant::now();
    while repo
        .read("fast", None, "file", 0, 100)
        .await
        .ok()
        .as_deref()
        != Some(b"fast")
    {
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "the fast mount waited for the slow one"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }

    tokio::time::sleep(Duration::from_millis(300)).await;
    let Response::Status(status) = daemon.handle(ADMIN, Request::Status).await else {
        panic!("no status");
    };
    let lag = |path: &Path| {
        let path = path.canonicalize().unwrap();
        status
            .mounts
            .iter()
            .find(|m| m.path == path)
            .unwrap()
            .save_lag_ms
    };
    assert!(lag(&slow) >= 300, "slow lag {}", lag(&slow));
    assert!(lag(&fast) < 300, "fast lag {}", lag(&fast));

    stall.stalled.store(false, Ordering::SeqCst);
    stall.released.notify_waiters();
    daemon.shutdown().await;
    assert_eq!(
        repo.read("slow", None, "file", 0, 100).await.unwrap(),
        b"slow"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn failed_saves_keep_the_manifest_current() {
    use skywake_daemon::manifest::Manifest;

    let dirs = tempfile::tempdir().unwrap();
    let stall = stalling_main().await;
    let root = dirs.path().join("root");
    let daemon = daemon(&root, stall.clone(), &["--save-every-ms", "3600000"]);
    let folder = dirs.path().join("mnt");
    std::fs::create_dir(&folder).unwrap();
    mount(&daemon, "main", &folder).await;
    let local = std::fs::read_dir(root.join("mounts"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let listed = |name: &str| {
        Manifest::read(&local)
            .is_ok_and(|(manifest, _)| manifest.paths.iter().any(|item| item.path == name))
    };

    stall.failing.store(true, Ordering::SeqCst);
    let first = folder.join("first");
    let blocking = first.clone();
    let synced = tokio::task::spawn_blocking(move || {
        let mut file = std::fs::File::create(blocking).unwrap();
        std::io::Write::write_all(&mut file, b"one").unwrap();
        file.sync_all()
    })
    .await
    .unwrap();
    assert!(synced.is_err(), "fsync succeeded with the bucket down");
    assert!(listed("first"), "a failed fsync wrote no manifest");

    std::fs::write(folder.join("second"), "two").unwrap();
    let request = Request::Sync {
        path: folder.clone(),
    };
    assert!(matches!(
        daemon.handle(ADMIN, request).await,
        Response::Error(_)
    ));
    assert!(listed("second"), "the manifest misses a newer file");

    stall.failing.store(false, Ordering::SeqCst);
    daemon.shutdown().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn shutdown_finishes_while_a_process_uses_a_mount() {
    let dirs = tempfile::tempdir().unwrap();
    let stall = stalling_main().await;
    let repo = Repo::new(stall.clone());
    repo.create_branch("other", None).await.unwrap();
    let root = dirs.path().join("root");
    let daemon = daemon(&root, stall.clone(), &["--save-every-ms", "3600000"]);
    let (busy, other) = (dirs.path().join("busy"), dirs.path().join("other"));
    std::fs::create_dir(&busy).unwrap();
    std::fs::create_dir(&other).unwrap();
    mount(&daemon, "main", &busy).await;
    mount(&daemon, "other", &other).await;
    std::fs::write(busy.join("a"), "one").unwrap();
    std::fs::write(other.join("b"), "two").unwrap();
    let open = std::fs::File::open(busy.join("a")).unwrap();
    let finished = tokio::time::timeout(Duration::from_secs(20), daemon.shutdown()).await;
    drop(open);
    assert!(
        finished.is_ok(),
        "shutdown hangs while a process uses a mount"
    );
    assert_eq!(repo.read("main", None, "a", 0, 100).await.unwrap(), b"one");
    assert_eq!(repo.read("other", None, "b", 0, 100).await.unwrap(), b"two");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_mount_that_fails_to_start_is_taken_down() {
    let dirs = tempfile::tempdir().unwrap();
    let stall = stalling_main().await;
    let root = dirs.path().join("root");
    let daemon = daemon(&root, stall.clone(), &[]);
    std::fs::remove_dir(root.join("local")).unwrap();
    std::fs::write(root.join("local"), "not a folder").unwrap();
    let folder = dirs.path().join("mnt");
    std::fs::create_dir(&folder).unwrap();
    let response = daemon.handle(ADMIN, mount_request(&folder, false)).await;
    let left = is_mounted(&folder);
    detach(&folder);
    assert!(matches!(response, Response::Error(_)), "{response:?}");
    assert!(!left, "the mount failed but stays mounted");
}

#[tokio::test(flavor = "multi_thread")]
async fn changes_kept_after_a_crash_go_to_their_member() {
    use std::os::unix::fs::MetadataExt;
    let dirs = tempfile::tempdir().unwrap();
    let stall = stalling_main().await;
    let root = dirs.path().join("root");
    drop(daemon_with_group(&root, stall.clone()));
    let dead = root.join("mounts/main-1");
    std::fs::create_dir_all(dead.join("files")).unwrap();
    std::fs::write(dead.join("files/7"), "unsaved").unwrap();
    std::fs::write(dead.join("owner"), MEMBER.uid.to_string()).unwrap();
    drop(daemon_with_group(&root, stall.clone()));
    let kept = std::fs::metadata(root.join("unsaved/main-1")).unwrap();
    assert_eq!(kept.uid(), MEMBER.uid);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_save_that_landed_despite_an_error_keeps_the_branch() {
    let dirs = tempfile::tempdir().unwrap();
    let stall = stalling_main().await;
    let root = dirs.path().join("root");
    let daemon = daemon(
        &root,
        stall.clone(),
        &["--save-every-ms", "3600000", "--head-check-ms", "3600000"],
    );
    let folder = dirs.path().join("mnt");
    std::fs::create_dir(&folder).unwrap();
    mount(&daemon, "main", &folder).await;
    let sync = || Request::Sync {
        path: folder.clone(),
    };
    std::fs::write(folder.join("a"), "one").unwrap();
    stall.unsettle.store(true, Ordering::SeqCst);
    let first = daemon.handle(ADMIN, sync()).await;
    assert!(matches!(first, Response::Error(_)), "{first:?}");
    std::fs::write(folder.join("b"), "two").unwrap();
    let second = daemon.handle(ADMIN, sync()).await;
    daemon.shutdown().await;
    assert!(matches!(second, Response::Done), "{second:?}");
    let repo = Repo::new(stall.clone());
    assert_eq!(repo.read("main", None, "b", 0, 100).await.unwrap(), b"two");
}
