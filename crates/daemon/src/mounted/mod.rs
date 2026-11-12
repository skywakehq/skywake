//! One mounted branch: its claim, its session, and how it stops.

mod ignored;
mod log;
mod place;
mod save;

use ignored::link_ignored;
use log::Log;
use place::unmount;
pub(crate) use place::{Place, detach_mounts_below, give, is_dead_mount, sync_kernel_writes};

use std::fs::File;
use std::os::unix::net::UnixListener;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use anyhow::{Result, bail};
use skywake_core::cache::WriteLog;
use skywake_core::{Claim, Hash, Packs, Refs, Repo};
use skywake_daemon::MountInfo;
use skywake_mount::{BackgroundSession, BranchFs, ChunkCache, MountOptions, VmSession};
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;

use crate::user::User;

pub(crate) const SAVED_AT: &str = "saved-at";

pub(crate) const OWNER: &str = "owner";

pub(crate) struct Mounted {
    pub(crate) branch: String,
    pub(crate) path: PathBuf,
    place: Place,
    pub(crate) dir: PathBuf,
    pub(crate) local: PathBuf,
    pub(crate) read_only: bool,
    pub(crate) owner: u32,
    owner_user: Option<User>,
    fs: Arc<BranchFs>,
    log: Option<Log>,
    ignored: Vec<String>,
    claim: tokio::sync::Mutex<Claimed>,
    refs: Refs,
    base: Packs,
    session: Mutex<Option<Session>>,
    moved: AtomicBool,
    unmounting: AtomicBool,
    detached: AtomicBool,
    health: Mutex<Health>,
    stop: watch::Sender<bool>,
    saver: Mutex<Option<JoinHandle<()>>>,
}

struct Claimed {
    claim: Claim,
    seq: Option<u64>,
    unsettled: Option<Unsettled>,
}

struct Unsettled {
    seq: u64,
    from: Hash,
    tree: Hash,
}

struct Health {
    saved: Instant,
    last_error: Option<String>,
    lagging: bool,
}

enum Session {
    Fuse(BackgroundSession),
    Vm(VmSession),
}

pub(crate) struct Setup<'a> {
    pub(crate) repo: &'a Repo,
    pub(crate) refs: &'a Refs,
    pub(crate) cache: Arc<ChunkCache>,
    pub(crate) dir: PathBuf,
    pub(crate) local: PathBuf,
    pub(crate) read_only: bool,
    pub(crate) owner: u32,
    pub(crate) options: MountOptions,
    pub(crate) owner_user: Option<User>,
    pub(crate) save_every: Duration,
    pub(crate) head_check_every: Duration,
    pub(crate) local_limit: u64,
    pub(crate) log: Option<(Arc<WriteLog>, String)>,
}

impl Mounted {
    pub(crate) async fn start(
        branch: &str,
        place: Place,
        dir: Option<File>,
        setup: Setup<'_>,
    ) -> Result<Arc<Self>> {
        let path = place.path.clone();
        let Setup { repo, refs, .. } = setup;
        let (mut claim, seq, base) = match setup.read_only {
            true => (repo.position(branch).await?, None, Packs::default()),
            false => {
                let claim = repo.claim(branch).await?;
                let (seq, base) = (claim.seq(), claim.packs().clone());
                (claim, Some(seq), base)
            }
        };
        let fs = Arc::new(
            BranchFs::new(
                repo.objects().clone(),
                setup.cache,
                setup.dir.join("files"),
                claim.tree,
                claim.trees.clone(),
            )?
            .with_name(path.display().to_string())
            .with_local_limit(setup.local_limit),
        );
        if setup.read_only {
            fs.set_read_only();
        }
        std::fs::write(setup.dir.join(OWNER), setup.owner.to_string())?;
        let (log, replay) = match (setup.read_only, setup.log) {
            (false, Some((store, scope))) => {
                let key = WriteLog::key(&scope, branch);
                let (log, ops) = Log::open(store, key, claim.seq(), claim.tree).await?;
                (Some(log), ops)
            }
            _ => (None, Vec::new()),
        };
        if !replay.is_empty() {
            let failed = fs.replay(replay).await;
            if failed > 0 {
                tracing::warn!(branch, failed, "some logged changes could not be replayed");
            }
        }
        let ignored = match setup.read_only {
            true => Vec::new(),
            false => fs.ignored().await?,
        };
        let seq = match &log {
            Some(log) => Some(log::catch_up(log, repo, &mut claim, &fs, &ignored).await?),
            None => seq,
        };
        if dir.is_some() && !setup.read_only {
            link_ignored(&fs, &ignored, &setup.local, setup.options.owner).await?;
        }
        let (fsyncs, waiting) = mpsc::unbounded_channel();
        let session = match &dir {
            None => {
                let at = place.at();
                let bind = || {
                    let _ = std::fs::remove_file(&at);
                    UnixListener::bind(&at)
                };
                let listener = match &setup.owner_user {
                    Some(user) => user.bind(&at)?,
                    None => bind()?,
                };
                Session::Vm(skywake_mount::serve_vm_on(
                    fs.clone(),
                    listener,
                    &at,
                    fsyncs,
                )?)
            }
            Some(dir) => Session::Fuse(skywake_mount::mount_dir(
                fs.clone(),
                dir,
                fsyncs,
                &setup.options,
            )?),
        };

        let mounted = Arc::new(Self {
            branch: branch.to_string(),
            path: path.clone(),
            place,
            dir: setup.dir,
            local: setup.local,
            read_only: setup.read_only,
            owner: setup.owner,
            owner_user: setup.owner_user,
            fs,
            log,
            ignored,
            claim: tokio::sync::Mutex::new(Claimed {
                claim,
                seq,
                unsettled: None,
            }),
            refs: refs.clone(),
            base,
            session: Mutex::new(Some(session)),
            moved: AtomicBool::new(false),
            unmounting: AtomicBool::new(false),
            detached: AtomicBool::new(false),
            health: Mutex::new(Health {
                saved: Instant::now(),
                last_error: None,
                lagging: false,
            }),
            stop: watch::channel(false).0,
            saver: Mutex::new(None),
        });
        tokio::spawn(mounted.clone().answer_fsyncs(repo.clone(), waiting));
        mounted.start_saver(repo.clone(), setup.save_every, setup.head_check_every);
        Ok(mounted)
    }

    pub(crate) fn moved(&self) -> bool {
        self.moved.load(Ordering::Relaxed)
    }

    pub(crate) fn has_unsaved(&self) -> bool {
        self.fs.has_changes()
    }

    pub(crate) fn clear_metrics(&self) {
        self.fs.clear_metrics();
    }

    pub(crate) fn info(&self) -> MountInfo {
        let unsaved = self.has_unsaved();
        let health = self.health();
        MountInfo {
            branch: self.branch.clone(),
            path: self.path.clone(),
            moved: self.moved(),
            read_only: self.read_only,
            save_lag_ms: match unsaved {
                true => health.saved.elapsed().as_millis() as u64,
                false => 0,
            },
            unsaved_bytes: self.fs.unsaved_bytes(),
            last_error: health.last_error.clone(),
        }
    }

    fn is_vm(&self) -> bool {
        matches!(*lock(&self.session), Some(Session::Vm(_)))
    }

    pub(crate) fn begin_unmount(&self) -> bool {
        !self.unmounting.swap(true, Ordering::Relaxed)
    }

    pub(crate) async fn stop_writes(&self, lazy: bool) -> Result<()> {
        if !self.is_vm() && !self.detached.load(Ordering::Relaxed) {
            self.sync_kernel().await?;
        }
        if self.is_vm() || lazy {
            self.fs.stop_writes().await;
        }
        if self.is_vm() {
            return Ok(());
        }
        let (at, path, turn) = (self.place.at(), self.path.clone(), self.place.turn.clone());
        let unmounted = tokio::task::spawn_blocking(move || {
            let _turn = lock(&turn);
            unmount(&at, &path, lazy)
        })
        .await?;
        if let Err(error) = unmounted {
            self.unmounting.store(false, Ordering::Relaxed);
            let hint = match error.raw_os_error() {
                Some(libc::EBUSY) => " (a process has a file or its working folder in it)",
                _ => "",
            };
            bail!(
                "can't unmount {}: {error}{hint}; it stays mounted and keeps saving",
                self.path.display()
            );
        }
        self.detached.store(true, Ordering::Relaxed);
        if lazy {
            drop(lock(&self.session).take());
        }
        Ok(())
    }

    pub(crate) async fn finish(&self, repo: &Repo) -> Result<()> {
        self.stop_saver().await;
        let saved = self.save_now(repo, None).await.map(drop);
        if let (Ok(()), Some(log)) = (&saved, &self.log)
            && !self.has_unsaved()
        {
            log.clear().await;
        }
        let session = lock(&self.session).take();
        match session {
            Some(Session::Fuse(session)) => {
                tokio::task::spawn_blocking(move || session.umount_and_join()).await??
            }
            Some(Session::Vm(session)) => session.stop(),
            None => {}
        }
        saved
    }

    fn health(&self) -> MutexGuard<'_, Health> {
        lock(&self.health)
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
