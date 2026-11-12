//! `scale-bench`: the same operations on filesystems of growing size, to show which costs stay flat and which grow.

mod measure;
mod report;
mod synth;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use serde_json::json;
use skywake_core::Repo;

use crate::metrics::memory::peak_rss;
use crate::metrics::requests::{Log, Op};
use crate::progress;
use crate::results::Run;
use crate::stores::{Counted, Options, Store};
use measure::{Collection, Operation, Sample};
use report::{Report, Step};

#[derive(clap::Args)]
pub struct Args {
    #[arg(
        long,
        default_value = "1000,10000,100000",
        value_delimiter = ',',
        help = "Files in each step's filesystem, smallest first"
    )]
    files: Vec<u64>,
    #[arg(
        long,
        default_value_t = 100,
        help = "Files to a folder, and folders to a folder"
    )]
    per_folder: usize,
    #[arg(
        long,
        default_value_t = 20,
        help = "Commits after the first, each changing one file"
    )]
    history: usize,
    #[arg(
        long,
        default_value_t = 5,
        help = "Runs of each operation; the median is reported"
    )]
    runs: usize,
    #[command(flatten)]
    store: Options,
    #[arg(long, help = "The results folder; by default benchmarks/results/<run>")]
    out: Option<PathBuf>,
}

pub async fn run(args: Args) -> Result<()> {
    if args.files.len() < 2 || !args.files.is_sorted() {
        bail!("--files needs two or more sizes, smallest first");
    }
    if args.per_folder < 2 || args.runs == 0 {
        bail!("--per-folder must be 2 or more and --runs 1 or more");
    }
    if let Some(out) = &args.out {
        progress::record_to(&out.join("events.jsonl"))?;
    }
    let options = &args.store;
    let empty = Store::open(options)?;
    let baseline = collect_apart(&empty).await?.peak_bytes;
    let store_name = empty.name.clone();
    empty.remove().await?;
    let mut steps = Vec::new();
    for &files in &args.files {
        let store = Store::open(options)?;
        let step = measure_step(&store, &args, files).await;
        if let Err(e) = store.remove().await {
            progress::note(
                "cleanup",
                &format!("could not delete the test filesystem: {e}"),
            );
        }
        steps.push(step?);
    }

    let report = Report {
        store: store_name,
        per_folder: args.per_folder,
        history: args.history,
        runs: args.runs,
        baseline_bytes: baseline,
        steps,
    };
    let markdown = report.markdown();
    println!("{markdown}");
    let mut run = Run::new(
        "scale",
        json!({
            "files": args.files,
            "per_folder": args.per_folder,
            "history": args.history,
            "runs": args.runs,
            "store": options.kind,
        }),
    );
    run.tables = report.tables();
    run.save(args.out, &markdown)
}

async fn measure_step(store: &Store, args: &Args, files: u64) -> Result<Step> {
    let repo = Repo::new(store.store.clone());
    let writing = progress::start("write", &format!("{} files", progress::count(files)));
    let made = synth::make(&repo, files, args.per_folder, args.history).await?;
    let objects = store.log.take().iter().filter(|r| r.op == Op::Put).count() as u64;
    writing.done(&format!("{} objects", progress::count(objects)));

    let mut samples = Vec::new();
    for operation in Operation::ALL {
        samples.push(measure::sample(store, &made, operation, args.runs).await?);
    }
    let collecting = progress::start("gc", &format!("{} files", progress::count(files)));
    let collection = collect_apart(store).await?;
    collecting.done(&progress::bytes(collection.peak_bytes));
    Ok(Step {
        files: made.files,
        folders: made.folders,
        objects,
        samples,
        collection,
    })
}

async fn collect_apart(store: &Store) -> Result<Collection> {
    let location = store.location.clone();
    let output = tokio::task::spawn_blocking(move || {
        std::process::Command::new(std::env::current_exe()?)
            .args(["gc", &location])
            .stderr(std::process::Stdio::inherit())
            .output()
    })
    .await??;
    if !output.status.success() {
        bail!("gc failed ({}); its errors are above", output.status);
    }
    serde_json::from_slice(&output.stdout).context("gc printed no result")
}

pub async fn collect(location: &str) -> Result<()> {
    let log = Arc::new(Log::default());
    let store = Arc::new(Counted::new(
        skywake_core::open_store(location)?,
        log.clone(),
    ));
    let started = Instant::now();
    let collected = Repo::new(store)
        .collect_garbage(Duration::ZERO, true)
        .await?;
    let sample = Sample::of(&log, started.elapsed());
    let collection = Collection {
        ms: sample.ms,
        requests: sample.requests,
        lists: sample.lists,
        peak_bytes: peak_rss(),
        kept: collected.kept,
    };
    println!("{}", serde_json::to_string(&collection)?);
    Ok(())
}
