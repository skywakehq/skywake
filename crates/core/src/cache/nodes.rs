//! Asking the cache servers for chunks, and passing over servers that fail.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures::{StreamExt, stream};
use tracing::{debug, warn};

use super::{Listing, Members};
use crate::net::{client, score};
use crate::retry::random;
use crate::sync::lock;
use crate::{Bundled, Hash};

const CONNECT: Duration = Duration::from_millis(250);
const FIRST_BYTE: Duration = Duration::from_millis(500);
const BODY: Duration = Duration::from_secs(2);
const DOWN_MIN: Duration = Duration::from_secs(5);
const DOWN_MAX: Duration = Duration::from_secs(60);
const BATCH_WAIT: Duration = Duration::from_secs(10);
pub const BATCH_MAX: u64 = 16 << 20;
pub const BATCH_FILES_MAX: usize = 4096;
const BATCHES_AT_ONCE: usize = 16;

pub const HOT: &str = "skywake-hot";
const HOT_COPIES: usize = 3;
const HOT_FOR: Duration = Duration::from_secs(30);
const HOT_MAX: usize = 10_000;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Shared {
    pub kind: &'static str,
    pub folder: String,
    pub bundled: Option<Bundled>,
}

impl Shared {
    pub fn chunks(folder: impl Into<String>) -> Self {
        Self {
            kind: "chunks",
            folder: folder.into(),
            bundled: None,
        }
    }

    pub fn blobs(folder: impl Into<String>) -> Self {
        Self {
            kind: "blobs",
            folder: folder.into(),
            bundled: None,
        }
    }

    pub fn at(self, bundled: Option<Bundled>) -> Self {
        Self { bundled, ..self }
    }

    fn route(&self, hash: Hash) -> Hash {
        self.bundled.map_or(hash, |bundled| bundled.bundle)
    }

    fn add_to(&self, url: &mut reqwest::Url) {
        let mut query = url.query_pairs_mut();
        if !self.folder.is_empty() {
            query.append_pair("in", &self.folder);
        }
        if let Some(bundled) = &self.bundled {
            query.append_pair("bundle", &bundled.bundle.to_string());
            query.append_pair("at", &bundled.offset.to_string());
            query.append_pair("stored", &bundled.len.to_string());
            query.append_pair("size", &bundled.chunk.size.to_string());
        }
    }
}

pub struct CacheNodes {
    members: Arc<Members>,
    token: Option<String>,
    client: reqwest::Client,
    health: Mutex<HashMap<String, Health>>,
    hot: Mutex<HashMap<Hash, Instant>>,
}

#[derive(Default)]
struct Health {
    failures: u32,
    down_until: Option<Instant>,
}

impl Default for CacheNodes {
    fn default() -> Self {
        Self::over(Members::fixed(Listing::default()), None)
    }
}

impl CacheNodes {
    pub fn new(seeds: Vec<String>, token: Option<String>) -> Self {
        Self::over(Members::seeded(seeds), token)
    }

    pub fn over(members: Arc<Members>, token: Option<String>) -> Self {
        Self {
            members,
            token,
            client: client(CONNECT, None),
            health: Mutex::default(),
            hot: Mutex::default(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.members.is_empty()
    }

    pub async fn get(&self, hash: Hash, shared: &Shared) -> Option<Vec<u8>> {
        let route = shared.route(hash);
        let node = self.owner(route)?;
        if self.is_down(&node) {
            fallback("down");
            return None;
        }
        match self.ask(&node, hash, shared).await {
            Ok(data) => {
                self.healthy(&node);
                Some(data)
            }
            Err("not_found") => {
                self.healthy(&node);
                fallback("not_found");
                None
            }
            Err(reason) => {
                self.failed(&node, reason);
                fallback(reason);
                None
            }
        }
    }

    pub async fn slice(
        &self,
        hash: Hash,
        shared: &Shared,
        start: u64,
        len: u64,
    ) -> Option<Vec<u8>> {
        let node = self.owner(shared.route(hash))?;
        if self.is_down(&node) {
            return None;
        }
        let answer = self.ask_slice(&node, hash, shared, start, len).await;
        match &answer {
            Ok(_) | Err("not_found") => self.healthy(&node),
            Err(reason) => self.failed(&node, reason),
        }
        answer.ok()
    }

    pub async fn get_bundled(
        &self,
        mut wanted: Vec<Bundled>,
        got: &(dyn Fn(Hash, Vec<u8>) + Send + Sync),
    ) -> Vec<Bundled> {
        wanted.sort_by_key(|bundled| (*bundled.bundle.as_bytes(), bundled.offset));
        wanted.dedup_by_key(|bundled| (bundled.bundle, bundled.chunk.hash));
        let mut batches: Vec<Vec<Bundled>> = Vec::new();
        let mut bytes = 0;
        for bundled in wanted {
            let size = u64::from(bundled.chunk.size);
            let joins = batches.last().is_some_and(|batch| {
                batch[0].bundle == bundled.bundle
                    && batch.len() < BATCH_FILES_MAX
                    && bytes + size <= BATCH_MAX
            });
            if !joins {
                batches.push(Vec::new());
                bytes = 0;
            }
            bytes += size;
            batches.last_mut().expect("just pushed").push(bundled);
        }
        stream::iter(batches)
            .map(|batch| self.batch(batch, got))
            .buffer_unordered(BATCHES_AT_ONCE)
            .concat()
            .await
    }

    async fn batch(
        &self,
        batch: Vec<Bundled>,
        got: &(dyn Fn(Hash, Vec<u8>) + Send + Sync),
    ) -> Vec<Bundled> {
        let Some(node) = self.owner(batch[0].bundle) else {
            return batch;
        };
        if self.is_down(&node) {
            fallback("down");
            return batch;
        }
        let reply = match tokio::time::timeout(BATCH_WAIT, self.ask_bundled(&node, &batch)).await {
            Ok(Ok(reply)) => reply,
            Ok(Err(reason)) => {
                self.failed(&node, reason);
                fallback(reason);
                return batch;
            }
            Err(_) => {
                self.failed(&node, "timeout");
                fallback("timeout");
                return batch;
            }
        };
        self.healthy(&node);
        let mut left = Vec::new();
        let mut at = 0;
        for bundled in batch {
            let size = bundled.chunk.size as usize;
            match reply.get(at) {
                Some(1) if reply.len() >= at + 1 + size => {
                    let data = &reply[at + 1..at + 1 + size];
                    at += 1 + size;
                    if Hash::of(data) == bundled.chunk.hash {
                        got(bundled.chunk.hash, data.to_vec());
                    } else {
                        left.push(bundled);
                    }
                }
                Some(0) => {
                    at += 1;
                    left.push(bundled);
                }
                _ => {
                    at = reply.len();
                    left.push(bundled);
                }
            }
        }
        left
    }

    async fn ask_bundled(&self, node: &str, batch: &[Bundled]) -> Result<Vec<u8>, &'static str> {
        let url = format!("{node}/bundles/{}", batch[0].bundle);
        let url = reqwest::Url::parse(&url).map_err(|_| "unreachable")?;
        let body = postcard::to_stdvec(batch).map_err(|_| "status")?;
        let mut request = self.client.post(url).body(body);
        if let Some(token) = &self.token {
            request = request.bearer_auth(token);
        }
        let response = request.send().await.map_err(|_| "unreachable")?;
        self.check(batch[0].bundle, &response)?;
        let reply = response.bytes().await.map_err(|_| "unreachable")?;
        Ok(reply.to_vec())
    }

    async fn ask_slice(
        &self,
        node: &str,
        hash: Hash,
        shared: &Shared,
        start: u64,
        len: u64,
    ) -> Result<Vec<u8>, &'static str> {
        let proof = self
            .download(node, hash, shared, Some((start, len)))
            .await?;
        super::slices::verify(&proof, hash, start, len).map_err(|_| "corrupt")
    }

    async fn ask(&self, node: &str, hash: Hash, shared: &Shared) -> Result<Vec<u8>, &'static str> {
        let data = self.download(node, hash, shared, None).await?;
        if Hash::of(&data) != hash {
            return Err("corrupt");
        }
        Ok(data)
    }

    async fn download(
        &self,
        node: &str,
        hash: Hash,
        shared: &Shared,
        range: Option<(u64, u64)>,
    ) -> Result<Vec<u8>, &'static str> {
        let url = format!("{node}/{}/{hash}", shared.kind);
        let mut url = reqwest::Url::parse(&url).map_err(|_| "unreachable")?;
        shared.add_to(&mut url);
        if let Some((start, len)) = range {
            let mut query = url.query_pairs_mut();
            query.append_pair("start", &start.to_string());
            query.append_pair("len", &len.to_string());
        }
        let mut request = self.client.get(url);
        if let Some(token) = &self.token {
            request = request.bearer_auth(token);
        }
        let response = tokio::time::timeout(FIRST_BYTE, request.send())
            .await
            .map_err(|_| "timeout")?
            .map_err(|_| "unreachable")?;
        self.check(shared.route(hash), &response)?;
        let data = tokio::time::timeout(BODY, response.bytes())
            .await
            .map_err(|_| "timeout")?
            .map_err(|_| "unreachable")?;
        Ok(data.to_vec())
    }

    fn check(&self, route: Hash, response: &reqwest::Response) -> Result<(), &'static str> {
        match response.status().as_u16() {
            200 => {}
            404 => return Err("not_found"),
            401 | 403 => return Err("unauthorized"),
            _ => return Err("status"),
        }
        if response.headers().contains_key(HOT) {
            let mut hot = lock(&self.hot);
            if hot.len() >= HOT_MAX {
                hot.retain(|_, since| since.elapsed() < HOT_FOR);
            }
            if hot.len() < HOT_MAX {
                hot.entry(route).or_insert_with(Instant::now);
            }
        }
        Ok(())
    }

    fn owner(&self, route: Hash) -> Option<String> {
        let listing = self.members.now(self.token.clone());
        let spread = {
            let mut hot = lock(&self.hot);
            match hot.get(&route) {
                Some(since) if since.elapsed() < HOT_FOR => HOT_COPIES,
                Some(_) => {
                    hot.remove(&route);
                    1
                }
                None => 1,
            }
        };
        let mut ranked: Vec<(u64, &String)> = listing
            .live
            .iter()
            .map(|node| (rank(node, route), node))
            .collect();
        ranked.sort_unstable_by(|a, b| b.cmp(a));
        let choices = spread.min(ranked.len());
        if choices == 0 {
            return None;
        }
        let pick = (random() % choices as u64) as usize;
        Some(ranked[pick].1.clone())
    }

    fn is_down(&self, node: &str) -> bool {
        lock(&self.health)
            .get(node)
            .and_then(|health| health.down_until)
            .is_some_and(|until| Instant::now() < until)
    }

    fn healthy(&self, node: &str) {
        lock(&self.health).remove(node);
    }

    fn failed(&self, node: &str, reason: &str) {
        let mut all = lock(&self.health);
        let health = all.entry(node.to_string()).or_default();
        health.failures += 1;
        let wait = DOWN_MIN
            .saturating_mul(1 << (health.failures - 1).min(16))
            .min(DOWN_MAX);
        health.down_until = Some(Instant::now() + wait);
        if health.failures == 1 {
            warn!(
                node,
                reason, "cache node failed; reading the bucket instead"
            );
        } else {
            debug!(
                node,
                reason,
                failures = health.failures,
                "cache node failed again"
            );
        }
    }
}

fn rank(node: &str, route: Hash) -> u64 {
    score(&format!("{node}/{route}"))
}

fn fallback(reason: &'static str) {
    metrics::counter!("skywake_node_fallbacks_total", "reason" => reason).increment(1);
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::time::{Duration, Instant};

    use crate::Hash;
    use tokio::net::TcpListener;

    use super::{CacheNodes, Listing, Members, Shared, lock};

    async fn stuck_node() -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move {
            let mut held = Vec::new();
            while let Ok((socket, _)) = listener.accept().await {
                held.push(socket);
            }
        });
        url
    }

    #[tokio::test]
    async fn a_stuck_node_costs_one_short_wait_then_is_skipped() {
        let nodes = CacheNodes::new(vec![stuck_node().await], None);
        let hash = Hash::of(b"chunk");
        let started = Instant::now();
        assert!(nodes.get(hash, &Shared::chunks("")).await.is_none());
        let first = started.elapsed();
        assert!(first < Duration::from_secs(1), "first try took {first:?}");

        let started = Instant::now();
        for _ in 0..10 {
            assert!(nodes.get(hash, &Shared::chunks("")).await.is_none());
        }
        let skipped = started.elapsed();
        assert!(
            skipped < Duration::from_millis(50),
            "skips took {skipped:?}"
        );
    }

    #[tokio::test]
    async fn a_node_is_tried_again_after_its_wait() {
        let node = stuck_node().await;
        let nodes = CacheNodes::new(vec![node.clone()], None);
        nodes.failed(&node, "timeout");
        assert!(nodes.is_down(&node));
        lock(&nodes.health).get_mut(&node).unwrap().down_until = Some(Instant::now());
        assert!(!nodes.is_down(&node));
        nodes.failed(&node, "timeout");
        assert_eq!(lock(&nodes.health)[&node].failures, 2);
    }

    #[tokio::test]
    async fn a_hot_chunk_is_spread_over_three_servers() {
        let servers: Vec<String> = (0..8).map(|n| format!("http://10.0.0.{n}:7070")).collect();
        let nodes = CacheNodes::over(
            Members::fixed(Listing {
                live: servers,
                ..Listing::default()
            }),
            None,
        );
        let route = Hash::of(b"chunk");
        let mut picked = HashSet::new();
        for _ in 0..50 {
            picked.insert(nodes.owner(route).unwrap());
        }
        assert_eq!(picked.len(), 1, "a cold chunk has one server");
        lock(&nodes.hot).insert(route, Instant::now());
        for _ in 0..200 {
            picked.insert(nodes.owner(route).unwrap());
        }
        assert_eq!(picked.len(), 3);
    }
}
