//! Sending rows to the API in parallel batches.

use std::io::IsTerminal;

use anyhow::{Result, anyhow};
use reqwest::Method;
use tokio::task::JoinSet;

use super::rows::{self, Columns};
use crate::api::Api;

const BATCH_BYTES: usize = 30 * 1024 * 1024;
const PARALLEL: usize = 4;

pub(super) async fn upsert(
    api: &Api,
    path: &str,
    rows: Box<dyn Iterator<Item = Result<rows::Row>>>,
    columns: &Columns,
    batch_size: usize,
) -> Result<u64> {
    let progress = std::io::stderr().is_terminal();
    let mut sending: JoinSet<Result<u64>> = JoinSet::new();
    let mut written = 0;
    let mut batch: Vec<String> = Vec::new();
    let mut bytes = 0;
    let mut rows = rows.enumerate().peekable();
    while let Some((n, row)) = rows.next() {
        let document = row
            .and_then(|row| rows::document(row, columns))
            .map_err(|error| anyhow!("row {}: {error:#}", n + 1))?;
        let text = document.to_string();
        bytes += text.len() + 1;
        batch.push(text);
        let full = batch.len() == batch_size || bytes > BATCH_BYTES || rows.peek().is_none();
        if !full {
            continue;
        }
        let body = format!("{{\"documents\":[{}]}}", batch.join(","));
        let first = n + 2 - batch.len();
        batch.clear();
        bytes = 0;
        while sending.len() >= PARALLEL {
            written += finished(&mut sending, written).await?;
        }
        let api = api.clone();
        let path = path.to_string();
        sending.spawn(async move {
            let answer = api.send(Method::POST, &path, Some(body), true).await;
            let answer =
                answer.map_err(|error| anyhow!("the batch from row {first}: {error:#}"))?;
            Ok(answer["count"].as_u64().unwrap_or(0))
        });
        if progress {
            eprint!("\rsent {} rows", n + 1);
        }
    }
    while !sending.is_empty() {
        written += finished(&mut sending, written).await?;
    }
    if progress {
        eprint!("\r");
    }
    Ok(written)
}

async fn finished(sending: &mut JoinSet<Result<u64>>, written: u64) -> Result<u64> {
    match sending.join_next().await {
        Some(Ok(Ok(count))) => Ok(count),
        Some(Ok(Err(error))) => Err(anyhow!(
            "{error:#}\nstopped after {written} documents were written; running it again is safe"
        )),
        Some(Err(error)) => Err(error.into()),
        None => Ok(0),
    }
}
