//! The stores a run can use, each made fresh for the run, counted, and removed after it.

mod counted;
mod slow;

use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{Result, bail};
use futures::{StreamExt, TryStreamExt};
use object_store::ObjectStore;
use serde_json::{Value, json};
use tempfile::TempDir;

pub(crate) use counted::Counted;
pub(crate) use slow::Slow;

use crate::metrics::requests::Log;

#[derive(clap::Args)]
pub(crate) struct Options {
    #[arg(
        id = "store",
        long = "store",
        default_value = "local",
        help = "local (a temp folder), slow (the same with object-storage latency) or s3://bucket/folder"
    )]
    pub kind: String,
    #[arg(
        long,
        default_value_t = 60,
        help = "For slow: the wait before each request"
    )]
    pub latency_ms: u64,
    #[arg(
        long,
        default_value_t = 64,
        help = "For slow: the most requests in flight"
    )]
    pub in_flight: usize,
    #[arg(long, help = "Allow an s3:// store whose endpoint is not local")]
    pub allow_remote: bool,
}

pub(crate) struct Store {
    pub store: Arc<dyn ObjectStore>,
    pub log: Arc<Log>,
    pub name: String,
    pub location: String,
    pub settings: Value,
    place: Place,
}

enum Place {
    Folder(TempDir),
    Bucket(Arc<dyn ObjectStore>),
}

impl Store {
    pub(crate) fn open(options: &Options) -> Result<Self> {
        let (raw, place, name, location) = match options.kind.as_str() {
            "local" | "slow" => {
                let dir = tempfile::Builder::new().prefix("bench-").tempdir()?;
                let location = dir.path().to_string_lossy().into_owned();
                let raw = skywake_core::open_store(&location)?;
                let name = match options.kind.as_str() {
                    "local" => "local".to_string(),
                    _ => format!(
                        "slow ({} ms, {} in flight)",
                        options.latency_ms, options.in_flight
                    ),
                };
                (raw, Place::Folder(dir), name, location)
            }
            location if location.starts_with("s3://") => {
                if !options.allow_remote && !local_endpoint() {
                    bail!(
                        "AWS_ENDPOINT is not a local server; pass --allow-remote to run against a real bucket"
                    );
                }
                let at = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
                let location = format!("{}/bench-{at}", location.trim_end_matches('/'));
                let raw = skywake_core::open_store(&location)?;
                (raw.clone(), Place::Bucket(raw), location.clone(), location)
            }
            other => bail!("unknown store `{other}`: use local, slow or s3://bucket/folder"),
        };
        let (inner, settings): (Arc<dyn ObjectStore>, _) = match options.kind.as_str() {
            "slow" => (
                Arc::new(Slow::new(
                    raw,
                    Duration::from_millis(options.latency_ms),
                    options.in_flight,
                )),
                json!({
                    "kind": "slow",
                    "latency_ms": options.latency_ms,
                    "in_flight": options.in_flight,
                }),
            ),
            "local" => (raw, json!({ "kind": "local", "latency_ms": 0 })),
            _ => (
                raw,
                json!({ "kind": "s3", "location": name, "endpoint": endpoint(), "latency_ms": 0 }),
            ),
        };
        let log = Arc::new(Log::default());
        Ok(Self {
            store: Arc::new(Counted::new(inner, log.clone())),
            log,
            name,
            location,
            settings,
            place,
        })
    }

    pub(crate) async fn remove(self) -> Result<()> {
        match self.place {
            Place::Folder(dir) => Ok(dir.close()?),
            Place::Bucket(raw) => {
                let paths = raw.list(None).map_ok(|meta| meta.location).boxed();
                raw.delete_stream(paths).try_collect::<Vec<_>>().await?;
                Ok(())
            }
        }
    }
}

fn endpoint() -> String {
    std::env::var("AWS_ENDPOINT")
        .or_else(|_| std::env::var("AWS_ENDPOINT_URL"))
        .unwrap_or_default()
}

fn local_endpoint() -> bool {
    let endpoint = endpoint();
    let host = endpoint
        .split("://")
        .nth(1)
        .unwrap_or(&endpoint)
        .split([':', '/'])
        .next()
        .unwrap_or_default();
    ["localhost", "127.0.0.1"].contains(&host)
}
