//! `pinning-load`: the pinned-index load test that `benchmarks/pinning/run.sh` starts against its API servers.

use anyhow::Result;
use clap::Parser;
use skywake_benchmarks::workloads::pinning::{Args, run};

#[tokio::main]
async fn main() -> Result<()> {
    run(Args::parse()).await
}
