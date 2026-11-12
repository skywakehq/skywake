//! `skywake://<namespace>`: a store with short-lived credentials for one namespace.

use std::fmt;
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use async_trait::async_trait;
use futures::future::ready;
use futures::stream::{self, BoxStream, StreamExt};
use object_store::aws::{AmazonS3Builder, AwsCredential};
use object_store::path::Path;
use object_store::{
    CopyOptions, CredentialProvider, Error, GetOptions, GetResult, ListResult, MultipartUpload,
    ObjectMeta, ObjectStore, PutMultipartOptions, PutOptions, PutPayload, PutResult, RenameOptions,
    Result,
};
use serde::Deserialize;
use tokio::sync::{Mutex, OnceCell};

use super::s3_store;
use crate::store::refs::{HeadNodes, PassSource};

const RENEW_AT: f64 = 0.8;

const RETRY_MAX: Duration = Duration::from_secs(60);

const RENEW_MIN: Duration = Duration::from_secs(60);

const API_TIMEOUT: Duration = Duration::from_secs(30);

pub(crate) fn open(namespace: &str) -> crate::Result<Arc<dyn ObjectStore>> {
    Ok(Arc::new(Scoped(Arc::new(Lazy {
        api: Arc::new(api(namespace)?),
        store: OnceCell::new(),
    }))))
}

pub(crate) async fn heads(namespace: &str) -> crate::Result<Option<HeadNodes>> {
    let api = Arc::new(api(namespace)?);
    let grant = api.grant().await?;
    let Some(heads) = grant.heads else {
        return Ok(None);
    };
    let expires = expiry(&grant.expires_at)?;
    let nodes = HeadNodes::new(heads.nodes, Some(heads.pass))
        .ok_or_else(|| generic("the API named no cache servers for branch heads"))?
        .in_folder(heads.folder)
        .renewing(Arc::new(Passes(api)), expires);
    Ok(Some(nodes))
}

struct Passes(Arc<Api>);

#[async_trait]
impl PassSource for Passes {
    async fn pass(&self) -> crate::Result<(String, SystemTime)> {
        let grant = self.0.ask().await?;
        let heads = grant.heads.ok_or_else(|| {
            generic("the API no longer keeps this namespace's heads on cache servers")
        })?;
        Ok((heads.pass, expiry(&grant.expires_at)?))
    }
}

fn expiry(text: &str) -> Result<SystemTime> {
    let time = chrono::DateTime::parse_from_rfc3339(text).map_err(generic)?;
    Ok(SystemTime::from(time.to_utc()))
}

fn api(namespace: &str) -> Result<Api> {
    let var = |name: &str| {
        std::env::var(name).map_err(|_| generic(format!("{name} must be set for skywake://")))
    };
    Ok(Api {
        url: var("SKYWAKE_API_URL")?,
        key: var("SKYWAKE_API_KEY")?,
        namespace: namespace.to_string(),
        access: access(
            std::env::var("SKYWAKE_STORE_ACCESS").ok(),
            std::env::var("SKYWAKE_ACCESS").ok(),
        )?,
        client: reqwest::Client::builder()
            .connect_timeout(API_TIMEOUT / 3)
            .timeout(API_TIMEOUT)
            .build()
            .map_err(generic)?,
    })
}

fn access(store_access: Option<String>, old: Option<String>) -> Result<String> {
    match (store_access, old.as_deref()) {
        (Some(access), _) => Ok(access),
        (None, Some("read" | "write")) => Err(generic(
            "SKYWAKE_ACCESS no longer sets a skywake:// store's access; set SKYWAKE_STORE_ACCESS",
        )),
        (None, _) => Ok("write".to_string()),
    }
}

struct Api {
    url: String,
    key: String,
    namespace: String,
    access: String,
    client: reqwest::Client,
}

impl fmt::Debug for Api {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Api({}, {})", self.url, self.namespace)
    }
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Grant {
    store: String,
    region: String,
    endpoint: Option<String>,
    access_key_id: String,
    secret_access_key: String,
    session_token: String,
    expires_at: String,
    #[serde(default)]
    heads: Option<GrantedHeads>,
}

#[derive(Deserialize, Clone)]
struct GrantedHeads {
    nodes: Vec<String>,
    folder: String,
    pass: String,
}

const SHARED_FOR: Duration = Duration::from_secs(30);

static RECENT: std::sync::Mutex<Vec<(String, Grant, std::time::Instant)>> =
    std::sync::Mutex::new(Vec::new());

impl Api {
    async fn grant(&self) -> Result<Grant> {
        let key = format!("{} {} {}", self.url, self.namespace, self.access);
        {
            let recent = crate::sync::lock(&RECENT);
            if let Some((_, grant, _)) = recent
                .iter()
                .find(|(at, _, when)| *at == key && when.elapsed() < SHARED_FOR)
            {
                return Ok(grant.clone());
            }
        }
        let grant = self.ask().await?;
        let mut recent = crate::sync::lock(&RECENT);
        recent.retain(|(at, _, when)| *at != key && when.elapsed() < SHARED_FOR);
        recent.push((key, grant.clone(), std::time::Instant::now()));
        Ok(grant)
    }

    async fn ask(&self) -> Result<Grant> {
        let url = format!(
            "{}/v1/namespaces/{}/credentials",
            self.url.trim_end_matches('/'),
            encode(&self.namespace)
        );
        let response = self
            .client
            .post(url)
            .bearer_auth(&self.key)
            .json(&serde_json::json!({ "access": self.access }))
            .send()
            .await
            .map_err(generic)?;
        let status = response.status();
        if status == reqwest::StatusCode::NOT_IMPLEMENTED {
            return Err(generic(
                "the Skywake API cannot grant scoped credentials (no STS role is set up); \
                 use an s3:// location with your own keys",
            ));
        }
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            let body: String = body.chars().take(500).collect();
            return Err(generic(format!(
                "the Skywake API refused credentials for {}: {status} {body}",
                self.namespace
            )));
        }
        response.json().await.map_err(generic)
    }
}

fn encode(text: &str) -> String {
    text.bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

struct Current {
    credential: Arc<AwsCredential>,
    expires: SystemTime,
    renew: SystemTime,
    failures: u32,
}

impl Current {
    fn new(grant: &Grant, now: SystemTime) -> Result<Self> {
        let expires = chrono::DateTime::parse_from_rfc3339(&grant.expires_at)
            .map_err(generic)?
            .to_utc();
        let expires = SystemTime::from(expires);
        let life = expires.duration_since(now).unwrap_or_default();
        Ok(Self {
            credential: Arc::new(AwsCredential {
                key_id: grant.access_key_id.clone(),
                secret_key: grant.secret_access_key.clone(),
                token: Some(grant.session_token.clone()),
            }),
            expires,
            renew: now + life.mul_f64(RENEW_AT).max(RENEW_MIN),
            failures: 0,
        })
    }

    fn failed(&mut self, now: SystemTime) -> bool {
        self.failures += 1;
        let wait = Duration::from_secs(1 << self.failures.min(6)).min(RETRY_MAX);
        self.renew = now + wait;
        now < self.expires
    }
}

#[derive(Debug)]
struct Credentials {
    api: Arc<Api>,
    current: std::sync::Mutex<Current>,
    renewing: Mutex<()>,
}

impl Credentials {
    fn current(&self) -> std::sync::MutexGuard<'_, Current> {
        crate::sync::lock(&self.current)
    }
}

impl fmt::Debug for Current {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Current {{ expires: {:?} }}", self.expires)
    }
}

#[async_trait]
impl CredentialProvider for Credentials {
    type Credential = AwsCredential;

    async fn get_credential(&self) -> Result<Arc<AwsCredential>> {
        let _renewing = loop {
            let (credential, renew, expires) = {
                let current = self.current();
                (current.credential.clone(), current.renew, current.expires)
            };
            let now = SystemTime::now();
            if now < renew {
                return Ok(credential);
            }
            match self.renewing.try_lock() {
                Ok(guard) => break guard,
                Err(_) if now < expires => return Ok(credential),
                Err(_) => drop(self.renewing.lock().await),
            }
        };
        let now = SystemTime::now();
        let grant = self.api.grant().await;
        let mut current = self.current();
        match grant.and_then(|grant| Current::new(&grant, now)) {
            Ok(fresh) => *current = fresh,
            Err(error) if current.failed(now) => {
                tracing::warn!(%error, "could not renew store credentials; using the old ones");
            }
            Err(error) => return Err(error),
        }
        Ok(current.credential.clone())
    }
}

#[derive(Debug)]
struct Lazy {
    api: Arc<Api>,
    store: OnceCell<Arc<dyn ObjectStore>>,
}

impl Lazy {
    async fn store(&self) -> Result<Arc<dyn ObjectStore>> {
        let store = self
            .store
            .get_or_try_init(|| async {
                let now = SystemTime::now();
                let grant = self.api.grant().await?;
                let credentials = Credentials {
                    api: self.api.clone(),
                    current: std::sync::Mutex::new(Current::new(&grant, now)?),
                    renewing: Mutex::new(()),
                };
                let mut s3 = AmazonS3Builder::new()
                    .with_region(&grant.region)
                    .with_credentials(Arc::new(credentials));
                if let Some(endpoint) = &grant.endpoint {
                    s3 = s3
                        .with_endpoint(endpoint)
                        .with_allow_http(endpoint.starts_with("http://"));
                }
                let location = grant.store.strip_prefix("s3://").ok_or_else(|| {
                    generic(format!(
                        "the API granted an unknown store `{}`",
                        grant.store
                    ))
                })?;
                s3_store(location, s3).map_err(|error| match error {
                    crate::Error::Store(error) => error,
                    error => generic(error),
                })
            })
            .await?;
        Ok(store.clone())
    }
}

#[derive(Debug)]
struct Scoped(Arc<Lazy>);

impl fmt::Display for Scoped {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "skywake://{}", self.0.api.namespace)
    }
}

fn later<T: Send + 'static>(
    lazy: Arc<Lazy>,
    then: impl FnOnce(Arc<dyn ObjectStore>) -> BoxStream<'static, Result<T>> + Send + 'static,
) -> BoxStream<'static, Result<T>> {
    stream::once(async move {
        match lazy.store().await {
            Ok(store) => then(store),
            Err(error) => stream::once(ready(Err(error))).boxed(),
        }
    })
    .flatten()
    .boxed()
}

#[async_trait]
impl ObjectStore for Scoped {
    async fn put_opts(
        &self,
        location: &Path,
        payload: PutPayload,
        opts: PutOptions,
    ) -> Result<PutResult> {
        let store = self.0.store().await?;
        store.put_opts(location, payload, opts).await
    }

    async fn put_multipart_opts(
        &self,
        location: &Path,
        opts: PutMultipartOptions,
    ) -> Result<Box<dyn MultipartUpload>> {
        let store = self.0.store().await?;
        store.put_multipart_opts(location, opts).await
    }

    async fn get_opts(&self, location: &Path, options: GetOptions) -> Result<GetResult> {
        let store = self.0.store().await?;
        store.get_opts(location, options).await
    }

    fn delete_stream(
        &self,
        locations: BoxStream<'static, Result<Path>>,
    ) -> BoxStream<'static, Result<Path>> {
        later(self.0.clone(), move |store| store.delete_stream(locations))
    }

    fn list(&self, prefix: Option<&Path>) -> BoxStream<'static, Result<ObjectMeta>> {
        let prefix = prefix.cloned();
        later(self.0.clone(), move |store| store.list(prefix.as_ref()))
    }

    fn list_with_offset(
        &self,
        prefix: Option<&Path>,
        offset: &Path,
    ) -> BoxStream<'static, Result<ObjectMeta>> {
        let (prefix, offset) = (prefix.cloned(), offset.clone());
        later(self.0.clone(), move |store| {
            store.list_with_offset(prefix.as_ref(), &offset)
        })
    }

    async fn list_with_delimiter(&self, prefix: Option<&Path>) -> Result<ListResult> {
        let store = self.0.store().await?;
        store.list_with_delimiter(prefix).await
    }

    async fn copy_opts(&self, from: &Path, to: &Path, options: CopyOptions) -> Result<()> {
        let store = self.0.store().await?;
        store.copy_opts(from, to, options).await
    }

    async fn rename_opts(&self, from: &Path, to: &Path, options: RenameOptions) -> Result<()> {
        let store = self.0.store().await?;
        store.rename_opts(from, to, options).await
    }
}

fn generic(error: impl Into<Box<dyn std::error::Error + Send + Sync>>) -> Error {
    Error::Generic {
        store: "skywake",
        source: error.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grant(seconds: u64, key: &str) -> Grant {
        let expires = chrono::Utc::now() + Duration::from_secs(seconds);
        Grant {
            store: "s3://bucket/ns".into(),
            region: "auto".into(),
            endpoint: None,
            access_key_id: key.into(),
            secret_access_key: "secret".into(),
            session_token: "token".into(),
            expires_at: expires.to_rfc3339(),
            heads: None,
        }
    }

    #[test]
    fn skywakeds_access_file_is_not_sent_as_the_stores_access() {
        let file = Some("/etc/skywake/access".to_string());
        assert_eq!(access(None, file.clone()).unwrap(), "write");
        assert_eq!(access(Some("read".into()), file).unwrap(), "read");
    }

    #[test]
    fn an_access_level_left_in_the_old_variable_stops() {
        assert!(access(None, Some("read".into())).is_err());
        assert_eq!(
            access(Some("read".into()), Some("write".into())).unwrap(),
            "read"
        );
        assert_eq!(access(None, None).unwrap(), "write");
    }

    #[test]
    fn credentials_are_renewed_at_four_fifths_of_their_life() {
        let now = SystemTime::now();
        let current = Current::new(&grant(1000, "a"), now).unwrap();
        let renew = current.renew.duration_since(now).unwrap().as_secs();
        assert!((795..=800).contains(&renew), "{renew}");
    }

    #[test]
    fn a_failed_renewal_keeps_the_old_credentials_until_they_end() {
        let now = SystemTime::now();
        let mut current = Current::new(&grant(100, "a"), now).unwrap();
        let later = now + Duration::from_secs(90);
        assert!(current.failed(later));
        assert_eq!(current.renew, later + Duration::from_secs(2));
        assert!(current.failed(later));
        assert_eq!(current.renew, later + Duration::from_secs(4));
        assert!(!current.failed(now + Duration::from_secs(200)), "expired");
    }

    #[test]
    fn credentials_that_look_ended_are_still_used_for_a_while() {
        let now = SystemTime::now();
        let current = Current::new(&grant(0, "a"), now).unwrap();
        assert!(current.renew >= now + RENEW_MIN);
    }

    #[tokio::test]
    async fn a_slow_renewal_does_not_stop_other_requests() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move {
            let mut held = Vec::new();
            while let Ok((socket, _)) = listener.accept().await {
                held.push(socket);
            }
        });
        let now = SystemTime::now();
        let mut current = Current::new(&grant(3600, "a"), now).unwrap();
        current.renew = now;
        let credentials = Arc::new(Credentials {
            api: Arc::new(Api {
                url,
                key: "k".into(),
                namespace: "ns".into(),
                access: "write".into(),
                client: reqwest::Client::new(),
            }),
            current: std::sync::Mutex::new(current),
            renewing: Mutex::new(()),
        });
        let renewing = tokio::spawn({
            let credentials = credentials.clone();
            async move { credentials.get_credential().await }
        });
        tokio::time::sleep(Duration::from_millis(200)).await;
        let other = tokio::time::timeout(Duration::from_secs(2), credentials.get_credential())
            .await
            .expect("waited for the stalled renewal");
        assert_eq!(other.unwrap().key_id, "a");
        renewing.abort();
    }

    #[test]
    fn namespaces_are_escaped() {
        assert_eq!(encode("team/a b"), "team%2Fa%20b");
    }

    #[test]
    fn the_key_is_never_printed() {
        let api = Api {
            url: "https://api".into(),
            key: "sk_live_secret".into(),
            namespace: "ns".into(),
            access: "write".into(),
            client: reqwest::Client::new(),
        };
        assert!(!format!("{api:?}").contains("secret"));
    }
}
