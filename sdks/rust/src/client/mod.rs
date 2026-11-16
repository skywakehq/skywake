mod create;
mod settings;
mod types;

use std::time::Duration;

use serde::Serialize;

pub use create::{CreateDisk, CreateIndex, CreateKey};
pub use types::{CreatedKey, Environment, Key, NewLogin, Role, StartedLogin, Whoami};

use crate::place::{MAIN, Place};
use crate::shared::http::{Http, segment};
use crate::shared::paging::{List, pages};
use crate::shared::retry::Retry;
use crate::{Disk, DiskSummary, Index, IndexSummary, Result};
use settings::{Asked, resolve};

#[derive(Clone)]
pub struct Skywake {
    http: Http,
    url: String,
    environment: Option<String>,
}

#[derive(Serialize)]
struct NewEnvironment<'a> {
    name: &'a str,
}

impl Skywake {
    pub fn new() -> Result<Self> {
        Self::builder().build()
    }

    pub fn builder() -> Builder {
        Builder::default()
    }

    pub fn url(&self) -> &str {
        &self.url
    }

    pub fn environment(&self) -> Option<&str> {
        self.environment.as_deref()
    }

    pub fn disk(&self, name: &str) -> Disk {
        Disk::from(Place::new(self.http.clone(), "disks", name, MAIN))
    }

    pub fn index(&self, name: &str) -> Index {
        Index::from(Place::new(self.http.clone(), "indexes", name, MAIN))
    }

    pub fn create_disk(&self, name: &str) -> CreateDisk<'_> {
        CreateDisk::new(self, name)
    }

    pub fn create_index(&self, name: &str) -> CreateIndex<'_> {
        CreateIndex::new(self, name)
    }

    pub fn list_disks(&self) -> List<DiskSummary> {
        self.list("/disks")
    }

    pub fn list_indexes(&self) -> List<IndexSummary> {
        self.list("/indexes")
    }

    pub fn create_key(&self, name: &str, role: Role) -> CreateKey<'_> {
        CreateKey::new(self, name, role)
    }

    pub fn list_keys(&self) -> List<Key> {
        self.list("/keys")
    }

    pub async fn revoke_key(&self, id: &str) -> Result<()> {
        self.http.delete(&format!("/keys/{}", segment(id))).await
    }

    pub fn list_environments(&self) -> List<Environment> {
        self.list("/environments")
    }

    pub async fn create_environment(&self, name: &str) -> Result<Environment> {
        self.http
            .post("/environments", &NewEnvironment { name })
            .await
    }

    pub async fn whoami(&self) -> Result<Whoami> {
        self.http.get("/whoami", Vec::new()).await
    }

    pub async fn start_login(&self, login: &NewLogin) -> Result<StartedLogin> {
        self.http.post("/logins", login).await
    }

    fn list<T: serde::de::DeserializeOwned + Send + 'static>(&self, path: &str) -> List<T> {
        pages(self.http.clone(), path.to_string(), Vec::new())
    }
}

#[derive(Default)]
#[must_use]
pub struct Builder {
    asked: Asked,
    retries: Option<u32>,
    timeout: Option<Duration>,
    backoff: Option<Duration>,
}

impl Builder {
    pub fn key(mut self, key: impl Into<String>) -> Self {
        self.asked.key = Some(key.into());
        self
    }

    pub fn url(mut self, url: impl Into<String>) -> Self {
        self.asked.url = Some(url.into());
        self
    }

    pub fn environment(mut self, environment: impl Into<String>) -> Self {
        self.asked.environment = Some(environment.into());
        self
    }

    pub fn profile(mut self, profile: impl Into<String>) -> Self {
        self.asked.profile = Some(profile.into());
        self
    }

    pub fn retries(mut self, retries: u32) -> Self {
        self.retries = Some(retries);
        self
    }

    pub fn timeout(mut self, timeout: Duration) -> Self {
        self.timeout = Some(timeout);
        self
    }

    pub fn backoff(mut self, backoff: Duration) -> Self {
        self.backoff = Some(backoff);
        self
    }

    pub fn build(self) -> Result<Skywake> {
        let settings = resolve(self.asked)?;
        let timeout = self.timeout.unwrap_or(Duration::from_secs(60));
        let client = reqwest::Client::builder()
            .connect_timeout(timeout)
            .read_timeout(timeout)
            .build()?;
        let url = root_url(&settings.url);
        let retry = Retry {
            retries: self.retries.unwrap_or(3),
            backoff: self.backoff.unwrap_or(Duration::from_millis(200)),
        };
        let base = format!("{url}/v2");
        let environment = settings.environment;
        let http = Http::new(client, &base, &settings.key, environment.as_deref(), retry);
        Ok(Skywake {
            http,
            url,
            environment,
        })
    }
}

fn root_url(url: &str) -> String {
    let url = url.trim_end_matches('/');
    let url = url
        .strip_suffix("/v1")
        .or_else(|| url.strip_suffix("/v2"))
        .unwrap_or(url);
    url.to_string()
}
