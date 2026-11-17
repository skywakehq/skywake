use std::time::{Duration, Instant};

use anyhow::{Result, ensure};
use futures::stream::{FuturesUnordered, StreamExt};
use skywake_index::{Index, Options, Reads, Snapshot, Value, counted};

use super::data::{Ask, Family, doc, schema};
use super::report::{Answer, Pass, Setup, Temperature};
use crate::metrics::memory::peak_rss;
use crate::metrics::requests::{Op, Request, count};
use crate::progress::{self, Meter};
use crate::stores::Store;

pub(super) struct Plan {
    pub rows: u64,
    pub dims: usize,
    pub families: Vec<Family>,
    pub hot: usize,
    pub cold: usize,
    pub temperatures: Vec<Temperature>,
    pub batch: usize,
    pub writers: usize,
    pub cache_bytes: usize,
    pub qps: Option<f64>,
    pub seconds: u64,
}

pub(super) async fn load(store: &Store, plan: &Plan) -> Result<Setup> {
    let options = Options {
        unbuilt_bytes: u64::MAX,
        ..Options::default()
    };
    let index = Index::create_with(store.store.clone(), schema(plan.dims), options).await?;
    let step = progress::start(
        "load",
        &format!("{} rows into {}", progress::count(plan.rows), store.name),
    );
    let mut meter = Meter::new("load", plan.rows, "rows");
    let mut writing = FuturesUnordered::new();
    let writer = &index;
    let dims = plan.dims;
    for start in (0..plan.rows).step_by(plan.batch) {
        let end = (start + plan.batch as u64).min(plan.rows);
        writing.push(async move {
            let docs = (start..end).map(|id| doc(id, dims)).collect();
            writer.upsert(docs).await.map(|()| end - start)
        });
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

    let step = progress::start("build", "");
    index.build().await?;
    let build_requests = store.log.take();
    let stats = index.stats().await?;
    let build = step.done(&progress::bytes(stats.bytes));
    Ok(Setup {
        load_s: load.as_secs_f64(),
        rows_per_s: plan.rows as f64 / load.as_secs_f64(),
        load_puts: count(&load_requests, Op::Put),
        build_s: build.as_secs_f64(),
        build_gets: count(&build_requests, Op::Get),
        build_puts: count(&build_requests, Op::Put),
        index_bytes: stats.bytes,
        clusters: stats.clusters,
        peak_rss_load: rss_load,
        peak_rss_build: peak_rss(),
        peak_rss_end: 0,
    })
}

pub(super) async fn measure(store: &Store, plan: &Plan) -> Result<Vec<Pass>> {
    let options = Options {
        cache_bytes: plan.cache_bytes,
        ..Options::default()
    };
    let index = Index::open_with(store.store.clone(), skywake_index::MAIN, options).await?;
    let mut passes = Vec::new();
    for &family in &plan.families {
        for &temperature in &plan.temperatures {
            let queries = match temperature {
                Temperature::Cold => plan.cold,
                _ => plan.hot,
            };
            let what = format!(
                "{} · {} · {queries} queries",
                family.name(),
                temperature.name()
            );
            let step = progress::start("query", &what);
            let samples = match (temperature, plan.qps) {
                (Temperature::Cold, _) => cold(store, family, queries).await?,
                (_, Some(qps)) => open_loop(&index, temperature, family, qps, plan.seconds).await?,
                _ => hot(&index, store, temperature, family, queries).await?,
            };
            check(family, plan.rows, &samples)?;
            let pass = Pass::new(family, temperature, &samples);
            step.done(&pass.summary());
            passes.push(pass);
        }
    }
    Ok(passes)
}

pub(super) struct Sample {
    pub time: Duration,
    pub requests: Vec<Request>,
    pub reads: Reads,
    pub answer: Answer,
}

async fn hot(
    index: &Index,
    store: &Store,
    temperature: Temperature,
    family: Family,
    queries: usize,
) -> Result<Vec<Sample>> {
    for n in 0..queries as u64 {
        ask(&index.snapshot().await?, &family.ask(n)).await?;
    }
    let mut samples = Vec::new();
    for n in 0..queries as u64 {
        let question = family.ask(n);
        store.log.take();
        let started = Instant::now();
        let (answer, reads) = counted(async {
            let snapshot = snapshot(index, temperature).await?;
            ask(&snapshot, &question).await
        })
        .await;
        samples.push(Sample {
            time: started.elapsed(),
            requests: store.log.take(),
            reads,
            answer: answer?,
        });
    }
    Ok(samples)
}

async fn cold(store: &Store, family: Family, queries: usize) -> Result<Vec<Sample>> {
    let mut samples = Vec::new();
    for n in 0..queries as u64 {
        let question = family.ask(n);
        store.log.take();
        let started = Instant::now();
        let (answer, reads) = counted(async {
            let index = Index::open(store.store.clone(), skywake_index::MAIN).await?;
            ask(&index.snapshot().await?, &question).await
        })
        .await;
        samples.push(Sample {
            time: started.elapsed(),
            requests: store.log.take(),
            reads,
            answer: answer?,
        });
    }
    Ok(samples)
}

async fn open_loop(
    index: &Index,
    temperature: Temperature,
    family: Family,
    qps: f64,
    seconds: u64,
) -> Result<Vec<Sample>> {
    let total = (qps * seconds as f64).ceil() as u64;
    for n in 0..total.min(64) {
        ask(&index.snapshot().await?, &family.ask(n)).await?;
    }
    let interval = Duration::from_secs_f64(1.0 / qps);
    let start = tokio::time::Instant::now();
    let mut running = FuturesUnordered::new();
    for n in 0..total {
        let due = start + interval * n as u32;
        running.push(async move {
            tokio::time::sleep_until(due).await;
            let question = family.ask(n);
            let (answer, reads) = counted(async {
                let snapshot = snapshot(index, temperature).await?;
                ask(&snapshot, &question).await
            })
            .await;
            Ok::<_, anyhow::Error>(Sample {
                time: due.elapsed(),
                requests: Vec::new(),
                reads,
                answer: answer?,
            })
        });
    }
    let mut samples = Vec::new();
    while let Some(sample) = running.next().await {
        samples.push(sample?);
    }
    Ok(samples)
}

async fn snapshot(index: &Index, temperature: Temperature) -> skywake_index::Result<Snapshot> {
    match temperature {
        Temperature::Hot => index.snapshot_for(0).await,
        _ => index.snapshot().await,
    }
}

async fn ask(snapshot: &Snapshot, ask: &Ask) -> Result<Answer> {
    Ok(match ask {
        Ask::Aggregate(aggregate) => {
            let groups = snapshot.aggregate(aggregate).await?;
            let counts = groups.iter().map(|group| match group.values.get("n") {
                Some(Value::Int(n)) => *n as u64,
                _ => 0,
            });
            Answer::Counts {
                groups: groups.len(),
                total: counts.sum(),
            }
        }
        Ask::Order(order) => Answer::Rows(snapshot.order(order).await?.len()),
    })
}

fn check(family: Family, rows: u64, samples: &[Sample]) -> Result<()> {
    for sample in samples {
        let ok = match (family, &sample.answer) {
            (Family::Count | Family::Grouped, Answer::Counts { total, .. }) => *total == rows,
            (Family::Grouped, _) => false,
            (Family::Order | Family::OrderFiltered, Answer::Rows(found)) => *found == 10,
            (_, Answer::Counts { total, .. }) => *total > 0 && *total < rows,
            _ => false,
        };
        ensure!(ok, "{} answered {:?}", family.name(), sample.answer);
    }
    Ok(())
}
