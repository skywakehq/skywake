//! `index-bench run`: load a dataset into a fresh index, build it, and measure recall, latency, requests and waves.

mod passes;
mod report;

use std::path::PathBuf;

use anyhow::{Context, Result, bail};
use serde_json::json;
use skywake_index::Metric;

use crate::datasets::filters::Selection;
use crate::datasets::{files, manifest, truth};
use crate::progress;
use crate::results::Run;
use crate::stores::{Options, Store};
use passes::{Data, Plan};
use report::Report;

#[derive(clap::Args)]
pub struct Args {
    #[arg(
        help = "The dataset folder: base.fbin, query.fbin, and optionally groundtruth.ibin and metric"
    )]
    dir: PathBuf,
    #[arg(
        long,
        help = "cosine, euclidean or dot; by default the dataset's `metric` file"
    )]
    metric: Option<String>,
    #[arg(long, help = "Use only the first rows of the base set")]
    rows: Option<usize>,
    #[arg(
        long,
        default_value_t = 1000,
        help = "Queries for warm passes, from the start of the query set"
    )]
    queries: usize,
    #[arg(
        long,
        default_value_t = 100,
        help = "Queries for cold passes, a prefix of the warm ones"
    )]
    cold_queries: usize,
    #[arg(short, long, default_value_t = 10)]
    k: usize,
    #[arg(
        long,
        default_value = "default,16,32,128",
        value_delimiter = ',',
        help = "Clusters read per query; `default` is the index's choice"
    )]
    probes: Vec<String>,
    #[arg(
        long,
        default_value = "50,10,1,0.1",
        value_delimiter = ',',
        help = "Filtered passes, as the percent of rows that pass; `none` for none"
    )]
    filters: Vec<String>,
    #[command(flatten)]
    store: Options,
    #[arg(long, default_value_t = 2000, help = "Rows per upsert while loading")]
    batch: usize,
    #[arg(long, default_value_t = 8, help = "Upserts in flight while loading")]
    writers: usize,
    #[arg(
        long,
        help = "Also run warm passes through a chunk cache on disk, reported as warm+disk, and as warm+disk+head with the head kept as the API keeps it"
    )]
    disk_cache: bool,
    #[arg(long, default_value_t = 10, help = "The disk cache's size in GiB")]
    disk_cache_gb: u64,
    #[arg(long, help = "The results folder; by default benchmarks/results/<run>")]
    out: Option<PathBuf>,
}

pub async fn run(args: Args) -> Result<()> {
    if let Some(out) = &args.out {
        progress::record_to(&out.join("events.jsonl"))?;
    }
    let metric = match &args.metric {
        Some(metric) => metric.clone(),
        None => std::fs::read_to_string(args.dir.join("metric"))
            .context("no --metric and no `metric` file in the dataset")?,
    };
    let metric = parse_metric(metric.trim())?;
    let base = files::Vectors::open(&args.dir.join("base.fbin"), args.rows)?;
    let queries = files::read_vectors(&args.dir.join("query.fbin"), Some(args.queries))?;
    let mut selections = vec![Selection::ALL];
    for filter in args.filters.iter().filter(|f| *f != "none") {
        selections.push(Selection::percent(filter)?);
    }
    progress::note(
        "plan",
        &format!(
            "{} · {} rows × {} dims · {} warm / {} cold queries · probes {} · filters {}",
            args.dir.display(),
            progress::count(base.rows as u64),
            base.dims,
            queries.len(),
            args.cold_queries.min(queries.len()),
            args.probes.join(","),
            args.filters.join(",")
        ),
    );
    let truth = truth::load(&args.dir, base.rows, metric, &queries, &selections)?;
    let probes = (args.probes.iter())
        .map(|p| match p.as_str() {
            "default" => Ok(None),
            p => Ok(Some(p.parse()?)),
        })
        .collect::<Result<_>>()?;
    let plan = Plan {
        k: args.k,
        probes,
        selections,
        cold_queries: args.cold_queries,
        batch: args.batch,
        writers: args.writers.max(1),
        disk_cache: args.disk_cache,
        disk_cache_gb: args.disk_cache_gb,
    };
    let store = Store::open(&args.store)?;
    let dataset = (args.dir.file_name()).map_or(String::new(), |n| n.to_string_lossy().into());
    let metric_name = format!("{metric:?}").to_lowercase();
    let cold_queries = args.cold_queries.min(queries.len());
    let mut run = Run::new(
        "index",
        json!({
            "dataset": dataset,
            "source": manifest(&args.dir),
            "rows": base.rows,
            "dims": base.dims,
            "payload_bytes_per_row": base.dims * 4,
            "metric": metric_name,
            "k": args.k,
            "queries": queries.len(),
            "cold_queries": cold_queries,
            "probes": args.probes,
            "filters": args.filters,
            "batch": args.batch,
            "writers": args.writers,
            "disk_cache": args.disk_cache,
            "disk_cache_gb": args.disk_cache_gb,
            "concurrency": 1,
            "store": store.settings,
        }),
    );
    let report = Report {
        dataset,
        store: store.name.clone(),
        commit: run.environment.commit_label(),
        rows: base.rows,
        dims: base.dims,
        metric: metric_name,
        k: args.k,
        queries: queries.len(),
        cold_queries,
        ..Report::default()
    };
    let data = Data {
        dir: &args.dir,
        rows: base.rows,
        metric,
        queries: &queries,
        truth: &truth,
    };
    let result = passes::run(&data, &plan, &store, report).await;
    // A failed cleanup must not lose the results.
    if let Err(e) = store.remove().await {
        progress::note("cleanup", &format!("could not delete the test index: {e}"));
    }
    let report = result?;

    let markdown = report.markdown();
    println!("{markdown}");
    run.tables = report.tables();
    run.save(args.out, &markdown)
}

fn parse_metric(name: &str) -> Result<Metric> {
    Ok(match name {
        "cosine" | "angular" => Metric::Cosine,
        "euclidean" | "l2" => Metric::Euclidean,
        "dot" | "ip" => Metric::Dot,
        other => bail!("unknown metric `{other}`"),
    })
}
