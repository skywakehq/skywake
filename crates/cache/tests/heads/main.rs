//! Branch heads on the cache tier: owners, checkpoints they hold, and passes from the API.

#[path = "../common/mod.rs"]
mod common;

mod blocking;
mod checkpoints;
mod churn;
mod owners;
mod passes;

use std::sync::Arc;
use std::time::Duration;

use object_store::ObjectStore;
use object_store::memory::InMemory;
use object_store::prefix::PrefixStore;
use skywake_cache::Node;
use skywake_core::cache::ChunkCache;
use skywake_core::store::held;
use skywake_core::store::refs::{self, Slot};
use skywake_core::{Commit, HeadNodes, Objects, Packs, Refs, Repo};
use tempfile::{TempDir, tempdir};
use tokio::net::TcpListener;

use common::TOKEN;

struct Server(std::sync::Mutex<Option<tokio::runtime::Runtime>>);

impl Server {
    fn start(
        listener: std::net::TcpListener,
        store: Arc<dyn ObjectStore>,
        dir: &TempDir,
        url: &str,
        zone: &str,
        copies: usize,
    ) -> Self {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .unwrap();
        let (dir, url, zone) = (dir.path().to_path_buf(), url.to_string(), zone.to_string());
        listener.set_nonblocking(true).unwrap();
        runtime.spawn(async move {
            let cache = ChunkCache::new(dir.join("chunks"), u64::MAX).unwrap();
            let node = Node::new(Arc::new(cache), Objects::new(store), Some(TOKEN.into()))
                .with_log(dir.join("log"), zone)
                .unwrap()
                .with_registration(url)
                .await
                .unwrap()
                .with_heads(copies);
            let listener = TcpListener::from_std(listener).unwrap();
            skywake_cache::serve(listener, node).await
        });
        Self(std::sync::Mutex::new(Some(runtime)))
    }

    fn abort(&self) {
        if let Some(runtime) = self.0.lock().unwrap().take() {
            runtime.shutdown_background();
        }
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.abort();
    }
}

struct Tier {
    urls: Vec<String>,
    zones: Vec<&'static str>,
    store: Arc<dyn ObjectStore>,
    listeners: Vec<Option<std::net::TcpListener>>,
    servers: Vec<Option<Server>>,
    dirs: Vec<TempDir>,
}

async fn tier() -> Tier {
    tier_on(Arc::new(InMemory::new())).await
}

async fn tier_on(store: Arc<dyn ObjectStore>) -> Tier {
    let mut tier = Tier::reserve(store, &["a", "b", "c"]);
    for n in 0..3 {
        tier.start(n, 3).await;
    }
    tier
}

async fn tier_without_one(mut tier: Tier) -> Tier {
    for server in &mut tier.servers {
        *server = None;
    }
    for n in 1..3 {
        tier.start(n, 2).await;
    }
    tier
}

impl Tier {
    fn reserve(store: Arc<dyn ObjectStore>, zones: &[&'static str]) -> Self {
        raise_open_file_limit();
        let listeners: Vec<_> = zones
            .iter()
            .map(|_| std::net::TcpListener::bind("127.0.0.1:0").unwrap())
            .collect();
        let urls = listeners
            .iter()
            .map(|listener| format!("http://{}", listener.local_addr().unwrap()))
            .collect();
        Tier {
            urls,
            zones: zones.to_vec(),
            store,
            listeners: listeners.into_iter().map(Some).collect(),
            servers: zones.iter().map(|_| None).collect(),
            dirs: zones.iter().map(|_| tempdir().unwrap()).collect(),
        }
    }

    async fn start(&mut self, n: usize, copies: usize) {
        let listener = match self.listeners[n].take() {
            Some(listener) => listener,
            None => bind(self.urls[n].trim_start_matches("http://")).await,
        };
        let server = Server::start(
            listener,
            self.store.clone(),
            &self.dirs[n],
            &self.urls[n],
            self.zones[n],
            copies,
        );
        self.servers[n] = Some(server);
    }

    fn crash(&mut self, n: usize) {
        self.servers[n] = None;
    }

    fn crash_all(&self) {
        self.servers.iter().flatten().for_each(Server::abort);
    }

    fn refs(&self) -> Refs {
        Refs::new(self.store.clone()).served_by(self.nodes())
    }

    fn refs_in(&self, folder: &str, bearer: &str) -> Refs {
        let nodes = HeadNodes::new(self.urls.clone(), Some(bearer.into()))
            .unwrap()
            .in_folder(folder);
        let store: Arc<dyn ObjectStore> = Arc::new(PrefixStore::new(self.store.clone(), folder));
        Refs::new(store).served_by(Arc::new(nodes))
    }

    fn repo(&self) -> Repo {
        Repo::new(self.store.clone()).with_head_nodes(self.nodes())
    }

    fn nodes(&self) -> Arc<HeadNodes> {
        Arc::new(HeadNodes::new(self.urls.clone(), Some(TOKEN.into())).unwrap())
    }

    async fn checkpoint(
        &self,
        branch: &str,
        files: &[(&str, &str)],
        message: &str,
    ) -> skywake_core::Hash {
        let dir = tempdir().unwrap();
        for (name, text) in files {
            std::fs::write(dir.path().join(name), text).unwrap();
        }
        let repo = self.repo();
        held::holding(
            self.store.as_ref(),
            repo.commit(branch, dir.path(), message),
        )
        .await
        .unwrap()
    }

    async fn in_bucket(&self, branch: &str, seq: u64) {
        for _ in 0..100 {
            if let Slot::Live(head) = refs::read(self.store.as_ref(), branch).await.unwrap()
                && head.seq == seq
            {
                return;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        panic!("{branch} never reached the bucket at {seq}");
    }
}

fn commit(message: &str) -> Commit {
    Commit::new(
        skywake_core::Hash::of(message.as_bytes()),
        Packs::default(),
        None,
        message,
    )
}

async fn bind(address: &str) -> std::net::TcpListener {
    for _ in 0..100 {
        if let Ok(listener) = std::net::TcpListener::bind(address) {
            return listener;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("{address} stayed in use");
}

fn big(text: &str) -> String {
    text.repeat(4096)
}

async fn checked_out(store: Arc<dyn ObjectStore>, branch: &str, name: &str) -> String {
    let out = tempdir().unwrap();
    Repo::new(store).checkout(branch, out.path()).await.unwrap();
    std::fs::read_to_string(out.path().join(name)).unwrap()
}

fn raise_open_file_limit() {
    static RAISED: std::sync::Once = std::sync::Once::new();
    RAISED.call_once(|| {
        let mut limit = libc::rlimit {
            rlim_cur: 0,
            rlim_max: 0,
        };
        // SAFETY: both calls only use the struct we pass.
        unsafe {
            if libc::getrlimit(libc::RLIMIT_NOFILE, &mut limit) == 0 {
                limit.rlim_cur = limit.rlim_max;
                libc::setrlimit(libc::RLIMIT_NOFILE, &limit);
            }
        }
    });
}
