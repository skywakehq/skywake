//! Building the text index, in the same commit as the cluster build.

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use futures::TryStreamExt;
use futures::future::try_join_all;

use super::fields::{Fields, key};
use super::part::{self, PartRef, PartWriter, TextIndex, blocking};
use crate::build::segments;
use crate::format::{Segment, SegmentRef, Version};
use crate::store::{Storage, Written};
use crate::{Id, Result};

const MAX_PARTS: usize = 8;

const DEAD_SHARE: u64 = 5;

const BATCH: usize = 4096;

pub(crate) async fn build(
    storage: &Storage,
    version: &Version,
    budget: usize,
    full: bool,
    written: &mut Written,
) -> Result<Option<TextIndex>> {
    if version.schema.text.is_empty() {
        return Ok(None);
    }
    let base = version.text.clone().unwrap_or_default();
    let docs: u64 = base.parts.iter().map(|p| p.docs as u64).sum();
    let dead: u64 = base.parts.iter().map(|p| p.dead_docs as u64).sum();
    let anew = full
        || base.parts.len() >= MAX_PARTS
        || dead * DEAD_SHARE > docs
        || (base.parts.is_empty() && version.covers() > 0);
    let mut refs: Vec<SegmentRef> = Vec::new();
    if anew {
        let built = version.built.open::<SegmentRef>(storage).await?;
        refs.extend(built.iter().cloned());
    }
    refs.extend_from_slice(&version.tail);
    if refs.is_empty() {
        return Ok(Some(base));
    }

    let mut newest: HashMap<Id, u64> = HashMap::new();
    let mut pass = segments(storage, &refs);
    while let Some((first_seq, segment)) = pass.try_next().await? {
        for (seq, id, _) in segment.writes(first_seq) {
            newest.insert(id.clone(), seq);
        }
    }
    drop(pass);

    let mut parts = Vec::new();
    if !anew {
        let keys: Vec<u64> = {
            let mut keys: Vec<u64> = newest.keys().map(key).collect();
            keys.sort_unstable();
            keys.dedup();
            keys
        };
        for part in &base.parts {
            parts.extend(kill(storage, part, &keys, written).await?);
        }
    }

    let kept = try_join_all(
        parts
            .iter()
            .map(|p| part::open(storage, p.hot, p.hot_bytes)),
    )
    .await?;
    let fields = Arc::new(Fields::new(&version.schema, part::widest(&kept)));
    let mut writer = Some(PartWriter::new(fields, budget / 2)?);
    let mut pass = segments(storage, &refs);
    while let Some((first_seq, segment)) = pass.try_next().await? {
        let segment = Arc::new(segment);
        let current = current(&segment, first_seq, &newest);
        for batch in current.chunks(BATCH) {
            let mut moved = writer.take().expect("a writer");
            let (segment, batch) = (Arc::clone(&segment), batch.to_vec());
            moved = blocking(move || -> Result<PartWriter> {
                for row in batch {
                    moved.add(&segment.ids[row], &segment.attributes[row])?;
                }
                Ok(moved)
            })
            .await??;
            writer = Some(moved);
        }
    }
    drop(pass);
    drop(newest);
    let writer = writer.expect("a writer");
    if writer.docs() > 0 {
        let built = blocking(move || writer.finish()).await??;
        parts.push(built.store(storage, written).await?);
    }
    Ok(Some(TextIndex { parts }))
}

fn current(segment: &Segment, first_seq: u64, newest: &HashMap<Id, u64>) -> Vec<usize> {
    (segment.writes(first_seq))
        .filter_map(|(seq, id, row)| row.filter(|_| newest.get(id) == Some(&seq)))
        .collect()
}

async fn kill(
    storage: &Storage,
    part: &PartRef,
    keys: &[u64],
    written: &mut Written,
) -> Result<Option<PartRef>> {
    let opened = part::open(storage, part.hot, part.hot_bytes).await?;
    let found: BTreeMap<u64, u32> = part::find(storage, &opened.ids, keys).await?;
    if found.is_empty() {
        return Ok(Some(part.clone()));
    }
    let mut bits = match part::dead(storage, part).await? {
        Some(bits) => bits.as_ref().clone(),
        None => Vec::new(),
    };
    let mut dead = part.dead_docs;
    for &doc in found.values() {
        dead += part::set(&mut bits, doc) as u32;
    }
    if dead >= part.docs {
        return Ok(None);
    }
    let hash = storage.put(postcard::to_stdvec(&bits)?).await?;
    written.chunks([hash]);
    Ok(Some(PartRef {
        dead: Some(hash),
        dead_docs: dead,
        ..part.clone()
    }))
}
