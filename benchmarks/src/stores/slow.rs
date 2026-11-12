//! A store that acts like object storage on a laptop: each request waits a fixed time, with only so many in flight.

use std::fmt;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use futures::stream::BoxStream;
use object_store::path::Path;
use object_store::{
    CopyOptions, GetOptions, GetResult, ListResult, MultipartUpload, ObjectMeta, ObjectStore,
    PutMultipartOptions, PutOptions, PutPayload, PutResult, RenameOptions, Result,
};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

#[derive(Debug)]
pub(crate) struct Slow {
    inner: Arc<dyn ObjectStore>,
    latency: Duration,
    slots: Arc<Semaphore>,
}

impl Slow {
    pub(crate) fn new(inner: Arc<dyn ObjectStore>, latency: Duration, in_flight: usize) -> Self {
        Self {
            inner,
            latency,
            slots: Arc::new(Semaphore::new(in_flight.max(1))),
        }
    }

    async fn wait(&self) -> OwnedSemaphorePermit {
        let slot =
            (self.slots.clone().acquire_owned().await).expect("the semaphore is never closed");
        tokio::time::sleep(self.latency).await;
        slot
    }
}

impl fmt::Display for Slow {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} + {:?} per request", self.inner, self.latency)
    }
}

#[async_trait]
impl ObjectStore for Slow {
    async fn put_opts(
        &self,
        location: &Path,
        payload: PutPayload,
        opts: PutOptions,
    ) -> Result<PutResult> {
        let _slot = self.wait().await;
        self.inner.put_opts(location, payload, opts).await
    }

    async fn put_multipart_opts(
        &self,
        location: &Path,
        opts: PutMultipartOptions,
    ) -> Result<Box<dyn MultipartUpload>> {
        let _slot = self.wait().await;
        self.inner.put_multipart_opts(location, opts).await
    }

    async fn get_opts(&self, location: &Path, options: GetOptions) -> Result<GetResult> {
        let _slot = self.wait().await;
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
        let _slot = self.wait().await;
        self.inner.copy_opts(from, to, options).await
    }

    async fn rename_opts(&self, from: &Path, to: &Path, options: RenameOptions) -> Result<()> {
        let _slot = self.wait().await;
        self.inner.rename_opts(from, to, options).await
    }
}
