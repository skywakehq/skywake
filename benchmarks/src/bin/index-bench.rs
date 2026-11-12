//! `index-bench`: the search index's benchmarks: `gen` a synthetic dataset, `run` the vector benchmark, `msmarco` BM25.

use anyhow::Result;
use clap::{Parser, Subcommand};
use skywake_benchmarks::datasets::synth;
use skywake_benchmarks::workloads::{text, vectors};

#[derive(Parser)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    #[command(about = "Write a synthetic clustered dataset (cosine)")]
    Gen(synth::Args),
    #[command(about = "Load a dataset into a fresh index, build it and measure queries")]
    Run(vectors::Args),
    #[command(about = "BM25 on MS MARCO passages: quality, and cold and warm latency")]
    Msmarco(text::Args),
}

#[tokio::main]
async fn main() -> Result<()> {
    match Cli::parse().command {
        Command::Gen(args) => synth::generate(&args),
        Command::Run(args) => vectors::run(args).await,
        Command::Msmarco(args) => text::run(args).await,
    }
}
