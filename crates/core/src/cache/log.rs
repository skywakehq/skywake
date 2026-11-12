//! The write log on the cache tier: each record kept on nodes in different zones, synced before they answer.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures::future::join_all;
use serde::{Deserialize, Serialize};

use super::Members;
use crate::net::{client, score};
use crate::sync::lock;

const CONNECT: Duration = Duration::from_millis(250);
const ANSWER: Duration = Duration::from_secs(2);
const REST: Duration = Duration::from_secs(5);

pub const ZONE: &str = "skywake-zone";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct LogRecord {
    pub claim: u64,
    pub n: u64,
    pub max_tag: u64,
    pub data: Vec<u8>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct Trimmed {
    pub claim: u64,
    pub below: u64,
    pub through: u64,
}

impl Trimmed {
    pub fn drops(&self, record: &LogRecord) -> bool {
        record.claim < self.claim
            || (record.claim == self.claim
                && record.n < self.below
                && record.max_tag <= self.through)
    }
}

#[derive(Serialize, Deserialize, Debug, Default)]
pub struct Sealed {
    pub records: Vec<LogRecord>,
    pub trimmed: Option<Trimmed>,
}

#[derive(Debug, thiserror::Error)]
pub enum LogError {
    #[error("not enough cache nodes answered")]
    Unreachable,
    #[error("a newer mount of the branch holds the log")]
    TakenOver,
}

pub struct WriteLog {
    members: Arc<Members>,
    copies: usize,
    token: Option<String>,
    client: reqwest::Client,
    zones: Mutex<HashMap<String, String>>,
    failed: Mutex<HashMap<String, Instant>>,
}

enum Answer {
    Kept { zone: String, bytes: Vec<u8> },
    NoLog,
}

impl WriteLog {
    pub fn new(seeds: Vec<String>, token: Option<String>, copies: usize) -> Option<Self> {
        if copies == 0 || seeds.is_empty() {
            return None;
        }
        Some(Self::over(Members::seeded(seeds), token, copies))
    }

    pub fn over(members: Arc<Members>, token: Option<String>, copies: usize) -> Self {
        Self {
            members,
            copies,
            token,
            client: client(CONNECT, Some(ANSWER)),
            zones: Mutex::default(),
            failed: Mutex::default(),
        }
    }

    pub fn key(scope: &str, branch: &str) -> String {
        blake3::hash(format!("{scope}\n{branch}").as_bytes())
            .to_hex()
            .to_string()
    }

    pub async fn seal(&self, key: &str, claim: u64) -> Result<Vec<LogRecord>, LogError> {
        let listing = self.members.current(self.token.clone()).await;
        let nodes: Vec<&String> = listing.all().collect();
        let asks = nodes.iter().map(|node| async move {
            let url = format!("{node}/log/{key}/seal?claim={claim}");
            self.post(node, url, Vec::new()).await
        });
        let mut records = BTreeMap::new();
        let mut trimmed: Option<Trimmed> = None;
        let mut answered = 0;
        for answer in join_all(asks).await {
            let bytes = match answer {
                Ok(Answer::Kept { bytes, .. }) => bytes,
                Ok(Answer::NoLog) => {
                    answered += 1;
                    continue;
                }
                Err(LogError::TakenOver) => return Err(LogError::TakenOver),
                Err(LogError::Unreachable) => continue,
            };
            let Ok(found) = postcard::from_bytes::<Sealed>(&bytes) else {
                continue;
            };
            answered += 1;
            if let Some(found) = found.trimmed
                && trimmed
                    .is_none_or(|known| (known.claim, known.below) < (found.claim, found.below))
            {
                trimmed = Some(found);
            }
            for record in found.records {
                records.insert((record.claim, record.n), record);
            }
        }
        if answered + self.copies <= nodes.len() {
            return Err(LogError::Unreachable);
        }
        Ok(records
            .into_values()
            .filter(|record| !trimmed.is_some_and(|trimmed| trimmed.drops(record)))
            .collect())
    }

    pub async fn append(&self, key: &str, record: &LogRecord) -> Result<(), LogError> {
        let LogRecord {
            claim, n, max_tag, ..
        } = record;
        let listing = self.members.current(self.token.clone()).await;
        let holders = self
            .holders(key, &listing.live)
            .ok_or(LogError::Unreachable)?;
        let asks = holders.into_iter().map(|(node, zone)| async move {
            let url = format!("{node}/log/{key}/append?claim={claim}&n={n}&max_tag={max_tag}");
            match self.post(node, url, record.data.clone()).await? {
                Answer::Kept { zone: now, .. } if now == zone => Ok(()),
                _ => Err(LogError::Unreachable),
            }
        });
        for answer in join_all(asks).await {
            answer?;
        }
        Ok(())
    }

    pub async fn trim(&self, key: &str, claim: u64, below: u64, through: u64) -> bool {
        let listing = self.members.current(self.token.clone()).await;
        let asks = listing.all().map(|node| {
            let url =
                format!("{node}/log/{key}/trim?claim={claim}&below={below}&through={through}");
            self.post(node, url, Vec::new())
        });
        let done = join_all(asks).await;
        done.iter()
            .filter(|answer| matches!(answer, Ok(Answer::Kept { .. })))
            .count()
            >= self.copies
    }

    async fn post(&self, node: &str, url: String, body: Vec<u8>) -> Result<Answer, LogError> {
        let mut request = self.client.post(url).body(body);
        if let Some(token) = &self.token {
            request = request.bearer_auth(token);
        }
        let answer = async {
            let response = request.send().await.map_err(|_| LogError::Unreachable)?;
            match response.status().as_u16() {
                200 => {}
                404 => return Ok(Answer::NoLog),
                409 => return Err(LogError::TakenOver),
                _ => return Err(LogError::Unreachable),
            }
            let zone = response
                .headers()
                .get(ZONE)
                .and_then(|zone| zone.to_str().ok())
                .ok_or(LogError::Unreachable)?
                .to_string();
            let bytes = response.bytes().await.map_err(|_| LogError::Unreachable)?;
            Ok(Answer::Kept {
                zone,
                bytes: bytes.to_vec(),
            })
        }
        .await;
        match &answer {
            Ok(Answer::Kept { zone, .. }) => {
                lock(&self.zones).insert(node.to_string(), zone.clone());
                lock(&self.failed).remove(node);
            }
            Ok(Answer::NoLog) => {
                lock(&self.zones).remove(node);
            }
            Err(LogError::Unreachable) => {
                lock(&self.failed).insert(node.to_string(), Instant::now());
            }
            Err(LogError::TakenOver) => {}
        }
        answer
    }

    fn holders<'a>(&self, key: &str, live: &'a [String]) -> Option<Vec<(&'a str, String)>> {
        let zones = lock(&self.zones);
        let failed = lock(&self.failed);
        let resting = |node: &str| failed.get(node).is_some_and(|at| at.elapsed() < REST);
        let mut ranked: Vec<(u64, &str)> = live
            .iter()
            .map(|node| (score(&format!("{node}/log/{key}")), node.as_str()))
            .collect();
        ranked.sort_unstable_by(|a, b| b.cmp(a));
        let mut taken = HashSet::new();
        let holders: Vec<(&str, String)> = ranked
            .into_iter()
            .filter(|(_, node)| !resting(node))
            .filter_map(|(_, node)| Some((node, zones.get(node)?.clone())))
            .filter(|(_, zone)| taken.insert(zone.clone()))
            .take(self.copies)
            .collect();
        (holders.len() == self.copies).then_some(holders)
    }
}
