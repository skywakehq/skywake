//! Helpers shared by tests.

use std::fmt;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use futures::stream::BoxStream;
use object_store::memory::InMemory;
use object_store::path::Path;
use object_store::{
    CopyOptions, GetOptions, GetRange, GetResult, ListResult, MultipartUpload, ObjectMeta,
    ObjectStore, PutMultipartOptions, PutOptions, PutPayload, PutResult, RenameOptions,
};
use tokio::sync::{Notify, Semaphore};

use crate::format::Version;
use crate::format::cluster::ClusterRef;
use crate::vector::ivf::Random;
use crate::{Doc, Id, Index, Metric, Options, Query, Schema};

#[derive(Debug)]
pub(crate) struct Gate {
    pub(crate) inner: InMemory,
    hold: Mutex<Option<(String, bool)>>,
    pub(crate) held: Notify,
    open: Semaphore,
    pub(crate) chunk_puts: AtomicUsize,
    pub(crate) reads: Mutex<Vec<(String, Option<GetRange>)>>,
}

impl Gate {
    pub(crate) fn new() -> Arc<Self> {
        Arc::new(Self {
            inner: InMemory::new(),
            hold: Mutex::default(),
            held: Notify::new(),
            open: Semaphore::new(0),
            chunk_puts: AtomicUsize::new(0),
            reads: Mutex::default(),
        })
    }

    pub(crate) fn hold_next(&self, prefix: &str, write: bool) {
        *self.hold.lock().unwrap() = Some((prefix.to_string(), write));
    }

    pub(crate) fn open(&self) {
        self.open.add_permits(Semaphore::MAX_PERMITS / 2);
    }

    async fn pass(&self, at: &Path, write: bool) {
        let held = {
            let mut hold = self.hold.lock().unwrap();
            let matches = hold
                .as_ref()
                .is_some_and(|(prefix, w)| *w == write && at.as_ref().starts_with(prefix));
            matches && hold.take().is_some()
        };
        if held {
            self.held.notify_one();
            let _ = self.open.acquire().await;
        }
    }
}

impl fmt::Display for Gate {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Gate")
    }
}

#[async_trait]
impl ObjectStore for Gate {
    async fn put_opts(
        &self,
        at: &Path,
        payload: PutPayload,
        opts: PutOptions,
    ) -> object_store::Result<PutResult> {
        if at.as_ref().starts_with("chunks/") {
            self.chunk_puts.fetch_add(1, Ordering::SeqCst);
        }
        self.pass(at, true).await;
        self.inner.put_opts(at, payload, opts).await
    }

    async fn put_multipart_opts(
        &self,
        at: &Path,
        opts: PutMultipartOptions,
    ) -> object_store::Result<Box<dyn MultipartUpload>> {
        self.inner.put_multipart_opts(at, opts).await
    }

    async fn get_opts(&self, at: &Path, options: GetOptions) -> object_store::Result<GetResult> {
        if !options.head {
            let read = (at.to_string(), options.range.clone());
            self.reads.lock().unwrap().push(read);
        }
        self.pass(at, false).await;
        self.inner.get_opts(at, options).await
    }

    fn delete_stream(
        &self,
        locations: BoxStream<'static, object_store::Result<Path>>,
    ) -> BoxStream<'static, object_store::Result<Path>> {
        self.inner.delete_stream(locations)
    }

    fn list(&self, prefix: Option<&Path>) -> BoxStream<'static, object_store::Result<ObjectMeta>> {
        self.inner.list(prefix)
    }

    async fn list_with_delimiter(&self, prefix: Option<&Path>) -> object_store::Result<ListResult> {
        self.inner.list_with_delimiter(prefix).await
    }

    async fn copy_opts(&self, from: &Path, to: &Path, o: CopyOptions) -> object_store::Result<()> {
        self.inner.copy_opts(from, to, o).await
    }

    async fn rename_opts(
        &self,
        from: &Path,
        to: &Path,
        o: RenameOptions,
    ) -> object_store::Result<()> {
        self.inner.rename_opts(from, to, o).await
    }
}

pub(crate) fn schema() -> Schema {
    Schema::new().vector("v", 2, Metric::Euclidean)
}

pub(crate) fn doc(id: u64) -> Doc {
    Doc::new(id).vector("v", vec![id as f32, 0.0])
}

pub(crate) async fn ids(index: &Index) -> Vec<Id> {
    let hits = index.query(&Query::new("v", vec![0.0, 0.0], 1000)).await;
    let mut ids: Vec<Id> = hits.unwrap().into_iter().map(|hit| hit.id).collect();
    ids.sort();
    ids
}

pub(crate) fn clustered(rows: usize, dims: usize, seed: u64) -> Vec<Vec<f32>> {
    let mut random = Random(42);
    let normal = move |random: &mut Random| {
        let unit = |r: &mut Random| (r.next() >> 40) as f32 / (1u64 << 24) as f32;
        let u = unit(random).max(1e-7);
        (-2.0 * u.ln()).sqrt() * (std::f32::consts::TAU * unit(random)).cos()
    };
    let centers: Vec<Vec<f32>> = (0..50)
        .map(|_| (0..dims).map(|_| normal(&mut random)).collect())
        .collect();
    let mut random = Random(seed);
    (0..rows)
        .map(|_| {
            let center = &centers[random.below(centers.len())];
            center
                .iter()
                .map(|x| x + 1.5 * normal(&mut random))
                .collect()
        })
        .collect()
}

pub(crate) async fn built(gate: &Arc<Gate>, rows: usize, dims: usize, batch: usize) -> Index {
    let schema = Schema::new().vector("v", dims, Metric::Euclidean);
    let options = Options {
        cluster_rows: 200,
        ..Options::default()
    };
    let index = Index::create_with(gate.clone(), schema, options)
        .await
        .unwrap();
    let docs: Vec<Doc> = (clustered(rows, dims, 1).into_iter().enumerate())
        .map(|(id, v)| Doc::new(id as u64).vector("v", v))
        .collect();
    for part in docs.chunks(batch) {
        index.upsert(part.to_vec()).await.unwrap();
    }
    index.build().await.unwrap();
    index
}

pub(crate) async fn table(index: &Index, version: &Version) -> Vec<ClusterRef> {
    let clusters = &version.ann.as_ref().unwrap().columns["v"];
    let table = clusters.table.open(&index.storage).await.unwrap();
    table.iter().cloned().collect()
}

pub(crate) async fn brute_force(index: &Index, query: &Query) -> Vec<(Id, f32)> {
    let schema = index.schema().await.unwrap();
    let column = schema.vectors[&query.column];
    let mut vector = query.vector.clone();
    if column.metric == Metric::Cosine {
        crate::vector::ivf::normalize(&mut vector);
    }
    let mut export = index.export().await.unwrap();
    let mut all = Vec::new();
    while let Some(docs) = export.next().await.unwrap() {
        for doc in docs {
            if (query.filter.as_ref()).is_some_and(|f| !f.matches(&doc.id, &doc.attributes)) {
                continue;
            }
            let d =
                crate::vector::ivf::distance(column.metric, &vector, &doc.vectors[&query.column]);
            all.push((doc.id, d));
        }
    }
    all.sort_by(|a, b| a.1.total_cmp(&b.1).then_with(|| a.0.cmp(&b.0)));
    all.truncate(query.top_k);
    all
}
