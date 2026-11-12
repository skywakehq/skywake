//! Opening a store from a location.

use std::collections::HashMap;
use std::fmt;
use std::fs;
use std::path::{Path as FsPath, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use async_trait::async_trait;
use futures::stream::BoxStream;
use object_store::aws::{AmazonS3Builder, S3ConditionalPut};
use object_store::azure::MicrosoftAzureBuilder;
use object_store::gcp::GoogleCloudStorageBuilder;
use object_store::limit::LimitStore;
use object_store::local::LocalFileSystem;
use object_store::path::Path;
use object_store::prefix::PrefixStore;
use object_store::{
    CopyOptions, Error, GetOptions, GetResult, ListResult, MultipartUpload, ObjectMeta,
    ObjectStore, ObjectStoreExt, PutMode, PutMultipartOptions, PutOptions, PutPayload, PutResult,
    RenameOptions, Result, UpdateVersion,
};
use tokio::sync::OnceCell;

use local::LocalStore;
use measured::Measured;

mod local;
mod measured;
mod scoped;
use crate::retry::random;

const MAX_REQUESTS: usize = 256;

pub(crate) const PROBES: &str = "probes";

static CHECKED: OnceLock<PathBuf> = OnceLock::new();

pub fn remember_checks(dir: PathBuf) {
    let _ = CHECKED.set(dir);
}

fn checked_mark(location: &str) -> Option<PathBuf> {
    let name = crate::Hash::of(location.as_bytes()).to_string();
    Some(CHECKED.get()?.join(name))
}

/// The URL schemes of the buckets Skywake can open: AWS S3 and other S3
/// compatible stores, Google Cloud Storage, and Azure Blob Storage.
const BUCKETS: [&str; 3] = ["s3://", "gs://", "az://"];

pub fn bucket_folder(location: &str) -> Option<String> {
    let rest = BUCKETS
        .iter()
        .find_map(|scheme| location.strip_prefix(scheme))?;
    let path = rest.split('?').next().unwrap_or_default();
    Some(split_bucket(path).1.to_string())
}

/// Splits `bucket/folder/inside` into the bucket and the folder.
fn split_bucket(location: &str) -> (&str, &str) {
    let (bucket, folder) = location.split_once('/').unwrap_or((location, ""));
    (bucket, folder.trim_matches('/'))
}

/// Opens only one folder of a bucket when the location names one.
fn in_folder(store: impl ObjectStore, folder: &str) -> Arc<dyn ObjectStore> {
    if folder.is_empty() {
        return Arc::new(store);
    }
    Arc::new(PrefixStore::new(store, folder))
}

pub async fn granted_heads(location: &str) -> crate::Result<Option<crate::HeadNodes>> {
    match location.strip_prefix("skywake://") {
        Some(namespace) => scoped::heads(namespace).await,
        None => Ok(None),
    }
}

pub fn open_store(location: &str) -> crate::Result<Arc<dyn ObjectStore>> {
    open_store_with(location, None)
}

#[derive(Clone, Debug)]
pub enum Encryption {
    Kms(String),
    Customer(String),
}

pub fn open_store_with(
    location: &str,
    encryption: Option<&Encryption>,
) -> crate::Result<Arc<dyn ObjectStore>> {
    if encryption.is_some() && !location.starts_with("s3://") {
        let message = "only an s3:// store takes an encryption key";
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, message).into());
    }
    let store: Arc<dyn ObjectStore> = if let Some(rest) = location.strip_prefix("s3://") {
        let (rest, region) = match rest.split_once("?region=") {
            Some((rest, region)) => (rest, Some(region)),
            None => (rest, None),
        };
        let mut s3 = AmazonS3Builder::from_env();
        if let Some(region) = region {
            s3 = s3.with_region(region);
        }
        s3 = match encryption {
            Some(Encryption::Kms(key)) => s3.with_sse_kms_encryption(key),
            Some(Encryption::Customer(key)) => s3.with_ssec_encryption(key),
            None => s3,
        };
        Arc::new(Checked::new(location, s3_store(rest, s3)?))
    } else if let Some(rest) = location.strip_prefix("gs://") {
        // Credentials come from the usual GOOGLE_* variables, or from the
        // machine's service account on Google Cloud.
        let (bucket, folder) = split_bucket(rest);
        let gcs = GoogleCloudStorageBuilder::from_env()
            .with_bucket_name(bucket)
            .build()?;
        Arc::new(Checked::new(location, in_folder(gcs, folder)))
    } else if let Some(rest) = location.strip_prefix("az://") {
        // The bucket is a container. The account and its key come from the
        // usual AZURE_* variables.
        let (container, folder) = split_bucket(rest);
        let azure = MicrosoftAzureBuilder::from_env()
            .with_container_name(container)
            .build()?;
        Arc::new(Checked::new(location, in_folder(azure, folder)))
    } else if let Some(namespace) = location.strip_prefix("skywake://") {
        Arc::new(Checked::new(location, scoped::open(namespace)?))
    } else {
        fs::create_dir_all(location)?;
        let local = LocalFileSystem::new_with_prefix(location)?;
        Arc::new(LocalStore::new(
            local,
            FsPath::new(location).join("refs.lock"),
        ))
    };
    Ok(Arc::new(LimitStore::new(
        Measured::new(store),
        MAX_REQUESTS,
    )))
}

pub(crate) fn s3_store(location: &str, s3: AmazonS3Builder) -> crate::Result<Arc<dyn ObjectStore>> {
    let (bucket, folder) = split_bucket(location);
    let s3 = s3
        .with_bucket_name(bucket)
        .with_conditional_put(S3ConditionalPut::ETagMatch)
        .build()?;
    Ok(in_folder(s3, folder))
}

type Check = Arc<OnceCell<Result<(), String>>>;

#[derive(Debug)]
pub(crate) struct Checked {
    inner: Arc<dyn ObjectStore>,
    location: String,
    check: Check,
}

impl Checked {
    pub(crate) fn new(location: &str, inner: Arc<dyn ObjectStore>) -> Self {
        static CHECKS: Mutex<Option<HashMap<String, Check>>> = Mutex::new(None);
        let mut checks = crate::sync::lock(&CHECKS);
        let check = checks
            .get_or_insert_default()
            .entry(location.to_string())
            .or_default()
            .clone();
        Self {
            inner,
            location: location.to_string(),
            check,
        }
    }

    async fn check(&self) -> Result<()> {
        let found = self.check.get_or_try_init(|| self.probe_once()).await?;
        found.clone().map_err(|message| Error::NotSupported {
            source: message.into(),
        })
    }
}

impl Checked {
    async fn probe_once(&self) -> Result<Result<(), String>> {
        let mark = checked_mark(&self.location);
        if mark.as_ref().is_some_and(|mark| mark.exists()) {
            return Ok(Ok(()));
        }
        let found = probe(self.inner.as_ref()).await?;
        if let (Ok(()), Some(mark)) = (&found, mark) {
            let _ = mark.parent().map(fs::create_dir_all);
            let _ = fs::write(mark, &self.location);
        }
        Ok(found)
    }
}

async fn probe(store: &dyn ObjectStore) -> Result<Result<(), String>> {
    let path = Path::from(format!("{PROBES}/{:016x}", random()));
    let put = |mode: PutMode| store.put_opts(&path, PutPayload::from("probe"), mode.into());
    put(PutMode::Create).await?;
    let again = put(PutMode::Create).await;
    // S3 and Azure check the ETag; Google Cloud Storage checks the version
    // (its "generation"). Neither of these matches the probe just written.
    let stale = put(PutMode::Update(UpdateVersion {
        e_tag: Some("\"0\"".to_string()),
        version: Some("1".to_string()),
    }))
    .await;
    let _ = store.delete(&path).await;
    if again.is_ok() || stale.is_ok() {
        return Ok(Err(format!(
            "{store} ignores conditional writes (If-None-Match and If-Match). Skywake needs \
             them to keep branch heads safe: use AWS S3, Google Cloud Storage, Azure Blob \
             Storage, Cloudflare R2, MinIO, RustFS or another store that supports them"
        )));
    }
    for result in [again, stale] {
        match result {
            Err(Error::AlreadyExists { .. } | Error::Precondition { .. }) | Ok(_) => {}
            Err(error) => return Err(error),
        }
    }
    Ok(Ok(()))
}

impl fmt::Display for Checked {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.inner.fmt(f)
    }
}

#[async_trait]
impl ObjectStore for Checked {
    async fn put_opts(
        &self,
        location: &Path,
        payload: PutPayload,
        opts: PutOptions,
    ) -> Result<PutResult> {
        if !matches!(opts.mode, PutMode::Overwrite) {
            self.check().await?;
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
        self.inner.copy_opts(from, to, options).await
    }

    async fn rename_opts(&self, from: &Path, to: &Path, options: RenameOptions) -> Result<()> {
        self.inner.rename_opts(from, to, options).await
    }
}

#[cfg(test)]
mod tests {
    use futures::StreamExt;
    use object_store::memory::InMemory;

    use super::*;

    #[derive(Debug, Default)]
    struct Careless(InMemory);

    impl fmt::Display for Careless {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            write!(f, "Careless")
        }
    }

    #[async_trait]
    impl ObjectStore for Careless {
        async fn put_opts(&self, at: &Path, data: PutPayload, _: PutOptions) -> Result<PutResult> {
            self.0.put_opts(at, data, PutOptions::default()).await
        }
        async fn put_multipart_opts(
            &self,
            at: &Path,
            opts: PutMultipartOptions,
        ) -> Result<Box<dyn MultipartUpload>> {
            self.0.put_multipart_opts(at, opts).await
        }
        async fn get_opts(&self, at: &Path, options: GetOptions) -> Result<GetResult> {
            self.0.get_opts(at, options).await
        }
        fn delete_stream(
            &self,
            paths: BoxStream<'static, Result<Path>>,
        ) -> BoxStream<'static, Result<Path>> {
            self.0.delete_stream(paths)
        }
        fn list(&self, prefix: Option<&Path>) -> BoxStream<'static, Result<ObjectMeta>> {
            self.0.list(prefix)
        }
        async fn list_with_delimiter(&self, prefix: Option<&Path>) -> Result<ListResult> {
            self.0.list_with_delimiter(prefix).await
        }
        async fn copy_opts(&self, from: &Path, to: &Path, options: CopyOptions) -> Result<()> {
            self.0.copy_opts(from, to, options).await
        }
    }

    #[test]
    fn every_bucket_scheme_names_its_folder() {
        for scheme in BUCKETS {
            assert_eq!(bucket_folder(&format!("{scheme}b")).unwrap(), "");
            assert_eq!(
                bucket_folder(&format!("{scheme}b/team/app/")).unwrap(),
                "team/app"
            );
        }
        assert_eq!(bucket_folder("s3://b/app?region=eu-west-1").unwrap(), "app");
        assert_eq!(bucket_folder(".skywake"), None);
    }

    #[tokio::test]
    async fn a_store_that_ignores_conditions_is_refused() {
        let store = Arc::new(Checked::new(
            "test://careless",
            Arc::new(Careless::default()),
        ));
        let repo = crate::Repo::new(store.clone());
        let error = repo.create_branch("main", None).await.unwrap_err();
        assert!(
            error.to_string().contains("ignores conditional writes"),
            "{error}"
        );
        store.put(&Path::from("x"), "x".into()).await.unwrap();
        assert!(store.list(Some(&Path::from(PROBES))).next().await.is_none());
    }

    #[tokio::test]
    async fn a_store_that_honours_conditions_is_checked_once() {
        let store = Arc::new(Checked::new("test://careful", Arc::new(InMemory::new())));
        let repo = crate::Repo::new(store.clone());
        repo.create_branch("main", None).await.unwrap();
        repo.create_branch("other", Some("main")).await.unwrap();
        assert!(store.check.initialized());
        assert!(store.list(Some(&Path::from(PROBES))).next().await.is_none());
    }

    #[tokio::test]
    async fn a_store_checked_by_an_earlier_process_is_not_probed() {
        let marks = tempfile::tempdir().unwrap();
        remember_checks(marks.path().into());
        let location = "test://checked-before";
        let mark = checked_mark(location).unwrap();
        fs::create_dir_all(mark.parent().unwrap()).unwrap();
        fs::write(&mark, location).unwrap();
        let store = Arc::new(Checked::new(location, Arc::new(Careless::default())));
        crate::Repo::new(store.clone())
            .create_branch("main", None)
            .await
            .unwrap();
        assert!(store.list(Some(&Path::from(PROBES))).next().await.is_none());
    }

    #[derive(Debug)]
    struct ReadOnly(Arc<InMemory>);

    impl fmt::Display for ReadOnly {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            write!(f, "ReadOnly")
        }
    }

    fn refused(path: &Path) -> Error {
        Error::PermissionDenied {
            path: path.to_string(),
            source: "read-only credentials".into(),
        }
    }

    #[async_trait]
    impl ObjectStore for ReadOnly {
        async fn put_opts(&self, at: &Path, _: PutPayload, _: PutOptions) -> Result<PutResult> {
            Err(refused(at))
        }
        async fn put_multipart_opts(
            &self,
            at: &Path,
            _: PutMultipartOptions,
        ) -> Result<Box<dyn MultipartUpload>> {
            Err(refused(at))
        }
        async fn get_opts(&self, at: &Path, options: GetOptions) -> Result<GetResult> {
            self.0.get_opts(at, options).await
        }
        fn delete_stream(
            &self,
            paths: BoxStream<'static, Result<Path>>,
        ) -> BoxStream<'static, Result<Path>> {
            paths.map(|path| Err(refused(&path?))).boxed()
        }
        fn list(&self, prefix: Option<&Path>) -> BoxStream<'static, Result<ObjectMeta>> {
            self.0.list(prefix)
        }
        async fn list_with_delimiter(&self, prefix: Option<&Path>) -> Result<ListResult> {
            self.0.list_with_delimiter(prefix).await
        }
        async fn copy_opts(&self, _: &Path, to: &Path, _: CopyOptions) -> Result<()> {
            Err(refused(to))
        }
    }

    #[tokio::test]
    async fn read_only_credentials_can_read() {
        let bucket = Arc::new(InMemory::new());
        let work = tempfile::tempdir().unwrap();
        std::fs::write(work.path().join("notes.md"), "hello").unwrap();
        let writer = crate::Repo::new(bucket.clone());
        writer.create_branch("main", None).await.unwrap();
        writer.commit("main", work.path(), "notes").await.unwrap();

        let store = Arc::new(Checked::new("test://read-only", Arc::new(ReadOnly(bucket))));
        let reader = crate::Repo::new(store.clone());
        assert_eq!(reader.branches().await.unwrap(), ["main"]);
        assert_eq!(reader.log("main").await.unwrap().len(), 2);
        assert_eq!(
            reader.read("main", None, "notes.md", 0, 100).await.unwrap(),
            b"hello"
        );
        reader.position("main").await.unwrap();
        let out = tempfile::tempdir().unwrap();
        reader.checkout("main", out.path()).await.unwrap();
        assert!(!store.check.initialized(), "a read wrote a probe");

        let error = reader.create_branch("other", Some("main")).await;
        assert!(error.is_err());
        assert!(!store.check.initialized());
    }
}
