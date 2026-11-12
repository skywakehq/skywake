//! The one results schema every benchmark writes: what ran, where, with which settings, and its tables.

use std::path::{Path, PathBuf};

use anyhow::Result;
use serde::Serialize;
use serde_json::Value;

use crate::environment::Environment;

const SCHEMA: u32 = 1;

#[derive(Serialize)]
pub(crate) struct Run {
    schema: u32,
    pub benchmark: &'static str,
    pub run: String,
    pub environment: Environment,
    pub settings: Value,
    pub tables: Vec<Table>,
}

#[derive(Serialize)]
pub(crate) struct Table {
    pub name: &'static str,
    pub rows: Vec<Row>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub notes: Vec<String>,
}

#[derive(Serialize)]
pub(crate) struct Row {
    pub label: String,
    pub metrics: Value,
}

impl Run {
    pub(crate) fn new(benchmark: &'static str, settings: Value) -> Self {
        let time = chrono::Local::now().format("%Y%m%d-%H%M%S");
        Self {
            schema: SCHEMA,
            benchmark,
            run: format!("{time}-{benchmark}"),
            environment: Environment::capture(),
            settings,
            tables: Vec::new(),
        }
    }

    pub(crate) fn save(&self, out: Option<PathBuf>, report: &str) -> Result<()> {
        let dir = out.unwrap_or_else(|| results().join(&self.run));
        std::fs::create_dir_all(&dir)?;
        std::fs::write(dir.join("results.json"), serde_json::to_vec_pretty(self)?)?;
        std::fs::write(dir.join("report.md"), report)?;
        crate::progress::note("results", &format!("wrote {}", dir.display()));
        Ok(())
    }
}

impl Table {
    pub(crate) fn new(name: &'static str, rows: Vec<Row>) -> Self {
        Self {
            name,
            rows,
            notes: Vec::new(),
        }
    }
}

impl Row {
    pub(crate) fn new(label: impl Into<String>, metrics: Value) -> Self {
        Self {
            label: label.into(),
            metrics,
        }
    }
}

fn results() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("results")
}
