mod data;
mod passes;
mod report;

use std::path::PathBuf;

use anyhow::{Result, anyhow};
use serde_json::json;

use crate::metrics::memory::peak_rss;
use crate::progress;
use crate::results::Run;
use crate::stores::{Options, Store};
use data::Family;
use passes::Plan;
use report::{Report, Temperature};

#[derive(clap::Args)]
pub struct Args {
    #[arg(long, default_value_t = 1_000_000, help = "Rows to load")]
    rows: u64,
    #[arg(
        long,
        default_value_t = 64,
        help = "Dimensions of a random vector column; 0 for none"
    )]
    dims: usize,
    #[arg(
        long,
        default_value = "count,count-eq,count-and,grouped,grouped-filtered,order,order-filtered",
        value_delimiter = ',',
        help = "Query families to run"
    )]
    families: Vec<String>,
    #[arg(
        long,
        default_value = "hot,hot+head,cold",
        value_delimiter = ',',
        help = "hot (the head held), hot+head (the head read per query), cold (a fresh index per query)"
    )]
    temperatures: Vec<String>,
    #[arg(long, default_value_t = 20, help = "Queries per family for hot passes")]
    hot: usize,
    #[arg(long, default_value_t = 3, help = "Queries per family for cold passes")]
    cold: usize,
    #[arg(
        long,
        help = "Run hot passes open loop at this rate instead of one at a time"
    )]
    qps: Option<f64>,
    #[arg(long, default_value_t = 60, help = "Seconds of each open-loop pass")]
    seconds: u64,
    #[arg(long, default_value_t = 8, help = "GiB of memory cache for hot passes")]
    cache_gb: usize,
    #[arg(long, default_value_t = 10_000, help = "Rows per upsert while loading")]
    batch: usize,
    #[arg(long, default_value_t = 8, help = "Upserts in flight while loading")]
    writers: usize,
    #[arg(long, help = "Build column pages (engine v2 storage)")]
    columns: bool,
    #[command(flatten)]
    store: Options,
    #[arg(long, help = "The results folder; by default benchmarks/results/<run>")]
    out: Option<PathBuf>,
}

pub async fn run(args: Args) -> Result<()> {
    if let Some(out) = &args.out {
        progress::record_to(&out.join("events.jsonl"))?;
    }
    let families = (args.families.iter())
        .map(|f| Family::parse(f).ok_or_else(|| anyhow!("no query family `{f}`")))
        .collect::<Result<Vec<_>>>()?;
    let temperatures = (args.temperatures.iter())
        .map(|t| Temperature::parse(t).ok_or_else(|| anyhow!("no temperature `{t}`")))
        .collect::<Result<Vec<_>>>()?;
    let plan = Plan {
        rows: args.rows,
        dims: args.dims,
        families,
        hot: args.hot,
        cold: args.cold,
        temperatures,
        batch: args.batch.max(1),
        writers: args.writers.max(1),
        cache_bytes: args.cache_gb << 30,
        qps: args.qps,
        seconds: args.seconds,
        columns: args.columns,
    };
    let store = Store::open(&args.store)?;
    let mut run = Run::new(
        "attrs",
        json!({
            "rows": args.rows,
            "dims": args.dims,
            "families": args.families,
            "temperatures": args.temperatures,
            "hot_queries": args.hot,
            "cold_queries": args.cold,
            "qps": args.qps,
            "seconds": args.seconds,
            "cache_gb": args.cache_gb,
            "batch": args.batch,
            "writers": args.writers,
            "columns": args.columns,
            "store": store.settings,
        }),
    );
    let name = store.name.clone();
    let result = async {
        let setup = passes::load(&store, &plan).await?;
        let passes = passes::measure(&store, &plan).await?;
        Ok::<_, anyhow::Error>((setup, passes))
    }
    .await;
    if let Err(e) = store.remove().await {
        progress::note("cleanup", &format!("could not delete the test index: {e}"));
    }
    let (mut setup, passes) = result?;
    setup.peak_rss_end = peak_rss();
    let report = Report {
        rows: args.rows,
        dims: args.dims,
        store: name,
        commit: run.environment.commit_label(),
        open_loop: args.qps,
        setup,
        passes,
    };
    let markdown = report.markdown();
    println!("{markdown}");
    run.tables = report.tables();
    run.save(args.out, &markdown)
}
