//! Doing work as another user, in a short helper process.

mod helper;
#[cfg(test)]
mod tests;
mod wire;

use helper::{act, close_others, helper_command, no_file, split_fd_path};
pub(crate) use helper::{harden, serve_if_helper};
use wire::{recv, send, socket_pair, wait_readable};

use std::ffi::CStr;
use std::fs::File;
use std::io;
use std::os::fd::{AsRawFd, OwnedFd};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::net::UnixListener;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::root::effective_uid;

const HELPER: &str = "SKYWAKE_AS_USER";

const TIMEOUT: Duration = Duration::from_secs(60);

const MAX_REQUEST: usize = 256 * 1024;

#[derive(Clone)]
pub(crate) struct User {
    pub(crate) uid: u32,
    pub(crate) gid: u32,
    groups: Vec<libc::gid_t>,
}

impl User {
    pub(crate) fn new(uid: u32, gid: u32) -> Self {
        Self {
            uid,
            gid,
            groups: groups_of(uid, gid),
        }
    }

    pub(crate) fn groups(&self) -> &[u32] {
        &self.groups
    }

    pub(crate) fn open(&self, path: &Path, flags: libc::c_int) -> io::Result<File> {
        let (_, file) = self.call(Op::Open(flags), path)?;
        file.map(File::from).ok_or_else(no_file)
    }

    pub(crate) fn sync(&self, mountpoint: &Path) -> io::Result<()> {
        self.call(Op::Sync, mountpoint).map(drop)
    }

    pub(crate) fn bind(&self, path: &Path) -> io::Result<UnixListener> {
        let (_, file) = self.call(Op::Bind, path)?;
        file.map(UnixListener::from).ok_or_else(no_file)
    }

    pub(crate) fn is_dead_mount(&self, path: &Path) -> io::Result<bool> {
        self.call(Op::IsDeadMount, path).map(|(dead, _)| dead)
    }

    fn call(&self, op: Op, path: &Path) -> io::Result<(bool, Option<OwnedFd>)> {
        if effective_uid() != 0 || (self.uid, self.gid) == (0, 0) {
            return act(op, path);
        }
        let (dir, path) = match split_fd_path(path) {
            Some((dir, rest)) => (Some(dir), rest),
            None => (None, path),
        };
        let request = Request {
            uid: self.uid,
            gid: self.gid,
            groups: self.groups.clone(),
            op,
            path: path.as_os_str().as_bytes().to_vec(),
        };
        let request = postcard::to_stdvec(&request).map_err(io::Error::other)?;
        let (ours, theirs) = socket_pair()?;
        let mut child = {
            let mut command = helper_command();
            command
                .env_clear()
                .env(HELPER, "1")
                .stdin(Stdio::from(theirs))
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            // SAFETY: close_range is a plain system call, safe after fork.
            unsafe { command.pre_exec(close_others) };
            command.spawn()?
        };
        let answer = send(&ours, &request, dir).and_then(|()| {
            wait_readable(&ours, TIMEOUT)?;
            recv(&ours, 64)
        });
        let _ = child.kill();
        std::thread::spawn(move || child.wait());
        let (reply, file) = answer?;
        let reply: Result<bool, i32> = postcard::from_bytes(&reply).map_err(io::Error::other)?;
        Ok((reply.map_err(io::Error::from_raw_os_error)?, file))
    }
}

#[derive(Clone, Copy, Serialize, Deserialize)]
enum Op {
    Open(libc::c_int),
    Sync,
    Bind,
    IsDeadMount,
}

#[derive(Serialize, Deserialize)]
struct Request {
    uid: u32,
    gid: u32,
    groups: Vec<u32>,
    op: Op,
    path: Vec<u8>,
}

pub(crate) fn open(user: Option<&User>, path: &Path, flags: libc::c_int) -> io::Result<File> {
    match user {
        Some(user) => user.open(path, flags),
        None => act(Op::Open(flags), path).map(|(_, file)| File::from(file.expect("opened"))),
    }
}

pub(crate) fn real_path(user: Option<&User>, path: &Path) -> io::Result<PathBuf> {
    path_of(&open(user, path, libc::O_PATH)?)
}

pub(crate) fn path_of(file: &File) -> io::Result<PathBuf> {
    std::fs::read_link(format!("/proc/self/fd/{}", file.as_raw_fd()))
}

fn groups_of(uid: u32, gid: u32) -> Vec<libc::gid_t> {
    let mut buffer = vec![0 as libc::c_char; 16 * 1024];
    let mut entry = std::mem::MaybeUninit::<libc::passwd>::uninit();
    let mut found = std::ptr::null_mut();
    // SAFETY: every pointer is valid for the sizes given, during the call.
    unsafe {
        libc::getpwuid_r(
            uid,
            entry.as_mut_ptr(),
            buffer.as_mut_ptr(),
            buffer.len(),
            &mut found,
        )
    };
    if found.is_null() {
        return vec![gid];
    }
    // SAFETY: found, so `entry` is filled in and its name points into
    // `buffer`, which is still alive.
    let name = unsafe { CStr::from_ptr(entry.assume_init().pw_name) };
    let mut count: libc::c_int = 64;
    for _ in 0..4 {
        let mut groups = vec![0; count as usize];
        // SAFETY: `groups` holds `count` entries; the call writes at most
        // that many and sets `count` to how many there are.
        let listed =
            unsafe { libc::getgrouplist(name.as_ptr(), gid, groups.as_mut_ptr(), &mut count) };
        if listed >= 0 {
            groups.truncate(count as usize);
            return groups;
        }
    }
    vec![gid]
}
