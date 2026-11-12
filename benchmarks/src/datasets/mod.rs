//! A dataset folder: base and query vectors, optional ground truth, its metric, and a manifest of where it came from.

pub(crate) mod files;
pub(crate) mod filters;
pub(crate) mod random;
pub mod synth;
pub(crate) mod truth;

use std::path::Path;

use serde_json::Value;

const MANIFEST: &str = "dataset.json";

pub(crate) fn manifest(dir: &Path) -> Value {
    std::fs::read(dir.join(MANIFEST))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or(Value::Null)
}
