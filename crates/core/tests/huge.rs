//! A tree too big to load at once: one pack read per folder level.

use std::fmt;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;

use async_trait::async_trait;
use futures::stream::BoxStream;
use object_store::memory::InMemory;
use object_store::path::Path;
use object_store::{
    CopyOptions, GetOptions, GetResult, ListResult, MultipartUpload, ObjectMeta, ObjectStore,
    PutMultipartOptions, PutOptions, PutPayload, PutResult, RenameOptions, Result,
};
use skywake_core::{Data, Entry, FILE_MODE, Hash, Repo, Tree, Trees};

#[derive(Debug, Default)]
struct Counting {
    inner: InMemory,
    gets: AtomicUsize,
}

impl fmt::Display for Counting {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Counting")
    }
}

#[async_trait]
impl ObjectStore for Counting {
    async fn put_opts(
        &self,
        at: &Path,
        payload: PutPayload,
        opts: PutOptions,
    ) -> Result<PutResult> {
        self.inner.put_opts(at, payload, opts).await
    }
    async fn put_multipart_opts(
        &self,
        at: &Path,
        opts: PutMultipartOptions,
    ) -> Result<Box<dyn MultipartUpload>> {
        self.inner.put_multipart_opts(at, opts).await
    }
    async fn get_opts(&self, at: &Path, options: GetOptions) -> Result<GetResult> {
        self.gets.fetch_add(1, Ordering::Relaxed);
        self.inner.get_opts(at, options).await
    }
    fn delete_stream(
        &self,
        locations: BoxStream<'static, Result<Path>>,
    ) -> BoxStream<'static, Result<Path>> {
        self.inner.delete_stream(locations)
    }
    fn list(&self, prefix: Option<&Path>) -> BoxStream<'static, Result<ObjectMeta>> {
        self.inner.list(prefix)
    }
    fn list_with_offset(
        &self,
        prefix: Option<&Path>,
        offset: &Path,
    ) -> BoxStream<'static, Result<ObjectMeta>> {
        self.inner.list_with_offset(prefix, offset)
    }
    async fn list_with_delimiter(&self, prefix: Option<&Path>) -> Result<ListResult> {
        self.inner.list_with_delimiter(prefix).await
    }
    async fn copy_opts(&self, from: &Path, to: &Path, options: CopyOptions) -> Result<()> {
        self.inner.copy_opts(from, to, options).await
    }
    async fn rename_opts(&self, from: &Path, to: &Path, options: RenameOptions) -> Result<()> {
        self.inner.rename_opts(from, to, options).await
    }
}

fn file(i: usize) -> Entry {
    Entry::File {
        size: 0,
        modified_ns: i as u64,
        mode: FILE_MODE,
        data: Data::Inline(Vec::new()),
    }
}

fn dir(tree: Hash) -> Entry {
    Entry::Dir { tree }
}

#[tokio::test]
async fn a_folder_of_a_huge_tree_costs_one_pack_per_level() {
    let store = Arc::new(Counting::default());
    let repo = Repo::new(store.clone());
    repo.create_branch("huge", None).await.unwrap();
    let mut claim = repo.claim("huge").await.unwrap();
    let mut root = Tree::new();
    for top in 0..20 {
        let mut middle = Tree::new();
        for folder in 0..50 {
            let leaf: Tree = (0..200)
                .map(|i| {
                    (
                        format!("file-{i:03}.rs"),
                        file(top * 10_000 + folder * 200 + i),
                    )
                })
                .collect();
            middle.insert(
                format!("pkg-{folder:02}"),
                dir(claim.trees.add(leaf).unwrap()),
            );
        }
        root.insert(
            format!("top-{top:02}"),
            dir(claim.trees.add(middle).unwrap()),
        );
    }
    let root = claim.trees.add(root).unwrap();
    repo.save(&mut claim, root, Some("huge")).await.unwrap();

    let packs = repo.log("huge").await.unwrap()[0].1.packs.clone();
    let trees = Trees::new(repo.objects().clone(), &packs).unwrap();
    store.gets.store(0, Ordering::Relaxed);
    let path = ["top-17", "pkg-33"];
    let mut tree = trees.get(root).await.unwrap();
    for name in path {
        let Some(Entry::Dir { tree: next }) = tree.get(name) else {
            panic!("no {name}")
        };
        tree = trees.get(*next).await.unwrap();
    }
    assert_eq!(tree.len(), 200);
    let gets = store.gets.load(Ordering::Relaxed);
    assert!(gets <= 3, "{gets} reads for a folder two levels down");

    let started = Instant::now();
    for _ in 0..1000 {
        let top = trees.get(root).await.unwrap();
        assert!(top.contains_key("top-17"));
    }
    let each = started.elapsed() / 1000;
    assert!(each.as_micros() < 100, "{each:?} per warm lookup");
    assert_eq!(store.gets.load(Ordering::Relaxed), gets);
}
