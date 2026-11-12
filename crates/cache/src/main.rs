//! The `skywake-cache` server.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{Result, bail};
use clap::Parser;
use skywake_cache::{Node, telemetry};
use skywake_core::cache::ChunkCache;
use skywake_core::{Objects, open_store};
use tokio::net::TcpListener;
use tracing::{info, warn};

/// skywake-cache: a node of the shared chunk cache. Give every skywaked an
/// address that reaches the servers with `SKYWAKE_CACHE_NODES`, and the same token.
#[derive(Parser)]
#[command(version)]
struct Args {
    /// `s3://bucket` or a local directory.
    #[arg(long, env = "SKYWAKE_STORE", default_value = ".skywake")]
    store: String,
    /// Where to listen. Use the machine's private address, such as
    /// `10.0.0.5:7070`, for other machines to reach it.
    #[arg(long, env = "SKYWAKE_CACHE_LISTEN", default_value = "127.0.0.1:7070")]
    listen: SocketAddr,
    /// Folder for the chunks. A fast local disk (NVMe) is best.
    #[arg(
        long,
        env = "SKYWAKE_CACHE_DIR",
        default_value = "/var/cache/skywake-cache"
    )]
    dir: PathBuf,
    /// Folder for the write logs: changes saved with fsync that the bucket
    /// does not have yet. Must survive restarts; not inside the chunk folder.
    #[arg(
        long,
        env = "SKYWAKE_CACHE_LOG_DIR",
        default_value = "/var/lib/skywake-cache/log"
    )]
    log_dir: PathBuf,
    /// This server's address as others reach it. Set, the server joins the set of
    /// servers on its own: it keeps a record in the bucket, and leaves cleanly on
    /// SIGTERM. Servers can then be added and removed at any time.
    #[arg(long, env = "SKYWAKE_CACHE_URL")]
    url: Option<String>,
    /// No longer needed: servers find each other through the bucket. Set, it
    /// has the same effect as `--url`.
    #[arg(long, env = "SKYWAKE_CACHE_PEERS", value_delimiter = ',', hide = true)]
    peers: Vec<String>,
    /// Zones that keep each branch-head change before it is answered.
    #[arg(long, env = "SKYWAKE_LOG_COPIES", default_value_t = 3)]
    log_copies: usize,
    /// The zone this machine runs in, such as `us-east-1a`. Write logs are kept
    /// only when it is set: each record goes to nodes in different zones.
    #[arg(long, env = "SKYWAKE_CACHE_ZONE")]
    zone: Option<String>,
    /// Maximum disk space for the chunks, in GiB.
    #[arg(long, env = "SKYWAKE_CACHE_GB", default_value_t = 100)]
    gb: u64,
    /// Every request must send this as `Authorization: Bearer <token>`.
    #[arg(long, env = "SKYWAKE_CACHE_TOKEN", hide_env_values = true)]
    token: Option<String>,
    /// Serve anyone, without a token. Only for a network you fully trust.
    #[arg(long)]
    insecure: bool,
    /// Serve Prometheus metrics at `http://<address>/metrics`.
    #[arg(long, env = "SKYWAKE_METRICS_LISTEN")]
    metrics_listen: Option<SocketAddr>,
}

#[tokio::main]
async fn main() -> Result<()> {
    telemetry::init_logs();
    let args = Args::parse();
    let token = args.token.filter(|token| !token.is_empty());
    match (&token, args.insecure) {
        (None, false) => bail!("set SKYWAKE_CACHE_TOKEN, or pass --insecure to serve anyone"),
        (None, true) => warn!("serving without a token: anyone who can connect can read chunks"),
        (Some(_), _) => {}
    }
    if let Some(listen) = args.metrics_listen {
        telemetry::serve_metrics(listen).await?;
    }
    let objects = Objects::new(open_store(&args.store)?);
    let cache = Arc::new(ChunkCache::new(args.dir.clone(), args.gb << 30)?);
    let listener = TcpListener::bind(args.listen).await?;
    info!(address = %listener.local_addr()?, "skywake-cache listening");
    let mut node = Node::new(cache, objects, token).with_ranges(args.dir.join("ranges"))?;
    match args.zone.filter(|zone| !zone.is_empty()) {
        Some(zone) => node = node.with_log(args.log_dir, zone)?,
        None => warn!("SKYWAKE_CACHE_ZONE is not set: this node keeps no write logs"),
    }
    let peers: Vec<String> = args
        .peers
        .into_iter()
        .filter(|peer| !peer.is_empty())
        .collect();
    let url = args.url.filter(|url| !url.is_empty());
    if !peers.is_empty() {
        warn!(
            "SKYWAKE_CACHE_PEERS is no longer needed: servers find each other through the bucket"
        );
    }
    if url.is_some() || !peers.is_empty() {
        let me = url.unwrap_or_else(|| format!("http://{}", args.listen));
        node = node
            .with_registration(me)
            .await?
            .with_heads(args.log_copies);
        info!("joined the set of cache servers");
    }
    skywake_cache::serve_until(listener, node, stopped()).await?;
    Ok(())
}

async fn stopped() {
    let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .expect("a SIGTERM handler");
    tokio::select! {
        _ = term.recv() => {}
        _ = tokio::signal::ctrl_c() => {}
    }
    info!("stopping");
}
