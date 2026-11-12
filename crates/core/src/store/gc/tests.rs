//! Tests for collections shared by workers, and for marks kept by bundle.

use std::collections::BTreeSet;
use std::fmt;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use async_trait::async_trait;
use futures::stream::BoxStream;
use futures::{StreamExt, TryStreamExt};
use object_store::memory::InMemory;
use object_store::path::Path;
use object_store::{
    CopyOptions, GetOptions, GetResult, ListResult, MultipartUpload, ObjectMeta, ObjectStore,
    ObjectStoreExt, PutMultipartOptions, PutOptions, PutPayload, PutResult,
};

use super::run::{self, Phase, Shelf};
use super::slices::FILE;
use super::{collect_in, lock, mark};
use crate::model::{FILE_MODE, Tree};
use crate::{Bundler, Error, Repo, files};

const NOW: Duration = Duration::ZERO;

#[derive(Default)]
struct Slow {
    inner: InMemory,
    hang: AtomicBool,
}

impl fmt::Display for Slow {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Slow")
    }
}

impl fmt::Debug for Slow {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Slow")
    }
}

#[async_trait]
impl ObjectStore for Slow {
    async fn put_opts(
        &self,
        location: &Path,
        payload: PutPayload,
        opts: PutOptions,
    ) -> object_store::Result<PutResult> {
        self.inner.put_opts(location, payload, opts).await
    }

    async fn put_multipart_opts(
        &self,
        location: &Path,
        opts: PutMultipartOptions,
    ) -> object_store::Result<Box<dyn MultipartUpload>> {
        self.inner.put_multipart_opts(location, opts).await
    }

    async fn get_opts(
        &self,
        location: &Path,
        options: GetOptions,
    ) -> object_store::Result<GetResult> {
        self.inner.get_opts(location, options).await
    }

    fn delete_stream(
        &self,
        locations: BoxStream<'static, object_store::Result<Path>>,
    ) -> BoxStream<'static, object_store::Result<Path>> {
        if self.hang.load(Ordering::SeqCst) {
            return futures::stream::pending().boxed();
        }
        self.inner.delete_stream(locations)
    }

    fn list(&self, prefix: Option<&Path>) -> BoxStream<'static, object_store::Result<ObjectMeta>> {
        let listing = self.inner.list(prefix);
        futures::stream::once(async move {
            tokio::time::sleep(Duration::from_millis(2)).await;
            listing
        })
        .flatten()
        .boxed()
    }

    async fn list_with_delimiter(&self, prefix: Option<&Path>) -> object_store::Result<ListResult> {
        self.inner.list_with_delimiter(prefix).await
    }

    async fn copy_opts(
        &self,
        from: &Path,
        to: &Path,
        options: CopyOptions,
    ) -> object_store::Result<()> {
        self.inner.copy_opts(from, to, options).await
    }
}

fn big(seed: u8) -> Vec<u8> {
    (0..20_000u32)
        .map(|i| (i.wrapping_mul(2654435761) >> 13) as u8 ^ seed)
        .collect()
}

fn small(i: u32) -> Vec<u8> {
    format!("small file number {i} ").repeat(4).into_bytes()
}

async fn commit(repo: &Repo, branch: &str, count: u32, seed: u8) {
    repo.create_branch(branch, None).await.unwrap();
    let mut claim = repo.claim(branch).await.unwrap();
    let bundler = Bundler::new(repo.objects());
    let mut tree = Tree::new();
    for i in 0..count {
        let data = bundler
            .add(small(i + u32::from(seed) * 1_000_000))
            .await
            .unwrap();
        tree.insert(format!("f{i}"), files::file(data, FILE_MODE));
    }
    bundler.finish().await.unwrap();
    let file = files::store(repo.objects(), &big(seed), FILE_MODE)
        .await
        .unwrap();
    tree.insert("big".into(), file);
    let root = claim.trees.add(tree).unwrap();
    repo.save(&mut claim, root, Some("files")).await.unwrap();
}

async fn scene(store: Arc<dyn ObjectStore>) -> Repo {
    let repo = Repo::new(store);
    commit(&repo, "main", 200, 1).await;
    commit(&repo, "old", 200, 2).await;
    repo.delete_branch("old").await.unwrap();
    repo
}

async fn copy(from: &dyn ObjectStore) -> Arc<Slow> {
    let to = Arc::new(Slow::default());
    let listing: Vec<ObjectMeta> = from.list(None).try_collect().await.unwrap();
    for meta in listing {
        let bytes = from
            .get(&meta.location)
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap();
        to.put(&meta.location, bytes.into()).await.unwrap();
    }
    to
}

async fn data(store: &dyn ObjectStore) -> BTreeSet<String> {
    let listing: Vec<ObjectMeta> = store.list(None).try_collect().await.unwrap();
    (listing.iter())
        .map(|meta| meta.location.to_string())
        .filter(|path| !path.starts_with("gc/"))
        .collect()
}

async fn readable(repo: &Repo) {
    for i in [0, 199] {
        let read = repo.read("main", None, &format!("f{i}"), 0, u64::MAX).await;
        assert_eq!(read.unwrap(), small(i + 1_000_000));
    }
    let read = repo.read("main", None, "big", 0, u64::MAX).await;
    assert_eq!(read.unwrap(), big(1));
}

async fn phase(store: &dyn ObjectStore) -> Option<Phase> {
    Some(run::read(store).await.unwrap().0?.phase)
}

#[tokio::test]
async fn small_files_are_marked_on_disk_by_bundle() {
    let store: Arc<dyn ObjectStore> = Arc::new(InMemory::new());
    let repo = Repo::new(store.clone());
    commit(&repo, "main", 20_000, 1).await;
    let shelf = Shelf::local().unwrap();
    let marked = mark::mark(repo.objects(), repo.refs(), NOW, &mut None, &shelf, Some(4))
        .await
        .unwrap();

    assert!(marked.in_memory < 100, "{} in memory", marked.in_memory);
    let mut files = 0;
    for work in 0..marked.slices {
        files += shelf.get(&format!("files-{work}")).await.unwrap().len() / FILE;
    }
    assert_eq!(files, 20_000);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn two_workers_sweep_disjoint_slices_to_the_same_end_as_one() {
    let store = Arc::new(Slow::default());
    let repo = scene(store.clone()).await;
    let alone = copy(store.as_ref()).await;
    let lone = Repo::new(alone.clone());
    let one = collect_in(lone.objects(), lone.refs(), NOW, false, Some(16)).await;
    assert_eq!(one.unwrap().slices, 16);

    let first = tokio::spawn({
        let repo = repo.clone();
        async move { collect_in(repo.objects(), repo.refs(), NOW, false, Some(16)).await }
    });
    while run::read(store.as_ref()).await.unwrap().0.is_none() {
        tokio::task::yield_now().await;
    }
    let second = loop {
        match collect_in(repo.objects(), repo.refs(), NOW, false, None).await {
            Err(Error::CollectionRunning) => tokio::time::sleep(Duration::from_millis(1)).await,
            second => break second.unwrap(),
        }
    };
    let first = first.await.unwrap().unwrap();
    assert_eq!(first.slices + second.slices, 16, "each slice swept once");
    assert!(second.slices > 0, "the second worker took no slice");
    assert!(first.deleted > 0 || second.deleted > 0);
    assert_eq!(phase(store.as_ref()).await, Some(Phase::Done));

    assert_eq!(data(store.as_ref()).await, data(alone.as_ref()).await);
    readable(&repo).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_slice_whose_worker_died_is_swept_by_another_after_its_lease() {
    let store = Arc::new(Slow::default());
    let repo = scene(store.clone()).await;
    let alone = copy(store.as_ref()).await;
    let lone = Repo::new(alone.clone());
    collect_in(lone.objects(), lone.refs(), NOW, false, Some(4))
        .await
        .unwrap();

    store.hang.store(true, Ordering::SeqCst);
    let dying = tokio::spawn({
        let repo = repo.clone();
        async move { collect_in(repo.objects(), repo.refs(), NOW, false, Some(4)).await }
    });
    while phase(store.as_ref()).await != Some(Phase::Sweeping) {
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    tokio::time::sleep(Duration::from_millis(200)).await;
    dying.abort();
    store.hang.store(false, Ordering::SeqCst);

    collect_in(repo.objects(), repo.refs(), NOW, false, None)
        .await
        .unwrap();
    assert_eq!(phase(store.as_ref()).await, Some(Phase::Sweeping));

    let dead = lock::alive(store.as_ref()).await.unwrap();
    assert_eq!(dead.len(), 1);
    lock::end(store.as_ref(), dead[0]).await;
    let after = collect_in(repo.objects(), repo.refs(), NOW, false, None)
        .await
        .unwrap();
    assert!(after.slices >= 1, "the dead worker's slice was not swept");
    assert_eq!(phase(store.as_ref()).await, Some(Phase::Done));
    assert_eq!(data(store.as_ref()).await, data(alone.as_ref()).await);
    readable(&repo).await;
}
