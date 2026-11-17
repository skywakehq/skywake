use std::fmt::Write;

use serde::Serialize;
use serde_json::json;

use super::data::Family;
use super::passes::Sample;
use crate::metrics::requests::{Op, count, waves};
use crate::metrics::{millis, nearest_rank};
use crate::progress;
use crate::results::{Row, Table};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Temperature {
    Hot,
    HotHead,
    Cold,
}

impl Temperature {
    pub(super) fn name(self) -> &'static str {
        match self {
            Temperature::Hot => "hot",
            Temperature::HotHead => "hot+head",
            Temperature::Cold => "cold",
        }
    }

    pub(super) fn parse(text: &str) -> Option<Self> {
        [Temperature::Hot, Temperature::HotHead, Temperature::Cold]
            .into_iter()
            .find(|t| t.name() == text)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(super) enum Answer {
    Counts { groups: usize, total: u64 },
    Rows(usize),
}

#[derive(Serialize, Default)]
pub(super) struct Setup {
    pub load_s: f64,
    pub rows_per_s: f64,
    pub load_puts: u64,
    pub build_s: f64,
    pub build_gets: u64,
    pub build_puts: u64,
    pub index_bytes: u64,
    pub clusters: u64,
    pub peak_rss_load: u64,
    pub peak_rss_build: u64,
    pub peak_rss_end: u64,
}

#[derive(Serialize)]
pub(super) struct Pass {
    #[serde(skip)]
    family: Family,
    #[serde(skip)]
    temperature: Temperature,
    pub queries: usize,
    pub p50_ms: f64,
    pub p90_ms: f64,
    pub p99_ms: f64,
    pub gets: f64,
    pub bytes: f64,
    pub waves: f64,
    pub waves_max: usize,
    pub store_reads: f64,
}

impl Pass {
    pub(super) fn new(family: Family, temperature: Temperature, samples: &[Sample]) -> Self {
        let n = samples.len().max(1) as f64;
        let ms = millis(&samples.iter().map(|s| s.time).collect::<Vec<_>>());
        let waves: Vec<usize> = samples.iter().map(|s| waves(&s.requests)).collect();
        let gets: u64 = samples.iter().map(|s| count(&s.requests, Op::Get)).sum();
        let bytes: u64 = samples
            .iter()
            .flat_map(|s| &s.requests)
            .map(|r| r.bytes)
            .sum();
        let store_reads: u64 = samples.iter().map(|s| s.reads.store).sum();
        Self {
            family,
            temperature,
            queries: samples.len(),
            p50_ms: nearest_rank(&ms, 0.5),
            p90_ms: nearest_rank(&ms, 0.9),
            p99_ms: nearest_rank(&ms, 0.99),
            gets: gets as f64 / n,
            bytes: bytes as f64 / n,
            waves: waves.iter().sum::<usize>() as f64 / n,
            waves_max: waves.iter().copied().max().unwrap_or(0),
            store_reads: store_reads as f64 / n,
        }
    }

    pub(super) fn label(&self) -> String {
        format!("{} · {}", self.family.name(), self.temperature.name())
    }

    pub(super) fn summary(&self) -> String {
        format!(
            "p50 {:.1} ms · p90 {:.1} ms · {:.1} waves · {}",
            self.p50_ms,
            self.p90_ms,
            self.waves,
            progress::bytes(self.bytes as u64)
        )
    }
}

pub(super) struct Report {
    pub rows: u64,
    pub dims: usize,
    pub store: String,
    pub commit: String,
    pub open_loop: Option<f64>,
    pub setup: Setup,
    pub passes: Vec<Pass>,
}

impl Report {
    pub(super) fn markdown(&self) -> String {
        let mut out = String::new();
        let vectors = match self.dims {
            0 => "no vectors".to_string(),
            dims => format!("{dims}-d vectors"),
        };
        let load = match self.open_loop {
            Some(qps) => format!("open loop at {qps} QPS"),
            None => "one query at a time".to_string(),
        };
        let _ = writeln!(
            out,
            "# Attributes: {} rows, {vectors}\n\nStore: {} · commit {} · {load}\n",
            progress::count(self.rows),
            self.store,
            self.commit
        );
        let s = &self.setup;
        let _ = writeln!(
            out,
            "Load {:.1} s ({:.0} rows/s) · build {:.1} s · index {} · peak memory {}\n",
            s.load_s,
            s.rows_per_s,
            s.build_s,
            progress::bytes(s.index_bytes),
            progress::bytes(s.peak_rss_end.max(s.peak_rss_build))
        );
        out.push_str(
            "| Query | Temperature | n | p50 ms | p90 ms | p99 ms | GETs | Read | Waves |\n",
        );
        out.push_str("|---|---|--:|--:|--:|--:|--:|--:|--:|\n");
        for p in &self.passes {
            let _ = writeln!(
                out,
                "| {} | {} | {} | {:.1} | {:.1} | {:.1} | {:.1} | {} | {:.1} |",
                p.family.name(),
                p.temperature.name(),
                p.queries,
                p.p50_ms,
                p.p90_ms,
                p.p99_ms,
                p.gets,
                progress::bytes(p.bytes as u64),
                p.waves
            );
        }
        out
    }

    pub(super) fn tables(&self) -> Vec<Table> {
        let setup = Row::new("setup", json!(self.setup));
        let passes = self
            .passes
            .iter()
            .map(|p| Row::new(p.label(), json!(p)))
            .collect();
        vec![
            Table::new("attrs setup", vec![setup]),
            Table::new("attrs queries", passes),
        ]
    }
}
