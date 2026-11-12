//! Ignored folders linked to local disk.

use super::*;

#[tokio::test(flavor = "multi_thread")]
async fn ignore_rules_stay_inside_the_mount() {
    let dirs = tempfile::tempdir().unwrap();
    let stall = stalling_main().await;
    let (outside, elsewhere) = (dirs.path().join("outside"), dirs.path().join("elsewhere"));
    std::fs::create_dir(&outside).unwrap();
    std::fs::create_dir(&elsewhere).unwrap();
    let work = dirs.path().join("work");
    std::fs::create_dir(&work).unwrap();
    std::fs::write(work.join(".skywakeignore"), "../outside/x\nevil/x\nbuild\n").unwrap();
    std::os::unix::fs::symlink(&elsewhere, work.join("evil")).unwrap();
    let repo = Repo::new(stall.clone());
    repo.commit("main", &work, "rules").await.unwrap();

    let root = dirs.path().join("root");
    let daemon = daemon(&root, stall.clone(), &[]);
    let folder = dirs.path().join("mnt");
    std::fs::create_dir(&folder).unwrap();
    mount(&daemon, "main", &folder).await;
    let linked = folder.join("build").symlink_metadata().is_ok();
    daemon.shutdown().await;
    assert!(linked, "a plain rule was not linked");
    assert!(
        outside.read_dir().unwrap().next().is_none(),
        "linked through .."
    );
    assert!(
        elsewhere.read_dir().unwrap().next().is_none(),
        "linked through a symlink"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_symlinked_ignore_file_does_not_break_the_mount() {
    let dirs = tempfile::tempdir().unwrap();
    let stall = stalling_main().await;
    let work = dirs.path().join("work");
    std::fs::create_dir(&work).unwrap();
    std::fs::write(work.join(".gitignore"), "build\n").unwrap();
    std::os::unix::fs::symlink(".gitignore", work.join(".skywakeignore")).unwrap();
    Repo::new(stall.clone())
        .commit("main", &work, "rules")
        .await
        .unwrap();

    let root = dirs.path().join("root");
    let daemon = daemon(&root, stall.clone(), &[]);
    let folder = dirs.path().join("mnt");
    std::fs::create_dir(&folder).unwrap();
    let response = daemon.handle(ADMIN, mount_request(&folder, false)).await;
    let left = is_mounted(&folder);
    daemon.shutdown().await;
    let stays = is_mounted(&folder);
    detach(&folder);
    assert!(
        matches!(response, Response::Done),
        "the mount failed: {response:?} (still mounted: {left})"
    );
    assert!(!stays, "the mount stays after shutdown");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_member_can_write_its_build_folder() {
    let (dirs, folder) = member_dirs();
    let stall = stalling_main().await;
    let work = dirs.path().join("work");
    std::fs::create_dir(&work).unwrap();
    std::fs::write(work.join(".skywakeignore"), "build\nout/deep\n").unwrap();
    std::fs::create_dir(work.join("out")).unwrap();
    std::fs::write(work.join("out/kept"), "").unwrap();
    Repo::new(stall.clone())
        .commit("main", &work, "rules")
        .await
        .unwrap();
    let daemon = daemon_with_group(&dirs.path().join("root"), stall.clone());
    let response = daemon.handle(MEMBER, mount_request(&folder, false)).await;
    assert!(matches!(response, Response::Done), "{response:?}");
    let plain = run_as_member(&folder, "echo hi > src.txt");
    let build = run_as_member(
        &folder,
        "mkdir -p build/out && echo x > build/out/a && echo y > out/deep/b",
    );
    daemon.shutdown().await;
    assert!(plain.status.success(), "the member can't write its mount");
    assert!(
        build.status.success(),
        "the member can't write its build folder: {build:?}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn build_folders_are_private_to_their_member() {
    let (dirs, folder) = member_dirs();
    let stall = stalling_main().await;
    let work = dirs.path().join("work");
    std::fs::create_dir(&work).unwrap();
    std::fs::write(work.join(".skywakeignore"), "build\n").unwrap();
    Repo::new(stall.clone())
        .commit("main", &work, "rules")
        .await
        .unwrap();
    let root = dirs.path().join("root");
    let daemon = daemon_with_group(&root, stall.clone());
    let response = daemon.handle(MEMBER, mount_request(&folder, false)).await;
    assert!(matches!(response, Response::Done), "{response:?}");
    let target = std::fs::read_link(folder.join("build")).unwrap();
    let other = |script: String| run_as(MEMBER.uid + 1, dirs.path(), &script).status;
    let listed = other(format!("ls {}", root.join("local").display()));
    let entered = other(format!("ls {}", target.display()));
    daemon.shutdown().await;
    assert!(
        !listed.success(),
        "another member can list the build folders"
    );
    assert!(!entered.success(), "another member can read a build folder");
}

#[tokio::test(flavor = "multi_thread")]
async fn sec_startup_survives_a_mount_in_a_build_folder() {
    let dirs = tempfile::tempdir().unwrap();
    let stall = stalling_main().await;
    let root = dirs.path().join("root");
    let args = args(&root, &[]);
    drop(Daemon::start(&args, stall.clone(), None).unwrap());
    let sub = root.join("local/main-1/build/sub");
    std::fs::create_dir_all(&sub).unwrap();
    let ok = std::process::Command::new("mount")
        .args(["-t", "tmpfs", "tmpfs"])
        .arg(&sub)
        .status()
        .unwrap()
        .success();
    assert!(ok, "can't mount tmpfs");
    let started = Daemon::start(&args, stall.clone(), None).map(drop);
    detach(&sub);
    assert!(started.is_ok(), "skywaked won't start: {started:?}");
}

#[tokio::test(flavor = "multi_thread")]
async fn sec_ignore_rules_are_bounded() {
    let dirs = tempfile::tempdir().unwrap();
    let stall = stalling_main().await;
    let work = dirs.path().join("work");
    std::fs::create_dir(&work).unwrap();
    let rules: String = (0..20000).map(|n| format!("d{n}\n")).collect();
    std::fs::write(work.join(".skywakeignore"), rules).unwrap();
    Repo::new(stall.clone())
        .commit("main", &work, "rules")
        .await
        .unwrap();
    let root = dirs.path().join("root");
    let daemon = daemon(&root, stall.clone(), &[]);
    let folder = dirs.path().join("mnt");
    std::fs::create_dir(&folder).unwrap();
    let began = Instant::now();
    mount(&daemon, "main", &folder).await;
    let took = began.elapsed();
    let local = std::fs::read_dir(root.join("local"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let made = std::fs::read_dir(&local).unwrap().count();
    daemon.shutdown().await;
    assert!(
        made < 1000,
        "{made} folders made from branch rules in {took:?}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn ignore_rules_match_however_they_are_written() {
    let dirs = tempfile::tempdir().unwrap();
    let stall = stalling_main().await;
    let work = dirs.path().join("work");
    std::fs::create_dir_all(work.join("a")).unwrap();
    std::fs::write(work.join("a/kept"), "").unwrap();
    std::fs::write(work.join(".skywakeignore"), "a/./b\n").unwrap();
    let repo = Repo::new(stall.clone());
    repo.commit("main", &work, "rules").await.unwrap();
    let root = dirs.path().join("root");
    let daemon = daemon(&root, stall.clone(), &[]);
    let folder = dirs.path().join("mnt");
    std::fs::create_dir(&folder).unwrap();
    mount(&daemon, "main", &folder).await;
    let linked = folder.join("a/b").symlink_metadata().is_ok();
    std::fs::write(folder.join("new"), "x").unwrap();
    daemon.shutdown().await;
    assert!(linked, "no link for the rule");
    let out = dirs.path().join("out");
    repo.checkout("main", &out).await.unwrap();
    assert!(out.join("new").exists());
    assert!(
        out.join("a/b").symlink_metadata().is_err(),
        "the link was saved"
    );
}
