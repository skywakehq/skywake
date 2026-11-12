//! One run: load the rows, build, query cold and warm for each probe and filter, and time how soon a write is seen.

use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::Result;
use futures::stream::{FuturesUnordered, StreamExt};
use skywake_core::cache::ChunkCache;
use skywake_index::{Doc, Hit, Id, Index, Metric, Options, Query, Schema};

use super::report::{Pass, Report, Setup};
use crate::datasets::files::Vectors;
use crate::datasets::filters::{self, Selection, TAG};
use crate::metrics::memory::peak_rss;
use crate::metrics::requests::{Op, Request, count};
use crate::metrics::{floor_rank, millis};
use crate::progress::{self, Meter};
use crate::stores::Store;

const COLUMN: &str = "v";

const VISIBLE_TRIALS: usize = 20;
const VISIBLE_WAIT: Duration = Duration::from_secs(30);
const BUILD_HEARTBEAT: Duration = Duration::from_secs(30);

pub(super) struct Plan {
    pub k: usize,
    pub probes: Vec<Option<usize>>,
    pub selections: Vec<Selection>,
    pub cold_queries: usize,
    pub batch: usize,
    pub writers: usize,
    pub disk_cache: bool,
    pub disk_cache_gb: u64,
}

pub(super) struct Data<'a> {
    pub dir: &'a Path,
    pub rows: usize,
    pub metric: Metric,
    pub queries: &'a [Vec<f32>],
    pub truth: &'a [Vec<Vec<u32>>],
}

pub(super) async fn run(
    data: &Data<'_>,
    plan: &Plan,
    store: &Store,
    mut report: Report,
) -> Result<Report> {
    let mut base = Vectors::open(&data.dir.join("base.fbin"), Some(data.rows))?;
    let dims = base.dims;
    let schema = Schema::new()
        .vector(COLUMN, dims, data.metric)
        .attribute(TAG, skywake_index::Kind::Number)
        .filter_index(TAG);
    let loading = Options {
        unbuilt_bytes: u64::MAX,
        ..Options::default()
    };
    let index = Index::create_with(store.store.clone(), schema, loading).await?;

    let step = progress::start(
        "load",
        &format!(
            "{} rows into {}, {} writers",
            progress::count(data.rows as u64),
            store.name,
            plan.writers
        ),
    );
    let mut meter = Meter::new("load", data.rows as u64, "rows");
    let mut writing = FuturesUnordered::new();
    let writer = &index;
    let mut id = 0u64;
    loop {
        let block = base.next_block(plan.batch)?;
        if block.is_empty() {
            break;
        }
        let docs: Vec<Doc> = block
            .chunks_exact(dims)
            .map(|v| {
                id += 1;
                doc(id - 1, v.to_vec())
            })
            .collect();
        let rows = docs.len() as u64;
        writing.push(async move { writer.upsert(docs).await.map(|()| rows) });
        if writing.len() >= plan.writers {
            meter.add(writing.next().await.expect("an upsert is in flight")?);
        }
    }
    while let Some(rows) = writing.next().await {
        meter.add(rows?);
    }
    let load = step.done("");
    let load_requests = store.log.take();
    let rss_load = peak_rss();

    let step = progress::start("build", "clusters, then the cluster files");
    let log = store.log.clone();
    let heartbeat = progress::every("build", BUILD_HEARTBEAT, move || {
        let (gets, read, puts, written) = log.totals();
        format!(
            "read {} in {} requests · wrote {} in {}",
            progress::bytes(read),
            progress::count(gets),
            progress::bytes(written),
            progress::count(puts)
        )
    });
    index.build().await?;
    drop(heartbeat);
    let build_requests = store.log.take();
    let stats = index.stats().await?;
    let build = step.done(&format!(
        "{} clusters, {}",
        progress::count(stats.clusters),
        progress::bytes(stats.bytes)
    ));
    report.setup = Setup {
        load_s: load.as_secs_f64(),
        rows_per_s: data.rows as f64 / load.as_secs_f64(),
        load_puts: count(&load_requests, Op::Put),
        build_s: build.as_secs_f64(),
        build_gets: count(&build_requests, Op::Get),
        build_puts: count(&build_requests, Op::Put),
        clusters: stats.clusters,
        index_bytes: stats.bytes,
        peak_rss_load: rss_load,
        peak_rss_build: peak_rss(),
        ..Setup::default()
    };

    let folder = tempfile::Builder::new()
        .prefix("index-bench-disk-")
        .tempdir()?;
    let mut warm = vec![("warm", Options::default(), false)];
    if plan.disk_cache {
        let cache = ChunkCache::new(folder.path().into(), plan.disk_cache_gb << 30)?;
        let options = Options {
            disk: Some(Arc::new(cache)),
            ..Options::default()
        };
        warm.push(("warm+disk", options.clone(), false));
        warm.push(("warm+disk+head", options, true));
    }

    for (s, &selection) in plan.selections.iter().enumerate() {
        let probes = match selection == Selection::ALL {
            true => plan.probes.clone(),
            false => vec![None],
        };
        for probe in probes {
            let mut query = Query::new(COLUMN, Vec::new(), plan.k);
            query.probe = probe;
            query.filter = selection.filter();
            let truth = &data.truth[s];
            let cold = &data.queries[..plan.cold_queries.min(data.queries.len())];
            let what = format!("{} rows · probe {}", selection.name(), label(probe));
            let step = progress::start("cold", &format!("{what} · {} queries", cold.len()));
            let (hits, times, requests) = cold_pass(store, &query, cold).await?;
            let found = recall(plan.k, truth, &hits);
            step.done(&summary(&times, found));
            report.add(Pass::new(
                "cold", selection, probe, found, &times, &requests,
            ));
            for &(name, ref options, kept) in &warm {
                let step =
                    progress::start(name, &format!("{what} · {} queries", data.queries.len()));
                let (hits, times, requests) =
                    warm_pass(store, options, kept, &query, data.queries).await?;
                let found = recall(plan.k, truth, &hits);
                step.done(&summary(&times, found));
                report.add(Pass::new(name, selection, probe, found, &times, &requests));
            }
        }
    }

    let step = progress::start(
        "visible",
        &format!("{VISIBLE_TRIALS} writes, each read back from another handle"),
    );
    let times = visible(&index, store, data.queries, data.rows as u64).await?;
    let ms = millis(&times);
    step.done(&format!("p50 {:.1} ms", floor_rank(&ms, 0.5)));
    report.setup.visible_p50_ms = floor_rank(&ms, 0.5);
    report.setup.visible_p99_ms = floor_rank(&ms, 0.99);
    report.setup.peak_rss_end = peak_rss();
    store.log.take();
    Ok(report)
}

fn doc(id: u64, vector: Vec<f32>) -> Doc {
    let tag = filters::tag(id) as f64;
    Doc::new(id).vector(COLUMN, vector).attribute(TAG, tag)
}

fn summary(times: &[Duration], recall: f64) -> String {
    let ms = millis(times);
    format!(
        "p50 {:.1} ms · p99 {:.1} ms · recall {recall:.3}",
        floor_rank(&ms, 0.5),
        floor_rank(&ms, 0.99)
    )
}

pub(super) fn label(probe: Option<usize>) -> String {
    probe.map_or("default".to_string(), |p| p.to_string())
}

type Measured = (Vec<Vec<Hit>>, Vec<Duration>, Vec<Vec<Request>>);

async fn cold_pass(store: &Store, query: &Query, vectors: &[Vec<f32>]) -> Result<Measured> {
    let (mut hits, mut times, mut requests) = (Vec::new(), Vec::new(), Vec::new());
    for vector in vectors {
        let query = Query {
            vector: vector.clone(),
            ..query.clone()
        };
        store.log.take();
        let started = Instant::now();
        let index = Index::open(store.store.clone(), skywake_index::MAIN).await?;
        hits.push(index.query(&query).await?);
        times.push(started.elapsed());
        requests.push(store.log.take());
    }
    Ok((hits, times, requests))
}

async fn warm_pass(
    store: &Store,
    options: &Options,
    kept: bool,
    query: &Query,
    vectors: &[Vec<f32>],
) -> Result<Measured> {
    let index = Index::open_with(store.store.clone(), skywake_index::MAIN, options.clone()).await?;
    let queries: Vec<Query> = (vectors.iter())
        .map(|vector| Query {
            vector: vector.clone(),
            ..query.clone()
        })
        .collect();
    for query in &queries {
        ask(&index, kept, query).await?;
    }
    let (mut hits, mut times, mut requests) = (Vec::new(), Vec::new(), Vec::new());
    for query in &queries {
        store.log.take();
        let started = Instant::now();
        hits.push(ask(&index, kept, query).await?);
        times.push(started.elapsed());
        requests.push(store.log.take());
    }
    Ok((hits, times, requests))
}

async fn ask(index: &Index, kept: bool, query: &Query) -> Result<Vec<Hit>> {
    Ok(match kept {
        true => index.snapshot_for(0).await?.query(query).await?,
        false => index.query(query).await?,
    })
}

async fn visible(
    index: &Index,
    store: &Store,
    queries: &[Vec<f32>],
    first: u64,
) -> Result<Vec<Duration>> {
    let reader = Index::open(store.store.clone(), skywake_index::MAIN).await?;
    let mut times = Vec::new();
    for (i, vector) in queries.iter().cycle().take(VISIBLE_TRIALS).enumerate() {
        let id = first + i as u64;
        let query = Query::new(COLUMN, vector.clone(), 1);
        let started = Instant::now();
        index.upsert(vec![doc(id, vector.clone())]).await?;
        while !(reader.query(&query).await?.iter()).any(|hit| hit.id == Id::Num(id)) {
            anyhow::ensure!(
                started.elapsed() < VISIBLE_WAIT,
                "a write was not seen in time"
            );
        }
        times.push(started.elapsed());
    }
    Ok(times)
}

fn recall(k: usize, truth: &[Vec<u32>], found: &[Vec<Hit>]) -> f64 {
    let (mut hits, mut wanted) = (0, 0);
    for (truth, found) in truth.iter().zip(found) {
        let truth: HashSet<Id> = (truth.iter().take(k))
            .filter(|&&id| id != u32::MAX)
            .map(|&id| Id::Num(id as u64))
            .collect();
        wanted += truth.len();
        hits += found.iter().filter(|hit| truth.contains(&hit.id)).count();
    }
    hits as f64 / wanted.max(1) as f64
}
