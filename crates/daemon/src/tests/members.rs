//! What members of the daemon's group may do.

use super::*;

#[tokio::test]
async fn members_may_only_own_the_files_themselves() {
    let dirs = tempfile::tempdir().unwrap();
    let store = dirs.path().join("store");
    std::fs::create_dir(&store).unwrap();
    let store = open_store(store.to_str().unwrap()).unwrap();
    Repo::new(store.clone())
        .create_branch("main", None)
        .await
        .unwrap();
    let root = dirs.path().join("root");
    let daemon = daemon(&root, store, &["--group", "users"]);
    let folder = dirs.path().join("mnt");
    std::fs::create_dir(&folder).unwrap();
    std::os::unix::fs::chown(&folder, Some(1000), Some(1000)).unwrap();

    let member = Caller {
        uid: 1000,
        gid: 1000,
        admin: false,
    };
    let request = Request::Mount {
        branch: "main".into(),
        path: folder,
        vm: false,
        read_only: false,
        owner: Some((0, 0)),
        allow_other: false,
    };
    match daemon.handle(member, request).await {
        Response::Error(error) => assert!(error.contains("only own"), "{error}"),
        other => panic!("mounted with root's files: {other:?}"),
    }
}

async fn swap_while_mounting(
    daemon: &Daemon,
    stall: &StallOne,
    request: Request,
    folder: &Path,
    victim: &Path,
) -> Response {
    stall.stalled.store(true, Ordering::SeqCst);
    let hanging = stall.hanging.notified();
    let swap = async {
        hanging.await;
        std::fs::rename(folder, folder.with_extension("old")).unwrap();
        std::os::unix::fs::symlink(victim, folder).unwrap();
        stall.stalled.store(false, Ordering::SeqCst);
        stall.released.notify_waiters();
    };
    let (response, ()) = tokio::join!(daemon.handle(MEMBER, request), swap);
    response
}

#[tokio::test(flavor = "multi_thread")]
async fn a_member_cant_swap_the_folder_for_a_symlink() {
    let dirs = tempfile::tempdir().unwrap();
    let stall = stalling_main().await;
    let daemon = daemon_with_group(&dirs.path().join("root"), stall.clone());
    let (folder, victim) = (dirs.path().join("mnt"), dirs.path().join("victim"));
    std::fs::create_dir(&folder).unwrap();
    std::os::unix::fs::chown(&folder, Some(1000), Some(1000)).unwrap();
    std::fs::create_dir(&victim).unwrap();
    std::fs::write(victim.join("kept"), "root's").unwrap();

    let request = Request::Mount {
        branch: "main".into(),
        path: folder.clone(),
        vm: false,
        read_only: false,
        owner: None,
        allow_other: false,
    };
    swap_while_mounting(&daemon, &stall, request, &folder, &victim).await;
    let covered = !victim.join("kept").exists();
    detach(&victim);
    detach(&folder.with_extension("old"));
    assert!(!covered, "mounted over root's folder");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_member_cant_swap_the_folder_of_a_vm_socket() {
    let dirs = tempfile::tempdir().unwrap();
    let stall = stalling_main().await;
    let daemon = daemon_with_group(&dirs.path().join("root"), stall.clone());
    let (folder, victim) = (dirs.path().join("vm"), dirs.path().join("victim"));
    std::fs::create_dir(&folder).unwrap();
    std::os::unix::fs::chown(&folder, Some(1000), Some(1000)).unwrap();
    std::fs::create_dir(&victim).unwrap();
    std::fs::write(victim.join("passwd"), "root's").unwrap();

    let request = Request::Mount {
        branch: "main".into(),
        path: folder.join("passwd"),
        vm: true,
        read_only: false,
        owner: None,
        allow_other: false,
    };
    swap_while_mounting(&daemon, &stall, request, &folder, &victim).await;
    daemon.shutdown().await;
    assert_eq!(std::fs::read(victim.join("passwd")).unwrap(), b"root's");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_member_can_read_its_kept_changes() {
    let (dirs, folder) = member_dirs();
    let stall = stalling_main().await;
    let root = dirs.path().join("root");
    let daemon = daemon_with_group(&root, stall.clone());
    let response = daemon.handle(MEMBER, mount_request(&folder, false)).await;
    assert!(matches!(response, Response::Done), "{response:?}");
    assert!(run_as_member(&folder, "echo hi > a").status.success());
    stall.failing.store(true, Ordering::SeqCst);
    let request = Request::Unmount {
        path: folder.clone(),
    };
    let response = daemon.handle(MEMBER, request).await;
    assert!(matches!(response, Response::Error(_)), "{response:?}");
    let kept = std::fs::read_dir(root.join("unsaved"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let read = run_as_member(
        &folder,
        &format!(
            "cat {0}/manifest.json >/dev/null && ls {0}/files",
            kept.display()
        ),
    );
    assert!(
        read.status.success(),
        "the member can't read its kept changes: {read:?}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_members_vm_socket_belongs_to_the_member() {
    use std::os::unix::fs::MetadataExt;
    let (_dirs, folder) = member_dirs();
    let stall = stalling_main().await;
    let daemon = daemon_with_group(&_dirs.path().join("root"), stall.clone());
    let socket = folder.join("vm.sock");
    let response = daemon.handle(MEMBER, mount_request(&socket, true)).await;
    assert!(matches!(response, Response::Done), "{response:?}");
    let owner = std::fs::symlink_metadata(&socket).unwrap().uid();
    daemon.shutdown().await;
    assert_eq!(
        owner, MEMBER.uid,
        "the member can't connect to its VM socket"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn sec_a_member_can_use_a_private_mount() {
    let (dirs, folder) = member_dirs();
    let stall = stalling_main().await;
    let daemon = daemon_with_group(&dirs.path().join("root"), stall.clone());
    let request = Request::Mount {
        branch: "main".into(),
        path: folder.clone(),
        vm: false,
        read_only: false,
        owner: None,
        allow_other: false,
    };
    let response = daemon.handle(MEMBER, request).await;
    assert!(matches!(response, Response::Done), "{response:?}");
    let own = run_as_member(&folder, "ls . && echo hi > a");
    let other = run_as(MEMBER.uid + 1, dirs.path(), "ls mnt");
    daemon.shutdown().await;
    assert!(
        own.status.success(),
        "the member can't use its own private mount: {own:?}"
    );
    assert!(!other.status.success(), "another user can list the mount");
    assert_eq!(
        Repo::new(stall.clone())
            .read("main", None, "a", 0, 100)
            .await
            .unwrap(),
        b"hi\n"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_mount_inside_the_daemons_folder_is_refused() {
    let dirs = tempfile::tempdir().unwrap();
    let stall = stalling_main().await;
    let root = dirs.path().join("root");
    let daemon = daemon(&root, stall.clone(), &[]);
    let inside = root.join("local/x");
    std::fs::create_dir(&inside).unwrap();
    let response = daemon.handle(ADMIN, mount_request(&inside, false)).await;
    detach(&inside);
    match response {
        Response::Error(error) => assert!(error.contains("inside"), "{error}"),
        other => panic!("mounted inside the daemon's folder: {other:?}"),
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_member_learns_nothing_of_paths_it_cant_reach() {
    use std::os::unix::fs::PermissionsExt;
    let (dirs, _folder) = member_dirs();
    let stall = stalling_main().await;
    let daemon = daemon_with_group(&dirs.path().join("root"), stall.clone());
    let hidden = dirs.path().join("hidden");
    std::fs::create_dir_all(hidden.join("there")).unwrap();
    std::fs::set_permissions(&hidden, std::fs::Permissions::from_mode(0o700)).unwrap();
    let mut errors = Vec::new();
    for name in ["there", "missing"] {
        let request = mount_request(&hidden.join(name), false);
        match daemon.handle(MEMBER, request).await {
            Response::Error(error) => errors.push(error.replace(name, "")),
            other => panic!("{other:?}"),
        }
    }
    assert_eq!(errors[0], errors[1]);
}

#[tokio::test]
async fn members_have_a_limit_of_open_requests() {
    let dirs = tempfile::tempdir().unwrap();
    let stall = stalling_main().await;
    let daemon = daemon_with_group(&dirs.path().join("root"), stall.clone());
    let open: Vec<_> = std::iter::from_fn(|| daemon.begin_request(MEMBER))
        .take(100)
        .collect();
    assert!(open.len() < 100, "no limit");
    assert!(daemon.begin_request(ADMIN).is_some(), "admins are limited");
    drop(open);
    assert!(daemon.begin_request(MEMBER).is_some());
}

const OTHER: Caller = Caller {
    uid: MEMBER.uid + 1,
    gid: USERS,
    admin: false,
};

fn write_access(root: &Path, text: &str) {
    let next = root.join("access.next");
    std::fs::write(&next, text).unwrap();
    std::fs::rename(&next, root.join("access")).unwrap();
}

fn denied(response: &Response) -> bool {
    matches!(response, Response::Error(error) if error.contains("permission denied"))
}

fn create(branch: &str, from: Option<&str>) -> Request {
    Request::Create {
        branch: branch.into(),
        from: from.map(Into::into),
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn the_access_file_decides_what_each_member_may_do() {
    let (dirs, folder) = member_dirs();
    let stall = stalling_main().await;
    Repo::new(stall.clone())
        .create_branch("hidden", None)
        .await
        .unwrap();
    let root = dirs.path().join("root");
    std::fs::create_dir(&root).unwrap();
    write_access(
        &root,
        "user:1000 write agents/*  # the member\ngroup:100 read main\n",
    );
    let daemon = daemon_with_group(&root, stall.clone());
    let as_member = async |request| daemon.handle(MEMBER, request).await;

    let mount = |read_only| Request::Mount {
        branch: "main".into(),
        path: folder.clone(),
        vm: false,
        read_only,
        owner: None,
        allow_other: false,
    };
    assert!(denied(&as_member(mount(false)).await));
    let response = as_member(mount(true)).await;
    assert!(matches!(response, Response::Done), "{response:?}");
    let request = Request::Unmount {
        path: folder.clone(),
    };
    assert!(matches!(as_member(request).await, Response::Done));

    let response = as_member(create("agents/a", Some("main"))).await;
    assert!(matches!(response, Response::Committed(_)), "{response:?}");
    assert!(denied(&as_member(create("agents/b", Some("hidden"))).await));
    assert!(denied(&as_member(create("other", None)).await));
    let merge = |from: &str, into: &str| Request::Merge {
        from: from.into(),
        into: into.into(),
        message: "merge".into(),
    };
    assert!(denied(&as_member(merge("agents/a", "main")).await));
    let response = as_member(merge("main", "agents/a")).await;
    assert!(matches!(response, Response::Committed(_)), "{response:?}");
    let delete = |branch: &str| Request::Delete {
        branch: branch.into(),
    };
    assert!(denied(&as_member(delete("main")).await));
    assert!(matches!(
        as_member(delete("agents/a")).await,
        Response::Done
    ));

    let response = daemon.handle(OTHER, create("agents/c", Some("main"))).await;
    assert!(denied(&response), "{response:?}");
    assert!(matches!(
        daemon.handle(ADMIN, delete("hidden")).await,
        Response::Done
    ));

    write_access(&root, "user:1000 write *\n");
    let response = as_member(create("other", None)).await;
    assert!(matches!(response, Response::Committed(_)), "{response:?}");
}

#[tokio::test]
async fn an_access_file_others_can_change_is_refused() {
    use std::os::unix::fs::PermissionsExt;
    let dirs = tempfile::tempdir().unwrap();
    let stall = stalling_main().await;
    let root = dirs.path().join("root");
    std::fs::create_dir(&root).unwrap();
    write_access(&root, "group:100 read *\n");
    let access = root.join("access");
    let start = || {
        let args = args(&root, &["--group", "users"]);
        Daemon::start(&args, stall.clone(), None).map(drop)
    };
    std::fs::set_permissions(&access, std::fs::Permissions::from_mode(0o664)).unwrap();
    let error = format!("{:#}", start().unwrap_err());
    assert!(error.contains("chmod go-w"), "{error}");
    std::fs::set_permissions(&access, std::fs::Permissions::from_mode(0o644)).unwrap();
    std::os::unix::fs::chown(&access, Some(MEMBER.uid), None).unwrap();
    let error = format!("{:#}", start().unwrap_err());
    assert!(error.contains("only root"), "{error}");
    std::os::unix::fs::chown(&access, Some(0), None).unwrap();
    start().unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn a_member_cant_use_another_members_mount() {
    let (dirs, folder) = member_dirs();
    let stall = stalling_main().await;
    let daemon = daemon_with_group(&dirs.path().join("root"), stall.clone());
    let response = daemon.handle(MEMBER, mount_request(&folder, false)).await;
    assert!(matches!(response, Response::Done), "{response:?}");
    let path = folder.clone();
    for request in [
        Request::Unmount { path: path.clone() },
        Request::Sync { path: path.clone() },
        Request::Commit {
            branch: "main".into(),
            path: path.clone(),
            message: "theirs".into(),
        },
    ] {
        match daemon.handle(OTHER, request).await {
            Response::Error(error) => assert!(error.contains("not your mount"), "{error}"),
            other => panic!("another member used the mount: {other:?}"),
        }
    }
    match daemon.handle(OTHER, Request::List).await {
        Response::Mounts(mounts) => assert!(mounts.is_empty(), "{mounts:?}"),
        other => panic!("{other:?}"),
    }
    assert!(matches!(
        daemon.handle(MEMBER, Request::Unmount { path }).await,
        Response::Done
    ));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_member_recovers_only_its_own_kept_changes() {
    let (dirs, folder) = member_dirs();
    let stall = stalling_main().await;
    let root = dirs.path().join("root");
    let daemon = daemon_with_group(&root, stall.clone());
    let response = daemon.handle(MEMBER, mount_request(&folder, false)).await;
    assert!(matches!(response, Response::Done), "{response:?}");
    assert!(run_as_member(&folder, "echo hi > a").status.success());
    stall.failing.store(true, Ordering::SeqCst);
    let request = Request::Unmount {
        path: folder.clone(),
    };
    let response = daemon.handle(MEMBER, request).await;
    assert!(matches!(response, Response::Error(_)), "{response:?}");
    stall.failing.store(false, Ordering::SeqCst);
    let kept = std::fs::read_dir(root.join("unsaved"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let recover = |folder: &Path| Request::Recover {
        folder: folder.into(),
        branch: "rescued".into(),
        message: "rescue".into(),
    };
    for (caller, folder) in [(OTHER, kept.as_path()), (MEMBER, folder.as_path())] {
        match daemon.handle(caller, recover(folder)).await {
            Response::Error(error) => assert!(error.contains("not a folder of your"), "{error}"),
            other => panic!("recovered {}: {other:?}", folder.display()),
        }
    }
    let response = daemon.handle(MEMBER, recover(&kept)).await;
    assert!(
        matches!(&response, Response::Recovered { missing, .. } if missing.is_empty()),
        "{response:?}"
    );
    let repo = Repo::new(stall.clone());
    assert_eq!(
        repo.read("rescued", None, "a", 0, 100).await.unwrap(),
        b"hi\n"
    );
}
