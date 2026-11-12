//! Logs and metrics for the Skywake servers, skywaked and skywake-cache.

use std::future::ready;
use std::io;
use std::net::SocketAddr;
use std::time::Duration;

use axum::Router;
use axum::routing::get;
use metrics_exporter_prometheus::PrometheusBuilder;
use tokio::net::TcpListener;
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

pub fn init_logs() {
    let filter = EnvFilter::try_from_env("SKYWAKE_LOG").unwrap_or_else(|_| EnvFilter::new("info"));
    let logs = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(io::stderr);
    if std::env::var("SKYWAKE_LOG_FORMAT").is_ok_and(|format| format == "json") {
        logs.json().init();
    } else {
        logs.init();
    }
}

pub async fn serve_metrics(listen: SocketAddr) -> io::Result<()> {
    let metrics = PrometheusBuilder::new()
        .install_recorder()
        .map_err(io::Error::other)?;
    let listener = TcpListener::bind(listen).await?;
    info!(address = %listener.local_addr()?, "serving metrics");
    let upkeep = metrics.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(5)).await;
            upkeep.run_upkeep();
        }
    });
    let app = Router::new().route("/metrics", get(move || ready(metrics.render())));
    tokio::spawn(async move {
        if let Err(error) = axum::serve(listener, app).await {
            warn!(%error, "metrics server stopped");
        }
    });
    Ok(())
}
