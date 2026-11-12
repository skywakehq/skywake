//! Branch requests: create, merge, delete and recover.

use std::os::unix::fs::MetadataExt;
use std::path::Path;

use anyhow::{Result, bail};
use skywake_core::Merged;
use skywake_daemon::access::Access;
use skywake_daemon::manifest::{Manifest, recover_from};
use skywake_daemon::{Response, delete_branch, kept};
use tracing::info;

use super::{Caller, Daemon};
use crate::user::{self, User};

impl Daemon {
    pub(super) async fn create(
        &self,
        caller: Caller,
        branch: &str,
        from: Option<&str>,
    ) -> Result<Response> {
        self.allow(caller, branch, Access::Write).await?;
        if let Some(from) = from {
            self.allow(caller, from, Access::Read).await?;
        }
        let commit = self.repo.create_branch(branch, from).await?;
        info!(uid = caller.uid, branch, from, "created");
        Ok(Response::Committed(commit.to_string()))
    }

    pub(super) async fn merge(
        &self,
        caller: Caller,
        from: &str,
        into: &str,
        message: &str,
    ) -> Result<Response> {
        self.allow(caller, from, Access::Read).await?;
        self.allow(caller, into, Access::Write).await?;
        match self.repo.merge(into, from, message, None).await? {
            Merged::Done(commit) => {
                info!(uid = caller.uid, from, into, "merged");
                Ok(Response::Committed(commit.to_string()))
            }
            Merged::Conflicts(paths) => Ok(Response::Conflicts(paths)),
        }
    }

    pub(super) async fn delete(&self, caller: Caller, branch: &str) -> Result<Response> {
        self.allow(caller, branch, Access::Write).await?;
        delete_branch(&self.repo, branch).await?;
        info!(uid = caller.uid, branch, "deleted");
        Ok(Response::Done)
    }

    pub(super) async fn recover(
        &self,
        caller: Caller,
        folder: &Path,
        branch: &str,
        message: &str,
    ) -> Result<Response> {
        self.allow(caller, branch, Access::Write).await?;
        let (folder, unsaved) = (folder.to_path_buf(), self.root.join("unsaved"));
        let (user, folder, manifest, base) = tokio::task::spawn_blocking(move || {
            let user = User::new(caller.uid, caller.gid);
            let real = user::real_path(Some(&user), &folder).ok().filter(|real| {
                real.parent() == Some(unsaved.as_path())
                    && std::fs::symlink_metadata(real).is_ok_and(|found| found.uid() == caller.uid)
            });
            let Some(real) = real else {
                bail!(
                    "{} is not a folder of your kept changes in {}",
                    folder.display(),
                    unsaved.display()
                );
            };
            let (manifest, base) =
                Manifest::read_with(&real, |path| user.open(path, libc::O_RDONLY))?;
            anyhow::Ok((user, real, manifest, base))
        })
        .await??;
        self.allow(caller, &manifest.branch, Access::Read).await?;
        let open =
            |file: &str| kept::open_copy_with(&folder, file, |path, flags| user.open(path, flags));
        let (commit, missing) =
            recover_from(&self.repo, &folder, &manifest, &base, branch, message, open).await?;
        info!(uid = caller.uid, branch, "recovered");
        Ok(Response::Recovered {
            commit: commit.to_string(),
            missing,
        })
    }
}
