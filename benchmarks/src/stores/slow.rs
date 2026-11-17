//! A store that acts like object storage on a laptop: each request waits a fixed time, with only so many in flight.

use std::fmt;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use async_trait::async_trait;
use futures::stream::BoxStream;
use object_store::path::Path;
use object_store::{
    CopyOptions, GetOptions, GetResult, ListResult, MultipartUpload, ObjectMeta, ObjectStore,
    PutMultipartOptions, PutOptions, PutPayload, PutResult, RenameOptions, Result,
};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

use crate::datasets::random::Random;

const P99_SIGMAS: f64 = 2.326;

#[derive(Debug)]
pub(crate) struct Slow {
    inner: Arc<dyn ObjectStore>,
    latency: Duration,
    slots: Arc<Semaphore>,
    tail: f64,
    bytes_per_s: Option<f64>,
    draws: AtomicU64,
}

impl Slow {
    pub(crate) fn new(inner: Arc<dyn ObjectStore>, latency: Duration, in_flight: usize) -> Self {
        Self {
            inner,
            latency,
            slots: Arc::new(Semaphore::new(in_flight.max(1))),
            tail: 1.0,
            bytes_per_s: None,
            draws: AtomicU64::new(0),
        }
    }

    pub(crate) fn with_tail(mut self, p99_over_p50: f64) -> Self {
        self.tail = p99_over_p50.max(1.0);
        self
    }

    pub(crate) fn with_bandwidth(mut self, mb_per_s: f64) -> Self {
        self.bytes_per_s = (mb_per_s > 0.0).then_some(mb_per_s * 1e6);
        self
    }

    async fn wait(&self) -> OwnedSemaphorePermit {
        let slot =
            (self.slots.clone().acquire_owned().await).expect("the semaphore is never closed");
        tokio::time::sleep(self.latency.mul_f64(self.factor())).await;
        slot
    }

    fn factor(&self) -> f64 {
        if self.tail <= 1.0 {
            return 1.0;
        }
        let n = self.draws.fetch_add(1, Ordering::Relaxed);
        let mut random = Random(n);
        let sigma = self.tail.ln() / P99_SIGMAS;
        (sigma * random.normal() as f64).exp()
    }

    async fn transfer(&self, bytes: u64) {
        if let Some(rate) = self.bytes_per_s {
            tokio::time::sleep(Duration::from_secs_f64(bytes as f64 / rate)).await;
        }
    }
}

impl fmt::Display for Slow {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} + {:?} per request", self.inner, self.latency)?;
        if self.tail > 1.0 {
            write!(f, ", p99 {}x", self.tail)?;
        }
        match self.bytes_per_s {
            Some(rate) => write!(f, ", {} MB/s a request", rate / 1e6),
            None => Ok(()),
        }
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
        let got = self.inner.get_opts(location, options).await?;
        self.transfer(got.range.end - got.range.start).await;
        Ok(got)
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
