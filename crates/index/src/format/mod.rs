//! What the index stores: the Version and the blobs it names.

pub(crate) mod cluster;
pub(crate) mod directory;
pub(crate) mod legacy;
pub(crate) mod pages;
pub(crate) mod rows;

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use skywake_core::Hash;

pub(crate) use legacy::decode_version;

use crate::filter::FilterPart;
use crate::text::part::TextIndex;
use crate::vector::calibrate::Calibration;
use crate::{Attributes, Id, Result, Schema, invalid};
use pages::Pages;

pub(crate) const FORMAT: u32 = 10;

pub(crate) const BLOB_MAX: usize = 4 << 20;

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct Version {
    pub format: u32,
    pub parent: Option<Hash>,
    pub schema: Schema,
    pub built: Pages,
    pub tail: Vec<SegmentRef>,
    pub ann: Option<Ann>,
    pub next_seq: u64,
    pub text: Option<TextIndex>,
}
impl Version {
    pub(crate) fn new(schema: Schema) -> Self {
        Self {
            format: FORMAT,
            parent: None,
            schema,
            built: Pages::default(),
            tail: Vec::new(),
            ann: None,
            next_seq: 0,
            text: None,
        }
    }

    pub(crate) fn covers(&self) -> usize {
        self.built.len as usize
    }

    pub(crate) fn tail(&self) -> &[SegmentRef] {
        &self.tail
    }

    pub(crate) fn weight(&self) -> usize {
        let pages: usize = (self.ann.iter())
            .flat_map(|ann| ann.columns.values())
            .map(|column| column.table.hashes.len())
            .sum();
        let parts = self.text.as_ref().map_or(0, |text| 256 * text.parts.len());
        1024 + 64 * self.tail.len() + 32 * (self.built.hashes.len() + pages) + parts
    }
}

#[derive(Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct SegmentRef {
    pub hash: Hash,
    pub rows: u64,
    pub first_seq: u64,
    pub bytes: u64,
}

#[derive(Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct Ann {
    pub columns: BTreeMap<String, Clusters>,
    pub rows: Vec<Hash>,
    pub rows_bytes: u64,
    pub live: u64,
    pub full_rows: u64,
    pub removed: u64,
    pub filters: Hash,
    pub parts: BTreeMap<String, FilterPart>,
}

#[derive(Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct Clusters {
    pub centroids: Hash,
    pub origin: Option<Hash>,
    pub table: Pages,
    pub seed: u64,
    pub calibration: Calibration,
    pub directory: Option<Hash>,
}

#[derive(Default, Serialize, Deserialize)]
pub(crate) struct Segment {
    pub ids: Vec<Id>,
    pub vectors: Vec<Vec<f32>>,
    pub attributes: Vec<Attributes>,
    pub deletes: Vec<Id>,
}

impl Segment {
    pub(crate) fn writes(&self, first_seq: u64) -> impl Iterator<Item = (u64, &Id, Option<usize>)> {
        let docs = self.ids.iter().enumerate().map(|(row, id)| (id, Some(row)));
        let deletes = self.deletes.iter().map(|id| (id, None));
        (first_seq..)
            .zip(docs.chain(deletes))
            .map(|(seq, (id, row))| (seq, id, row))
    }

    pub(crate) fn vector(&self, column: usize, dims: usize, row: usize) -> &[f32] {
        &self.vectors[column][row * dims..(row + 1) * dims]
    }
}

pub(crate) fn pack<T>(
    items: &[T],
    row_bytes: usize,
    encode: &(dyn Fn(&[T]) -> Result<Vec<u8>> + Sync),
) -> Result<Vec<(Vec<u8>, usize)>> {
    fn halve<T>(
        items: &[T],
        encode: &(dyn Fn(&[T]) -> Result<Vec<u8>> + Sync),
        out: &mut Vec<(Vec<u8>, usize)>,
    ) -> Result<()> {
        let bytes = encode(items)?;
        if bytes.len() <= BLOB_MAX {
            out.push((bytes, items.len()));
            return Ok(());
        }
        if items.len() == 1 {
            return Err(invalid("a document is larger than 4 MiB"));
        }
        let (a, b) = items.split_at(items.len() / 2);
        halve(a, encode, out)?;
        halve(b, encode, out)
    }
    let mut out = Vec::new();
    for batch in items.chunks((BLOB_MAX / row_bytes.max(1)).max(1)) {
        halve(batch, encode, &mut out)?;
    }
    Ok(out)
}

#[cfg(test)]
mod tests;
