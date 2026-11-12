//! Reading a folder of kept changes for `skywake recover`, trusting none of its file names.

use std::ffi::CString;
use std::fs::File;
use std::io;
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};

use anyhow::{Result, bail};

pub fn check_owner(folder: &Path) -> Result<()> {
    let owner = std::fs::symlink_metadata(folder)?.uid();
    // SAFETY: geteuid can't fail and uses no memory.
    let user = unsafe { libc::geteuid() };
    if owner != user {
        bail!(
            "{} belongs to user {owner}; run `skywake recover` as that user",
            folder.display()
        );
    }
    Ok(())
}

pub fn open_copy(folder: &Path, file: &str) -> io::Result<File> {
    let number = copy_number(file)?;
    let files = open_at(None, &folder.join("files"), libc::O_DIRECTORY)?;
    plain(open_at(Some(&files), Path::new(number), 0)?, file)
}

pub fn open_copy_with(
    folder: &Path,
    file: &str,
    open: impl Fn(&Path, libc::c_int) -> io::Result<File>,
) -> io::Result<File> {
    let number = copy_number(file)?;
    let flags = libc::O_RDONLY | libc::O_NOFOLLOW;
    let files = open(&folder.join("files"), flags | libc::O_DIRECTORY)?;
    plain(open(&fd_path(&files).join(number), flags)?, file)
}

fn copy_number(file: &str) -> io::Result<&str> {
    file.strip_prefix("files/")
        .filter(|number| !number.is_empty() && number.bytes().all(|b| b.is_ascii_digit()))
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!("{file:?} is not a copy in files/"),
            )
        })
}

fn plain(copy: File, file: &str) -> io::Result<File> {
    if !copy.metadata()?.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("{file} is not a plain file"),
        ));
    }
    Ok(copy)
}

pub fn fd_path(file: &File) -> PathBuf {
    let fds = if cfg!(target_os = "linux") {
        "/proc/self/fd"
    } else {
        "/dev/fd"
    };
    Path::new(fds).join(file.as_raw_fd().to_string())
}

fn open_at(dir: Option<&File>, path: &Path, flags: libc::c_int) -> io::Result<File> {
    let path = CString::new(path.as_os_str().as_bytes())?;
    let dir = dir.map_or(libc::AT_FDCWD, AsRawFd::as_raw_fd);
    let flags = flags | libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC;
    // SAFETY: `path` is a valid C string that outlives the call.
    let fd = unsafe { libc::openat(dir, path.as_ptr(), flags) };
    if fd < 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: `fd` is a new descriptor that nothing else owns.
    Ok(unsafe { File::from_raw_fd(fd) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_plain_copies_in_files_open() {
        let folder = tempfile::tempdir().unwrap();
        let outside = folder.path().join("secret");
        std::fs::write(&outside, "secret").unwrap();
        std::fs::create_dir(folder.path().join("files")).unwrap();
        std::fs::write(folder.path().join("files/1"), "kept").unwrap();
        std::os::unix::fs::symlink(&outside, folder.path().join("files/2")).unwrap();

        let read = |file: &str| {
            open_copy(folder.path(), file)
                .and_then(|copy| std::fs::read(fd_path(&copy)))
                .map_err(|error| error.kind())
        };
        assert_eq!(read("files/1"), Ok(b"kept".to_vec()));
        assert!(read("files/2").is_err(), "followed a symlink");
        assert_eq!(read("files/3"), Err(io::ErrorKind::NotFound));
        for name in [
            outside.to_str().unwrap(),
            "secret",
            "files/../secret",
            "files/",
        ] {
            assert_eq!(read(name), Err(io::ErrorKind::InvalidData), "{name}");
        }
        check_owner(folder.path()).unwrap();
    }
}
