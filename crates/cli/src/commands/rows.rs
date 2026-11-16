use std::io::IsTerminal;
use std::path::PathBuf;

use anyhow::{Result, anyhow, bail};
use serde_json::{Value, json};
use skywake::{ErrorKind, Index, Mode, Order};

use crate::cli::{Format, QueryMode};
use crate::commands::files;
use crate::input::filter;
use crate::input::rows::{self, Fields, Row};
use crate::output::{self, cell, table};
use crate::session::{Place, Session};
use crate::target::Target;

const BATCH: usize = 10_000;

pub(crate) async fn upsert(
    session: &Session,
    target: &Target,
    file: Option<PathBuf>,
    format: Option<Format>,
) -> Result<()> {
    let index = session.index(target);
    let fields = Fields::of(&schema(&index).await?);
    let format = format.unwrap_or_else(|| rows::guess(file.as_deref()));
    let progress = std::io::stderr().is_terminal() && !session.json;
    let mut written = 0;
    let mut batch: Vec<Row> = Vec::new();
    let mut input = rows::read(file.as_deref(), format)?.enumerate().peekable();
    while let Some((n, row)) = input.next() {
        let row = row
            .and_then(|row| fields.typed(row))
            .map_err(|error| anyhow!("row {}: {error:#}", n + 1))?;
        batch.push(row);
        if batch.len() < BATCH && input.peek().is_some() {
            continue;
        }
        let sent = std::mem::take(&mut batch);
        let done = index.upsert(sent).await.map_err(|error| {
            anyhow!("{error}\nstopped after {written} rows were written; running it again is safe")
        })?;
        written += done.count;
        if progress {
            eprint!("\rwrote {written} rows");
        }
    }
    if progress {
        eprint!("\r");
    }
    output::report(
        session.json,
        json!({ "count": written }),
        format!("{}: wrote {written} rows", target.label()),
    )
}

async fn schema(index: &Index) -> Result<Value> {
    match index.info().await {
        Ok(info) => Ok(info.schema),
        Err(error) if error.kind() == Some(&ErrorKind::NotFound) => Ok(Value::Null),
        Err(error) => Err(error.into()),
    }
}

pub(crate) async fn get(session: &Session, target: &Target, id: &str) -> Result<()> {
    let Some(row) = session.index(target).get(id_value(id)).await? else {
        bail!("no row `{id}` in {}", target.label());
    };
    output::json(&row)
}

pub(crate) async fn delete(session: &Session, target: &Target, ids: Vec<String>) -> Result<()> {
    if ids.is_empty() {
        bail!(
            "name the rows to delete, such as `skywake delete {} 1 2 3`; to delete the index, use `skywake destroy {}`",
            target.name,
            target.name
        );
    }
    let ids: Vec<Value> = ids.iter().map(|id| id_value(id)).collect();
    let count = session.index(target).delete(ids).await?;
    output::report(
        session.json,
        json!({ "count": count }),
        format!("{}: deleted {count} rows", target.label()),
    )
}

pub(crate) struct Search {
    pub(crate) text: Option<String>,
    pub(crate) filter: Option<String>,
    pub(crate) limit: Option<u32>,
    pub(crate) mode: Option<QueryMode>,
    pub(crate) vector: Option<String>,
    pub(crate) sort: Option<String>,
    pub(crate) fields: Vec<String>,
}

pub(crate) async fn query(session: &Session, target: &Target, search: Search) -> Result<()> {
    match session.place(target).await? {
        Place::Disk(disk) => {
            let Some(text) = &search.text else {
                bail!(
                    "a disk query needs words, such as `skywake query {} \"where is auth\"`",
                    target.name
                );
            };
            files::query(session, disk, text, None, search.limit).await
        }
        Place::Index(index) => query_index(session, &index, search).await,
    }
}

async fn query_index(session: &Session, index: &Index, search: Search) -> Result<()> {
    let mut query = index.query(search.text.as_deref());
    if let Some(text) = &search.filter {
        query = query.filter(filter::parse(text)?);
    }
    if let Some(limit) = search.limit {
        query = query.limit(limit);
    }
    if let Some(mode) = search.mode {
        query = query.mode(match mode {
            QueryMode::Auto => Mode::Auto,
            QueryMode::Meaning => Mode::Meaning,
            QueryMode::Keywords => Mode::Keywords,
        });
    }
    if let Some(vector) = &search.vector {
        let numbers: Vec<f64> = serde_json::from_str(vector)
            .map_err(|_| anyhow!("--vector must be a JSON list of numbers, such as [0.1, 0.2]"))?;
        query = query.vector(numbers);
    }
    if let Some(sort) = &search.sort {
        let (field, order) = match sort.split_once(':') {
            Some((field, "desc")) => (field, Order::Desc),
            Some((field, "asc")) => (field, Order::Asc),
            Some(_) => bail!("--sort takes FIELD, FIELD:asc or FIELD:desc"),
            None => (sort.as_str(), Order::Asc),
        };
        query = query.sort(field, order);
    }
    if !search.fields.is_empty() {
        query = query.fields(search.fields.clone());
    }
    let hits = query.send().await?;
    output::either(session.json, &hits, |hits| print_hits(hits))
}

fn print_hits(hits: &[Row]) {
    let mut columns = vec!["id".to_string()];
    for hit in hits {
        for name in hit.keys() {
            if !columns.contains(name) && !hit[name].is_array() {
                columns.push(name.clone());
            }
        }
    }
    let header: Vec<String> = columns.iter().map(|name| name.to_uppercase()).collect();
    let header: Vec<&str> = header.iter().map(String::as_str).collect();
    let rows: Vec<Vec<String>> = hits
        .iter()
        .map(|hit| {
            columns
                .iter()
                .map(|name| score(name, hit.get(name)))
                .collect()
        })
        .collect();
    table(&header, &rows);
}

fn score(name: &str, value: Option<&Value>) -> String {
    match (name, value) {
        ("score", Some(Value::Number(number))) => format!("{:.4}", number.as_f64().unwrap_or(0.0)),
        (_, Some(value)) => cell(value),
        (_, None) => String::new(),
    }
}

fn id_value(id: &str) -> Value {
    match id.parse::<u64>() {
        Ok(number) if !id.starts_with('0') || id == "0" => Value::from(number),
        _ => Value::String(id.to_string()),
    }
}
