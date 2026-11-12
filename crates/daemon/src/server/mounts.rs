//! Mount requests: mount, unmount, sync, commit and list.

use std::collections::HashMap;
use std::fs::File;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result, bail};
use skywake_daemon::access::Access;
use skywake_daemon::{MountInfo, Response};
use skywake_mount::MountOptions;
use tracing::info;

use super::{Caller, Daemon, Slot, lock};
use crate::mounted::{Mounted, Place, Setup, is_dead_mount};
use crate::unsaved::{keep, remove_local};
use crate::user::{self, User};

impl Daemon {
    pub(super) async fn mount(
        &self,
        caller: Caller,
        branch: &str,
        path: &Path,
        vm: bool,
        read_only: bool,
        mut options: MountOptions,
    ) -> Result<()> {
        let need = if read_only {
            Access::Read
        } else {
            Access::Write
        };
        self.allow(caller, branch, need).await?;
        if !caller.admin {
            let caller_owns = (caller.uid, caller.gid);
            if options.owner.is_some_and(|owner| owner != caller_owns) {
                bail!(
                    "you can only own the files yourself: --owner {}:{}",
                    caller.uid,
                    caller.gid
                );
            }
            options.owner = Some(caller_owns);
        }
        // SAFETY: getuid and getgid can't fail and use no memory.
        let daemon_user = unsafe { (libc::getuid(), libc::getgid()) };
        let owner = options.owner.filter(|owner| *owner != daemon_user);
        let (path, root) = (path.to_path_buf(), self.root.clone());
        let (place, dir, owner_user) = tokio::task::spawn_blocking(move || {
            let as_caller = (!caller.admin).then(|| User::new(caller.uid, caller.gid));
            let (place, dir) = find_place(&path, vm, as_caller.as_ref(), &root)?;
            anyhow::Ok((place, dir, owner.map(|(uid, gid)| User::new(uid, gid))))
        })
        .await??;
        let path = place.path.clone();
        {
            let mut mounts = self.mounts();
            if mounts.contains_key(&path) {
                bail!("{} is already mounted", path.display());
            }
            mounts.insert(path.clone(), Slot::Starting);
        }
        let started = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
        let name = format!("{}-{started}", branch.replace('/', "~"));
        let (dir_path, local) = (
            self.root.join("mounts").join(&name),
            self.root.join("local").join(&name),
        );
        let setup = Setup {
            repo: &self.repo,
            refs: &self.refs,
            cache: self.cache.clone(),
            dir: dir_path.clone(),
            local: local.clone(),
            read_only,
            owner: caller.uid,
            options,
            owner_user,
            save_every: self.save_every,
            head_check_every: self.head_check_every,
            local_limit: self.mount_local_limit,
            log: self.log.clone(),
        };
        let mounted = Mounted::start(branch, place, dir, setup).await;
        let mut mounts = self.mounts();
        match mounted {
            Ok(mounted) => {
                info!(branch, path = %path.display(), "mounted");
                mounts.insert(path, Slot::Ready(mounted));
                Ok(())
            }
            Err(error) => {
                mounts.remove(&path);
                drop(mounts);
                let _ = std::fs::remove_dir_all(dir_path);
                remove_local(&local);
                Err(error)
            }
        }
    }

    pub(super) async fn unmount(&self, caller: Caller, path: &Path) -> Result<Response> {
        let Some(mounted) = self.mounted(caller, path).await? else {
            return Ok(Response::NotMounted);
        };
        if !mounted.begin_unmount() {
            bail!("{} is already being unmounted", mounted.path.display());
        }
        mounted.stop_writes(false).await?;
        self.finish(&mounted).await?;
        Ok(Response::Done)
    }

    pub(super) async fn finish(&self, mounted: &Mounted) -> Result<()> {
        let saved = mounted.finish(&self.repo).await;
        self.mounts().remove(&mounted.path);
        mounted.clear_metrics();
        remove_local(&mounted.local);
        let error = match saved {
            Ok(()) => {
                std::fs::remove_dir_all(&mounted.dir)?;
                info!(path = %mounted.path.display(), "unmounted");
                return Ok(());
            }
            Err(error) => error,
        };
        match keep(&self.root, mounted, &format!("{error:#}")).await? {
            None => Ok(()),
            Some(kept) => Err(error.context(format!(
                "unmounted, but unsaved changes are kept in {}; restore them with `skywake recover {} <new-branch>`",
                kept.display(),
                kept.display()
            ))),
        }
    }

    pub(super) async fn sync(&self, caller: Caller, path: &Path) -> Result<Response> {
        let Some(mounted) = self.mounted(caller, path).await? else {
            return Ok(Response::NotMounted);
        };
        mounted.sync_now(&self.repo).await?;
        Ok(Response::Done)
    }

    pub(super) async fn commit(
        &self,
        caller: Caller,
        branch: &str,
        path: &Path,
        message: &str,
    ) -> Result<Response> {
        let Some(mounted) = self.mounted(caller, path).await? else {
            return Ok(Response::NotMounted);
        };
        if mounted.branch != branch {
            bail!(
                "{} is a mount of {}, not {branch}",
                path.display(),
                mounted.branch
            );
        }
        self.allow(caller, branch, Access::Write).await?;
        let commit = mounted.save_now(&self.repo, Some(message)).await?;
        Ok(Response::Committed(
            commit.map(|hash| hash.to_string()).unwrap_or_default(),
        ))
    }

    pub(super) fn list(&self, caller: Caller) -> Vec<MountInfo> {
        let mut mounts: Vec<MountInfo> = self
            .ready()
            .iter()
            .filter(|mounted| caller.admin || mounted.owner == caller.uid)
            .map(|mounted| mounted.info())
            .collect();
        mounts.sort_by(|a, b| a.path.cmp(&b.path));
        mounts
    }

    pub(super) async fn mounted(
        &self,
        caller: Caller,
        path: &Path,
    ) -> Result<Option<Arc<Mounted>>> {
        let path = path.to_path_buf();
        let Ok(path) = tokio::task::spawn_blocking(move || path.canonicalize()).await? else {
            return Ok(None);
        };
        let mounted = match self.mounts().get(&path) {
            Some(Slot::Ready(mounted)) => mounted.clone(),
            _ => return Ok(None),
        };
        if !caller.admin && mounted.owner != caller.uid {
            bail!("{} is not your mount", path.display());
        }
        Ok(Some(mounted))
    }

    pub(super) fn ready(&self) -> Vec<Arc<Mounted>> {
        self.mounts()
            .values()
            .filter_map(|slot| match slot {
                Slot::Ready(mounted) => Some(mounted.clone()),
                Slot::Starting => None,
            })
            .collect()
    }

    fn mounts(&self) -> MutexGuard<'_, HashMap<PathBuf, Slot>> {
        lock(&self.mounts)
    }
}

pub(super) fn find_place(
    path: &Path,
    vm: bool,
    user: Option<&User>,
    root: &Path,
) -> Result<(Place, Option<File>)> {
    let owner = user.map(|user| user.uid);
    let owns_folder =
        |place: &Place| owner.is_none_or(|owner| place.folder_owner().ok() == Some(owner));
    if vm {
        let place = Place::open(path, user)?;
        if !owns_folder(&place) {
            bail!("you can only serve a VM from a folder you own");
        }
        refuse_inside(&place, root)?;
        return Ok((place, None));
    }
    let dead = match user {
        Some(user) => user.is_dead_mount(path)?,
        None => is_dead_mount(path)?,
    };
    if dead {
        let place = Place::open(path, user)?;
        if !owns_folder(&place) {
            bail!(
                "{} is a broken mount in a folder you don't own",
                path.display()
            );
        }
        place.detach()?;
    }
    let real = user::real_path(user, path).with_context(|| format!("{}", path.display()))?;
    let place = Place::open(&real, user)?;
    let dir = place.open_dir(user)?;
    if owner.is_some_and(|owner| dir.metadata().ok().map(|found| found.uid()) != Some(owner)) {
        bail!("you can only mount over a folder you own");
    }
    refuse_inside(&place, root)?;
    Ok((place, Some(dir)))
}

fn refuse_inside(place: &Place, root: &Path) -> Result<()> {
    if place.path.starts_with(root) {
        bail!("{} is inside skywaked's folder", place.path.display());
    }
    Ok(())
}
