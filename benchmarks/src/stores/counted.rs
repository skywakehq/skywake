//! A store that logs every request it passes on, with its bytes and timing.

use std::fmt;
use std::sync::Arc;
use std::time::Instant;

use async_trait::async_trait;
use futures::StreamExt;
use futures::stream::BoxStream;
use object_store::path::Path;
use object_store::{
    CopyOptions, GetOptions, GetResult, ListResult, MultipartUpload, ObjectMeta, ObjectStore,
    PutMultipartOptions, PutOptions, PutPayload, PutResult, RenameOptions, Result,
};

use crate::metrics::requests::{Log, Op};

#[derive(Debug)]
pub(crate) struct Counted {
    inner: Arc<dyn ObjectStore>,
    log: Arc<Log>,
}

impl Counted {
    pub(crate) fn new(inner: Arc<dyn ObjectStore>, log: Arc<Log>) -> Self {
        Self { inner, log }
    }
}

impl fmt::Display for Counted {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.inner.fmt(f)
    }
}

struct Listing {
    log: Arc<Log>,
    started: Instant,
}

impl Drop for Listing {
    fn drop(&mut self) {
        self.log.add(Op::List, 0, self.started);
    }
}

impl Counted {
    fn list_logged(
        &self,
        stream: BoxStream<'static, Result<ObjectMeta>>,
    ) -> BoxStream<'static, Result<ObjectMeta>> {
        let listing = Listing {
            log: self.log.clone(),
            started: Instant::now(),
        };
        stream
            .inspect(move |_| {
                let _ = &listing;
            })
            .boxed()
    }
}

#[async_trait]
impl ObjectStore for Counted {
    async fn put_opts(
        &self,
        location: &Path,
        payload: PutPayload,
        opts: PutOptions,
    ) -> Result<PutResult> {
        let (started, bytes) = (Instant::now(), payload.content_length() as u64);
        let result = self.inner.put_opts(location, payload, opts).await;
        self.log.add(Op::Put, bytes, started);
        result
    }

    async fn put_multipart_opts(
        &self,
        location: &Path,
        opts: PutMultipartOptions,
    ) -> Result<Box<dyn MultipartUpload>> {
        let started = Instant::now();
        let result = self.inner.put_multipart_opts(location, opts).await;
        self.log.add(Op::Other, 0, started);
        result
    }

    async fn get_opts(&self, location: &Path, options: GetOptions) -> Result<GetResult> {
        let op = match options.head {
            true => Op::Head,
            false => Op::Get,
        };
        let started = Instant::now();
        let result = self.inner.get_opts(location, options).await;
        let bytes = match (&result, op) {
            (Ok(found), Op::Get) => found.range.end - found.range.start,
            _ => 0,
        };
        self.log.add(op, bytes, started);
        result
    }

    fn delete_stream(
        &self,
        locations: BoxStream<'static, Result<Path>>,
    ) -> BoxStream<'static, Result<Path>> {
        let (log, started) = (self.log.clone(), Instant::now());
        self.inner
            .delete_stream(locations)
            .inspect(move |_| log.add(Op::Other, 0, started))
            .boxed()
    }

    fn list(&self, prefix: Option<&Path>) -> BoxStream<'static, Result<ObjectMeta>> {
        self.list_logged(self.inner.list(prefix))
    }

    fn list_with_offset(
        &self,
        prefix: Option<&Path>,
        offset: &Path,
    ) -> BoxStream<'static, Result<ObjectMeta>> {
        self.list_logged(self.inner.list_with_offset(prefix, offset))
    }

    async fn list_with_delimiter(&self, prefix: Option<&Path>) -> Result<ListResult> {
        let started = Instant::now();
        let result = self.inner.list_with_delimiter(prefix).await;
        self.log.add(Op::List, 0, started);
        result
    }

    async fn copy_opts(&self, from: &Path, to: &Path, options: CopyOptions) -> Result<()> {
        let started = Instant::now();
        let result = self.inner.copy_opts(from, to, options).await;
        self.log.add(Op::Other, 0, started);
        result
    }

    async fn rename_opts(&self, from: &Path, to: &Path, options: RenameOptions) -> Result<()> {
        let started = Instant::now();
        let result = self.inner.rename_opts(from, to, options).await;
        self.log.add(Op::Other, 0, started);
        result
    }
}
