//! Saving a mount: on a timer, on fsync and on request, and finding out when the branch moved.

use std::io;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result, bail};
use skywake_core::store::held;
use skywake_core::{Error, Hash, Objects, Repo};
use skywake_daemon::manifest::{Item, Manifest, What};
use skywake_mount::Snapshot;
use tokio::sync::{mpsc, oneshot};
use tracing::{debug, info, warn};

use super::{Claimed, Mounted, SAVED_AT, Unsettled, lock, sync_kernel_writes};

const LAG_WARN: Duration = Duration::from_secs(30);

impl Mounted {
    pub(super) fn start_saver(
        self: &Arc<Self>,
        repo: Repo,
        every: Duration,
        head_check_every: Duration,
    ) {
        let mounted = self.clone();
        let mut stop = self.stop.subscribe();
        let task = tokio::spawn(async move {
            let timer = |every| {
                let mut timer = tokio::time::interval(every);
                timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
                timer.reset();
                timer
            };
            let (mut saves, mut checks) = (timer(every), timer(head_check_every));
            loop {
                tokio::select! {
                    _ = saves.tick() => mounted.autosave(&repo).await,
                    _ = checks.tick() => mounted.check_head(&repo).await,
                    _ = stop.changed() => return,
                }
            }
        });
        *lock(&self.saver) = Some(task);
    }

    pub(super) async fn stop_saver(&self) {
        let _ = self.stop.send(true);
        let task = lock(&self.saver).take();
        if let Some(task) = task {
            let _ = task.await;
        }
    }

    async fn autosave(&self, repo: &Repo) {
        if !self.read_only && !self.moved() {
            let _ = self.save_now(repo, None).await;
        }
        self.report();
    }

    pub(crate) async fn save_now(
        &self,
        repo: &Repo,
        message: Option<&str>,
    ) -> Result<Option<Hash>> {
        self.save(repo, message).await
    }

    pub(super) async fn answer_fsyncs(
        self: Arc<Self>,
        repo: Repo,
        mut waiting: mpsc::UnboundedReceiver<oneshot::Sender<io::Result<()>>>,
    ) {
        while let Some(first) = waiting.recv().await {
            let mut batch = vec![first];
            while let Ok(next) = waiting.try_recv() {
                batch.push(next);
            }
            if self.logged().await {
                for done in batch {
                    let _ = done.send(Ok(()));
                }
                continue;
            }
            let saved = self
                .save_received(&repo, None, Instant::now())
                .await
                .map(drop);
            for done in batch {
                let answer = match &saved {
                    Ok(()) => Ok(()),
                    Err(error) => Err(io::Error::other(format!("{error:#}"))),
                };
                let _ = done.send(answer);
            }
        }
    }

    pub(crate) async fn sync_now(&self, repo: &Repo) -> Result<()> {
        if !self.is_vm() && !self.detached.load(Ordering::Relaxed) {
            self.sync_kernel().await?;
        }
        if self.logged().await {
            return Ok(());
        }
        self.save_received(repo, None, Instant::now())
            .await
            .map(drop)
    }

    async fn logged(&self) -> bool {
        match &self.log {
            Some(log) if !self.read_only && !self.moved() => log.sync(&self.fs).await,
            _ => false,
        }
    }

    async fn save(&self, repo: &Repo, message: Option<&str>) -> Result<Option<Hash>> {
        let started = Instant::now();
        if !self.is_vm()
            && !self.detached.load(Ordering::Relaxed)
            && let Err(error) = self.sync_kernel().await
        {
            let _claimed = self.claim.lock().await;
            self.failed(&error).await;
            return Err(error);
        }
        self.save_received(repo, message, started).await
    }

    pub(super) async fn sync_kernel(&self) -> Result<()> {
        let path = self.place.at();
        let turn = self.place.turn.clone();
        let user = self.owner_user.clone();
        tokio::task::spawn_blocking(move || {
            let _turn = lock(&turn);
            match user {
                Some(user) => Ok(user.sync(&path)?),
                None => sync_kernel_writes(&path),
            }
        })
        .await?
    }

    async fn save_received(
        &self,
        repo: &Repo,
        message: Option<&str>,
        started: Instant,
    ) -> Result<Option<Hash>> {
        let saved = self.upload_and_commit(repo, message, started).await;
        match &saved {
            Ok(_) => {
                metrics::histogram!("skywake_save_seconds").record(started.elapsed().as_secs_f64())
            }
            Err(_) => metrics::counter!("skywake_save_failures_total").increment(1),
        }
        saved
    }

    async fn upload_and_commit(
        &self,
        repo: &Repo,
        message: Option<&str>,
        started: Instant,
    ) -> Result<Option<Hash>> {
        let mut claimed = self.claim.lock().await;
        let saved = match message.is_some() && repo.refs().served() {
            true => {
                held::holding(
                    repo.objects().store().as_ref(),
                    self.commit(&mut claimed, repo, message),
                )
                .await
            }
            false => self.commit(&mut claimed, repo, message).await,
        };
        match &saved {
            Ok(commit) => self.saved(started, commit.is_some()),
            Err(error) => self.failed(error).await,
        }
        saved
    }

    async fn commit(
        &self,
        claimed: &mut Claimed,
        repo: &Repo,
        message: Option<&str>,
    ) -> Result<Option<Hash>> {
        if self.read_only {
            match message {
                Some(_) => bail!("{} is mounted read-only", self.branch),
                None => return Ok(None),
            }
        }
        self.settle(claimed, repo).await?;
        if self.moved() {
            bail!(
                "{} moved to another machine; this mount is read-only",
                self.branch
            );
        }
        let mut save = self.fs.save(&self.ignored).await?;
        for new_tree in std::mem::take(&mut save.trees) {
            claimed.claim.trees.add(new_tree)?;
        }
        let through = save.as_of();
        if message.is_none() && save.root == claimed.claim.tree {
            self.fs.committed(&save);
            if let Some(log) = &self.log {
                log.settle(save.root, through, false).await;
            }
            return Ok(None);
        }
        let marker = match &self.log {
            Some(log) => log.mark(save.root, through, true).await,
            None => None,
        };
        let from = claimed.claim.head()?;
        match repo.save(&mut claimed.claim, save.root, message).await {
            Ok(commit) => {
                self.fs.committed(&save);
                if let (Some(log), Some(n)) = (&self.log, marker) {
                    log.saved(n, through).await;
                }
                if let Some(seq) = &mut claimed.seq {
                    *seq += 1;
                }
                Ok(Some(commit))
            }
            Err(Error::Conflict(_)) => {
                let why = match self.refs.head(&self.branch).await {
                    Ok(None) => "the branch was deleted",
                    _ => "another machine took the branch",
                };
                self.mark_moved(why).await;
                bail!("{}: {why}; this mount is now read-only", self.branch)
            }
            Err(error) => {
                if let (Error::Unsettled(_), Some(seq)) = (&error, claimed.seq) {
                    let tree = save.root;
                    claimed.unsettled = Some(Unsettled { seq, from, tree });
                }
                Err(error.into())
            }
        }
    }

    async fn settle(&self, claimed: &mut Claimed, repo: &Repo) -> Result<()> {
        let Some(unsettled) = claimed.unsettled.take() else {
            return Ok(());
        };
        let head = match self.refs.head(&self.branch).await {
            Ok(head) => head,
            Err(error) => {
                claimed.unsettled = Some(unsettled);
                return Err(error.into());
            }
        };
        let ours = head.is_some_and(|head| {
            head.seq == unsettled.seq + 1
                && head.commit.tree == unsettled.tree
                && Objects::address(&head.commit).is_ok_and(|commit| commit != unsettled.from)
        });
        if !ours {
            return Ok(());
        }
        let seq = unsettled.seq + 1;
        let mut claim = repo.position(&self.branch).await?;
        match self.refs.head(&self.branch).await? {
            Some(head) if head.seq == seq => {
                claim.session = claimed.claim.session.take();
                claimed.claim = claim;
                claimed.seq = Some(seq);
                info!(
                    branch = self.branch,
                    "a save that seemed to fail had landed"
                );
            }
            _ => {}
        }
        Ok(())
    }

    async fn check_head(&self, repo: &Repo) {
        if self.read_only || self.moved() {
            return;
        }
        let mut claimed = self.claim.lock().await;
        if let Err(error) = self.settle(&mut claimed, repo).await {
            debug!(branch = self.branch, "can't check the head: {error:#}");
            return;
        }
        let Some(seq) = claimed.seq else {
            return;
        };
        match self.refs.head(&self.branch).await {
            Ok(Some(head)) if head.seq == seq => {}
            Ok(Some(_)) => self.mark_moved("another machine took the branch").await,
            Ok(None) => self.mark_moved("the branch was deleted").await,
            Err(error) => debug!(branch = self.branch, %error, "can't check the head"),
        }
    }

    async fn mark_moved(&self, why: &str) {
        if self.moved.swap(true, Ordering::Relaxed) {
            return;
        }
        self.fs.set_moved();
        warn!(branch = self.branch, path = %self.path.display(), why, "the mount is read-only now");
        if self.has_unsaved()
            && let Err(error) = self.write_manifest(why).await
        {
            warn!(path = %self.path.display(), "can't write the manifest of unsaved changes: {error:#}");
        }
    }

    fn saved(&self, started: Instant, stored: bool) {
        let mut health = self.health();
        health.saved = started;
        health.last_error = None;
        let _ = std::fs::remove_file(self.dir.join(skywake_daemon::manifest::MANIFEST));
        if !stored {
            return;
        }
        let at = SystemTime::now() - started.elapsed();
        let nanos = at.duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
        let _ = std::fs::write(self.dir.join(SAVED_AT), nanos.to_string());
    }

    async fn failed(&self, error: &anyhow::Error) {
        let message = format!("{error:#}");
        let due = {
            let mut health = self.health();
            if health.last_error.as_ref() != Some(&message) {
                warn!(path = %self.path.display(), "save failed: {message}");
            }
            health.last_error = Some(message.clone());
            !self.moved() && self.has_unsaved()
        };
        if due && let Err(error) = self.write_manifest(&message).await {
            warn!(path = %self.path.display(), "can't write the manifest of unsaved changes: {error:#}");
        }
    }

    fn report(&self) {
        self.fs.record_unsaved();
        let lag = Duration::from_millis(self.info().save_lag_ms);
        let mut health = self.health();
        if lag >= LAG_WARN && !health.lagging {
            health.lagging = true;
            warn!(path = %self.path.display(), lag_seconds = lag.as_secs(), "changes are waiting long to be saved");
        } else if lag < LAG_WARN && health.lagging {
            health.lagging = false;
            info!(path = %self.path.display(), "saves caught up");
        }
    }

    pub(crate) async fn write_manifest(&self, reason: &str) -> Result<()> {
        let mut paths = Vec::new();
        for (path, snapshot) in self.fs.snapshot().await? {
            let what = match snapshot {
                Snapshot::Folder => What::Folder,
                Snapshot::Entry(entry) => What::Entry(entry),
                Snapshot::Local {
                    path: copy,
                    mode,
                    modified,
                } => What::File {
                    file: copy
                        .strip_prefix(&self.dir)
                        .context("a local file outside the mount's folder")?
                        .to_string_lossy()
                        .into_owned(),
                    mode,
                    modified_ns: modified
                        .duration_since(UNIX_EPOCH)
                        .map_or(0, |elapsed| elapsed.as_nanos() as u64),
                },
            };
            paths.push(Item { path, what });
        }
        let manifest = Manifest {
            branch: self.branch.clone(),
            mountpoint: self.path.clone(),
            reason: reason.to_string(),
            written: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
            ignored: self.ignored.clone(),
            paths,
        };
        manifest.write(&self.dir, &self.base)?;
        Ok(())
    }
}
