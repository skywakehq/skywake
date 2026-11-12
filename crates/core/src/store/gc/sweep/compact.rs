//! Compaction: bundles that are mostly unused are rewritten with only the files still used.

use chrono::Utc;
use object_store::{ObjectMeta, ObjectStoreExt};

use super::super::bucket::{delete, old};
use super::super::{Lock, held, mark};
use super::{Sweep, named};
use crate::model::Bundled;
use crate::store::bundles::{Moved, new_id};
use crate::store::io::found;
use crate::store::objects::{CHUNK_LIMIT, bundle_path, verify};
use crate::{Error, Hash, Objects, Result};

impl Sweep<'_> {
    pub(super) async fn compact_all(
        &mut self,
        lease: &mut Lock<'_>,
        sparse: Vec<ObjectMeta>,
    ) -> Result<()> {
        if sparse.is_empty() {
            return Ok(());
        }
        if lease.is_none() {
            self.collected.compacted += sparse.len() as u64;
            return Ok(());
        }
        self.on_time()?;
        held(lease).await?;
        mark(lease, true).await?;
        let compacted = self.compact_sparse(lease, sparse).await;
        let unmarked = mark(lease, false).await;
        compacted.and(unmarked)
    }

    async fn compact_sparse(
        &mut self,
        lease: &mut Lock<'_>,
        sparse: Vec<ObjectMeta>,
    ) -> Result<()> {
        self.owned_heads(lease).await?;
        let store = self.objects.store().as_ref();
        let mut doomed = Vec::new();
        for meta in sparse {
            let Some(now) = found(store.head(&meta.location).await)? else {
                continue;
            };
            if !old(&now, Utc::now(), self.grace) || !self.sparse(&now) {
                continue;
            }
            held(lease).await?;
            let bundle = named(&now, "bundles").expect("listed by hash");
            let live = self.live(bundle);
            self.collected.deleted_bytes += compact(self.objects, bundle, live).await?;
            self.collected.compacted += 1;
            doomed.push(now.location);
        }
        held(lease).await?;
        let Some(lease) = lease else { return Ok(()) };
        lease.within(delete(store, doomed)).await
    }
}

async fn compact(objects: &Objects, bundle: Hash, live: Vec<Bundled>) -> Result<u64> {
    let path = bundle_path(bundle);
    let old = objects.fetch(&path).await?;
    let new = new_id();
    let mut moved = Moved::default();
    let mut bytes = Vec::new();
    for at in live {
        let start = at.offset as usize;
        let stored = old
            .get(start..start + at.len as usize)
            .ok_or_else(|| Error::Corrupt(format!("{path}: a file is past its end")))?;
        verify(&path, stored, at.chunk.hash, CHUNK_LIMIT)?;
        let to = Bundled {
            offset: bytes.len() as u32,
            bundle: new,
            ..at
        };
        bytes.extend_from_slice(stored);
        moved.to.push((at.offset, to));
    }
    let kept = bytes.len() as u64;
    objects.store().put(&bundle_path(new), bytes.into()).await?;
    objects.put_moved(bundle, &moved).await?;
    Ok(old.len() as u64 - kept)
}
