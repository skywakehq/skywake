//! Where a mount is on the host, and unmounting and detaching it there.

use std::ffi::{CString, OsStr, OsString};
use std::fs::File;
use std::io;
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::ffi::{OsStrExt, OsStringExt};
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use tracing::debug;

use crate::user::User;

pub(super) fn unmount(at: &Path, path: &Path, lazy: bool) -> io::Result<()> {
    let c_path = CString::new(at.as_os_str().as_bytes())?;
    let flags = libc::UMOUNT_NOFOLLOW | if lazy { libc::MNT_DETACH } else { 0 };
    // SAFETY: `c_path` is a valid C string that outlives the call.
    if unsafe { libc::umount2(c_path.as_ptr(), flags) } == 0 {
        return Ok(());
    }
    let error = io::Error::last_os_error();
    if error.raw_os_error() != Some(libc::EPERM) {
        return Err(error);
    }
    let fusermount = |program: &str| {
        let mut command = Command::new(program);
        command.arg("-u");
        if lazy {
            command.arg("-z");
        }
        command.arg("--").arg(path).output()
    };
    let output = fusermount("fusermount3").or_else(|_| fusermount("fusermount"))?;
    if output.status.success() {
        return Ok(());
    }
    let message = String::from_utf8_lossy(&output.stderr);
    match message.contains("busy") {
        true => Err(io::Error::from_raw_os_error(libc::EBUSY)),
        false => Err(io::Error::other(message.trim().to_string())),
    }
}

pub(crate) fn sync_kernel_writes(mountpoint: &Path) -> Result<()> {
    let dir = open_dir_at(None, mountpoint.as_os_str())?;
    skywake_mount::sync_kernel(&dir)?;
    Ok(())
}

pub(crate) fn give(path: &Path, uid: u32, gid: Option<u32>) -> io::Result<()> {
    if std::fs::symlink_metadata(path)?.is_dir() {
        for entry in std::fs::read_dir(path)? {
            give(&entry?.path(), uid, gid)?;
        }
    }
    std::os::unix::fs::lchown(path, Some(uid), gid)
}

fn open_dir_at(dir: Option<&File>, name: &OsStr) -> io::Result<File> {
    let name = CString::new(name.as_bytes())?;
    let flags = libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC;
    let dir = dir.map_or(libc::AT_FDCWD, AsRawFd::as_raw_fd);
    // SAFETY: `name` is a valid C string that outlives the call.
    let fd = unsafe { libc::openat(dir, name.as_ptr(), flags) };
    if fd < 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: `fd` is a new descriptor that nothing else owns.
    Ok(unsafe { File::from_raw_fd(fd) })
}

pub(crate) struct Place {
    pub(crate) path: PathBuf,
    parent: File,
    name: OsString,
    pub(super) turn: Arc<Mutex<()>>,
}

impl Place {
    pub(crate) fn open(path: &Path, user: Option<&User>) -> Result<Self> {
        let name = path
            .file_name()
            .with_context(|| format!("{} has no name", path.display()))?;
        let folder = match path.parent() {
            Some(folder) if !folder.as_os_str().is_empty() => folder,
            _ => Path::new("."),
        };
        let flags = libc::O_RDONLY | libc::O_DIRECTORY;
        let parent = crate::user::open(user, folder, flags)
            .with_context(|| format!("{}", folder.display()))?;
        let folder = crate::user::path_of(&parent)?;
        Ok(Self {
            path: folder.join(name),
            parent,
            name: name.to_os_string(),
            turn: Arc::default(),
        })
    }

    pub(crate) fn at(&self) -> PathBuf {
        Path::new(&format!("/proc/self/fd/{}", self.parent.as_raw_fd())).join(&self.name)
    }

    pub(crate) fn folder_owner(&self) -> Result<u32> {
        Ok(self.parent.metadata()?.uid())
    }

    pub(crate) fn open_dir(&self, user: Option<&User>) -> Result<File> {
        let flags = libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW;
        crate::user::open(user, &self.at(), flags)
            .with_context(|| format!("{}", self.path.display()))
    }

    pub(crate) fn detach(&self) -> Result<()> {
        let at = CString::new(self.at().as_os_str().as_bytes())?;
        // SAFETY: `at` is a valid C string that outlives the call.
        if unsafe { libc::umount2(at.as_ptr(), libc::MNT_DETACH | libc::UMOUNT_NOFOLLOW) } != 0 {
            return Err(io::Error::last_os_error().into());
        }
        Ok(())
    }
}

pub(crate) fn is_dead_mount(path: &Path) -> Result<bool> {
    let probe = CString::new(path.as_os_str().as_bytes())?;
    let mut stats = std::mem::MaybeUninit::<libc::statfs>::uninit();
    // SAFETY: `probe` is a valid C string and `stats` is big enough. Both
    // live longer than the call.
    let found = unsafe { libc::statfs(probe.as_ptr(), stats.as_mut_ptr()) } == 0;
    Ok(!found && io::Error::last_os_error().raw_os_error() == Some(libc::ENOTCONN))
}

pub(crate) fn detach_mounts_below(dir: &Path) {
    let Ok(mounts) = std::fs::read_to_string("/proc/self/mountinfo") else {
        return;
    };
    let mut below: Vec<PathBuf> = mounts
        .lines()
        .filter_map(|line| line.split(' ').nth(4))
        .map(unescape)
        .filter(|path| path.starts_with(dir) && path != dir)
        .collect();
    below.sort_by_key(|path| path.components().count());
    for path in below {
        let Ok(relative) = path.strip_prefix(dir) else {
            continue;
        };
        let parts: Vec<&OsStr> = relative.iter().collect();
        let Some((name, folders)) = parts.split_last() else {
            continue;
        };
        let walked = open_dir_at(None, dir.as_os_str()).and_then(|top| {
            folders
                .iter()
                .try_fold(top, |parent, part| open_dir_at(Some(&parent), part))
        });
        let detached = walked.map_err(anyhow::Error::from).and_then(|parent| {
            Place {
                path: path.clone(),
                parent,
                name: name.to_os_string(),
                turn: Arc::default(),
            }
            .detach()
        });
        if let Err(error) = detached {
            debug!(path = %path.display(), "can't detach: {error:#}");
        }
    }
}

fn unescape(path: &str) -> PathBuf {
    let bytes = path.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let octal = bytes
            .get(i + 1..i + 4)
            .filter(|digits| digits.iter().all(|d| (b'0'..=b'7').contains(d)));
        match (bytes[i], octal) {
            (b'\\', Some(digits)) => {
                out.push(
                    digits
                        .iter()
                        .fold(0u8, |n, d| n.wrapping_mul(8) + (d - b'0')),
                );
                i += 4;
            }
            (byte, _) => {
                out.push(byte);
                i += 1;
            }
        }
    }
    PathBuf::from(OsString::from_vec(out))
}
