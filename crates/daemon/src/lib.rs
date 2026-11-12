//! The library of skywaked: its protocol, its folders, and what `skywake recover` reads.

pub mod access;
pub mod kept;
pub mod manifest;
mod protocol;

use std::path::{Path, PathBuf};

pub use protocol::{
    MAX_REQUEST, MAX_RESPONSE, MountInfo, Request, Response, Status, call, read_line,
};

pub const SYSTEM_ROOT: &str = "/var/lib/skywake";

pub fn default_root() -> PathBuf {
    // SAFETY: geteuid can't fail and uses no memory.
    if unsafe { libc::geteuid() } == 0 {
        return PathBuf::from(SYSTEM_ROOT);
    }
    let state = std::env::var_os("XDG_STATE_HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .or_else(|| std::env::var_os("HOME").map(|home| Path::new(&home).join(".local/state")));
    match state {
        Some(state) => state.join("skywake"),
        None => PathBuf::from(SYSTEM_ROOT),
    }
}

pub fn client_root() -> PathBuf {
    let own = default_root();
    if !socket_path(&own).exists() && socket_path(Path::new(SYSTEM_ROOT)).exists() {
        return PathBuf::from(SYSTEM_ROOT);
    }
    own
}

pub async fn delete_branch(repo: &skywake_core::Repo, branch: &str) -> anyhow::Result<()> {
    match repo.delete_branch(branch).await {
        Err(skywake_core::Error::Conflict(_)) => anyhow::bail!(
            "{branch} changed while deleting it, so it was not deleted; a mount may be saving to it. Unmount it first, or try again"
        ),
        deleted => Ok(deleted?),
    }
}

pub fn socket_path(root: &Path) -> PathBuf {
    root.join("skywaked.sock")
}
