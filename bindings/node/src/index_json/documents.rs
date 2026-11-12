//! Documents, patches and writes as plain JavaScript objects, and back.

use std::collections::HashMap;

use napi::{Either, Result};
use napi_derive::napi;
use serde_json::{Map, Value as Json};
use skywake_index::{Changes, Counts, Doc, Id, Patch, Write};

use super::filters::{condition_from, filter_from};
use super::values::{attributes_to, id_from, id_to, value_from};

#[napi(object)]
pub struct IndexDoc {
    pub id: Either<String, f64>,
    pub vectors: HashMap<String, Vec<f64>>,
    pub attributes: Option<Map<String, Json>>,
}

#[napi(object)]
pub struct IndexPatch {
    pub id: Either<String, f64>,
    pub attributes: Map<String, Json>,
}

#[napi(object)]
pub struct IndexPatchBy {
    pub filter: Json,
    pub attributes: Map<String, Json>,
}

#[napi(object)]
pub struct IndexWrite {
    pub upserts: Option<Vec<IndexDoc>>,
    pub patches: Option<Vec<IndexPatch>>,
    pub deletes: Option<Vec<Either<String, f64>>>,
    pub upsert_if: Option<Json>,
    pub patch_if: Option<Json>,
    pub delete_if: Option<Json>,
    pub delete_by: Option<Json>,
    pub patch_by: Option<IndexPatchBy>,
    pub return_affected_ids: Option<bool>,
    /// Count and return only deleted ids that were there. Off, every id named counts.
    pub exact_deletes: Option<bool>,
}

#[napi(object)]
pub struct IndexCounts {
    pub upserted: u32,
    pub patched: u32,
    pub deleted: u32,
    /// With `exactDeletes`: deletes of ids that were not there.
    pub missing: u32,
    pub upserted_ids: Option<Vec<Either<String, f64>>>,
    pub patched_ids: Option<Vec<Either<String, f64>>>,
    pub deleted_ids: Option<Vec<Either<String, f64>>>,
}

pub(crate) fn doc_to(doc: Doc) -> IndexDoc {
    IndexDoc {
        id: id_to(doc.id),
        vectors: (doc.vectors.into_iter())
            .map(|(name, vector)| (name, vector.into_iter().map(f64::from).collect()))
            .collect(),
        attributes: Some(attributes_to(doc.attributes)),
    }
}

pub(crate) fn doc_from(input: IndexDoc) -> Result<Doc> {
    let mut doc = Doc::new(id_from(input.id)?);
    doc.vectors = input
        .vectors
        .into_iter()
        .map(|(name, vector)| (name, vector.into_iter().map(|x| x as f32).collect()))
        .collect();
    for (name, value) in input.attributes.unwrap_or_default() {
        doc.attributes.insert(name, value_from(&value)?);
    }
    Ok(doc)
}

fn changes_from(attributes: Map<String, Json>) -> Result<Changes> {
    (attributes.into_iter())
        .map(|(name, json)| match json {
            Json::Null => Ok((name, None)),
            json => Ok((name, Some(value_from(&json)?))),
        })
        .collect()
}

pub(crate) fn write_from(input: IndexWrite) -> Result<Write> {
    let condition = |json: Option<Json>| json.as_ref().map(condition_from).transpose();
    Ok(Write {
        upserts: (input.upserts.unwrap_or_default().into_iter())
            .map(doc_from)
            .collect::<Result<_>>()?,
        patches: (input.patches.unwrap_or_default().into_iter())
            .map(|patch| {
                Ok(Patch {
                    id: id_from(patch.id)?,
                    changes: changes_from(patch.attributes)?,
                })
            })
            .collect::<Result<_>>()?,
        deletes: (input.deletes.unwrap_or_default().into_iter())
            .map(id_from)
            .collect::<Result<_>>()?,
        upsert_if: condition(input.upsert_if)?,
        patch_if: condition(input.patch_if)?,
        delete_if: condition(input.delete_if)?,
        delete_by: input.delete_by.as_ref().map(filter_from).transpose()?,
        patch_by: input
            .patch_by
            .map(|by| {
                Ok::<_, napi::Error>((filter_from(&by.filter)?, changes_from(by.attributes)?))
            })
            .transpose()?,
        return_ids: input.return_affected_ids.unwrap_or(false),
        exact_deletes: input.exact_deletes.unwrap_or(false),
    })
}

pub(crate) fn counts_to(counts: Counts) -> IndexCounts {
    let ids = |list: Vec<Id>| Some(list.into_iter().map(id_to).collect());
    let (upserted_ids, patched_ids, deleted_ids) = match counts.ids {
        Some(a) => (ids(a.upserted), ids(a.patched), ids(a.deleted)),
        None => (None, None, None),
    };
    IndexCounts {
        upserted: counts.upserted as u32,
        patched: counts.patched as u32,
        deleted: counts.deleted as u32,
        missing: counts.missing as u32,
        upserted_ids,
        patched_ids,
        deleted_ids,
    }
}
