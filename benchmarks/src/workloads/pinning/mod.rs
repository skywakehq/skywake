//! `pinning-load`: one index loaded through several API servers, then queried unpinned, pinned to one replica and to three.

mod api;

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::Result;
use serde::Serialize;
use serde_json::json;

use crate::datasets::random::{GOLDEN, Random};
use crate::metrics::lower_rank;
use crate::results::{Row, Run, Table};
use api::Api;

const DIMS: usize = 64;
const CENTERS: usize = 100;
const PHASES: [(&str, Option<usize>); 3] = [
    ("unpinned", None),
    ("1 replica", Some(1)),
    ("3 replicas", Some(3)),
];

#[derive(clap::Parser)]
#[command(
    about = "Queries one index through several API servers: unpinned, pinned to 1 and to 3 replicas"
)]
pub struct Args {
    #[arg(
        long,
        value_delimiter = ',',
        required = true,
        help = "The API servers; the first loads and pins"
    )]
    servers: Vec<String>,
    #[arg(long, env = "SKYWAKE_API_ADMIN_TOKEN", hide_env_values = true)]
    admin_token: String,
    #[arg(long, default_value_t = 100_000)]
    rows: usize,
    #[arg(long, default_value_t = 20, help = "Seconds of load in each phase")]
    seconds: u64,
    #[arg(long, default_value_t = 48, help = "Clients querying at once")]
    concurrency: usize,
    #[arg(long, default_value_t = 1, help = "Seed for the vectors' noise")]
    seed: u64,
    #[arg(long, help = "The results folder; by default benchmarks/results/<run>")]
    out: Option<PathBuf>,
}

#[derive(Serialize)]
struct Phase {
    phase: &'static str,
    replicas: Vec<String>,
    warm_ms: u64,
    queries: usize,
    errors: usize,
    qps: u64,
    p50_ms: f64,
    p99_ms: f64,
    answered_by: BTreeMap<String, usize>,
    only_replicas: bool,
    temperature: BTreeMap<String, usize>,
}

#[derive(Default)]
struct Seen {
    latencies: Vec<f64>,
    errors: usize,
    answered_by: BTreeMap<String, usize>,
    temperature: BTreeMap<String, usize>,
}

pub async fn run(args: Args) -> Result<()> {
    let millis = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64;
    let mut api = Api::new(
        args.admin_token.clone(),
        format!("bench-{}", base36(millis)),
    );
    let first = args.servers[0].clone();
    let seed = args.seed;
    api.load(&first, args.rows, DIMS, |id| vector(seed, id))
        .await?;

    let mut phases = Vec::new();
    for (name, replicas) in PHASES {
        let phase = phase(&api, &args, name, replicas).await?;
        println!("{}", serde_json::to_string(&phase)?);
        phases.push(phase);
    }
    api.delete(&first).await?;

    let report = format!(
        "{} rows, {DIMS} dims, {} clients, {} s per phase\n\n{}",
        args.rows,
        args.concurrency,
        args.seconds,
        table(&phases)
    );
    println!("\n{report}");
    let mut run = Run::new(
        "pinning",
        json!({
            "servers": args.servers.len(),
            "rows": args.rows,
            "dims": DIMS,
            "payload_bytes_per_row": DIMS * 4,
            "concurrency": args.concurrency,
            "seconds_per_phase": args.seconds,
            "seed": args.seed,
            "top_k": 10,
            "consistency": "eventual",
            "store": {
                "location": std::env::var("SKYWAKE_STORE").unwrap_or_default(),
                "endpoint": std::env::var("AWS_ENDPOINT").unwrap_or_default(),
                "latency_ms": 0,
            },
        }),
    );
    let rows = (phases.iter())
        .map(|phase| Ok(Row::new(phase.phase, serde_json::to_value(phase)?)))
        .collect::<Result<_>>()?;
    run.tables = vec![Table::new("phases", rows)];
    run.save(args.out, &report)
}

async fn phase(
    api: &Api,
    args: &Args,
    name: &'static str,
    replicas: Option<usize>,
) -> Result<Phase> {
    let placed = api.pin(&args.servers[0], replicas).await?;
    let until = Instant::now() + Duration::from_secs(args.seconds);
    let servers = Arc::new(args.servers.clone());
    let clients = (0..args.concurrency).map(|n| {
        let (api, servers) = (api.clone(), servers.clone());
        let (concurrency, seed) = (args.concurrency, args.seed);
        tokio::spawn(async move {
            let mut seen = Seen::default();
            let mut i = n;
            while Instant::now() < until {
                let server = &servers[i % servers.len()];
                let started = Instant::now();
                match api.query(server, vector(seed + 1, i)).await {
                    Ok(answer) => {
                        seen.latencies.push(started.elapsed().as_secs_f64() * 1e3);
                        let by = answer.server.unwrap_or_else(|| format!("entry {server}"));
                        *seen.answered_by.entry(by).or_default() += 1;
                        *seen.temperature.entry(answer.temperature).or_default() += 1;
                    }
                    Err(_) => seen.errors += 1,
                }
                i += concurrency;
            }
            seen
        })
    });
    let mut all = Seen::default();
    for client in futures::future::join_all(clients).await {
        let seen = client?;
        all.latencies.extend(seen.latencies);
        all.errors += seen.errors;
        for (by, n) in seen.answered_by {
            *all.answered_by.entry(by).or_default() += n;
        }
        for (temperature, n) in seen.temperature {
            *all.temperature.entry(temperature).or_default() += n;
        }
    }
    let only_replicas =
        replicas.is_none() || (all.answered_by.keys()).all(|by| placed.replicas.contains(by));
    Ok(Phase {
        phase: name,
        warm_ms: placed.warm_ms,
        queries: all.latencies.len(),
        errors: all.errors,
        qps: (all.latencies.len() as f64 / args.seconds as f64).round() as u64,
        p50_ms: lower_rank(&all.latencies, 0.5),
        p99_ms: lower_rank(&all.latencies, 0.99),
        replicas: placed.replicas,
        answered_by: all.answered_by,
        only_replicas,
        temperature: all.temperature,
    })
}

fn vector(stream: u64, id: usize) -> Vec<f32> {
    let center = (id % CENTERS) as f32;
    let mut noise = Random(stream.wrapping_mul(GOLDEN) ^ id as u64);
    (0..DIMS)
        .map(|d| (center * 7.0 + d as f32).sin() + noise.unit() as f32 * 0.1)
        .collect()
}

fn table(phases: &[Phase]) -> String {
    let mut lines = vec![
        "| Phase | Replicas | QPS | p50 ms | p99 ms | Errors | Only replicas answered | Temperature |".to_string(),
        "| --- | --- | --- | --- | --- | --- | --- | --- |".to_string(),
    ];
    for p in phases {
        let pinned = !p.replicas.is_empty();
        let temperature: Vec<String> = (p.temperature.iter())
            .map(|(t, n)| format!("{t} {n}"))
            .collect();
        lines.push(format!(
            "| {} | {} | {} | {} | {} | {} | {} | {} |",
            p.phase,
            match pinned {
                true => p.replicas.len().to_string(),
                false => "-".to_string(),
            },
            p.qps,
            p.p50_ms,
            p.p99_ms,
            p.errors,
            match (pinned, p.only_replicas) {
                (false, _) => "-",
                (true, true) => "yes",
                (true, false) => "no",
            },
            temperature.join(", ")
        ));
    }
    lines.join("\n")
}

fn base36(mut n: u64) -> String {
    let mut digits = Vec::new();
    loop {
        digits.push(std::char::from_digit((n % 36) as u32, 36).unwrap_or('0'));
        n /= 36;
        if n == 0 {
            break;
        }
    }
    digits.iter().rev().collect()
}
