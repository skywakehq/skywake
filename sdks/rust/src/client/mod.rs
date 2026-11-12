mod options;
mod transport;

pub use options::Options;
pub(crate) use transport::Params;

use crate::{Indexes, Result, SearchIndex};

/// The API, for one key. Cloning it is cheap and shares connections.
#[derive(Clone)]
pub struct Client {
    http: reqwest::Client,
    base: String,
    key: String,
    options: Options,
}

impl Client {
    /// `key` is an API key (`sw_...`) or a console token.
    pub fn new(url: &str, key: &str) -> Result<Self> {
        Self::with_options(url, key, Options::default())
    }

    pub fn with_options(url: &str, key: &str, options: Options) -> Result<Self> {
        let http = reqwest::Client::builder()
            .connect_timeout(options.timeout)
            .read_timeout(options.timeout)
            .build()?;
        // Every route lives under /v1.
        let url = url.trim_end_matches('/');
        let base = format!("{}/v1", url.strip_suffix("/v1").unwrap_or(url));
        let key = key.to_string();
        Ok(Client {
            http,
            base,
            key,
            options,
        })
    }

    /// Make, list, read and delete search indexes.
    pub fn indexes(&self) -> Indexes {
        Indexes::new(self.clone())
    }

    /// A search index, on its `main` branch.
    pub fn index(&self, name: &str) -> SearchIndex {
        SearchIndex::new(self.clone(), name, "main")
    }
}
