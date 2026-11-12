//! A node of the shared chunk cache: chunks, write logs and branch heads served over HTTP.

mod auth;
mod chunks;
mod heads;
mod log;
pub mod telemetry;

use std::io;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use axum::Router;
use axum::extract::{DefaultBodyLimit, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::serve::ListenerExt;
use object_store::ObjectStore;
use object_store::prefix::PrefixStore;
use skywake_core::Objects;
use skywake_core::cache::{ChunkCache, WriteLog};
use skywake_core::cluster::{Registration, members::RENEW};
use skywake_core::store::held::HOLD_MAX;
use tokio::net::TcpListener;
use tokio::sync::Semaphore;
use tracing::{info, warn};

use chunks::{Heat, Missing, Outboards};

const REQUESTS_AT_ONCE: usize = 512;

pub struct Node {
    cache: Arc<ChunkCache>,
    objects: Objects,
    token: Option<String>,
    requests: Arc<Semaphore>,
    missing: Missing,
    heat: Heat,
    outboards: Option<Arc<Outboards>>,
    logs: Option<Arc<log::Logs>>,
    zone: Option<String>,
    registration: Option<Arc<Registration>>,
    heads: Option<Arc<heads::Heads>>,
}

impl Node {
    pub fn new(cache: Arc<ChunkCache>, objects: Objects, token: Option<String>) -> Self {
        Self {
            cache,
            objects,
            token,
            requests: Arc::new(Semaphore::new(REQUESTS_AT_ONCE)),
            missing: Missing::default(),
            heat: Heat::default(),
            outboards: None,
            logs: None,
            zone: None,
            registration: None,
            heads: None,
        }
    }

    pub fn with_ranges(mut self, dir: PathBuf) -> io::Result<Self> {
        self.outboards = Some(Arc::new(Outboards::new(dir, &self.cache)?));
        Ok(self)
    }

    pub fn with_log(mut self, dir: PathBuf, zone: String) -> io::Result<Self> {
        self.logs = Some(Arc::new(log::Logs::new(dir)?));
        self.zone = Some(zone);
        Ok(self)
    }

    pub async fn with_registration(mut self, me: String) -> io::Result<Self> {
        let store = self.objects.store().clone();
        let registration = Registration::start("cache", me, self.zone.clone(), store)
            .await
            .map_err(io::Error::other)?;
        self.registration = Some(registration);
        Ok(self)
    }

    pub fn with_heads(mut self, copies: usize) -> Self {
        let (Some(registration), Some(_)) = (&self.registration, &self.logs) else {
            warn!(
                "branch heads need the write log (a zone) and this server's address; not serving them"
            );
            return self;
        };
        let members = registration.members();
        let servers = members.listing().live.len();
        if servers < copies {
            warn!(
                servers,
                copies, "fewer servers than log copies: branch-head changes fail until more join"
            );
        }
        let log = WriteLog::over(members, self.token.clone(), copies);
        self.heads = Some(heads::Heads::start(
            registration.clone(),
            self.objects.clone(),
            log,
        ));
        self
    }

    fn leaving(&self) -> bool {
        self.registration
            .as_ref()
            .is_some_and(|registration| registration.is_leaving())
    }

    pub async fn drain(&self) {
        let Some(registration) = &self.registration else {
            return;
        };
        info!("leaving: handing branch heads and write logs to other servers");
        if let Err(error) = registration.leave().await {
            warn!(%error, "can't mark this server as leaving");
        }
        if let Some(heads) = &self.heads {
            heads.leave().await;
        }
        // Write logs move only after every client has the new list, so no append lands here late.
        tokio::time::sleep(RENEW + Duration::from_secs(1)).await;
        if let Some(logs) = &self.logs {
            log::hand_off(logs, registration, self.token.as_deref()).await;
        }
        if let Err(error) = registration.remove().await {
            warn!(%error, "can't remove this server's record; it lapses on its own");
        }
        info!("left the set of servers");
    }
}

pub async fn serve(listener: TcpListener, node: Node) -> io::Result<()> {
    serve_until(listener, node, std::future::pending()).await
}

pub async fn serve_until(
    listener: TcpListener,
    node: Node,
    stop: impl Future<Output = ()> + Send + 'static,
) -> io::Result<()> {
    let node = Arc::new(node);
    let draining = node.clone();
    let app = Router::new()
        .route("/members", get(members))
        .route("/chunks/{hash}", get(chunks::chunk))
        .route("/blobs/{hash}", get(chunks::blob))
        .route(
            "/bundles/{bundle}",
            post(chunks::bundled).layer(DefaultBodyLimit::max(1 << 20)),
        )
        .route(
            "/log/{key}/{action}",
            post(log::route).layer(DefaultBodyLimit::max(log::RECORD_MAX)),
        )
        .route(
            "/heads",
            post(heads::route).layer(DefaultBodyLimit::max(2 * HOLD_MAX)),
        )
        .with_state(node);
    let listener = listener.tap_io(|stream| {
        let _ = stream.set_nodelay(true);
    });
    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            stop.await;
            draining.drain().await;
        })
        .await
}

async fn members(State(node): State<Arc<Node>>, headers: HeaderMap) -> Response {
    if node.rights(&headers).is_none() {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Some(registration) = &node.registration else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let listing = registration.members().listing();
    let listing = serde_json::to_vec(listing.as_ref()).expect("a list of addresses");
    ([(header::CONTENT_TYPE, "application/json")], listing).into_response()
}

fn in_folder(root: &Arc<dyn ObjectStore>, folder: &str) -> Arc<dyn ObjectStore> {
    match folder {
        "" => root.clone(),
        folder => Arc::new(PrefixStore::new(root.clone(), folder)),
    }
}

fn hold<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
