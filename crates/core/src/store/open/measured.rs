//! Counts the requests to a store, by kind and outcome, and times them.

use std::fmt;
use std::sync::Arc;
use std::time::Instant;

use async_trait::async_trait;
use futures::StreamExt;
use futures::stream::BoxStream;
use object_store::path::Path;
use object_store::{
    CopyOptions, Error, GetOptions, GetResult, ListResult, MultipartUpload, ObjectMeta,
    ObjectStore, PutMultipartOptions, PutOptions, PutPayload, PutResult, RenameOptions, Result,
};

#[derive(Debug)]
pub(crate) struct Measured {
    inner: Arc<dyn ObjectStore>,
}

impl Measured {
    pub(crate) fn new(inner: Arc<dyn ObjectStore>) -> Self {
        Self { inner }
    }
}

impl fmt::Display for Measured {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.inner.fmt(f)
    }
}

fn record<T>(op: &'static str, started: Instant, result: &Result<T>) {
    let outcome = match result {
        Ok(_) => "ok",
        Err(error) => outcome(error),
    };
    count(op, started, outcome);
}

fn count(op: &'static str, started: Instant, outcome: &'static str) {
    metrics::counter!("skywake_store_requests_total", "op" => op, "outcome" => outcome)
        .increment(1);
    metrics::histogram!("skywake_store_request_seconds", "op" => op)
        .record(started.elapsed().as_secs_f64());
}

fn outcome(error: &Error) -> &'static str {
    match error {
        Error::NotFound { .. } => "not_found",
        Error::Precondition { .. } | Error::AlreadyExists { .. } => "precondition",
        Error::NotModified { .. } => "not_modified",
        _ => "error",
    }
}

struct Listing {
    started: Instant,
    failed: bool,
}

impl Listing {
    fn saw(&mut self, item: &Result<ObjectMeta>) {
        self.failed |= item.is_err();
    }
}

impl Drop for Listing {
    fn drop(&mut self) {
        let outcome = match self.failed {
            true => "error",
            false => "ok",
        };
        count("list", self.started, outcome);
    }
}

fn measure_list(
    stream: BoxStream<'static, Result<ObjectMeta>>,
) -> BoxStream<'static, Result<ObjectMeta>> {
    let mut listing = Listing {
        started: Instant::now(),
        failed: false,
    };
    stream.inspect(move |item| listing.saw(item)).boxed()
}

#[async_trait]
impl ObjectStore for Measured {
    async fn put_opts(
        &self,
        location: &Path,
        payload: PutPayload,
        opts: PutOptions,
    ) -> Result<PutResult> {
        let started = Instant::now();
        let result = self.inner.put_opts(location, payload, opts).await;
        record("put", started, &result);
        result
    }

    async fn put_multipart_opts(
        &self,
        location: &Path,
        opts: PutMultipartOptions,
    ) -> Result<Box<dyn MultipartUpload>> {
        let started = Instant::now();
        let result = self.inner.put_multipart_opts(location, opts).await;
        record("put_multipart", started, &result);
        result
    }

    async fn get_opts(&self, location: &Path, options: GetOptions) -> Result<GetResult> {
        let op = match options.head {
            true => "head",
            false => "get",
        };
        let started = Instant::now();
        let result = self.inner.get_opts(location, options).await;
        record(op, started, &result);
        result
    }

    fn delete_stream(
        &self,
        locations: BoxStream<'static, Result<Path>>,
    ) -> BoxStream<'static, Result<Path>> {
        let started = Instant::now();
        self.inner
            .delete_stream(locations)
            .inspect(move |result| record("delete", started, result))
            .boxed()
    }

    fn list(&self, prefix: Option<&Path>) -> BoxStream<'static, Result<ObjectMeta>> {
        measure_list(self.inner.list(prefix))
    }

    fn list_with_offset(
        &self,
        prefix: Option<&Path>,
        offset: &Path,
    ) -> BoxStream<'static, Result<ObjectMeta>> {
        measure_list(self.inner.list_with_offset(prefix, offset))
    }

    async fn list_with_delimiter(&self, prefix: Option<&Path>) -> Result<ListResult> {
        let started = Instant::now();
        let result = self.inner.list_with_delimiter(prefix).await;
        record("list", started, &result);
        result
    }

    async fn copy_opts(&self, from: &Path, to: &Path, options: CopyOptions) -> Result<()> {
        let started = Instant::now();
        let result = self.inner.copy_opts(from, to, options).await;
        record("copy", started, &result);
        result
    }

    async fn rename_opts(&self, from: &Path, to: &Path, options: RenameOptions) -> Result<()> {
        let started = Instant::now();
        let result = self.inner.rename_opts(from, to, options).await;
        record("rename", started, &result);
        result
    }
}
