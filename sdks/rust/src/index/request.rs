//! Pieces of requests and answers that every index route shares.

use percent_encoding::{AsciiSet, NON_ALPHANUMERIC, utf8_percent_encode};
use serde::de::DeserializeOwned;
use serde_json::{Map, Value, json};

use crate::Result;
use crate::client::Params;

/// The most documents or ids the API takes in one request, and the longest page.
pub(super) const BATCH: usize = 1000;

/// Index and branch names may hold `/`. In a URL it must be `%2F`.
const NAME: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'.')
    .remove(b'_')
    .remove(b'~');

pub(super) fn escaped(name: &str) -> String {
    utf8_percent_encode(name, NAME).to_string()
}

/// The query parameters that are set.
pub(super) fn params<const N: usize>(pairs: [(&'static str, Option<String>); N]) -> Params {
    (pairs.into_iter())
        .filter_map(|(name, value)| Some((name, value?)))
        .collect()
}

pub(super) fn page(limit: Option<u32>, after: Option<&str>) -> Params {
    params([
        ("limit", limit.map(|n| n.to_string())),
        ("after", after.map(String::from)),
    ])
}

/// Takes one field of an answer.
pub(super) fn take<T: DeserializeOwned>(
    answer: &mut Map<String, Value>,
    name: &str,
) -> Result<Option<T>> {
    Ok(answer
        .remove(name)
        .map(serde_json::from_value)
        .transpose()?)
}

pub(super) fn encryption(kms_key_id: Option<&str>) -> Option<Value> {
    kms_key_id.map(|key| json!({ "kms_key_id": key }))
}
