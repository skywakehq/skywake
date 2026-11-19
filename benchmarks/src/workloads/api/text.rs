//! Keyword search through the API on MS MARCO passages, asked with the dev queries.

use std::fs::File;
use std::io::{BufRead, BufReader, Lines};
use std::path::Path;
use std::sync::Arc;

use anyhow::{Context, Result, ensure};
use futures::stream::{FuturesUnordered, StreamExt};
use reqwest::Method;
use serde_json::{Value as Json, json};

use super::{Api, settled, stamp};
use crate::progress::{self, Meter};

#[derive(Clone)]
pub(super) struct Queries(Arc<Vec<String>>);

impl Queries {
    pub(super) fn open(dir: &Path) -> Result<Self> {
        let list = lines(&dir.join("queries.dev.small.tsv"))?
            .map(|line| {
                let line = line?;
                let (_, text) = line.split_once('\t').context("a query line has no tab")?;
                Ok(text.to_string())
            })
            .collect::<Result<Vec<_>>>()?;
        ensure!(!list.is_empty(), "{} has no queries", dir.display());
        Ok(Self(Arc::new(list)))
    }

    pub(super) fn body(&self, n: u64, k: usize) -> Json {
        let text = &self.0[n as usize % self.0.len()];
        json!({ "text": text, "mode": "keywords", "limit": k, "fields": [] })
    }
}

pub(super) async fn load(
    api: &Api,
    dir: &Path,
    rows: u64,
    batch: u64,
    writers: usize,
    settle: u64,
) -> Result<String> {
    let name = format!("bench-text-{}", stamp());
    api.call(
        Method::POST,
        "/indexes",
        Some(&json!({
            "name": name,
            "embed": false,
            "schema": { "attributes": [{ "name": "body", "type": "text" }] },
        })),
    )
    .await?;
    let step = progress::start("load", &format!("MS MARCO passages into {name}"));
    let mut meter = Meter::new("load", rows, "rows");
    let path = format!("/indexes/{name}/rows");
    let mut passages = lines(&dir.join("collection.tsv"))?.take(rows as usize);
    let mut writing = FuturesUnordered::new();
    loop {
        let block = (passages.by_ref())
            .take(batch as usize)
            .map(|line| {
                let line = line?;
                let (id, body) = line.split_once('\t').context("a passage line has no tab")?;
                Ok(json!({ "id": id.parse::<u64>()?, "body": body }))
            })
            .collect::<Result<Vec<Json>>>()?;
        if block.is_empty() {
            break;
        }
        let (path, count) = (&path, block.len() as u64);
        let body = serde_json::to_vec(&block)?;
        writing.push(async move {
            api.send(Method::POST, path, Some(body)).await?;
            Ok::<_, anyhow::Error>(count)
        });
        if writing.len() >= writers.max(1) {
            meter.add(writing.next().await.expect("an upsert is in flight")?);
        }
    }
    while let Some(count) = writing.next().await {
        meter.add(count?);
    }
    step.done("");
    settled(api, &name, settle).await?;
    Ok(name)
}

fn lines(path: &Path) -> Result<Lines<BufReader<File>>> {
    let file = File::open(path).with_context(|| path.display().to_string())?;
    Ok(BufReader::new(file).lines())
}
