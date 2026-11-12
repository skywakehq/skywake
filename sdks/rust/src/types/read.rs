//! Reads: queries, searches, orders, ranks and aggregations.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use serde_with::skip_serializing_none;

/// `strong` (the default) sees every write that finished before the
/// request. `eventual` may use what the server read up to a minute ago.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Consistency {
    Strong,
    Eventual,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct Vector {
    pub column: String,
    pub value: Value,
}

/// The `top_k` nearest documents to a vector that pass `filter`. `recall`
/// is the share of the true nearest to find (0.95 by default; 1 reads every
/// cluster and returns exactly the true nearest by the column's metric);
/// `probe` overrides it with a number of clusters to read. `per`, such as
/// `{"attributes": ["file"], "limit": 3}`, keeps at most `limit` hits for
/// each value; `rerank` orders the hits again with a rerank model.
#[skip_serializing_none]
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Query {
    pub vector: Vector,
    pub top_k: Option<u32>,
    pub recall: Option<f64>,
    pub probe: Option<u32>,
    pub filter: Option<Value>,
    pub include: Option<Vec<String>>,
    pub exclude: Option<Vec<String>>,
    pub offset: Option<u32>,
    pub per: Option<Value>,
    pub consistency: Option<Consistency>,
    pub rerank: Option<Value>,
}

impl Query {
    pub fn new(column: &str, value: impl Into<Value>) -> Self {
        let vector = Vector {
            column: column.to_string(),
            value: value.into(),
        };
        Query {
            vector,
            ..Default::default()
        }
    }
}

/// The documents that best match `query` by BM25. `fields` are the text
/// attributes to search (every one by default) and `boosts` a weight per
/// field. `highlight` names text attributes to return the best fragment of;
/// `fuzzy` (1 or 2) also matches words that many typos away.
#[skip_serializing_none]
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Search {
    pub query: String,
    pub top_k: Option<u32>,
    pub fields: Option<Vec<String>>,
    pub boosts: Option<BTreeMap<String, f64>>,
    pub k1: Option<f64>,
    pub b: Option<f64>,
    pub filter: Option<Value>,
    pub include: Option<Vec<String>>,
    pub exclude: Option<Vec<String>>,
    pub highlight: Option<Vec<String>>,
    pub fuzzy: Option<u8>,
    pub offset: Option<u32>,
    pub per: Option<Value>,
    pub consistency: Option<Consistency>,
    pub rerank: Option<Value>,
}

impl Search {
    pub fn new(query: &str) -> Self {
        Search {
            query: query.to_string(),
            ..Default::default()
        }
    }
}

/// Named searches on one snapshot, each a query or a search body, fused by
/// reciprocal rank; or scored by `rank`, an expression such as
/// `{"sum": [{"search": "title"}, {"search": "body"}]}`.
#[skip_serializing_none]
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hybrid {
    pub searches: Map<String, Value>,
    pub top_k: Option<u32>,
    pub fuse: Option<Fuse>,
    pub offset: Option<u32>,
    pub per: Option<Value>,
    pub consistency: Option<Consistency>,
    pub rank: Option<Value>,
    pub rerank: Option<Value>,
}

/// A hit scores the sum of weight / (k + rank); `k` is 60 and weights are 1
/// by default.
#[skip_serializing_none]
#[derive(Clone, Debug, Default, Serialize)]
pub struct Fuse {
    pub k: Option<f64>,
    pub weights: Option<BTreeMap<String, f64>>,
}

/// Documents in the order of an attribute, or of `id`; those without it
/// come last.
#[skip_serializing_none]
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Order {
    pub by: String,
    pub descending: Option<bool>,
    pub top_k: Option<u32>,
    pub offset: Option<u32>,
    pub filter: Option<Value>,
    pub include: Option<Vec<String>>,
    pub exclude: Option<Vec<String>>,
    pub consistency: Option<Consistency>,
}

impl Order {
    pub fn new(by: &str) -> Self {
        Order {
            by: by.to_string(),
            ..Default::default()
        }
    }
}

/// Every document that passes the filter, best first by an exact score,
/// such as `{"dot": {"attribute", "indices", "values"}}` for sparse vectors
/// or `{"max_sim": {"attribute", "vectors"}}` for late interaction. Those
/// scoring 0 are left out.
#[skip_serializing_none]
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rank {
    pub score: Value,
    pub top_k: Option<u32>,
    pub offset: Option<u32>,
    pub filter: Option<Value>,
    pub include: Option<Vec<String>>,
    pub exclude: Option<Vec<String>>,
    pub consistency: Option<Consistency>,
}

impl Rank {
    pub fn new(score: Value) -> Self {
        Rank {
            score,
            ..Default::default()
        }
    }
}

/// Named measures, such as `{"total": ["count"], "revenue": ["sum",
/// "price"]}`, in one group or a group per set of `group_by` values.
#[skip_serializing_none]
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Aggregate {
    pub measures: Value,
    pub group_by: Option<Vec<String>>,
    pub filter: Option<Value>,
    pub consistency: Option<Consistency>,
}

impl Aggregate {
    pub fn new(measures: Value) -> Self {
        Aggregate {
            measures,
            ..Default::default()
        }
    }
}

/// One request of a multi-query. Each may not set its own consistency or
/// rerank.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Request {
    Query(Query),
    Search(Search),
    Hybrid(Hybrid),
    Order(Order),
    Rank(Rank),
    Aggregate(Aggregate),
}

/// Queries with the vectors of `queries` documents picked at random, as
/// asked and exactly, to measure recall.
#[skip_serializing_none]
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecallCheck {
    pub column: Option<String>,
    pub queries: Option<u32>,
    pub top_k: Option<u32>,
    pub recall: Option<f64>,
    pub filter: Option<Value>,
}
