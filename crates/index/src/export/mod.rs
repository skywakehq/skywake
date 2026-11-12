//! Reading documents by id.

pub(crate) mod parquet;

use std::collections::HashMap;
use std::sync::Arc;

use futures::{StreamExt, TryStreamExt, stream};
use object_store::{ObjectStore, ObjectStoreExt};

use crate::format::pages::Paged;
use crate::format::{Segment, SegmentRef, Version};
use crate::history::gc;
use crate::read::live;
use crate::store::head;
use crate::store::{PARALLELISM, Storage};
use crate::{Doc, Id, Index, MAIN, Result};

type Write = (u64, Option<(usize, usize)>);

impl Index {
    pub async fn scan(&self, after: Option<&Id>, limit: usize) -> Result<Vec<Doc>> {
        let version = self.version().await?;
        let after = (after.cloned().map(|id| version.schema.id.check(id))).transpose()?;
        let after = after.as_ref();
        let segments = segments(&self.storage, &version).await?;
        let mut newest: HashMap<&Id, Write> = HashMap::new();
        for (i, (first_seq, segment)) in segments.iter().enumerate() {
            for (seq, id, row) in segment.writes(*first_seq) {
                if after.is_some_and(|after| id <= after) {
                    continue;
                }
                let place = row.map(|row| (i, row));
                newest
                    .entry(id)
                    .and_modify(|old| {
                        if seq > old.0 {
                            *old = (seq, place);
                        }
                    })
                    .or_insert((seq, place));
            }
        }
        let mut live: Vec<(&Id, (usize, usize))> = (newest.into_iter())
            .filter_map(|(id, (_, place))| Some((id, place?)))
            .collect();
        live.sort_unstable_by(|a, b| a.0.cmp(b.0));
        live.truncate(limit);
        Ok((live.into_iter())
            .map(|(_, (i, row))| doc(&version, &segments[i].1, row))
            .collect())
    }

    pub async fn get(&self, id: &Id) -> Result<Option<Doc>> {
        let snapshot = self.snapshot().await?;
        Ok(snapshot.get_many(std::slice::from_ref(id)).await?.pop())
    }
}

pub struct Export {
    storage: Arc<Storage>,
    version: Arc<Version>,
    segments: Vec<SegmentRef>,
    current: HashMap<Id, u64>,
    next: usize,
}

impl Index {
    pub async fn export(&self) -> Result<Export> {
        let version = self.version().await?;
        let built: Paged<SegmentRef> = version.built.open(&self.storage).await?;
        let segments = built.iter().chain(version.tail()).cloned().collect();
        let current = live::current(&self.storage, &version).await?;
        Ok(Export {
            storage: self.storage.clone(),
            version,
            segments,
            current,
            next: 0,
        })
    }

    pub async fn copy_to(&self, store: Arc<dyn ObjectStore>) -> Result<Index> {
        let version = self.version().await?;
        let from = self.storage.store.clone();
        let used = gc::used_by(from.clone(), &version).await?;
        let paths = gc::paths_of(from.as_ref(), &used).await?;
        stream::iter(paths)
            .map(|path| {
                let (from, to) = (from.clone(), store.clone());
                async move {
                    let bytes = from.get(&path).await?.bytes().await?;
                    to.put(&path, bytes.into()).await?;
                    Ok::<_, crate::Error>(())
                }
            })
            .buffer_unordered(PARALLELISM)
            .try_collect::<()>()
            .await?;
        let mut fresh = (*version).clone();
        fresh.parent = None;
        let copy = Index::at(store, MAIN, self.options.clone());
        let hash = copy.storage.put_version(&fresh).await?;
        head::create(copy.storage.store.as_ref(), MAIN, hash, &[]).await?;
        Ok(copy)
    }
}

impl Export {
    pub async fn next(&mut self) -> Result<Option<Vec<Doc>>> {
        let Some(segment) = self.segments.get(self.next) else {
            return Ok(None);
        };
        self.next += 1;
        let blob: Arc<Segment> = self.storage.get(segment.hash).await?;
        let docs = blob.writes(segment.first_seq).filter_map(|(seq, id, row)| {
            let row = row?;
            (self.current.get(id) == Some(&seq)).then(|| doc(&self.version, &blob, row))
        });
        Ok(Some(docs.collect()))
    }
}

async fn segments(storage: &Storage, version: &Version) -> Result<Vec<(u64, Arc<Segment>)>> {
    let built: Paged<SegmentRef> = version.built.open(storage).await?;
    let refs: Vec<&SegmentRef> = built.iter().chain(version.tail()).collect();
    let blobs = storage
        .get_all(refs.iter().map(|r| r.hash).collect())
        .await?;
    Ok(refs.iter().map(|r| r.first_seq).zip(blobs).collect())
}

pub(crate) fn doc(version: &Version, segment: &Segment, row: usize) -> Doc {
    let mut doc = Doc::new(segment.ids[row].clone());
    for (column, (name, spec)) in version.schema.vectors.iter().enumerate() {
        let vector = segment.vector(column, spec.dims, row).to_vec();
        doc.vectors.insert(name.clone(), vector);
    }
    doc.attributes = segment.attributes[row].clone();
    doc
}

#[cfg(test)]
mod tests {
    use object_store::memory::InMemory;

    use crate::{Doc, Id, Index, Metric, Schema};

    fn doc(id: impl Into<Id>, x: f32) -> Doc {
        Doc::new(id)
            .vector("v", vec![x, 1.0])
            .attribute("x", x as f64)
    }

    async fn index() -> Index {
        let schema = Schema::new().vector("v", 2, Metric::Euclidean);
        let schema = schema.attribute("x", crate::Kind::Number);
        Index::create(std::sync::Arc::new(InMemory::new()), schema)
            .await
            .unwrap()
    }

    fn ids(docs: &[Doc]) -> Vec<Id> {
        docs.iter().map(|d| d.id.clone()).collect()
    }

    #[tokio::test]
    async fn scan_pages_through_the_newest_documents_in_id_order() {
        let index = index().await;
        index
            .upsert(vec![doc(3, 3.0), doc("b", 0.0), doc(1, 1.0), doc(2, 2.0)])
            .await
            .unwrap();
        index.build().await.unwrap();
        index
            .upsert(vec![doc(2, 20.0), doc("a", 0.0)])
            .await
            .unwrap();
        index.delete(vec![Id::Num(3)]).await.unwrap();

        let first = index.scan(None, 2).await.unwrap();
        assert_eq!(ids(&first), [Id::Num(1), Id::Num(2)]);
        assert_eq!(first[1].vectors["v"], [20.0, 1.0]);
        let rest = index.scan(Some(&first[1].id), 10).await.unwrap();
        assert_eq!(ids(&rest), [Id::from("a"), Id::from("b")]);
        assert!(
            index
                .scan(Some(&Id::from("b")), 10)
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn get_finds_the_newest_write_of_an_id() {
        let index = index().await;
        index.upsert(vec![doc(1, 1.0), doc(2, 2.0)]).await.unwrap();
        index.build().await.unwrap();
        index.upsert(vec![doc(1, 10.0)]).await.unwrap();
        index.delete(vec![Id::Num(2)]).await.unwrap();

        let one = index.get(&Id::Num(1)).await.unwrap().unwrap();
        assert_eq!(one.vectors["v"], [10.0, 1.0]);
        assert!(index.get(&Id::Num(2)).await.unwrap().is_none());
        assert!(index.get(&Id::Num(9)).await.unwrap().is_none());
    }
}
