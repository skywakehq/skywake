mod vectors;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result, anyhow, bail, ensure};
use futures::stream::{FuturesUnordered, StreamExt};
use reqwest::{Client, Method};
use serde_json::{Map, Value as Json, json};
use skywake_index::{Doc, Filter, Id, Value};

use super::attrs::data::{Ask, CATEGORY, CREATED, Family, GROUP, POPULARITY, VECTOR};
use crate::metrics::{millis, nearest_rank};
use crate::progress::{self, Meter};
use crate::results::{Row, Run, Table};

#[derive(clap::Args)]
pub struct Args {
    #[arg(
        long,
        default_value = "http://127.0.0.1:8080",
        help = "The API's address"
    )]
    url: String,
    #[arg(long, default_value_t = 1_000_000, help = "Rows to load")]
    rows: u64,
    #[arg(long, default_value_t = 64, help = "Dimensions of the vector column")]
    dims: usize,
    #[arg(
        long,
        default_value = "count,count-eq,count-and,grouped,grouped-filtered,order,order-filtered",
        value_delimiter = ',',
        help = "Query families to run; `vector` and `vector-filtered` search the vector column"
    )]
    families: Vec<String>,
    #[arg(
        long,
        default_value_t = 10,
        help = "Nearest neighbors a vector search returns"
    )]
    k: usize,
    #[arg(
        long,
        default_value_t = 100,
        help = "Vector queries checked against exact search for recall, 0 for none"
    )]
    recall: u64,
    #[arg(
        long,
        help = "Load vectors from this dataset folder's base.fbin instead of generating them; --rows caps them and --dims follows the file"
    )]
    dataset: Option<PathBuf>,
    #[arg(
        long,
        value_enum,
        default_value = "uniform",
        help = "Query vectors: `uniform` draws each number from [0, 1), as turbopuffer's benchmark does; `normal` from a standard normal"
    )]
    probes: vectors::Probes,
    #[arg(long, default_value_t = 8.0, help = "Queries a second, open loop")]
    qps: f64,
    #[arg(long, default_value_t = 60, help = "Seconds of each family's pass")]
    seconds: u64,
    #[arg(
        long,
        default_value_t = 10,
        help = "Seconds of queries before each pass, not measured"
    )]
    warm: u64,
    #[arg(long, default_value_t = 5_000, value_parser = clap::value_parser!(u64).range(1..=10_000), help = "Rows per upsert while loading, at most 10,000")]
    batch: u64,
    #[arg(long, default_value_t = 4, help = "Upserts in flight while loading")]
    writers: usize,
    #[arg(
        long,
        default_value_t = 30,
        help = "Seconds the index's size must hold still to count as built"
    )]
    settle: u64,
    #[arg(long, help = "Use this index instead of loading a new one")]
    index: Option<String>,
    #[arg(long, help = "The results folder; by default benchmarks/results/<run>")]
    out: Option<PathBuf>,
}

struct Api {
    client: Client,
    url: String,
    key: String,
}

impl Api {
    async fn connect(url: &str) -> Result<Self> {
        let client = Client::builder().pool_max_idle_per_host(64).build()?;
        let url = url.trim_end_matches('/').to_string();
        let key = match std::env::var("SKYWAKE_API_KEY") {
            Ok(key) if !key.is_empty() => key,
            _ => {
                let admin = std::env::var("SKYWAKE_API_ADMIN_TOKEN").context(
                    "set SKYWAKE_API_KEY, or SKYWAKE_API_ADMIN_TOKEN to make an organization",
                )?;
                let made = client
                    .post(format!("{url}/v1/orgs"))
                    .bearer_auth(admin)
                    .json(&json!({ "name": format!("bench-{}", stamp()) }))
                    .send()
                    .await?;
                ensure!(
                    made.status().is_success(),
                    "making an organization: {}",
                    made.status()
                );
                let made: Json = made.json().await?;
                made["key"]
                    .as_str()
                    .context("the organization came with no key")?
                    .to_string()
            }
        };
        Ok(Self { client, url, key })
    }

    async fn call(&self, method: Method, path: &str, body: Option<&Json>) -> Result<Json> {
        let mut request = self
            .client
            .request(method, format!("{}/v2{path}", self.url))
            .bearer_auth(&self.key);
        if let Some(body) = body {
            request = request.json(body);
        }
        let response = request.send().await?;
        let status = response.status();
        let text = response.text().await?;
        if !status.is_success() {
            bail!(
                "{path}: {status}: {}",
                text.chars().take(300).collect::<String>()
            );
        }
        Ok(match text.is_empty() {
            true => Json::Null,
            false => serde_json::from_str(&text)?,
        })
    }
}

pub async fn run(mut args: Args) -> Result<()> {
    if let Some(out) = &args.out {
        progress::record_to(&out.join("events.jsonl"))?;
    }
    let families = (args.families.iter())
        .map(|f| Kind::parse(f).ok_or_else(|| anyhow!("no query family `{f}`")))
        .collect::<Result<Vec<_>>>()?;
    let source = vectors::Source::open(args.dataset.as_deref(), args.rows, args.dims)?;
    (args.rows, args.dims) = (source.rows, source.dims);
    let api = Arc::new(Api::connect(&args.url).await?);
    let mut run = Run::new(
        "attrs-api",
        json!({
            "rows": args.rows,
            "dims": args.dims,
            "families": args.families,
            "k": args.k,
            "recall": args.recall,
            "dataset": args.dataset,
            "probes": format!("{:?}", args.probes).to_lowercase(),
            "qps": args.qps,
            "seconds": args.seconds,
            "warm": args.warm,
            "batch": args.batch,
            "writers": args.writers,
            "url": args.url,
        }),
    );
    let name = match &args.index {
        Some(name) => name.clone(),
        None => load(&api, &args, source).await?,
    };
    let truth = exact(&families, &args).await?;
    let mut rows = Vec::new();
    let mut report = format!(
        "# Through the API: {} rows, {}-d vectors\n\nTimed at the client, over HTTP. Open loop at {} QPS for {} s a family, after {} s of warm-up · commit {}\n\n| Query | n | errors | p50 ms | p90 ms | p99 ms | recall@k |\n|---|--:|--:|--:|--:|--:|--:|\n",
        progress::count(args.rows),
        args.dims,
        args.qps,
        args.seconds,
        args.warm,
        run.environment.commit_label()
    );
    for family in families {
        let step = progress::start("query", family.name());
        let shape = Shape {
            family,
            dims: args.dims,
            k: args.k,
            probes: args.probes,
        };
        pass(&api, &name, shape, args.qps, args.warm).await?;
        let (times, errors) = pass(&api, &name, shape, args.qps, args.seconds).await?;
        let recall = match (&truth, family) {
            (Some(truth), Kind::Vector { filtered }) => {
                let truth = match filtered {
                    true => &truth.filtered,
                    false => &truth.all,
                };
                Some(recall(&api, &name, shape, truth).await?)
            }
            _ => None,
        };
        let shown = recall.map_or("–".to_string(), |r| format!("{r:.3}"));
        let ms = millis(&times);
        let (p50, p90, p99) = (
            nearest_rank(&ms, 0.5),
            nearest_rank(&ms, 0.9),
            nearest_rank(&ms, 0.99),
        );
        step.done(&format!(
            "p50 {p50:.1} ms · p90 {p90:.1} ms · recall {shown} · {errors} errors"
        ));
        report.push_str(&format!(
            "| {} | {} | {errors} | {p50:.1} | {p90:.1} | {p99:.1} | {shown} |\n",
            family.name(),
            ms.len()
        ));
        rows.push(Row::new(
            format!("{} · api", family.name()),
            json!({ "queries": ms.len(), "errors": errors, "p50_ms": p50, "p90_ms": p90, "p99_ms": p99, "recall": recall }),
        ));
    }
    println!("{report}");
    run.tables = vec![Table::new("attrs api queries", rows)];
    run.save(args.out, &report)
}

#[derive(Clone, Copy)]
enum Kind {
    Attrs(Family),
    Vector { filtered: bool },
}

impl Kind {
    fn parse(text: &str) -> Option<Kind> {
        match text {
            "vector" => Some(Kind::Vector { filtered: false }),
            "vector-filtered" => Some(Kind::Vector { filtered: true }),
            other => Family::parse(other).map(Kind::Attrs),
        }
    }

    fn name(self) -> &'static str {
        match self {
            Kind::Attrs(family) => family.name(),
            Kind::Vector { filtered: false } => "vector search, top k",
            Kind::Vector { filtered: true } => "vector search, top k, category = c (1%)",
        }
    }
}

#[derive(Clone, Copy)]
struct Shape {
    family: Kind,
    dims: usize,
    k: usize,
    probes: vectors::Probes,
}

impl Shape {
    fn request(self, name: &str, n: u64) -> (Method, String, Json) {
        match self.family {
            Kind::Attrs(family) => request(name, family.ask(n)),
            Kind::Vector { filtered } => (
                Method::POST,
                format!("/indexes/{name}/query"),
                vectors::body(n, self.dims, self.k, filtered, self.probes),
            ),
        }
    }
}

async fn exact(families: &[Kind], args: &Args) -> Result<Option<vectors::Truth>> {
    let searched = families.iter().any(|f| matches!(f, Kind::Vector { .. }));
    if !searched || args.recall == 0 {
        return Ok(None);
    }
    let step = progress::start(
        "truth",
        &format!("exact search for {} queries", args.recall),
    );
    let source = vectors::Source::open(args.dataset.as_deref(), args.rows, args.dims)?;
    let (k, queries, probes) = (args.k, args.recall, args.probes);
    let truth =
        tokio::task::spawn_blocking(move || vectors::truth(source, k, queries, probes)).await??;
    step.done("");
    Ok(Some(truth))
}

async fn recall(api: &Api, name: &str, shape: Shape, truth: &[Vec<u64>]) -> Result<f64> {
    let mut total = 0.0;
    for (n, truth) in truth.iter().enumerate() {
        let (method, path, body) = shape.request(name, n as u64);
        let answer = api.call(method, &path, Some(&body)).await?;
        total += vectors::recall(&vectors::ids(&answer), truth);
    }
    Ok(total / truth.len().max(1) as f64)
}

async fn load(api: &Api, args: &Args, mut source: vectors::Source) -> Result<String> {
    let name = format!("bench-{}", stamp());
    api.call(
        Method::POST,
        "/indexes",
        Some(&json!({ "name": name, "schema": schema(args.dims) })),
    )
    .await?;
    let step = progress::start(
        "load",
        &format!("{} rows into {name}", progress::count(args.rows)),
    );
    let mut meter = Meter::new("load", args.rows, "rows");
    let path = format!("/indexes/{name}/rows");
    let mut writing = FuturesUnordered::new();
    loop {
        let docs = source.next_block(args.batch as usize)?;
        if docs.is_empty() {
            break;
        }
        let path = &path;
        writing.push(async move {
            let rows: Vec<Json> = docs.iter().map(row).collect();
            api.call(Method::POST, path, Some(&Json::Array(rows)))
                .await?;
            Ok::<_, anyhow::Error>(docs.len() as u64)
        });
        if writing.len() >= args.writers.max(1) {
            meter.add(writing.next().await.expect("an upsert is in flight")?);
        }
    }
    while let Some(rows) = writing.next().await {
        meter.add(rows?);
    }
    step.done("");
    let step = progress::start("build", "waiting for the index to stop changing");
    let mut last = Json::Null;
    let mut still = Instant::now();
    loop {
        tokio::time::sleep(Duration::from_secs(2)).await;
        let info = api
            .call(Method::GET, &format!("/indexes/{name}"), None)
            .await?;
        let size = json!([info["rows"], info["bytes"]]);
        if size != last {
            (last, still) = (size, Instant::now());
        } else if still.elapsed() >= Duration::from_secs(args.settle) {
            break;
        }
    }
    step.done(&format!("{} bytes", last[1]));
    Ok(name)
}

async fn pass(
    api: &Arc<Api>,
    name: &str,
    shape: Shape,
    qps: f64,
    seconds: u64,
) -> Result<(Vec<Duration>, usize)> {
    let total = (qps * seconds as f64).ceil() as u64;
    let interval = Duration::from_secs_f64(1.0 / qps);
    let start = tokio::time::Instant::now();
    let asked: Vec<_> = (0..total)
        .map(|n| {
            let (api, name) = (api.clone(), name.to_string());
            let due = start + interval * n as u32;
            tokio::spawn(async move {
                tokio::time::sleep_until(due).await;
                let (method, path, body) = shape.request(&name, n);
                let sent = Instant::now();
                let answer = api.call(method, &path, Some(&body)).await;
                (
                    sent.elapsed(),
                    answer.and_then(|answer| check(shape.family, &answer)),
                )
            })
        })
        .collect();
    let (mut times, mut errors) = (Vec::new(), 0);
    for asked in asked {
        let (time, answer) = asked.await?;
        match answer {
            Ok(()) => times.push(time),
            Err(e) => {
                errors += 1;
                if errors == 1 {
                    progress::note("query", &format!("{}: {e}", shape.family.name()));
                }
            }
        }
    }
    Ok((times, errors))
}

fn request(name: &str, ask: Ask) -> (Method, String, Json) {
    match ask {
        Ask::Aggregate(aggregate) => {
            let mut body = Map::new();
            if let Some(filter) = &aggregate.filter {
                body.insert("filter".into(), filter_json(filter));
            }
            match aggregate.group_by.as_slice() {
                [] => (
                    Method::POST,
                    format!("/indexes/{name}/count"),
                    Json::Object(body),
                ),
                group_by => {
                    body.insert("group_by".into(), json!(group_by));
                    (
                        Method::POST,
                        format!("/indexes/{name}/aggregate"),
                        Json::Object(body),
                    )
                }
            }
        }
        Ask::Order(order) => {
            let mut body = json!({
                "sort": { order.by.clone(): if order.descending { "desc" } else { "asc" } },
                "limit": order.top_k,
                "fields": order.include,
            });
            if let Some(filter) = &order.filter {
                body["filter"] = filter_json(filter);
            }
            (Method::POST, format!("/indexes/{name}/query"), body)
        }
    }
}

fn check(family: Kind, answer: &Json) -> Result<()> {
    let found = match family {
        Kind::Attrs(Family::Count | Family::CountEq | Family::CountAnd) => {
            answer["count"].as_u64().map_or(0, |n| n as usize)
        }
        _ => answer["data"].as_array().map_or(0, Vec::len),
    };
    ensure!(found > 0, "{} found nothing: {answer}", family.name());
    Ok(())
}

fn schema(dims: usize) -> Json {
    json!({
        "vectors": [{ "name": VECTOR, "dims": dims, "metric": "cosine" }],
        "attributes": [
            { "name": POPULARITY, "type": "number" },
            { "name": CATEGORY, "type": "string" },
            { "name": GROUP, "type": "string" },
            { "name": CREATED, "type": "int" },
        ],
    })
}

fn row(doc: &Doc) -> Json {
    let mut row = Map::new();
    row.insert("id".into(), id_json(&doc.id));
    for (name, value) in &doc.attributes {
        row.insert(name.clone(), value_json(value));
    }
    for (name, vector) in &doc.vectors {
        row.insert(name.clone(), json!(vector));
    }
    Json::Object(row)
}

fn id_json(id: &Id) -> Json {
    match id {
        Id::Num(n) => json!(n),
        Id::Str(s) => json!(s),
        Id::Uuid(bytes) => json!(bytes.iter().map(|b| format!("{b:02x}")).collect::<String>()),
    }
}

fn value_json(value: &Value) -> Json {
    match value {
        Value::String(s) => json!(s),
        Value::Number(n) => json!(n),
        Value::Bool(b) => json!(b),
        Value::Int(n) | Value::Datetime(n) => json!(n),
        Value::Strings(list) => json!(list),
        Value::Ints(list) => json!(list),
        Value::Numbers(list) => json!(list),
        other => unreachable!("the attrs workload writes no {other:?}"),
    }
}

fn filter_json(filter: &Filter) -> Json {
    let op = |name: &str, op: &str, value: Json| json!({ name: { op: value } });
    let all = |list: &[Filter]| list.iter().map(filter_json).collect::<Vec<_>>();
    match filter {
        Filter::Eq(name, v) => op(name, "eq", value_json(v)),
        Filter::In(name, vs) => op(name, "in", vs.iter().map(value_json).collect()),
        Filter::Lt(name, v) => op(name, "lt", value_json(v)),
        Filter::Lte(name, v) => op(name, "lte", value_json(v)),
        Filter::Gt(name, v) => op(name, "gt", value_json(v)),
        Filter::Gte(name, v) => op(name, "gte", value_json(v)),
        Filter::And(list) => json!({ "and": all(list) }),
        Filter::Or(list) => json!({ "or": all(list) }),
        Filter::Not(inner) => json!({ "not": filter_json(inner) }),
        other => unreachable!("the attrs workload asks no {other:?}"),
    }
}

fn stamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |t| t.as_millis())
}
