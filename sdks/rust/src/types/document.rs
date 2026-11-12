//! Documents and their ids.

use std::fmt;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use serde_with::skip_serializing_none;

pub type Attributes = Map<String, Value>;

/// A string, or a whole number from 0; a UUID, as a string, in an index
/// whose schema has `"id": "uuid"`.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(untagged)]
pub enum DocId {
    Num(u64),
    Str(String),
}

impl From<u64> for DocId {
    fn from(id: u64) -> Self {
        DocId::Num(id)
    }
}

impl From<&str> for DocId {
    fn from(id: &str) -> Self {
        DocId::Str(id.to_string())
    }
}

impl From<String> for DocId {
    fn from(id: String) -> Self {
        DocId::Str(id)
    }
}

impl fmt::Display for DocId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DocId::Num(id) => id.fmt(f),
            DocId::Str(id) => id.fmt(f),
        }
    }
}

/// A vector may be numbers, or text or `{"image": url}` when its column has
/// `embed`: the server embeds it.
#[skip_serializing_none]
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Document {
    pub id: DocId,
    #[serde(default)]
    pub vectors: Map<String, Value>,
    pub attributes: Option<Attributes>,
}

/// Sets attributes of a document; `null` removes one.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Patch {
    pub id: DocId,
    pub attributes: Attributes,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct DocumentPage {
    pub documents: Vec<Document>,
    /// Pass as `cursor` for the next page. None on the last page.
    pub next: Option<String>,
}
