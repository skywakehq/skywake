//! Merging one branch into another. The lines of the two branches say which
//! writes they share, so a merge takes only the writes the target lacks, even
//! after either branch folded its history into parts.

use std::collections::{BTreeMap, HashSet};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering::Relaxed};

use skywake_core::Hash;

use super::{append, encode_deletes, encode_docs, store};
use crate::export::doc;
use crate::format::line::Import;
use crate::format::parts::{self, Source};
use crate::format::{Segment, Version};
use crate::store::Storage;
use crate::{Id, Result};

pub(crate) async fn merge(storage: &Storage, into: &str, from: &str) -> Result<u64> {
    let (source, target) = futures::try_join!(storage.current(from), storage.current(into))?;
    let schema = target.schema.merge(&source.schema)?;
    let (shared, theirs) = target.line.shared(&source.line);
    let had: HashSet<Hash> = (parts::sources(storage, &target, true).await?.iter())
        .map(|source| source.hash)
        .collect();
    let mut newest: BTreeMap<Id, (u64, Option<(usize, usize)>)> = BTreeMap::new();
    let mut blobs: Vec<Arc<Segment>> = Vec::new();
    let sources: Vec<Source> = parts::sources(storage, &source, true).await?;
    for blob in sources.iter().filter(|source| !had.contains(&source.hash)) {
        let segment = blob.get(storage).await?;
        for (seq, id, row) in segment.writes(blob.first_seq) {
            if seq < shared || theirs.iter().any(|taken| taken.contains(&seq)) {
                continue;
            }
            let place = row.map(|row| (blobs.len(), row));
            if newest.get(id).is_none_or(|&(newer, _)| seq > newer) {
                newest.insert(id.clone(), (seq, place));
            }
        }
        blobs.push(segment);
    }
    let docs: Vec<_> = (newest.values())
        .filter_map(|&(_, place)| place)
        .map(|(blob, row)| doc(&source, &blobs[blob], row))
        .collect();
    let deletes: Vec<Id> = (newest.iter())
        .filter(|(_, (_, place))| place.is_none())
        .map(|(id, _)| id.clone())
        .collect();
    let mut encoded = encode_docs(&source.schema, &docs)?;
    encoded.extend(encode_deletes(&deletes)?);
    let (written, stored) = store(storage, encoded).await?;
    let rows = AtomicU64::new(0);
    let line = source.line.id;
    storage
        .save(into, &written, |current| {
            rows.store(0, Relaxed);
            let taken = (current.line.imports.iter())
                .filter(|import| import.line == line)
                .any(|import| import.upto >= source.next_seq);
            if stored.is_empty() || taken {
                return None;
            }
            let schema = current.schema.merge(&schema).ok()?;
            let mut next = append(current, &stored);
            rows.store(next.next_seq - current.next_seq, Relaxed);
            next.line.imports.push(Import {
                line,
                upto: source.next_seq,
                at: current.next_seq..next.next_seq,
            });
            Some(Version { schema, ..next })
        })
        .await?;
    Ok(rows.into_inner())
}
