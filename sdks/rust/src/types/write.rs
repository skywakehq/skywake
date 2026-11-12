//! Writes and what they changed.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use serde_with::skip_serializing_none;

use super::{Attributes, Billing, DocId, Document, Patch};

/// Upserts, patches and deletes as one change, in this order: `delete_by`,
/// `patch_by`, `upserts`, `patches`, `deletes`. A condition is a filter
/// checked against each document as it was, whose values may be
/// `{"$ref_new": attribute}`.
#[skip_serializing_none]
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Write {
    pub upserts: Option<Vec<Document>>,
    pub patches: Option<Vec<Patch>>,
    pub deletes: Option<Vec<DocId>>,
    pub upsert_if: Option<Value>,
    pub patch_if: Option<Value>,
    pub delete_if: Option<Value>,
    pub delete_by: Option<Value>,
    pub patch_by: Option<PatchBy>,
    /// Also return the ids behind the counts, in `WriteCounts`.
    pub return_affected_ids: Option<bool>,
}

#[derive(Clone, Debug, Serialize)]
pub struct PatchBy {
    pub filter: Value,
    pub attributes: Attributes,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct WriteCounts {
    pub upserted: u64,
    pub patched: u64,
    /// Without `delete_if`, every id given counts, there or not.
    pub deleted: u64,
    /// The ids behind the counts, when the write set `return_affected_ids`.
    pub upserted_ids: Option<Vec<DocId>>,
    pub patched_ids: Option<Vec<DocId>>,
    pub deleted_ids: Option<Vec<DocId>>,
    #[serde(default)]
    pub billing: Billing,
}
