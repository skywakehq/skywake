//! Linking a mount's ignored folders to local disk.

use std::fs::DirBuilder;
use std::os::unix::fs::DirBuilderExt;
use std::path::{Component, Path};

use anyhow::{Context, Result};
use skywake_core::CACHES;
use skywake_mount::{BranchFs, Ino, Kind, ROOT};
use tracing::{info, warn};

use super::give;

pub(super) async fn link_ignored(
    fs: &BranchFs,
    rules: &[String],
    local: &Path,
    owner: Option<(u32, u32)>,
) -> Result<()> {
    DirBuilder::new().mode(0o700).create(local)?;
    for rule in rules {
        if CACHES.contains(&rule.as_str()) {
            continue;
        }
        let path = Path::new(rule.trim_start_matches('/'));
        if !path
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
        {
            warn!(rule, "ignore rule outside the mount; not linked");
            continue;
        }
        let parts: Vec<&str> = rule.trim_start_matches('/').split('/').collect();
        let Some((name, folders)) = parts.split_last() else {
            continue;
        };
        let Some(parent) = find_folder(fs, folders).await? else {
            continue;
        };
        match fs.lookup(parent, name).await {
            Ok(found) => {
                fs.forget(found.ino, 1);
                info!(
                    rule,
                    "ignored, but part of the branch, so it stays on the mount"
                );
                continue;
            }
            Err(error) if error.raw_os_error() == Some(libc::ENOENT) => {}
            Err(error) => return Err(error.into()),
        }
        let target = local.join(path);
        std::fs::create_dir_all(&target)?;
        let target = target
            .to_str()
            .context("the daemon's folder is not UTF-8")?;
        let link = fs.symlink(parent, name, target, owner).await?;
        fs.forget(link.ino, 1);
    }
    if let Some((uid, gid)) = owner {
        give(local, uid, Some(gid))?;
    }
    Ok(())
}

async fn find_folder(fs: &BranchFs, path: &[&str]) -> Result<Option<Ino>> {
    let mut folder = ROOT;
    for name in path {
        let found = match fs.lookup(folder, name).await {
            Ok(found) => found,
            Err(error) if error.raw_os_error() == Some(libc::ENOENT) => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        fs.forget(found.ino, 1);
        if found.kind != Kind::Dir {
            return Ok(None);
        }
        folder = found.ino;
    }
    Ok(Some(folder))
}
