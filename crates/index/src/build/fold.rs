//! Folding the built segments into parts. A part keeps the newest write of a
//! span of ids, so a replay reads each live row once, not every write ever made.
//! A fold rewrites only the parts its writes land in.

use std::cmp::Ordering;
use std::collections::{HashSet, VecDeque};

use futures::TryStreamExt;
use serde::{Deserialize, Serialize};
use skywake_core::Hash;
use skywake_core::list::List;

use super::full::runs::{Merged, Runs, Sorter};
use super::segments;
use crate::format::pages::Pages;
use crate::format::parts::{self, PartRef, Source};
use crate::format::{BLOB_MAX, Segment, SegmentRef, Version, lists, pack};
use crate::store::{Storage, Written};
use crate::{Attributes, Id, Result, Schema};

/// Built writes fold once they reach this share of the parts.
const RATIO: u64 = 8;

const PENDING_PARTS: usize = 4;

pub(super) struct Folded {
    pub folded: u64,
    pub parts: List<PartRef>,
}

pub(super) async fn fold(
    storage: &Storage,
    version: &Version,
    built: &Pages,
    (budget, spill, least): (usize, bool, u64),
    written: &mut Written,
) -> Result<Option<Folded>> {
    let refs: Vec<Source> = (built.open::<SegmentRef>(storage).await?.iter())
        .map(Source::from)
        .collect();
    let bytes: u64 = refs.iter().map(|r| r.bytes).sum();
    if refs.is_empty() || bytes < least {
        return Ok(None);
    }
    let walked = lists::walk(storage, &version.parts).await?;
    if bytes * RATIO < walked.entries.iter().map(|part| part.bytes).sum::<u64>() {
        return Ok(None);
    }
    let schema = &version.schema;
    let rows: u64 = refs.iter().map(|r| r.rows).sum();
    let row_bytes = (bytes / rows.max(1) * 9 / 8).max(64) as usize;
    let runs = Runs::new(storage, spill)?;
    let mut sorter = Sorter::new(&runs, budget / 4 / row_bytes);
    let mut pass = segments(storage, &refs);
    while let Some((first_seq, segment)) = pass.try_next().await? {
        for (seq, id, row) in segment.writes(first_seq) {
            let doc = row.map(|row| doc(schema, &segment, row));
            sorter.push(Write::new(id.clone(), seq, doc)).await?;
        }
    }
    drop(pass);
    let mut incoming = Incoming::new(sorter.finish().await?).await?;
    let mut out = Out {
        storage,
        schema,
        row_bytes,
        pending: Vec::new(),
        parts: Vec::new(),
    };
    let n = walked.entries.len();
    for (i, part) in walked.entries.iter().enumerate() {
        let bound = (i + 1 < n).then_some(&part.last);
        if !incoming.waiting(bound) {
            out.flush(written).await?;
            out.parts.push(part.clone());
            continue;
        }
        let stored = storage.part(part.hash).await?;
        let mut old: VecDeque<Write> = writes(schema, &stored).into();
        while let Some(new) = incoming.pop(bound).await? {
            while old.front().is_some_and(|o| o.id < new.id) {
                out.push(old.pop_front().expect("a row"), written).await?;
            }
            old.pop_front_if(|o| o.id == new.id);
            out.push(new, written).await?;
        }
        for row in old {
            out.push(row, written).await?;
        }
    }
    while let Some(new) = incoming.pop(None).await? {
        out.push(new, written).await?;
    }
    out.flush(written).await?;
    let old: HashSet<Hash> = walked.nodes.into_iter().collect();
    let parts = lists::store(storage, out.parts, &old, written).await?;
    Ok(Some(Folded {
        folded: version.folded + built.len,
        parts,
    }))
}

type Doc = (Vec<Vec<f32>>, Attributes);

#[derive(Serialize, Deserialize)]
struct Write {
    id: Id,
    seq: u64,
    doc: Option<Doc>,
}

impl Write {
    fn new(id: Id, seq: u64, doc: Option<Doc>) -> Self {
        Self { id, seq, doc }
    }
}

impl PartialEq for Write {
    fn eq(&self, other: &Self) -> bool {
        (&self.id, self.seq) == (&other.id, other.seq)
    }
}

impl Eq for Write {}

impl PartialOrd for Write {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Write {
    fn cmp(&self, other: &Self) -> Ordering {
        (&self.id, self.seq).cmp(&(&other.id, other.seq))
    }
}

fn doc(schema: &Schema, segment: &Segment, row: usize) -> Doc {
    let vectors = (schema.vectors.values().enumerate())
        .map(|(c, column)| segment.vector(c, column.dims, row).to_vec())
        .collect();
    (vectors, segment.attributes[row].clone())
}

fn writes(schema: &Schema, part: &Segment) -> Vec<Write> {
    let mut rows: Vec<Write> = (part.writes(0))
        .map(|(seq, id, row)| Write::new(id.clone(), seq, row.map(|row| doc(schema, part, row))))
        .collect();
    rows.sort_unstable_by(|a, b| a.id.cmp(&b.id));
    rows
}

fn part(schema: &Schema, rows: &[Write]) -> Segment {
    let docs: Vec<(&Write, &Doc)> = rows
        .iter()
        .filter_map(|w| Some((w, w.doc.as_ref()?)))
        .collect();
    let deletes: Vec<&Write> = rows.iter().filter(|w| w.doc.is_none()).collect();
    Segment {
        ids: docs.iter().map(|(w, _)| w.id.clone()).collect(),
        vectors: (0..schema.vectors.len())
            .map(|c| {
                docs.iter()
                    .flat_map(|(_, doc)| doc.0[c].iter().copied())
                    .collect()
            })
            .collect(),
        attributes: docs.iter().map(|(_, doc)| doc.1.clone()).collect(),
        deletes: deletes.iter().map(|w| w.id.clone()).collect(),
        seqs: (docs.iter().map(|(w, _)| w.seq))
            .chain(deletes.iter().map(|w| w.seq))
            .collect(),
    }
}

/// The built writes in id order, newest write of each id only.
struct Incoming<'r> {
    merged: Merged<'r, Write>,
    next: Option<Write>,
}

impl<'r> Incoming<'r> {
    async fn new(mut merged: Merged<'r, Write>) -> Result<Self> {
        let next = merged.next().await?;
        Ok(Self { merged, next })
    }

    fn waiting(&self, bound: Option<&Id>) -> bool {
        (self.next.as_ref()).is_some_and(|w| bound.is_none_or(|bound| w.id <= *bound))
    }

    async fn pop(&mut self, bound: Option<&Id>) -> Result<Option<Write>> {
        if !self.waiting(bound) {
            return Ok(None);
        }
        let mut write = self.next.take().expect("a waiting write");
        loop {
            self.next = self.merged.next().await?;
            match self.next.take_if(|next| next.id == write.id) {
                Some(newer) => write = newer,
                None => return Ok(Some(write)),
            }
        }
    }
}

struct Out<'a> {
    storage: &'a Storage,
    schema: &'a Schema,
    row_bytes: usize,
    pending: Vec<Write>,
    parts: Vec<PartRef>,
}

impl Out<'_> {
    async fn push(&mut self, row: Write, written: &mut Written) -> Result<()> {
        self.pending.push(row);
        if self.pending.len() >= PENDING_PARTS * (BLOB_MAX / self.row_bytes).max(1) {
            self.flush(written).await?;
        }
        Ok(())
    }

    async fn flush(&mut self, written: &mut Written) -> Result<()> {
        let rows = std::mem::take(&mut self.pending);
        let schema = self.schema;
        let packed = pack(&rows, self.row_bytes, &|rows| {
            parts::encode(&part(schema, rows))
        })?;
        let mut at = 0;
        for (bytes, count) in packed {
            let size = bytes.len() as u64;
            let hash = self.storage.put(bytes).await?;
            written.chunks([hash]);
            self.parts.push(PartRef {
                hash,
                rows: count as u64,
                bytes: size,
                first: rows[at].id.clone(),
                last: rows[at + count - 1].id.clone(),
            });
            at += count;
        }
        Ok(())
    }
}
