//! Live rows folded out of the write history. Each part holds the newest write
//! of a span of ids, sorted by id, and keeps the sequence number each write had.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use skywake_core::Hash;

use super::{Segment, SegmentRef, Version, lists};
use crate::store::Storage;
use crate::{Id, Result};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct PartRef {
    pub hash: Hash,
    pub rows: u64,
    pub bytes: u64,
    pub first: Id,
    pub last: Id,
}

/// A blob a replay of the history reads: a part, or a segment as it was written.
#[derive(Clone, Debug)]
pub(crate) struct Source {
    pub hash: Hash,
    pub rows: u64,
    pub bytes: u64,
    pub first_seq: u64,
    pub part: bool,
}

impl From<&SegmentRef> for Source {
    fn from(segment: &SegmentRef) -> Self {
        Self {
            hash: segment.hash,
            rows: segment.rows,
            bytes: segment.bytes,
            first_seq: segment.first_seq,
            part: false,
        }
    }
}

impl From<&PartRef> for Source {
    fn from(part: &PartRef) -> Self {
        Self {
            hash: part.hash,
            rows: part.rows,
            bytes: part.bytes,
            first_seq: 0,
            part: true,
        }
    }
}

impl Source {
    pub(crate) async fn get(&self, storage: &Storage) -> Result<Arc<Segment>> {
        match self.part {
            true => storage.part(self.hash).await,
            false => storage.get(self.hash).await,
        }
    }

    pub(crate) async fn fetch(&self, storage: &Storage) -> Result<Segment> {
        match self.part {
            true => decode(&storage.fetch_raw(self.hash).await?),
            false => storage.fetch(self.hash).await,
        }
    }
}

pub(crate) fn encode(part: &Segment) -> Result<Vec<u8>> {
    Ok(postcard::to_stdvec(&(&part.seqs, part))?)
}

pub(crate) fn decode(bytes: &[u8]) -> Result<Segment> {
    let (seqs, mut part): (Vec<u64>, Segment) = postcard::from_bytes(bytes)?;
    part.seqs = seqs;
    Ok(part)
}

/// Every blob a full replay reads, oldest writes first: the parts, the built
/// segments, then the tail when asked for.
pub(crate) async fn sources(
    storage: &Storage,
    version: &Version,
    tail: bool,
) -> Result<Vec<Source>> {
    let parts = lists::all(storage, &version.parts).await?;
    let built = version.built.open::<SegmentRef>(storage).await?;
    let tail = version.tail.iter().filter(|_| tail);
    Ok((parts.iter().map(Source::from))
        .chain(built.iter().chain(tail).map(Source::from))
        .collect())
}
