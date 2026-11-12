//! A store that can refuse writes of heads or objects, and counts reads of heads.

use std::fmt;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use async_trait::async_trait;
use futures::stream::BoxStream;
use object_store::memory::InMemory;
use object_store::path::Path;
use object_store::{
    CopyOptions, GetOptions, GetResult, ListResult, MultipartUpload, ObjectMeta, ObjectStore,
    PutMultipartOptions, PutOptions, PutPayload, PutResult, RenameOptions,
};

#[derive(Debug, Default)]
pub(super) struct Blocking {
    pub(super) inner: InMemory,
    pub(super) blocked: AtomicBool,
    pub(super) objects_blocked: AtomicBool,
    pub(super) ref_reads: AtomicUsize,
}

impl fmt::Display for Blocking {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Blocking")
    }
}

#[async_trait]
impl ObjectStore for Blocking {
    async fn put_opts(
        &self,
        location: &Path,
        payload: PutPayload,
        opts: PutOptions,
    ) -> object_store::Result<PutResult> {
        let path = location.as_ref();
        let object = ["objects/", "chunks/", "commits/"]
            .iter()
            .any(|prefix| path.starts_with(prefix));
        if (path.starts_with("refs/") && self.blocked.load(Ordering::SeqCst))
            || (object && self.objects_blocked.load(Ordering::SeqCst))
        {
            return Err(object_store::Error::Generic {
                store: "Blocking",
                source: "blocked".into(),
            });
        }
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
        if location.as_ref().starts_with("refs/") {
            self.ref_reads.fetch_add(1, Ordering::SeqCst);
        }
        self.inner.get_opts(location, options).await
    }

    fn delete_stream(
        &self,
        locations: BoxStream<'static, object_store::Result<Path>>,
    ) -> BoxStream<'static, object_store::Result<Path>> {
        self.inner.delete_stream(locations)
    }

    fn list(&self, prefix: Option<&Path>) -> BoxStream<'static, object_store::Result<ObjectMeta>> {
        if prefix.is_some_and(|prefix| prefix.as_ref() == "refs") {
            self.ref_reads.fetch_add(1, Ordering::SeqCst);
        }
        self.inner.list(prefix)
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

    async fn rename_opts(
        &self,
        from: &Path,
        to: &Path,
        options: RenameOptions,
    ) -> object_store::Result<()> {
        self.inner.rename_opts(from, to, options).await
    }
}
