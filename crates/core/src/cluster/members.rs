//! Which servers are up now, as listed by any server from the records in the bucket.

use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use crate::net::client;
use crate::sync::lock;
use serde::{Deserialize, Serialize};
use tokio::sync::OnceCell;
use tracing::debug;

pub const FOLDER: &str = "members";
pub const RENEW: Duration = Duration::from_secs(5);
pub const LEASE: Duration = Duration::from_secs(15);
pub const GRACE: Duration = Duration::from_secs(60);

const ASK: Duration = Duration::from_secs(1);

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Record {
    pub url: String,
    pub zone: Option<String>,
    pub leaving: bool,
    #[serde(skip)]
    pub until: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct Listing {
    pub live: Vec<String>,
    #[serde(default)]
    pub leaving: Vec<String>,
    pub gone: Vec<String>,
}

impl Listing {
    pub fn of(records: &[Record], now: u64) -> Self {
        let grace = GRACE.as_millis() as u64;
        let mut listing = Self::default();
        for record in records {
            if record.until >= now {
                match record.leaving {
                    false => listing.live.push(record.url.clone()),
                    true => listing.leaving.push(record.url.clone()),
                }
            } else if record.until + grace >= now {
                listing.gone.push(record.url.clone());
            }
        }
        listing.tidy();
        listing
    }

    pub fn all(&self) -> impl Iterator<Item = &String> {
        self.live.iter().chain(&self.leaving).chain(&self.gone)
    }

    pub fn is_up(&self, url: &str) -> bool {
        self.live.iter().chain(&self.leaving).any(|up| up == url)
    }

    fn tidy(&mut self) {
        for list in [&mut self.live, &mut self.leaving, &mut self.gone] {
            for url in list.iter_mut() {
                *url = url.trim_end_matches('/').to_string();
            }
            list.sort();
            list.dedup();
        }
        let live = self.live.clone();
        self.leaving.retain(|url| !live.contains(url));
        let up: Vec<String> = self.live.iter().chain(&self.leaving).cloned().collect();
        self.gone.retain(|url| !up.contains(url));
    }
}

pub struct Members {
    seeds: Vec<String>,
    listing: RwLock<Arc<Listing>>,
    first: OnceCell<()>,
    asked: Mutex<Option<Instant>>,
    fixed: Mutex<bool>,
    client: reqwest::Client,
}

impl Members {
    pub fn seeded(seeds: Vec<String>) -> Arc<Self> {
        let listing = Listing {
            live: seeds.clone(),
            ..Listing::default()
        };
        Arc::new(Self::with(seeds, listing))
    }

    pub fn fixed(listing: Listing) -> Arc<Self> {
        Arc::new(Self::with(Vec::new(), listing))
    }

    fn with(seeds: Vec<String>, mut listing: Listing) -> Self {
        listing.tidy();
        let seeds = seeds
            .into_iter()
            .map(|url| url.trim_end_matches('/').to_string())
            .collect();
        Self {
            seeds,
            listing: RwLock::new(Arc::new(listing)),
            first: OnceCell::new(),
            asked: Mutex::default(),
            fixed: Mutex::new(false),
            client: client(ASK, Some(ASK)),
        }
    }

    pub fn listing(&self) -> Arc<Listing> {
        self.listing
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    pub fn set(&self, mut listing: Listing) {
        listing.tidy();
        *self
            .listing
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Arc::new(listing);
    }

    pub fn is_empty(&self) -> bool {
        self.listing().live.is_empty()
    }

    pub fn now(self: &Arc<Self>, token: Option<String>) -> Arc<Listing> {
        if !self.seeds.is_empty() && !*lock(&self.fixed) {
            let due = lock(&self.asked).is_none_or(|at| at.elapsed() >= RENEW);
            if due && let Ok(runtime) = tokio::runtime::Handle::try_current() {
                self.mark_asked();
                let members = self.clone();
                runtime.spawn(async move { members.ask(token.as_deref()).await });
            }
        }
        self.listing()
    }

    pub async fn current(self: &Arc<Self>, token: Option<String>) -> Arc<Listing> {
        if self.seeds.is_empty() || *lock(&self.fixed) {
            return self.listing();
        }
        self.first
            .get_or_init(|| async {
                self.mark_asked();
                self.ask(token.as_deref()).await;
            })
            .await;
        let since = lock(&self.asked).map_or(LEASE, |at| at.elapsed());
        if since >= LEASE {
            self.mark_asked();
            self.ask(token.as_deref()).await;
        } else if since >= RENEW {
            self.mark_asked();
            let members = self.clone();
            tokio::spawn(async move { members.ask(token.as_deref()).await });
        }
        self.listing()
    }

    fn mark_asked(&self) {
        *lock(&self.asked) = Some(Instant::now());
    }

    async fn ask(&self, token: Option<&str>) {
        let known = self.listing();
        let mut tried = Vec::new();
        for url in known.live.iter().chain(&self.seeds) {
            if tried.contains(url) {
                continue;
            }
            tried.push(url.clone());
            let mut request = self.client.get(format!("{url}/members"));
            if let Some(token) = token {
                request = request.bearer_auth(token);
            }
            let Ok(response) = request.send().await else {
                continue;
            };
            match response.status().as_u16() {
                200 => {}
                404 => {
                    *lock(&self.fixed) = true;
                    return;
                }
                _ => continue,
            }
            match response.json::<Listing>().await {
                Ok(listing) if !listing.live.is_empty() => {
                    self.set(listing);
                    return;
                }
                _ => continue,
            }
        }
        debug!("no cache server answered for the list of servers; keeping the last one");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(url: &str, until: u64, leaving: bool) -> Record {
        Record {
            url: url.into(),
            zone: None,
            until,
            leaving,
        }
    }

    #[test]
    fn records_sort_into_live_and_gone() {
        let now = 1_000_000;
        let grace = GRACE.as_millis() as u64;
        let listing = Listing::of(
            &[
                record("http://a/", now + 1, false),
                record("http://b", now + 1, true),
                record("http://c", now - 1, false),
                record("http://d", now - grace - 1, false),
            ],
            now,
        );
        assert_eq!(listing.live, vec!["http://a"]);
        assert_eq!(listing.leaving, vec!["http://b"]);
        assert_eq!(listing.gone, vec!["http://c"]);
        assert_eq!(listing.all().count(), 3);
        assert!(listing.is_up("http://b") && !listing.is_up("http://c"));
    }

    #[tokio::test]
    async fn a_list_set_from_outside_is_not_asked_for() {
        let members = Members::fixed(Listing {
            live: vec!["http://a".into()],
            ..Listing::default()
        });
        assert_eq!(members.current(None).await.live, vec!["http://a"]);
    }

    #[tokio::test]
    async fn seeds_that_cannot_be_reached_are_kept() {
        let members = Members::seeded(vec!["http://127.0.0.1:1/".into()]);
        assert_eq!(members.current(None).await.live, vec!["http://127.0.0.1:1"]);
    }
}
