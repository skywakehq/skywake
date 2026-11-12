//! The daemon: takes requests on its socket, and unmounts everything when it stops.

mod branches;
mod mounts;

use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use anyhow::{Context, Result, bail};
use clap::Parser;
use object_store::ObjectStore;
use skywake_core::cache::{Members, WriteLog};
use skywake_core::{HeadNodes, HeadsAt, Refs, Repo, granted_heads, open_store, remember_checks};
use skywake_daemon::access::{Access, AccessFile};
use skywake_daemon::{
    MAX_REQUEST, Request, Response, Status, default_root, read_line, socket_path,
};
use skywake_mount::{CacheNodes, ChunkCache, MountOptions};
use tokio::io::{AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::signal::unix::{SignalKind, signal};
use tracing::{info, warn};

use crate::mounted::Mounted;
use crate::root::{self, effective_uid};
use crate::unsaved::keep_unsaved;
use crate::user::User;

const REQUEST_WITHIN: Duration = Duration::from_secs(10);

const REQUESTS_PER_USER: usize = 16;

/// skywaked: serves every Skywake mount on this machine.
#[derive(Parser)]
#[command(version)]
pub(crate) struct Args {
    /// `s3://bucket` or a local directory.
    #[arg(long, env = "SKYWAKE_STORE", default_value = ".skywake")]
    pub(crate) store: String,
    /// Folder for the socket, chunk cache and local files. Only the user
    /// running skywaked may own it.
    #[arg(long, env = "SKYWAKE_ROOT", default_value_os_t = default_root())]
    pub(crate) root: PathBuf,
    /// How often each mount saves its changes to the bucket. A crash loses
    /// at most this much work, plus the time a save takes. Data synced with
    /// `fsync` or `skywake sync` is never lost.
    #[arg(long, env = "SKYWAKE_SAVE_EVERY_MS", default_value_t = 2000)]
    pub(crate) save_every_ms: u64,
    /// How often an idle mount checks whether another machine took its
    /// branch, with one small read. A mount with changes finds out on its
    /// next save.
    #[arg(long, env = "SKYWAKE_HEAD_CHECK_MS", default_value_t = 5000)]
    pub(crate) head_check_ms: u64,
    /// Maximum disk space for the chunk cache, in GiB. When full, the
    /// least recently used chunks are deleted.
    #[arg(long, env = "SKYWAKE_CACHE_GB", default_value_t = 10)]
    pub(crate) cache_gb: u64,
    /// Maximum disk space for each mount's local data, in GiB: changes not
    /// saved yet, and saved files not yet freed. Past it, writes fail with
    /// "no space". 0 means no limit.
    #[arg(long, env = "SKYWAKE_MOUNT_LOCAL_GB", default_value_t = 20)]
    pub(crate) mount_local_gb: u64,
    /// Cache nodes to ask for chunks before the bucket, for example
    /// `http://10.0.0.5:7070,http://10.0.0.6:7070`. One address that reaches any of them,
    /// such as a Kubernetes service, is enough: the rest are found from it.
    #[arg(long, env = "SKYWAKE_CACHE_NODES", value_delimiter = ',')]
    pub(crate) cache_nodes: Vec<String>,
    /// The token of the cache nodes.
    #[arg(long, env = "SKYWAKE_CACHE_TOKEN", hide_env_values = true)]
    pub(crate) cache_token: Option<String>,
    /// How many cache nodes, each in a different zone, keep each change before fsync answers; the
    /// bucket gets it in the next save. While fewer zones answer, and with 0, fsync waits for the
    /// bucket.
    #[arg(long, env = "SKYWAKE_LOG_COPIES", default_value_t = 3)]
    pub(crate) log_copies: usize,
    /// Where branch heads live: `bucket`, or `tier` when the cache nodes keep them
    /// (started with `SKYWAKE_CACHE_URL` or `SKYWAKE_CACHE_PEERS`). Every machine and every `skywake` command on a
    /// store must use the same setting.
    #[arg(long, env = "SKYWAKE_HEADS", default_value = "bucket")]
    pub(crate) heads: HeadsAt,
    /// Members of this group may use skywaked too, but only to mount over
    /// folders they own and to manage their own mounts. Root and the user
    /// running skywaked may do anything.
    #[arg(long, env = "SKYWAKE_GROUP")]
    pub(crate) group: Option<String>,
    /// The file that says which members may read or write which branches,
    /// such as `user:ann write agents/*`. Default: `access` in the root
    /// folder. Without the file, members may use every branch.
    #[arg(long, env = "SKYWAKE_ACCESS")]
    pub(crate) access: Option<PathBuf>,
    /// Serve Prometheus metrics at `http://<address>/metrics`.
    #[arg(long, env = "SKYWAKE_METRICS_LISTEN")]
    pub(crate) metrics_listen: Option<SocketAddr>,
}

pub(crate) async fn run(args: Args) -> Result<()> {
    let mut interrupt = signal(SignalKind::interrupt())?;
    let mut terminate = signal(SignalKind::terminate())?;

    if let Some(listen) = args.metrics_listen {
        skywake_cache::telemetry::serve_metrics(listen).await?;
    }
    remember_checks(args.root.join("checked-stores"));
    let granted = granted_heads(&args.store).await?;
    let daemon = Arc::new(Daemon::start(&args, open_store(&args.store)?, granted)?);
    let listener = daemon.listen()?;
    loop {
        tokio::select! {
            _ = interrupt.recv() => break,
            _ = terminate.recv() => break,
            accepted = listener.accept() => {
                let (stream, _) = accepted?;
                let daemon = daemon.clone();
                tokio::spawn(async move {
                    if let Err(error) = daemon.serve(stream).await {
                        warn!("request failed: {error:#}");
                    }
                });
            }
        }
    }
    info!("stopping");
    daemon.shutdown().await;
    let _ = std::fs::remove_file(socket_path(&daemon.root));
    Ok(())
}

pub(crate) struct Daemon {
    repo: Repo,
    refs: Refs,
    cache: Arc<ChunkCache>,
    pub(crate) root: PathBuf,
    group: Option<u32>,
    uid: u32,
    access: Arc<AccessFile>,
    save_every: Duration,
    head_check_every: Duration,
    mount_local_limit: u64,
    pub(crate) log: Option<(Arc<WriteLog>, String)>,
    mounts: Mutex<HashMap<PathBuf, Slot>>,
    requests: Mutex<HashMap<u32, usize>>,
}

enum Slot {
    Starting,
    Ready(Arc<Mounted>),
}

pub(crate) struct OpenRequest<'a> {
    daemon: &'a Daemon,
    caller: Caller,
}

impl Drop for OpenRequest<'_> {
    fn drop(&mut self) {
        if !self.caller.admin {
            let mut open = lock(&self.daemon.requests);
            if let Some(count) = open.get_mut(&self.caller.uid) {
                *count -= 1;
                if *count == 0 {
                    open.remove(&self.caller.uid);
                }
            }
        }
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[derive(Clone, Copy)]
pub(crate) struct Caller {
    pub(crate) uid: u32,
    pub(crate) gid: u32,
    pub(crate) admin: bool,
}

impl Daemon {
    pub(crate) fn start(
        args: &Args,
        store: Arc<dyn ObjectStore>,
        granted: Option<HeadNodes>,
    ) -> Result<Self> {
        let group = args.group.as_deref().map(root::group_id).transpose()?;
        root::prepare(&args.root, group)?;
        let root = args.root.canonicalize()?;
        keep_unsaved(&root)?;
        let access = args.access.clone().unwrap_or_else(|| root.join("access"));
        let access = AccessFile::open(access, effective_uid())?;
        if group.is_some() && access.policy().is_none() {
            info!(
                path = %access.path.display(),
                "no access file: every member of the group may read and write every branch"
            );
        }
        let token = args.cache_token.clone().filter(|token| !token.is_empty());
        let mut repo = Repo::new(store.clone()).with_cache(root.join("objects"));
        if let Some(nodes) = granted {
            repo = repo.with_head_nodes(Arc::new(nodes));
            info!("the API says the cache servers own this store's branch heads");
        } else if args.heads == HeadsAt::Tier {
            let nodes = HeadNodes::new(args.cache_nodes.clone(), token.clone())
                .ok_or_else(|| anyhow::anyhow!("SKYWAKE_HEADS=tier needs SKYWAKE_CACHE_NODES"))?;
            repo = repo.with_head_nodes(Arc::new(nodes));
            info!("branch heads come from the cache nodes");
        }
        let members = Members::seeded(args.cache_nodes.clone());
        let log = (args.log_copies > 0 && !args.cache_nodes.is_empty())
            .then(|| WriteLog::over(members.clone(), token.clone(), args.log_copies));
        if log.is_some() {
            info!(
                copies = args.log_copies,
                "fsync counts once changes are on cache nodes in this many zones"
            );
        }
        let cache = ChunkCache::new(root.join("chunks"), args.cache_gb << 30)?
            .with_nodes(CacheNodes::over(members, token));
        Ok(Self {
            refs: repo.refs().clone(),
            repo,
            cache: Arc::new(cache),
            root,
            group,
            uid: effective_uid(),
            access: Arc::new(access),
            save_every: Duration::from_millis(args.save_every_ms),
            head_check_every: Duration::from_millis(args.head_check_ms),
            mount_local_limit: args.mount_local_gb.saturating_mul(1 << 30),
            log: log.map(|log| (Arc::new(log), args.store.clone())),
            mounts: Mutex::default(),
            requests: Mutex::default(),
        })
    }

    pub(crate) fn listen(&self) -> Result<UnixListener> {
        let socket = socket_path(&self.root);
        let _ = std::fs::remove_file(&socket);
        let listener = UnixListener::bind(&socket)?;
        root::protect_socket(&socket, self.group)?;
        info!(socket = %socket.display(), "skywaked listening");
        Ok(listener)
    }

    pub(crate) async fn serve(&self, stream: UnixStream) -> Result<()> {
        let caller = self.caller(&stream)?;
        let open = caller.and_then(|caller| self.begin_request(caller));
        let (read, mut write) = stream.into_split();
        let response = match caller {
            None => {
                Response::Error("permission denied: ask root to add you to skywaked's group".into())
            }
            Some(_) if open.is_none() => Response::Error(format!(
                "you have {REQUESTS_PER_USER} requests open already; wait for one to finish"
            )),
            Some(caller) => {
                let mut read = BufReader::new(read);
                let line = tokio::time::timeout(REQUEST_WITHIN, read_line(&mut read, MAX_REQUEST))
                    .await
                    .context("no request in time")??;
                match serde_json::from_str(&line) {
                    Ok(request) => self.handle(caller, request).await,
                    Err(error) => Response::Error(format!("bad request: {error}")),
                }
            }
        };
        let mut reply = serde_json::to_string(&response)?;
        reply.push('\n');
        tokio::time::timeout(REQUEST_WITHIN, write.write_all(reply.as_bytes()))
            .await
            .context("the client did not take the reply in time")??;
        Ok(())
    }

    pub(crate) fn begin_request(&self, caller: Caller) -> Option<OpenRequest<'_>> {
        if !caller.admin {
            let mut open = lock(&self.requests);
            let count = open.entry(caller.uid).or_default();
            if *count >= REQUESTS_PER_USER {
                return None;
            }
            *count += 1;
        }
        Some(OpenRequest {
            daemon: self,
            caller,
        })
    }

    fn caller(&self, stream: &UnixStream) -> Result<Option<Caller>> {
        let peer = stream.peer_cred()?;
        let (uid, gid) = (peer.uid(), peer.gid());
        let admin = uid == 0 || uid == self.uid;
        if !admin && self.group.is_none() {
            warn!(uid, "refused a request from another user");
            return Ok(None);
        }
        Ok(Some(Caller { uid, gid, admin }))
    }

    pub(crate) async fn handle(&self, caller: Caller, request: Request) -> Response {
        let result = match request {
            Request::Mount {
                branch,
                path,
                vm,
                read_only,
                owner,
                allow_other,
            } => {
                let options = MountOptions { owner, allow_other };
                self.mount(caller, &branch, &path, vm, read_only, options)
                    .await
                    .map(|()| Response::Done)
            }
            Request::Unmount { path } => self.unmount(caller, &path).await,
            Request::Sync { path } => self.sync(caller, &path).await,
            Request::Commit {
                branch,
                path,
                message,
            } => self.commit(caller, &branch, &path, &message).await,
            Request::List => Ok(Response::Mounts(self.list(caller))),
            Request::Status => {
                let cache = self.cache.stats();
                Ok(Response::Status(Status {
                    mounts: self.list(caller),
                    cache_hits: cache.hits,
                    cache_misses: cache.misses,
                    cache_bytes: cache.bytes,
                    cache_max_bytes: cache.max_bytes,
                }))
            }
            Request::Create { branch, from } => self.create(caller, &branch, from.as_deref()).await,
            Request::Merge {
                from,
                into,
                message,
            } => self.merge(caller, &from, &into, &message).await,
            Request::Delete { branch } => self.delete(caller, &branch).await,
            Request::Recover {
                folder,
                branch,
                message,
            } => self.recover(caller, &folder, &branch, &message).await,
        };
        result.unwrap_or_else(|error| Response::Error(format!("{error:#}")))
    }

    async fn allow(&self, caller: Caller, branch: &str, need: Access) -> Result<()> {
        if caller.admin {
            return Ok(());
        }
        let (access, name) = (self.access.clone(), branch.to_string());
        let allowed = tokio::task::spawn_blocking(move || {
            access.policy().is_none_or(|policy| {
                let user = User::new(caller.uid, caller.gid);
                policy.allows(caller.uid, user.groups(), &name, need)
            })
        })
        .await?;
        if !allowed {
            bail!(
                "permission denied: you may not {need} {branch}; {} says who may",
                self.access.path.display()
            );
        }
        Ok(())
    }

    pub(crate) async fn shutdown(&self) {
        let mounts = self.ready().into_iter().map(|mounted| async move {
            if !mounted.begin_unmount() {
                return;
            }
            let stopped = match mounted.stop_writes(false).await {
                Ok(()) => Ok(()),
                Err(_) => {
                    mounted.begin_unmount();
                    mounted.stop_writes(true).await
                }
            };
            let finished = match stopped {
                Ok(()) => self.finish(&mounted).await,
                Err(error) => Err(error),
            };
            if let Err(error) = finished {
                warn!(path = %mounted.path.display(), "{error:#}");
            }
        });
        futures::future::join_all(mounts).await;
    }
}
