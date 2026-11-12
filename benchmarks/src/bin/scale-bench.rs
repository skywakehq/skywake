//! `scale-bench`: the same filesystem operations at growing sizes, and how each cost grows.

use anyhow::Result;
use clap::{Parser, Subcommand};
use skywake_benchmarks::workloads::scale;

#[derive(Parser)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    #[command(about = "Write filesystems of growing size and measure each")]
    Run(scale::Args),
    #[command(
        hide = true,
        about = "Garbage collection on one store, as JSON; `run` starts it"
    )]
    Gc { location: String },
}

#[tokio::main]
async fn main() -> Result<()> {
    match Cli::parse().command {
        Command::Run(args) => scale::run(args).await,
        Command::Gc { location } => scale::collect(&location).await,
    }
}
