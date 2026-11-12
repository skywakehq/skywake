//! The daemon's folder and socket, and who may use them.

use std::ffi::CString;
use std::fs::DirBuilder;
use std::io;
use std::os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt};
use std::path::Path;

use anyhow::{Context, Result, bail};

const PRIVATE: [&str; 3] = ["mounts", "chunks", "objects"];
const SHARED: [&str; 2] = ["unsaved", "local"];

pub(crate) fn prepare(root: &Path, group: Option<u32>) -> Result<()> {
    if let Some(parent) = root.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mode = if group.is_some() { 0o710 } else { 0o700 };
    private_dir(root, mode, group)?;
    for name in PRIVATE {
        private_dir(&root.join(name), 0o700, None)?;
    }
    for name in SHARED {
        private_dir(&root.join(name), 0o711, None)?;
    }
    Ok(())
}

pub(crate) fn protect_socket(socket: &Path, group: Option<u32>) -> Result<()> {
    if let Some(group) = group {
        chown(socket, group)?;
    }
    let mode = if group.is_some() { 0o660 } else { 0o600 };
    std::fs::set_permissions(socket, std::fs::Permissions::from_mode(mode))?;
    Ok(())
}

pub(crate) fn group_id(name: &str) -> Result<u32> {
    let name = CString::new(name)?;
    // SAFETY: `name` is a valid C string. The result points to static
    // memory, which we read right away, before any other call can reuse it.
    let group = unsafe { libc::getgrnam(name.as_ptr()) };
    if group.is_null() {
        bail!("no group named {}", name.to_string_lossy());
    }
    // SAFETY: not null, so it points to a valid group.
    Ok(unsafe { (*group).gr_gid })
}

pub(crate) fn effective_uid() -> u32 {
    // SAFETY: geteuid can't fail and uses no memory.
    unsafe { libc::geteuid() }
}

fn private_dir(path: &Path, mode: u32, group: Option<u32>) -> Result<()> {
    match DirBuilder::new().mode(mode).create(path) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error).with_context(|| format!("{}", path.display())),
    }
    let found = std::fs::symlink_metadata(path)?;
    if !found.is_dir() {
        bail!("{} is not a folder", path.display());
    }
    if found.uid() != effective_uid() {
        bail!(
            "{} belongs to user {}, not to the user running skywaked ({}); remove it or use another SKYWAKE_ROOT",
            path.display(),
            found.uid(),
            effective_uid()
        );
    }
    if let Some(group) = group {
        chown(path, group)?;
    }
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))?;
    Ok(())
}

fn chown(path: &Path, group: u32) -> Result<()> {
    std::os::unix::fs::lchown(path, None, Some(group))
        .with_context(|| format!("can't give {} to group {group}", path.display()))
}
