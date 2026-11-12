//! The helper process: takes on a user's ids and does one thing.

use std::io;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::net::UnixListener;
use std::path::{Path, PathBuf};
use std::process::Command;

use super::wire::{recv, send};
use super::{HELPER, MAX_REQUEST, Op, Request};
use crate::root::effective_uid;

pub(crate) fn serve_if_helper() {
    if std::env::var_os(HELPER).is_none() {
        return;
    }
    // SAFETY: the daemon gave us the socket as standard input.
    let socket = unsafe { OwnedFd::from_raw_fd(0) };
    let done = recv(&socket, MAX_REQUEST).and_then(|(request, dir)| {
        let request: Request = postcard::from_bytes(&request).map_err(io::Error::other)?;
        become_user(request.uid, request.gid, &request.groups)?;
        let path = Path::new(std::ffi::OsStr::from_bytes(&request.path));
        match &dir {
            Some(dir) => act(request.op, &fd_path(dir.as_raw_fd()).join(path)),
            None => act(request.op, path),
        }
    });
    let (reply, file) = match done {
        Ok((yes, file)) => (Ok(yes), file),
        Err(error) => (Err(error.raw_os_error().unwrap_or(libc::EIO)), None),
    };
    let reply: Result<bool, i32> = reply;
    if let Ok(reply) = postcard::to_stdvec(&reply) {
        let _ = send(&socket, &reply, file.as_ref().map(AsRawFd::as_raw_fd));
    }
    std::process::exit(0);
}

pub(crate) fn harden() {
    if effective_uid() != 0 {
        return;
    }
    // SAFETY: a plain system call that uses no memory.
    unsafe { libc::prctl(libc::PR_SET_DUMPABLE, 0) };
    let dumpable = std::fs::read_to_string("/proc/sys/fs/suid_dumpable").unwrap_or_default();
    if dumpable.trim() == "1" {
        tracing::warn!(
            "fs.suid_dumpable is 1, so users may trace processes that took on their ids; set it to 0"
        );
    }
}

pub(super) fn act(op: Op, path: &Path) -> io::Result<(bool, Option<OwnedFd>)> {
    match op {
        Op::Open(flags) => Ok((false, Some(open_path(path, flags)?))),
        Op::Sync => {
            crate::mounted::sync_kernel_writes(path).map_err(to_io)?;
            Ok((false, None))
        }
        Op::Bind => {
            let _ = std::fs::remove_file(path);
            Ok((false, Some(UnixListener::bind(path)?.into())))
        }
        Op::IsDeadMount => {
            let dead = crate::mounted::is_dead_mount(path).map_err(to_io)?;
            Ok((dead, None))
        }
    }
}

fn open_path(path: &Path, flags: libc::c_int) -> io::Result<OwnedFd> {
    let path = std::ffi::CString::new(path.as_os_str().as_bytes())?;
    // SAFETY: `path` is a valid C string that outlives the call.
    let fd = unsafe { libc::open(path.as_ptr(), flags | libc::O_CLOEXEC) };
    if fd < 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: `fd` is a new descriptor that nothing else owns.
    Ok(unsafe { OwnedFd::from_raw_fd(fd) })
}

fn fd_path(fd: RawFd) -> PathBuf {
    PathBuf::from(format!("/proc/self/fd/{fd}"))
}

pub(super) fn split_fd_path(path: &Path) -> Option<(RawFd, &Path)> {
    let mut parts = path.strip_prefix("/proc/self/fd").ok()?.components();
    let fd = parts.next()?.as_os_str().to_str()?.parse().ok()?;
    Some((fd, parts.as_path()))
}

fn to_io(error: anyhow::Error) -> io::Error {
    error
        .downcast::<io::Error>()
        .unwrap_or_else(|error| io::Error::other(format!("{error:#}")))
}

pub(super) fn no_file() -> io::Error {
    io::Error::other("the helper sent no file")
}

#[cfg(not(test))]
pub(super) fn helper_command() -> Command {
    Command::new("/proc/self/exe")
}

#[cfg(test)]
pub(super) fn helper_command() -> Command {
    let mut command = Command::new("/proc/self/exe");
    command.args(["--exact", "user::tests::helper", "--quiet"]);
    command
}

pub(super) fn close_others() -> io::Result<()> {
    const CLOSE_RANGE_CLOEXEC: libc::c_uint = 1 << 2;
    // SAFETY: a plain system call.
    match unsafe {
        libc::syscall(
            libc::SYS_close_range,
            3,
            libc::c_uint::MAX,
            CLOSE_RANGE_CLOEXEC,
        )
    } {
        0 => Ok(()),
        _ => Err(io::Error::last_os_error()),
    }
}

fn become_user(uid: u32, gid: u32, groups: &[u32]) -> io::Result<()> {
    // SAFETY: plain system calls; `groups` outlives the first one.
    let failed = unsafe {
        libc::setgroups(groups.len(), groups.as_ptr()) != 0
            || libc::setresgid(gid, gid, gid) != 0
            || libc::setresuid(uid, uid, uid) != 0
            || libc::prctl(libc::PR_SET_DUMPABLE, 0) != 0
    };
    match failed {
        true => Err(io::Error::last_os_error()),
        false => Ok(()),
    }
}
