//! Indexes, their branches and versions, and the work done on them.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use serde_with::skip_serializing_none;

/// Where a new index lives and how it is split and encrypted.
#[derive(Clone, Debug, Default)]
pub struct IndexOptions {
    /// Where its data lives; the server's default region if not given.
    pub region: Option<String>,
    /// The parts documents are split over by id; 1 by default.
    pub shards: Option<u32>,
    /// A key in your cloud's key service that encrypts the index.
    pub kms_key_id: Option<String>,
    pub pinned: Option<Pinned>,
}

/// Servers reserved for an index, billed per GB-hour for each replica
/// instead of per query.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pinned {
    /// Servers that keep the index open and on their disks, 1 to 8.
    pub replicas: u32,
}

/// Where an index is pinned: fewer replicas than asked while fewer servers
/// run.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Pinning {
    pub replicas: Vec<PinnedReplica>,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct PinnedReplica {
    pub server: String,
    /// Whether every object of the current version is on its disk.
    pub warm: bool,
    /// Queries it is answering now.
    pub in_flight: u64,
}

/// Attributes to add, each `{"name", "type"}`, making the index read-only or
/// writable again, or pinning it. An attribute it has must keep its type.
#[skip_serializing_none]
#[derive(Clone, Debug, Default, Serialize)]
pub struct UpdateIndex {
    pub attributes: Option<Vec<Value>>,
    pub read_only: Option<bool>,
    /// How long older versions stay after they were replaced, in days;
    /// `Some(None)` keeps every one.
    pub retention_days: Option<Option<u32>>,
    /// `Some(None)` unpins the index.
    pub pinned: Option<Option<Pinned>>,
}

/// A branch at one moment of its history.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct IndexVersion {
    pub version: String,
    pub time: String,
    /// Documents a query found then.
    pub rows: u64,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Index {
    pub name: String,
    pub region: String,
    pub schema: Value,
    pub shards: u32,
    pub encryption: Option<Value>,
    pub read_only: bool,
    /// None when every version is kept.
    #[serde(default)]
    pub retention_days: Option<u32>,
    /// None when it is not pinned.
    #[serde(default)]
    pub pinned: Option<Pinned>,
    pub created: String,
    /// The counts of `main`, when the index was read on its own.
    #[serde(default)]
    pub stats: Option<Stats>,
    /// Where it is pinned, when the index was read on its own.
    #[serde(default)]
    pub pinning: Option<Pinning>,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Branch {
    pub name: String,
    pub forked_from: Option<String>,
    pub created: String,
    /// When the branch was read on its own, and the server could count.
    #[serde(default)]
    pub stats: Option<Stats>,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Stats {
    pub rows: u64,
    pub deleted_rows: u64,
    pub segments: u64,
    pub indexed_rows: u64,
    pub unindexed_rows: u64,
    pub clusters: u64,
    pub bytes: u64,
}

/// A build or warming, which goes on after its request answers.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Operation {
    pub id: String,
    pub index: String,
    /// None for work on the whole index.
    pub branch: Option<String>,
    /// "build", "warm" or "collect".
    pub kind: String,
    /// "running", "done" or "failed".
    pub status: String,
    pub error: Option<String>,
    pub started: String,
    pub finished: Option<String>,
}
