//! Merging one branch into another.

use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering::Relaxed};

use skywake_core::Hash;

use super::append;
use crate::Result;
use crate::format::{SegmentRef, Version};
use crate::store::{Storage, Written};

pub(crate) async fn merge(storage: &Storage, into: &str, from: &str) -> Result<u64> {
    let (source, target) = futures::try_join!(storage.current(from), storage.current(into))?;
    let schema = target.schema.merge(&source.schema)?;
    let source = segments(storage, &source).await?;
    let had: HashSet<Hash> = (segments(storage, &target).await?.iter())
        .map(|segment| segment.hash)
        .collect();
    let mut written = Written::new();
    written.chunks(source.iter().map(|segment| segment.hash));
    let added = |current: &Version| -> Vec<SegmentRef> {
        let tail: HashSet<Hash> = current.tail.iter().map(|segment| segment.hash).collect();
        (source.iter())
            .filter(|segment| !had.contains(&segment.hash) && !tail.contains(&segment.hash))
            .cloned()
            .collect()
    };
    let rows = AtomicU64::new(0);
    storage
        .save(into, &written, |current| {
            rows.store(0, Relaxed);
            let added = added(current);
            let schema = current.schema.merge(&schema).ok()?;
            if added.is_empty() {
                return None;
            }
            rows.store(added.iter().map(|segment| segment.rows).sum(), Relaxed);
            Some(Version {
                schema,
                ..append(current, &added)
            })
        })
        .await?;
    Ok(rows.into_inner())
}

async fn segments(storage: &Storage, version: &Version) -> Result<Vec<SegmentRef>> {
    let built = version.built.open::<SegmentRef>(storage).await?;
    Ok(built.iter().chain(&version.tail).cloned().collect())
}
