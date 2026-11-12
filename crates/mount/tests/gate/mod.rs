//! An object store that can hold chunk uploads or downloads, so a test
//! can act while a save or a write is in the middle of one.

use std::fmt;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use async_trait::async_trait;
use futures::stream::BoxStream;
use object_store::memory::InMemory;
use object_store::path::Path;
use object_store::{
    CopyOptions, GetOptions, GetResult, ListResult, MultipartUpload, ObjectMeta, ObjectStore,
    PutMultipartOptions, PutOptions, PutPayload, PutResult, RenameOptions, Result,
};
use tokio::sync::{Notify, Semaphore};

#[derive(Debug)]
pub struct Gated {
    inner: InMemory,
    closed: AtomicBool,
    reads_closed: AtomicBool,
    open: Semaphore,
    /// Wakes the test when an upload waits at the closed gate.
    pub waiting: Notify,
}

impl Gated {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            inner: InMemory::new(),
            closed: AtomicBool::new(false),
            reads_closed: AtomicBool::new(false),
            open: Semaphore::new(0),
            waiting: Notify::new(),
        })
    }

    /// Holds chunk uploads from now on.
    pub fn close(&self) {
        self.closed.store(true, Ordering::SeqCst);
    }

    /// Holds chunk downloads from now on.
    pub fn close_reads(&self) {
        self.reads_closed.store(true, Ordering::SeqCst);
    }

    /// Lets all held and later uploads and downloads through.
    pub fn open(&self) {
        self.closed.store(false, Ordering::SeqCst);
        self.reads_closed.store(false, Ordering::SeqCst);
        self.open.add_permits(Semaphore::MAX_PERMITS / 2);
    }
}

impl fmt::Display for Gated {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Gated")
    }
}

#[async_trait]
impl ObjectStore for Gated {
    async fn put_opts(
        &self,
        location: &Path,
        payload: PutPayload,
        opts: PutOptions,
    ) -> Result<PutResult> {
        if location.as_ref().starts_with("chunks/") && self.closed.load(Ordering::SeqCst) {
            self.waiting.notify_one();
            let _ = self.open.acquire().await;
        }
        self.inner.put_opts(location, payload, opts).await
    }

    async fn put_multipart_opts(
        &self,
        location: &Path,
        opts: PutMultipartOptions,
    ) -> Result<Box<dyn MultipartUpload>> {
        self.inner.put_multipart_opts(location, opts).await
    }

    async fn get_opts(&self, location: &Path, options: GetOptions) -> Result<GetResult> {
        if location.as_ref().starts_with("chunks/") && self.reads_closed.load(Ordering::SeqCst) {
            self.waiting.notify_one();
            let _ = self.open.acquire().await;
        }
        self.inner.get_opts(location, options).await
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
