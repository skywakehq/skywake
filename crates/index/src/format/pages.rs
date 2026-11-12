//! Long lists of a Version, stored in pages.

use std::collections::BTreeMap;
use std::sync::Arc;

use futures::{StreamExt, TryStreamExt, stream};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use skywake_core::Hash;

use crate::Result;
use crate::store::{PARALLELISM, Storage, Written};

pub(crate) const PAGE: usize = 1000;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub(crate) struct Pages {
    pub hashes: Vec<Hash>,
    pub len: u64,
}

pub(crate) struct Paged<T>(Vec<Arc<Vec<T>>>);

impl<T> Paged<T> {
    pub(crate) fn get(&self, i: usize) -> &T {
        &self.0[i / PAGE][i % PAGE]
    }

    pub(crate) fn iter(&self) -> impl Iterator<Item = &T> {
        self.0.iter().flat_map(|page| page.iter())
    }
}

impl Pages {
    pub(crate) async fn open<T>(&self, storage: &Storage) -> Result<Paged<T>>
    where
        T: DeserializeOwned + Send + Sync + 'static,
    {
        Ok(Paged(storage.get_all(self.hashes.clone()).await?))
    }

    pub(crate) async fn write<T: Serialize + Sync>(
        storage: &Storage,
        entries: &[T],
        written: &mut Written,
    ) -> Result<Pages> {
        Ok(Pages {
            hashes: put_pages(storage, entries, written).await?,
            len: entries.len() as u64,
        })
    }

    pub(crate) async fn append<T>(
        &self,
        storage: &Storage,
        more: &[T],
        written: &mut Written,
    ) -> Result<Pages>
    where
        T: Serialize + DeserializeOwned + Clone + Send + Sync + 'static,
    {
        if more.is_empty() {
            return Ok(self.clone());
        }
        let full = self.len as usize / PAGE;
        let mut entries: Vec<T> = match self.hashes.get(full) {
            Some(&last) => storage.get::<Vec<T>>(last).await?.to_vec(),
            None => Vec::new(),
        };
        entries.extend_from_slice(more);
        let mut hashes = self.hashes[..full].to_vec();
        hashes.extend(put_pages(storage, &entries, written).await?);
        Ok(Pages {
            hashes,
            len: self.len + more.len() as u64,
        })
    }

    pub(crate) async fn update<T>(
        &self,
        storage: &Storage,
        changes: BTreeMap<usize, T>,
        written: &mut Written,
    ) -> Result<Pages>
    where
        T: Serialize + DeserializeOwned + Clone + Send + Sync + 'static,
    {
        let mut by_page: BTreeMap<usize, Vec<(usize, T)>> = BTreeMap::new();
        for (i, entry) in changes {
            by_page.entry(i / PAGE).or_default().push((i % PAGE, entry));
        }
        let changed: Vec<(usize, Hash)> = stream::iter(by_page)
            .map(|(page, entries)| async move {
                let mut list = storage.get::<Vec<T>>(self.hashes[page]).await?.to_vec();
                for (i, entry) in entries {
                    list[i] = entry;
                }
                Ok::<_, crate::Error>((page, storage.put(postcard::to_stdvec(&list)?).await?))
            })
            .buffered(PARALLELISM)
            .try_collect()
            .await?;
        let mut pages = self.clone();
        for (page, hash) in changed {
            pages.hashes[page] = hash;
            written.chunks([hash]);
        }
        Ok(pages)
    }
}

async fn put_pages<T: Serialize + Sync>(
    storage: &Storage,
    entries: &[T],
    written: &mut Written,
) -> Result<Vec<Hash>> {
    let encoded = (entries.chunks(PAGE))
        .map(postcard::to_stdvec)
        .collect::<Result<Vec<_>, _>>()?;
    let hashes: Vec<Hash> = stream::iter(encoded)
        .map(|page| storage.put(page))
        .buffered(PARALLELISM)
        .try_collect()
        .await?;
    written.chunks(hashes.iter().copied());
    Ok(hashes)
}

#[cfg(test)]
mod tests {
    use object_store::memory::InMemory;

    use super::*;

    #[tokio::test]
    async fn a_change_rewrites_only_the_pages_it_touches() {
        let storage = Storage::new(Arc::new(InMemory::new()), 1 << 20, None, None);
        let mut written = Written::new();
        let entries: Vec<u64> = (0..2500).collect();
        let pages = Pages::write(&storage, &entries, &mut written)
            .await
            .unwrap();
        assert_eq!((pages.hashes.len(), pages.len), (3, 2500));

        let changed = (pages.update(&storage, [(1200, 7u64)].into(), &mut written))
            .await
            .unwrap();
        assert_eq!(changed.hashes[0], pages.hashes[0]);
        assert_ne!(changed.hashes[1], pages.hashes[1]);
        assert_eq!(changed.hashes[2], pages.hashes[2]);
        assert_eq!(*changed.open::<u64>(&storage).await.unwrap().get(1200), 7);

        let more: Vec<u64> = (2500..3600).collect();
        let longer = pages.append(&storage, &more, &mut written).await.unwrap();
        assert_eq!((longer.hashes.len(), longer.len), (4, 3600));
        assert_eq!(longer.hashes[..2], pages.hashes[..2]);
        let all: Vec<u64> = (longer.open(&storage).await.unwrap().iter().copied()).collect();
        assert_eq!(all, (0..3600).collect::<Vec<u64>>());
    }
}
