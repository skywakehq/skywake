//! Changes that were never saved, kept in `unsaved/` after a crash, a failed save or a move.

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};

use anyhow::Result;
use skywake_daemon::manifest::Manifest;
use tracing::warn;

use crate::mounted::{Mounted, OWNER, SAVED_AT, detach_mounts_below, give};
use crate::root::effective_uid;

pub(crate) fn keep_unsaved(root: &Path) -> Result<()> {
    for dir in std::fs::read_dir(root.join("mounts"))? {
        let dir = dir?.path();
        if let Err(error) = keep_dead(root, &dir) {
            warn!(dir = %dir.display(), "can't keep the changes left by a stopped skywaked: {error:#}");
        }
    }
    for dir in std::fs::read_dir(root.join("local"))? {
        remove_local(&dir?.path());
    }
    Ok(())
}

pub(crate) fn remove_local(dir: &Path) {
    detach_mounts_below(dir);
    match std::fs::remove_dir_all(dir) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
            warn!(dir = %dir.display(), "can't delete a build folder: {error:#}");
        }
        _ => {}
    }
}

pub(crate) async fn keep(root: &Path, mounted: &Mounted, reason: &str) -> Result<Option<PathBuf>> {
    if !mounted.has_unsaved() {
        std::fs::remove_dir_all(&mounted.dir)?;
        return Ok(None);
    }
    mounted.write_manifest(reason).await?;
    let kept = move_to_unsaved(root, &mounted.dir, Some(mounted.owner))?;
    warn!(
        branch = mounted.branch,
        kept = %kept.display(),
        "unsaved changes kept; restore them with `skywake recover {} <new-branch>`",
        kept.display()
    );
    Ok(Some(kept))
}

fn keep_dead(root: &Path, dir: &Path) -> Result<()> {
    let owner = std::fs::read_to_string(dir.join(OWNER))
        .ok()
        .and_then(|owner| owner.trim().parse::<u32>().ok());
    if let Ok((manifest, _)) = Manifest::read(dir) {
        let kept = move_to_unsaved(root, dir, owner)?;
        warn!(
            branch = manifest.branch,
            files = manifest.changed_files().count(),
            kept = %kept.display(),
            "unsaved changes from before a restart; restore them with `skywake recover {} <new-branch>`",
            kept.display()
        );
        return Ok(());
    }
    let saved = std::fs::read_to_string(dir.join(SAVED_AT))
        .ok()
        .and_then(|nanos| nanos.trim().parse::<u64>().ok())
        .map_or(UNIX_EPOCH, |nanos| UNIX_EPOCH + Duration::from_nanos(nanos));
    let (files, bytes) = std::fs::read_dir(dir.join("files"))
        .map(|listing| {
            listing
                .flatten()
                .filter_map(|file| file.metadata().ok())
                .filter(|metadata| metadata.modified().is_ok_and(|changed| changed > saved))
                .fold((0, 0), |(files, bytes), metadata| {
                    (files + 1, bytes + metadata.len())
                })
        })
        .unwrap_or((0, 0));
    if files == 0 {
        std::fs::remove_dir_all(dir)?;
        return Ok(());
    }
    let kept = move_to_unsaved(root, dir, owner)?;
    warn!(
        files,
        bytes,
        kept = %kept.display(),
        "skywaked stopped without saving its last changes; files changed after the last save are in {}/files, named by inode",
        kept.display()
    );
    Ok(())
}

fn move_to_unsaved(root: &Path, dir: &Path, owner: Option<u32>) -> Result<PathBuf> {
    let kept = root
        .join("unsaved")
        .join(dir.file_name().unwrap_or_default());
    std::fs::rename(dir, &kept)?;
    std::fs::set_permissions(&kept, std::fs::Permissions::from_mode(0o700))?;
    if let Some(owner) = owner.filter(|owner| *owner != effective_uid()) {
        give(&kept, owner, None)?;
    }
    Ok(kept)
}
