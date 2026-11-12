//! Tests of the helper process.

use super::*;
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::Command;

#[test]
fn helper() {
    serve_if_helper();
}

const MEMBER: u32 = 65534;

#[test]
fn member_cannot_signal_or_limit_root_daemon() {
    if effective_uid() != 0 {
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    std::fs::set_permissions(
        dir.path(),
        std::os::unix::fs::PermissionsExt::from_mode(0o755),
    )
    .unwrap();
    let fifo = dir.path().join("fifo");
    let name = std::ffi::CString::new(fifo.as_os_str().as_encoded_bytes()).unwrap();
    // SAFETY: `name` is a valid C string.
    assert_eq!(unsafe { libc::mkfifo(name.as_ptr(), 0o666) }, 0);
    std::fs::set_permissions(&fifo, std::os::unix::fs::PermissionsExt::from_mode(0o666)).unwrap();
    let member = User::new(MEMBER, MEMBER);
    std::thread::scope(|scope| {
        let opened = scope.spawn(|| member.open(&fifo, libc::O_RDONLY));
        let task = wait_for_member_task();
        let as_member = |script: String| {
            Command::new("sh")
                .args(["-c", &script])
                .uid(MEMBER)
                .gid(MEMBER)
                .status()
                .unwrap()
                .success()
        };
        let before = rlimit_nofile();
        as_member(format!("prlimit --pid {task} --nofile=17:"));
        let after = rlimit_nofile();
        let signalled = as_member(format!("kill -0 {}", std::process::id()));
        let in_daemon = Path::new(&format!("/proc/self/task/{task}")).exists();
        std::fs::OpenOptions::new().write(true).open(&fifo).unwrap();
        opened.join().unwrap().unwrap();
        assert!(
            !in_daemon && !signalled && before == after,
            "member's task is in the daemon ({in_daemon}), could signal it ({signalled}), \
             RLIMIT_NOFILE soft {before} -> {after}"
        );
    });
}

fn wait_for_member_task() -> u32 {
    let started = std::time::Instant::now();
    while started.elapsed() < std::time::Duration::from_secs(10) {
        let threads = std::fs::read_dir("/proc/self/task").unwrap();
        let processes = std::fs::read_dir("/proc").unwrap();
        for entry in threads.chain(processes).flatten() {
            let Ok(task) = entry.file_name().to_string_lossy().parse::<u32>() else {
                continue;
            };
            let status = std::fs::read_to_string(entry.path().join("status")).unwrap_or_default();
            let field = |name: &str| {
                status
                    .lines()
                    .find_map(|line| line.strip_prefix(name))
                    .and_then(|rest| rest.split_whitespace().next()?.parse::<u32>().ok())
            };
            let ours = field("Tgid:") == Some(std::process::id())
                || field("PPid:") == Some(std::process::id());
            if ours && field("Uid:") == Some(MEMBER) {
                return task;
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    panic!("no task ran as the member");
}

fn rlimit_nofile() -> u64 {
    let mut limit = libc::rlimit {
        rlim_cur: 0,
        rlim_max: 0,
    };
    // SAFETY: `limit` is valid for the call.
    unsafe { libc::getrlimit(libc::RLIMIT_NOFILE, &mut limit) };
    limit.rlim_cur
}
