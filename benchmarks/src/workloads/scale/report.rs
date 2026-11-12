//! What a scale run found: per-step numbers, how each grows with size, and whether that growth is allowed.

use std::fmt::Write;

use serde_json::json;

use super::measure::{Collection, Operation, Sample, growth};
use crate::progress;
use crate::results::{Row, Table};

const FLAT: f64 = 0.25;
const LINEAR: f64 = 1.1;
const MIB: u64 = 1 << 20;
const GC_MEMORY_MAX: u64 = 64 * MIB;

pub(super) struct Step {
    pub files: u64,
    pub folders: u64,
    pub objects: u64,
    pub samples: Vec<Sample>,
    pub collection: Collection,
}

impl Step {
    fn sample(&self, operation: Operation) -> Sample {
        let at = Operation::ALL.iter().position(|o| *o == operation);
        at.and_then(|at| self.samples.get(at).copied())
            .unwrap_or_default()
    }

    fn gc_memory(&self, baseline: u64) -> u64 {
        self.collection.peak_bytes.saturating_sub(baseline)
    }
}

pub(super) struct Report {
    pub store: String,
    pub per_folder: usize,
    pub history: usize,
    pub runs: usize,
    pub baseline_bytes: u64,
    pub steps: Vec<Step>,
}

struct Check {
    label: String,
    growth: Option<f64>,
    limit: f64,
    passed: Option<bool>,
}

impl Check {
    fn verdict(&self) -> &'static str {
        let passed = (self.passed).unwrap_or_else(|| self.growth.is_none_or(|g| g <= self.limit));
        match passed {
            true => "PASS",
            false => "FAIL",
        }
    }
}

impl Report {
    pub(super) fn markdown(&self) -> String {
        let mut md = String::new();
        let _ = writeln!(md, "# Scale\n");
        let _ = writeln!(
            md,
            "Store: {} · {} files to a folder · {} commits of history · median of {} runs, each on a new client.\n",
            self.store, self.per_folder, self.history, self.runs
        );
        let _ = writeln!(
            md,
            "Each step is a synthetic filesystem with real trees, commits and chunk objects whose bodies are tiny. \
             These costs depend on the number of objects, not their bytes, so a step stands for its files at 1 MiB \
             each. On a local store a listing counts as one request; on S3 it is one per 1,000 keys.\n"
        );
        self.sizes(&mut md);
        self.operations(&mut md);
        self.collection(&mut md);
        let _ = writeln!(md, "## Checks\n");
        let _ = writeln!(
            md,
            "Growth is how a cost grows with size: 0 stays flat, 1 grows as fast as the filesystem.\n"
        );
        for check in self.checks() {
            let _ = write!(md, "- {}: {}", check.verdict(), check.label);
            let _ = match (check.passed, check.growth) {
                (None, Some(growth)) => {
                    writeln!(md, " (growth {growth:.2}, at most {})", check.limit)
                }
                _ => writeln!(md),
            };
        }
        md
    }

    pub(super) fn tables(&self) -> Vec<Table> {
        let sizes = self.per_step(|step| {
            json!({ "folders": step.folders, "objects": step.objects, "equivalent_bytes": step.files * MIB })
        });
        let mut operations = Vec::new();
        for operation in Operation::ALL {
            for step in &self.steps {
                let sample = step.sample(operation);
                operations.push(Row::new(
                    format!("{} @ {}", operation.label(), step.files),
                    json!({ "ms": sample.ms, "requests": sample.requests, "lists": sample.lists }),
                ));
            }
        }
        let gc = self.per_step(|step| {
            let c = &step.collection;
            json!({
                "ms": c.ms,
                "requests": c.requests,
                "lists": c.lists,
                "kept": c.kept,
                "memory_bytes": step.gc_memory(self.baseline_bytes),
            })
        });
        let checks = (self.checks().iter())
            .map(|check| {
                Row::new(
                    check.label.clone(),
                    json!({ "growth": check.growth, "limit": check.limit, "verdict": check.verdict() }),
                )
            })
            .collect();
        vec![
            Table::new("sizes", sizes),
            Table::new("operations", operations),
            Table::new("gc", gc),
            Table::new("checks", checks),
        ]
    }

    fn per_step(&self, metrics: impl Fn(&Step) -> serde_json::Value) -> Vec<Row> {
        (self.steps.iter())
            .map(|step| Row::new(step.files.to_string(), metrics(step)))
            .collect()
    }

    fn sizes(&self, md: &mut String) {
        let _ = writeln!(md, "## Sizes\n");
        let _ = writeln!(md, "| files | stands for | folders | objects written |");
        let _ = writeln!(md, "|---:|---:|---:|---:|");
        for step in &self.steps {
            let _ = writeln!(
                md,
                "| {} | {} | {} | {} |",
                progress::count(step.files),
                progress::bytes(step.files * MIB),
                progress::count(step.folders),
                progress::count(step.objects)
            );
        }
        md.push('\n');
    }

    fn operations(&self, md: &mut String) {
        let _ = writeln!(md, "## Operations\n");
        let _ = writeln!(md, "Milliseconds, then requests to the store.\n");
        self.header(md);
        for operation in Operation::ALL {
            self.row(md, operation.label(), |step| {
                let sample = step.sample(operation);
                format!("{:.1} ms · {}", sample.ms, sample.requests)
            });
        }
        md.push('\n');
    }

    fn collection(&self, md: &mut String) {
        let _ = writeln!(md, "## Garbage collection\n");
        let _ = writeln!(
            md,
            "A dry run in a process of its own. Memory is its peak above a collection of an empty store ({}).\n",
            progress::bytes(self.baseline_bytes)
        );
        self.header(md);
        self.row(md, "time", |s| format!("{:.0} ms", s.collection.ms));
        self.row(md, "requests", |s| progress::count(s.collection.requests));
        self.row(md, "lists", |s| progress::count(s.collection.lists));
        self.row(md, "memory", |s| {
            progress::bytes(s.gc_memory(self.baseline_bytes))
        });
        md.push('\n');
    }

    fn header(&self, md: &mut String) {
        let sizes: Vec<String> = (self.steps.iter())
            .map(|step| format!("{} files", progress::count(step.files)))
            .collect();
        let _ = writeln!(md, "| | {} |", sizes.join(" | "));
        let _ = writeln!(md, "|---|{}", "---:|".repeat(sizes.len()));
    }

    fn row(&self, md: &mut String, label: &str, cell: impl Fn(&Step) -> String) {
        let cells: Vec<String> = self.steps.iter().map(cell).collect();
        let _ = writeln!(md, "| {label} | {} |", cells.join(" | "));
    }

    fn checks(&self) -> Vec<Check> {
        let sizes: Vec<u64> = self.steps.iter().map(|step| step.files).collect();
        let series =
            |value: &dyn Fn(&Step) -> f64| -> Vec<f64> { self.steps.iter().map(value).collect() };
        let mut checks: Vec<Check> = (Operation::ALL.iter())
            .map(|&operation| Check {
                label: format!("{}: requests stay flat", operation.label()),
                growth: growth(&sizes, &series(&|s| s.sample(operation).requests as f64)),
                limit: FLAT,
                passed: None,
            })
            .collect();
        let peak = (self.steps.iter())
            .map(|step| step.gc_memory(self.baseline_bytes))
            .max()
            .unwrap_or(0);
        checks.push(Check {
            label: format!(
                "gc: memory stays under {} (peak {})",
                progress::bytes(GC_MEMORY_MAX),
                progress::bytes(peak)
            ),
            growth: None,
            limit: FLAT,
            passed: Some(peak <= GC_MEMORY_MAX),
        });
        checks.push(Check {
            label: "gc: time grows no faster than the filesystem".into(),
            growth: growth(&sizes, &series(&|s| s.collection.ms)),
            limit: LINEAR,
            passed: None,
        });
        checks
    }
}
