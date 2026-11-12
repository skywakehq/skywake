//! A store in a local folder.

use std::fmt;
use std::fs::File;
use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use futures::stream::BoxStream;
use futures::{StreamExt, TryStreamExt};
use object_store::local::LocalFileSystem;
use object_store::path::Path;
use object_store::{
    CopyOptions, Error, GetOptions, GetResult, ListResult, MultipartUpload, ObjectMeta,
    ObjectStore, ObjectStoreExt, PutMode, PutMultipartOptions, PutOptions, PutPayload, PutResult,
    RenameOptions, Result,
};

#[derive(Debug)]
pub(crate) struct LocalStore {
    inner: Arc<LocalFileSystem>,
    lock: PathBuf,
}

impl LocalStore {
    pub(crate) fn new(inner: LocalFileSystem, lock: PathBuf) -> Self {
        Self {
            inner: Arc::new(inner),
            lock,
        }
    }
}

async fn lock(path: PathBuf) -> Result<File> {
    tokio::task::spawn_blocking(move || {
        let file = File::create(path)?;
        file.lock()?;
        Ok::<_, std::io::Error>(file)
    })
    .await
    .map_err(generic)?
    .map_err(generic)
}

impl fmt::Display for LocalStore {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "LocalStore({})", self.inner)
    }
}

#[async_trait]
impl ObjectStore for LocalStore {
    async fn put_opts(
        &self,
        location: &Path,
        payload: PutPayload,
        opts: PutOptions,
    ) -> Result<PutResult> {
        let PutMode::Update(expected) = &opts.mode else {
            return self.inner.put_opts(location, payload, opts).await;
        };
        let _held = lock(self.lock.clone()).await?;
        let current = match self.inner.head(location).await {
            Ok(meta) => meta.e_tag,
            Err(Error::NotFound { .. }) => None,
            Err(error) => return Err(error),
        };
        if current.is_none() || current != expected.e_tag {
            return Err(Error::Precondition {
                path: location.to_string(),
                source: "the object changed since it was read".into(),
            });
        }
        let opts = PutOptions {
            mode: PutMode::Overwrite,
            ..opts
        };
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
        self.inner.get_opts(location, options).await
    }

    fn delete_stream(
        &self,
        locations: BoxStream<'static, Result<Path>>,
    ) -> BoxStream<'static, Result<Path>> {
        let (inner, lock_file) = (self.inner.clone(), self.lock.clone());
        locations
            .and_then(move |location| {
                let (inner, lock_file) = (inner.clone(), lock_file.clone());
                async move {
                    let _held = lock(lock_file).await?;
                    inner.delete(&location).await?;
                    Ok(location)
                }
            })
            .boxed()
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

fn generic(error: impl std::error::Error + Send + Sync + 'static) -> Error {
    Error::Generic {
        store: "LocalStore",
        source: Box::new(error),
    }
}
