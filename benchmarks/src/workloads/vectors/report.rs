//! What a run found: the Markdown table to read, and the result tables for comparing runs.

use std::fmt::Write;
use std::time::Duration;

use serde::Serialize;
use serde_json::json;

use super::passes::label;
use crate::datasets::filters::Selection;
use crate::metrics::requests::{Op, Request, count, waves};
use crate::metrics::{floor_rank, millis};
use crate::results::{Row, Table};

#[derive(Default)]
pub(super) struct Report {
    pub dataset: String,
    pub store: String,
    pub commit: String,
    pub rows: usize,
    pub dims: usize,
    pub metric: String,
    pub k: usize,
    pub queries: usize,
    pub cold_queries: usize,
    pub setup: Setup,
    pub passes: Vec<Pass>,
}

#[derive(Serialize, Default)]
pub(super) struct Setup {
    pub load_s: f64,
    pub rows_per_s: f64,
    pub load_puts: u64,
    pub build_s: f64,
    pub build_gets: u64,
    pub build_puts: u64,
    pub clusters: u64,
    pub index_bytes: u64,
    pub visible_p50_ms: f64,
    pub visible_p99_ms: f64,
    pub peak_rss_load: u64,
    pub peak_rss_build: u64,
    pub peak_rss_end: u64,
}

#[derive(Serialize)]
pub(super) struct Pass {
    pub pass: &'static str,
    pub filter: String,
    pub probe: String,
    pub recall: f64,
    pub p50_ms: f64,
    pub p90_ms: f64,
    pub p99_ms: f64,
    pub gets: f64,
    pub heads: f64,
    pub puts: f64,
    pub lists: f64,
    pub bytes: f64,
    pub waves: f64,
    pub waves_max: usize,
}

impl Pass {
    pub(super) fn new(
        pass: &'static str,
        selection: Selection,
        probe: Option<usize>,
        recall: f64,
        times: &[Duration],
        requests: &[Vec<Request>],
    ) -> Self {
        let n = requests.len().max(1) as f64;
        let mean = |op| requests.iter().map(|r| count(r, op)).sum::<u64>() as f64 / n;
        let waves: Vec<usize> = requests.iter().map(|r| waves(r)).collect();
        let bytes: u64 = requests.iter().flatten().map(|r| r.bytes).sum();
        let ms = millis(times);
        Self {
            pass,
            filter: selection.name(),
            probe: label(probe),
            recall,
            p50_ms: floor_rank(&ms, 0.5),
            p90_ms: floor_rank(&ms, 0.9),
            p99_ms: floor_rank(&ms, 0.99),
            gets: mean(Op::Get),
            heads: mean(Op::Head),
            puts: mean(Op::Put),
            lists: mean(Op::List),
            bytes: bytes as f64 / n,
            waves: waves.iter().sum::<usize>() as f64 / n,
            waves_max: waves.iter().copied().max().unwrap_or(0),
        }
    }
}

impl Report {
    pub(super) fn add(&mut self, pass: Pass) {
        self.passes.push(pass);
    }

    pub(super) fn markdown(&self) -> String {
        let s = &self.setup;
        let mut out = String::new();
        let _ = writeln!(
            out,
            "**{}**: {} rows × {} dims, {}, store {}, k={}, {} warm / {} cold queries, commit {}\n",
            self.dataset,
            self.rows,
            self.dims,
            self.metric,
            self.store,
            self.k,
            self.queries,
            self.cold_queries,
            self.commit
        );
        let _ = writeln!(
            out,
            "load {:.1} s ({:.0} rows/s, {} PUTs) · build {:.1} s ({} GETs, {} PUTs, {} clusters, {}) · \
             write→visible p50 {:.1} ms, p99 {:.1} ms · peak RSS {} load, {} build, {} end\n",
            s.load_s,
            s.rows_per_s,
            s.load_puts,
            s.build_s,
            s.build_gets,
            s.build_puts,
            s.clusters,
            size(s.index_bytes as f64),
            s.visible_p50_ms,
            s.visible_p99_ms,
            size(s.peak_rss_load as f64),
            size(s.peak_rss_build as f64),
            size(s.peak_rss_end as f64),
        );
        out.push_str(
            "| filter | probe | pass | recall@k | p50 ms | p90 ms | p99 ms | GET/q | HEAD/q | bytes/q | waves/q (max) |\n",
        );
        out.push_str("|---|---|---|---|---|---|---|---|---|---|---|\n");
        for p in &self.passes {
            let _ = writeln!(
                out,
                "| {} | {} | {} | {:.3} | {:.1} | {:.1} | {:.1} | {:.1} | {:.1} | {} | {:.1} ({}) |",
                p.filter,
                p.probe,
                p.pass,
                p.recall,
                p.p50_ms,
                p.p90_ms,
                p.p99_ms,
                p.gets,
                p.heads,
                size(p.bytes),
                p.waves,
                p.waves_max
            );
        }
        out
    }

    pub(super) fn tables(&self) -> Vec<Table> {
        let setup = Row::new("load and build", json!(self.setup));
        let passes = (self.passes.iter())
            .map(|p| {
                let label = format!("{} · probe {} · {}", p.filter, p.probe, p.pass);
                Row::new(label, json!(p))
            })
            .collect();
        vec![
            Table::new("setup", vec![setup]),
            Table::new("queries", passes),
        ]
    }
}

fn size(bytes: f64) -> String {
    match bytes {
        b if b >= 1e9 => format!("{:.2} GB", b / 1e9),
        b if b >= 1e6 => format!("{:.1} MB", b / 1e6),
        b if b >= 1e3 => format!("{:.1} KB", b / 1e3),
        b => format!("{b:.0} B"),
    }
}
