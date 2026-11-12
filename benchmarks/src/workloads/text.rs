//! `index-bench msmarco`: BM25 on MS MARCO passages through the production index, for quality and cold and warm latency.

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use futures::{StreamExt, TryStreamExt};
use object_store::ObjectStore;
use serde_json::json;
use skywake_index::{Doc, Id, Index, Schema, TextOptions, TextQuery};

use crate::metrics::requests::{Log, Op, waves};
use crate::metrics::{millis, nearest_rank};
use crate::results::{Row, Run, Table};
use crate::stores::{Counted, Slow};

const QUALITY_AT_ONCE: usize = 8;

#[derive(clap::Args)]
pub struct Args {
    #[arg(help = "The MS MARCO folder that `benchmarks/datasets/fetch.py get msmarco` writes")]
    dir: PathBuf,
    #[arg(
        long,
        help = "Where the index is kept between runs; by default <dir>/stores/index-<rows>"
    )]
    store: Option<PathBuf>,
    #[arg(long, help = "Use only the first passages")]
    rows: Option<usize>,
    #[arg(
        long,
        default_value_t = 50_000,
        help = "Passages per upsert while loading"
    )]
    batch: usize,
    #[arg(long, default_value_t = 0.9)]
    k1: f32,
    #[arg(long, default_value_t = 0.4)]
    b: f32,
    #[arg(
        long,
        default_value_t = 100,
        help = "Cold queries on the slow store, spread over dev small"
    )]
    cold: usize,
    #[arg(
        long,
        default_value_t = 1000,
        help = "Warm queries timed, from the start of dev small"
    )]
    warm: usize,
    #[arg(
        long,
        default_value_t = 60,
        help = "For the slow store: the wait before each request"
    )]
    latency_ms: u64,
    #[arg(
        long,
        default_value_t = 64,
        help = "For the slow store: the most requests in flight"
    )]
    in_flight: usize,
    #[arg(long, help = "The results folder; by default benchmarks/results/<run>")]
    out: Option<PathBuf>,
}

pub async fn run(args: Args) -> Result<()> {
    let label = args.rows.map_or("all".to_string(), |rows| rows.to_string());
    let folder =
        (args.store.clone()).unwrap_or_else(|| args.dir.join(format!("stores/index-{label}")));
    std::fs::create_dir_all(&folder)?;
    let raw = skywake_core::open_store(&folder.to_string_lossy())?;
    let mut run = Run::new(
        "text",
        json!({
            "dataset": args.dir.file_name().map(|n| n.to_string_lossy()),
            "rows": label,
            "batch": args.batch,
            "k1": args.k1,
            "b": args.b,
            "k": 10,
            "warm_queries": args.warm,
            "cold_queries": args.cold,
            "concurrency": { "quality": QUALITY_AT_ONCE, "timed": 1 },
            "store": {
                "warm": { "kind": "local", "latency_ms": 0 },
                "cold": { "kind": "slow", "latency_ms": args.latency_ms, "in_flight": args.in_flight },
            },
        }),
    );
    let mut report = Report::default();

    let mut setup = Vec::new();
    if Index::open(raw.clone(), skywake_index::MAIN).await.is_err() {
        let (count, load_s, build_s) = load(&args, raw.clone()).await?;
        report.line(format!(
            "load: {count} passages in {load_s:.1} s, build in {build_s:.1} s"
        ));
        setup.push(Row::new(
            "load and build",
            json!({ "passages": count, "load_s": load_s, "build_s": build_s }),
        ));
    } else {
        eprintln!("using the index in {}", folder.display());
    }
    let index = Index::open(raw.clone(), skywake_index::MAIN).await?;
    let stats = index.stats().await?;
    report.line(format!(
        "index: {} docs, {} MB, {} unindexed",
        stats.rows,
        stats.bytes >> 20,
        stats.unindexed_rows
    ));
    setup.push(Row::new(
        "index",
        json!({ "docs": stats.rows, "bytes": stats.bytes, "unindexed": stats.unindexed_rows }),
    ));

    let mut quality = Vec::new();
    for set in ["dev", "dl19"] {
        let queries = queries(&args.dir, set)?;
        let relevant = if set == "dl19" { 2 } else { 1 };
        let started = Instant::now();
        let ranked = search_all(&index, &queries.list, &args).await?;
        let (mut mrr, mut ndcg) = (0.0, 0.0);
        for ((id, _), ranked) in queries.list.iter().zip(&ranked) {
            let judged = &queries.qrels[id];
            mrr += mrr10(ranked, judged, relevant);
            ndcg += ndcg10(ranked, judged);
        }
        let n = queries.list.len() as f64;
        let seconds = started.elapsed().as_secs_f64();
        report.line(format!(
            "{set}: {} queries, MRR@10 {:.4}, nDCG@10 {:.4} ({seconds:.1} s)",
            queries.list.len(),
            mrr / n,
            ndcg / n,
        ));
        quality.push(Row::new(
            set,
            json!({ "queries": queries.list.len(), "mrr10": mrr / n, "ndcg10": ndcg / n, "seconds": seconds }),
        ));
    }

    let dev = queries(&args.dir, "dev")?;
    let mut times = Vec::new();
    for (_, text) in dev.list.iter().take(args.warm) {
        let started = Instant::now();
        index.search(&query(text, &args)).await?;
        times.push(started.elapsed());
    }
    let warm = millis(&times);
    report.line(format!(
        "warm, local, {} queries: {}",
        warm.len(),
        percentiles(&warm)
    ));
    let mut latency = vec![Row::new(
        "warm, local",
        json!({
            "queries": warm.len(),
            "p50_ms": nearest_rank(&warm, 0.5),
            "p90_ms": nearest_rank(&warm, 0.9),
            "p99_ms": nearest_rank(&warm, 0.99),
        }),
    )];
    drop(index);

    let log = Arc::new(Log::default());
    let slow = Arc::new(Slow::new(
        raw.clone(),
        Duration::from_millis(args.latency_ms),
        args.in_flight,
    ));
    let store: Arc<dyn ObjectStore> = Arc::new(Counted::new(slow, log.clone()));
    let step = (dev.list.len() / args.cold.max(1)).max(1);
    let (mut times, mut all_waves, mut gets, mut bytes) = (Vec::new(), Vec::new(), 0, 0);
    let misses = skywake_index::sync_misses();
    for (_, text) in dev.list.iter().step_by(step).take(args.cold) {
        log.take();
        let started = Instant::now();
        let index = Index::open(store.clone(), skywake_index::MAIN).await?;
        index.search(&query(text, &args)).await?;
        times.push(started.elapsed());
        let requests = log.take();
        all_waves.push(waves(&requests));
        for request in requests.iter().filter(|r| r.op == Op::Get) {
            gets += 1;
            bytes += request.bytes;
        }
    }
    let cold = millis(&times);
    let n = cold.len().max(1);
    all_waves.sort_unstable();
    let most = all_waves.last().copied().unwrap_or(0);
    let mean = all_waves.iter().sum::<usize>() as f64 / n as f64;
    let sync_misses = skywake_index::sync_misses() - misses;
    report.line(format!(
        "cold, slow ({} ms, {} in flight), {} queries: {}; waves mean {mean:.2}, most {most}; {:.1} GETs and {} KB per query; sync misses {sync_misses}",
        args.latency_ms,
        args.in_flight,
        cold.len(),
        percentiles(&cold),
        gets as f64 / n as f64,
        bytes / n as u64 / 1024,
    ));
    latency.push(Row::new(
        "cold, slow",
        json!({
            "queries": cold.len(),
            "p50_ms": nearest_rank(&cold, 0.5),
            "p90_ms": nearest_rank(&cold, 0.9),
            "p99_ms": nearest_rank(&cold, 0.99),
            "waves": mean,
            "waves_max": most,
            "gets": gets as f64 / n as f64,
            "bytes": bytes / n as u64,
            "sync_misses": sync_misses,
        }),
    ));

    run.tables = vec![
        Table::new("setup", setup),
        Table::new("quality", quality),
        Table::new("latency", latency),
    ];
    run.save(args.out.clone(), &report.0)
}

#[derive(Default)]
struct Report(String);

impl Report {
    fn line(&mut self, line: String) {
        println!("{line}");
        self.0.push_str(&line);
        self.0.push('\n');
    }
}

fn query(text: &str, args: &Args) -> TextQuery {
    TextQuery {
        k1: Some(args.k1),
        b: Some(args.b),
        ..TextQuery::new(text, 10)
    }
}

async fn load(args: &Args, raw: Arc<dyn ObjectStore>) -> Result<(usize, f64, f64)> {
    let options = TextOptions {
        k1: args.k1,
        b: args.b,
        ..TextOptions::default()
    };
    let index = Index::create(raw, Schema::new().text("body", options)).await?;
    let path = args.dir.join("collection.tsv");
    let file = File::open(&path).with_context(|| path.display().to_string())?;
    let rows = args.rows.unwrap_or(usize::MAX);
    let started = Instant::now();
    let mut batch = Vec::with_capacity(args.batch);
    let mut count = 0;
    for line in BufReader::new(file).lines().take(rows) {
        let line = line?;
        let (id, text) = line.split_once('\t').context("a passage line has no tab")?;
        batch.push(Doc::new(id.parse::<u64>()?).attribute("body", text));
        if batch.len() == args.batch {
            count += batch.len();
            index.upsert(std::mem::take(&mut batch)).await?;
            eprint!("\rloaded {count}");
        }
    }
    count += batch.len();
    index.upsert(batch).await?;
    let loaded = started.elapsed();
    eprintln!("\rloaded {count} in {:.1} s", loaded.as_secs_f64());
    let started = Instant::now();
    index.build().await?;
    Ok((count, loaded.as_secs_f64(), started.elapsed().as_secs_f64()))
}

async fn search_all(index: &Index, list: &[(u64, String)], args: &Args) -> Result<Vec<Vec<u64>>> {
    futures::stream::iter(list)
        .map(|(_, text)| async move {
            let hits = index.search(&query(text, args)).await?;
            Ok::<_, anyhow::Error>(
                (hits.into_iter())
                    .map(|hit| match hit.id {
                        Id::Num(n) => n,
                        _ => u64::MAX,
                    })
                    .collect(),
            )
        })
        .buffered(QUALITY_AT_ONCE)
        .try_collect()
        .await
}

fn percentiles(ms: &[f64]) -> String {
    format!(
        "p50 {:.1} / p90 {:.1} / p99 {:.1} ms",
        nearest_rank(ms, 0.5),
        nearest_rank(ms, 0.9),
        nearest_rank(ms, 0.99)
    )
}

struct Queries {
    list: Vec<(u64, String)>,
    qrels: HashMap<u64, HashMap<u64, u32>>,
}

fn queries(dir: &Path, set: &str) -> Result<Queries> {
    let (queries, qrels) = match set {
        "dev" => ("queries.dev.small.tsv", "qrels.dev.small.tsv"),
        _ => ("queries.dl19.tsv", "qrels.dl19.tsv"),
    };
    let mut judged: HashMap<u64, HashMap<u64, u32>> = HashMap::new();
    for line in lines(&dir.join(qrels))? {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() == 4 {
            (judged.entry(parts[0].parse()?).or_default())
                .insert(parts[2].parse()?, parts[3].parse()?);
        }
    }
    let mut list = Vec::new();
    for line in lines(&dir.join(queries))? {
        let (id, text) = line.split_once('\t').context("a query line has no tab")?;
        let id: u64 = id.parse()?;
        if judged.contains_key(&id) {
            list.push((id, text.to_string()));
        }
    }
    Ok(Queries {
        list,
        qrels: judged,
    })
}

fn lines(path: &Path) -> Result<impl Iterator<Item = String>> {
    let file = File::open(path).with_context(|| path.display().to_string())?;
    Ok(BufReader::new(file).lines().map_while(Result::ok))
}

fn mrr10(ranked: &[u64], judged: &HashMap<u64, u32>, relevant: u32) -> f64 {
    for (rank, pid) in ranked.iter().take(10).enumerate() {
        if judged.get(pid).is_some_and(|grade| *grade >= relevant) {
            return 1.0 / (rank + 1) as f64;
        }
    }
    0.0
}

fn ndcg10(ranked: &[u64], judged: &HashMap<u64, u32>) -> f64 {
    let gain = |grade: u32, rank: usize| grade as f64 / ((rank + 2) as f64).log2();
    let dcg: f64 = (ranked.iter().take(10).enumerate())
        .map(|(rank, pid)| gain(judged.get(pid).copied().unwrap_or(0), rank))
        .sum();
    let mut ideal: Vec<u32> = judged.values().copied().filter(|g| *g > 0).collect();
    ideal.sort_unstable_by(|a, b| b.cmp(a));
    let best: f64 = (ideal.iter().take(10).enumerate())
        .map(|(rank, grade)| gain(*grade, rank))
        .sum();
    if best == 0.0 { 0.0 } else { dcg / best }
}
