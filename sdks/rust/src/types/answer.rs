//! What reads return.

use std::collections::BTreeMap;
use std::ops::Deref;

use serde::Deserialize;
use serde_json::{Map, Value};

use super::{Attributes, DocId};

/// What a read returns, with how long it took and where its reads came
/// from, and what it counted toward the bill.
#[derive(Clone, Debug)]
pub struct Measured<T> {
    pub items: Vec<T>,
    pub performance: Option<Performance>,
    pub billing: Option<Billing>,
}

impl<T> Deref for Measured<T> {
    type Target = [T];

    fn deref(&self) -> &[T] {
        &self.items
    }
}

impl<T> IntoIterator for Measured<T> {
    type Item = T;
    type IntoIter = std::vec::IntoIter<T>;

    fn into_iter(self) -> Self::IntoIter {
        self.items.into_iter()
    }
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Performance {
    pub server_ms: u64,
    /// "hot", "warm" or "cold".
    pub cache_temperature: String,
    pub cache_hit_ratio: f64,
}

/// What a request counted toward the bill; counts of 0 are left out.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(default)]
pub struct Billing {
    pub queries: u64,
    pub writes: u64,
    pub deletes: u64,
    pub embeddings: u64,
    pub reranks: u64,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Hit {
    pub id: DocId,
    /// Smaller is closer, for every metric.
    pub distance: f64,
    pub attributes: Attributes,
    pub rerank_score: Option<f64>,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct SearchHit {
    pub id: DocId,
    pub score: f64,
    pub attributes: Attributes,
    #[serde(default)]
    pub highlights: Map<String, Value>,
    pub rerank_score: Option<f64>,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct FusedHit {
    pub id: DocId,
    pub score: f64,
    /// Its rank in each search that found it, from 1.
    pub ranks: BTreeMap<String, u32>,
    pub scores: BTreeMap<String, f64>,
    pub attributes: Attributes,
    #[serde(default)]
    pub highlights: Map<String, Value>,
    pub rerank_score: Option<f64>,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Row {
    pub id: DocId,
    pub attributes: Attributes,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Ranked {
    pub id: DocId,
    pub score: f64,
    pub attributes: Attributes,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Group {
    /// The values of `group_by` its documents share.
    pub key: Attributes,
    pub values: Attributes,
}

/// The answer to one request of a multi-query, in the field it was asked in.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(default)]
pub struct MultiResult {
    pub query: Option<Vec<Hit>>,
    pub search: Option<Vec<SearchHit>>,
    pub hybrid: Option<Vec<FusedHit>>,
    pub order: Option<Vec<Row>>,
    pub rank: Option<Vec<Ranked>>,
    pub aggregate: Option<Vec<Group>>,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Recall {
    /// The mean share of the exact hits that the queries found.
    pub recall: f64,
    pub queries: u32,
    pub found: f64,
    pub exact: f64,
}
