//! The row map.

use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::sync::Arc;

use futures::{StreamExt, TryStreamExt, stream};
use serde::{Deserialize, Serialize};
use skywake_core::Hash;
use skywake_core::list::{Built, List, Node};

use super::pages::PAGE;
use crate::store::{PARALLELISM, Storage, Written};
use crate::{Id, Result};

#[derive(Clone, Default, Serialize, Deserialize)]
pub(crate) struct RowPage {
    pub ids: Vec<Id>,
    pub seqs: Vec<u64>,
    pub clusters: Vec<u32>,
}

impl RowPage {
    pub(crate) fn find(&self, id: &Id) -> Option<usize> {
        self.ids.binary_search(id).ok()
    }

    pub(crate) fn push(&mut self, id: Id, seq: u64, clusters: &[u32]) {
        self.ids.push(id);
        self.seqs.push(seq);
        self.clusters.extend_from_slice(clusters);
    }

    pub(crate) fn sorted(self, columns: usize) -> RowPage {
        let mut order: Vec<usize> = (0..self.ids.len()).collect();
        order.sort_by(|&a, &b| self.ids[a].cmp(&self.ids[b]));
        let mut sorted = RowPage::default();
        for i in order {
            let clusters = &self.clusters[i * columns..(i + 1) * columns];
            sorted.push(self.ids[i].clone(), self.seqs[i], clusters);
        }
        sorted
    }
}

pub(crate) type RowMap = List<Hash>;

const INLINE: usize = if cfg!(test) { 4 } else { 256 };

pub(crate) fn pages_for(rows: usize) -> usize {
    rows.div_ceil(PAGE).max(1)
}

pub(crate) fn page_of(id: &Id, pages: usize) -> usize {
    let bytes = postcard::to_stdvec(id).unwrap_or_default();
    let hash = bytes.iter().fold(0xcbf2_9ce4_8422_2325u64, |h, &b| {
        (h ^ b as u64).wrapping_mul(0x0000_0100_0000_01b3)
    });
    (hash % pages as u64) as usize
}

pub(crate) async fn store(
    storage: &Storage,
    pages: &[RowPage],
    written: &mut Written,
) -> Result<(Vec<Hash>, Vec<u64>)> {
    let encoded = (pages.iter())
        .map(postcard::to_stdvec)
        .collect::<Result<Vec<_>, _>>()?;
    let stored: Vec<(Hash, u64)> = stream::iter(encoded)
        .map(|bytes| async move {
            let size = bytes.len() as u64;
            Ok::<_, crate::Error>((storage.put(bytes).await?, size))
        })
        .buffered(PARALLELISM)
        .try_collect()
        .await?;
    written.chunks(stored.iter().map(|(hash, _)| *hash));
    Ok(stored.into_iter().unzip())
}

pub(crate) async fn map(
    storage: &Storage,
    pages: Vec<Hash>,
    written: &mut Written,
) -> Result<RowMap> {
    save(
        storage,
        List::build(pages, INLINE)?,
        &HashSet::new(),
        written,
    )
    .await
}

pub(crate) async fn replace(
    storage: &Storage,
    map: &RowMap,
    changed: impl IntoIterator<Item = (usize, Hash)>,
    written: &mut Written,
) -> Result<RowMap> {
    let walked = map.walk(|hash| storage.get::<Node<Hash>>(hash)).await?;
    let mut pages = walked.entries;
    for (at, hash) in changed {
        pages[at] = hash;
    }
    let old = walked.nodes.into_iter().collect();
    save(storage, List::build(pages, INLINE)?, &old, written).await
}

async fn save(
    storage: &Storage,
    built: Built<Hash>,
    old: &HashSet<Hash>,
    written: &mut Written,
) -> Result<RowMap> {
    let fresh = (built.nodes.into_iter())
        .filter(|(hash, _)| !old.contains(hash))
        .map(|(_, bytes)| bytes);
    let stored: Vec<Hash> = stream::iter(fresh)
        .map(|bytes| storage.put(bytes))
        .buffered(PARALLELISM)
        .try_collect()
        .await?;
    written.chunks(stored);
    Ok(built.list)
}

pub(crate) async fn hashes(storage: &Storage, map: &RowMap) -> Result<Vec<Hash>> {
    map.all(|hash| storage.get::<Node<Hash>>(hash)).await
}

pub(crate) async fn all(storage: &Storage, map: &RowMap) -> Result<Vec<Arc<RowPage>>> {
    storage.get_all(hashes(storage, map).await?).await
}

pub(crate) fn page_in(id: &Id, map: &RowMap) -> usize {
    page_of(id, map.len() as usize)
}

pub(crate) async fn pages_of<'a>(
    storage: &Storage,
    map: &RowMap,
    ids: impl Iterator<Item = &'a Id>,
) -> Result<BTreeMap<usize, Arc<RowPage>>> {
    let wanted: BTreeSet<usize> = ids.map(|id| page_in(id, map)).collect();
    let at: Vec<u64> = wanted.iter().map(|&p| p as u64).collect();
    let hashes = map
        .get_many(&at, |hash| storage.get::<Node<Hash>>(hash))
        .await?;
    let pages = storage.get_all(hashes).await?;
    Ok(wanted.into_iter().zip(pages).collect())
}
