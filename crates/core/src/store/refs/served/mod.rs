//! Asking the cache server that owns a branch's slot for its head.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

use futures::future::join_all;

mod bearer;

use super::wire::{self, Answer, Ask, Held, OWNER, SLOTS, Stored, preferred};
use super::{Head, conflict};
use crate::cache::Members;
use crate::retry::{backoff, random};
use crate::{Commit, Error, Result};

use crate::net::client;
use crate::sync::lock;
use bearer::Bearer;
pub use bearer::PassSource;

const CONNECT: Duration = Duration::from_millis(250);
const ANSWER: Duration = Duration::from_secs(5);
const WAIT: Duration = Duration::from_secs(40);

pub struct HeadNodes {
    members: Arc<Members>,
    bearer: Bearer,
    folder: String,
    client: reqwest::Client,
    owners: Mutex<HashMap<u32, String>>,
}

enum Reply {
    Answer(Box<Answer>),
    Elsewhere(Option<String>),
    Failed,
    Refused(u16),
}

impl HeadNodes {
    pub fn new(seeds: Vec<String>, token: Option<String>) -> Option<Self> {
        if seeds.is_empty() {
            return None;
        }
        Some(Self {
            members: Members::seeded(seeds),
            bearer: Bearer::new(token),
            folder: String::new(),
            client: client(CONNECT, Some(ANSWER)),
            owners: Mutex::default(),
        })
    }

    pub fn in_folder(mut self, folder: impl Into<String>) -> Self {
        self.folder = folder.into().trim_matches('/').to_string();
        self
    }

    pub fn renewing(mut self, source: Arc<dyn PassSource>, expires: SystemTime) -> Self {
        self.bearer = self.bearer.renewing(source, expires);
        self
    }

    pub(super) async fn head(&self, branch: &str) -> Result<Option<Head>> {
        let ask = Ask::Head {
            branch: branch.to_string(),
        };
        match self.ask(branch, &ask).await? {
            Answer::Head(head) => Ok(head.map(Head::served)),
            other => Err(odd(other)),
        }
    }

    pub(super) async fn create(
        &self,
        branch: &str,
        commit: Commit,
        keep_commit: bool,
    ) -> Result<Head> {
        let ask = Ask::Create {
            branch: branch.to_string(),
            token: random(),
            commit,
            keep_commit,
        };
        match self.ask(branch, &ask).await? {
            Answer::Done(head) => Ok(Head::served(head)),
            Answer::Exists => Err(Error::BranchExists(branch.to_string())),
            other => Err(odd(other)),
        }
    }

    pub(super) async fn advance(
        &self,
        branch: &str,
        from: &Head,
        commit: Commit,
        objects: Vec<Held>,
        since: Option<u64>,
    ) -> Result<Option<Head>> {
        let ask = Ask::Advance {
            branch: branch.to_string(),
            from_seq: from.seq,
            from_token: from.token,
            token: random(),
            commit,
            objects,
            since,
        };
        match self.ask(branch, &ask).await? {
            Answer::Done(head) => Ok(Some(Head::served(head))),
            Answer::Settle => Ok(None),
            Answer::Conflict => Err(conflict(branch)),
            other => Err(odd(other)),
        }
    }

    pub(super) async fn delete(&self, branch: &str, head: &Head) -> Result<()> {
        let ask = Ask::Delete {
            branch: branch.to_string(),
            from_seq: head.seq,
            from_token: head.token,
        };
        match self.ask(branch, &ask).await? {
            Answer::Deleted => Ok(()),
            Answer::Conflict => Err(conflict(branch)),
            other => Err(odd(other)),
        }
    }

    pub(super) async fn all(&self, settled: bool) -> Result<Vec<(String, Stored)>> {
        let body = postcard::to_stdvec(&Ask::List)?;
        let started = Instant::now();
        let mut attempt = 0;
        let mut renewed = false;
        loop {
            let nodes = self.live().await;
            let asks = nodes.iter().map(|node| self.post(node, body.clone()));
            let mut covered = HashSet::new();
            let mut heads = Vec::new();
            let mut waiting = false;
            let mut expired = false;
            for reply in join_all(asks).await {
                match reply {
                    Reply::Answer(answer) => {
                        if let Answer::List {
                            slots,
                            heads: found,
                            pending,
                        } = *answer
                        {
                            covered.extend(slots);
                            heads.extend(found);
                            waiting |= settled && pending;
                        }
                    }
                    Reply::Refused(401) => expired = true,
                    Reply::Refused(status) => return Err(refused("*", status)),
                    _ => {}
                }
            }
            if expired {
                if renewed || !self.bearer.renew_now() {
                    return Err(refused("*", 401));
                }
                renewed = true;
                continue;
            }
            if covered.len() == SLOTS as usize && !waiting {
                return Ok(heads);
            }
            if started.elapsed() > WAIT {
                return Err(unavailable());
            }
            backoff(attempt).await;
            attempt += 1;
        }
    }

    async fn ask(&self, branch: &str, ask: &Ask) -> Result<Answer> {
        let slot = wire::slot(&self.folder, branch);
        let body = postcard::to_stdvec(ask)?;
        let started = Instant::now();
        let mut attempt = 0;
        let mut nodes = self.live().await;
        if nodes.is_empty() {
            return Err(unavailable());
        }
        let mut target = self.owner_of(slot, &nodes);
        let mut hops = 0;
        let mut tried = 0;
        let mut renewed = false;
        loop {
            match self.post(&target, body.clone()).await {
                Reply::Answer(answer) => {
                    lock(&self.owners).insert(slot, target);
                    return Ok(*answer);
                }
                Reply::Elsewhere(Some(owner))
                    if owner != target && hops < nodes.len() && nodes.contains(&owner) =>
                {
                    hops += 1;
                    target = owner;
                    continue;
                }
                Reply::Refused(401) if !renewed && self.bearer.renew_now() => {
                    renewed = true;
                    continue;
                }
                Reply::Refused(status) => return Err(refused(branch, status)),
                Reply::Elsewhere(_) | Reply::Failed => {}
            }
            lock(&self.owners).remove(&slot);
            if started.elapsed() > WAIT {
                return Err(match ask {
                    Ask::Head { .. } | Ask::List => unavailable(),
                    _ => Error::Unsettled(branch.to_string()),
                });
            }
            tried += 1;
            if tried >= nodes.len() {
                backoff(attempt).await;
                attempt += 1;
                tried = 0;
                let fresh = self.live().await;
                if !fresh.is_empty() {
                    nodes = fresh;
                }
            }
            hops = 0;
            let at = nodes.iter().position(|node| *node == target).unwrap_or(0);
            target = nodes[(at + 1) % nodes.len()].clone();
        }
    }

    async fn post(&self, node: &str, body: Vec<u8>) -> Reply {
        let mut request = self
            .client
            .post(format!("{node}/heads"))
            .header(wire::FOLDER, &self.folder)
            .body(body);
        if let Some(token) = self.bearer.get().await {
            request = request.bearer_auth(token);
        }
        let Ok(response) = request.send().await else {
            return Reply::Failed;
        };
        match response.status().as_u16() {
            200 => {}
            421 => {
                let owner = response
                    .headers()
                    .get(OWNER)
                    .and_then(|owner| owner.to_str().ok())
                    .map(str::to_string);
                return Reply::Elsewhere(owner);
            }
            status @ (400 | 401 | 403) => return Reply::Refused(status),
            _ => return Reply::Failed,
        }
        let Ok(bytes) = response.bytes().await else {
            return Reply::Failed;
        };
        match postcard::from_bytes(&bytes) {
            Ok(answer) => Reply::Answer(Box::new(answer)),
            Err(_) => Reply::Failed,
        }
    }

    fn owner_of(&self, slot: u32, nodes: &[String]) -> String {
        if let Some(owner) = lock(&self.owners).get(&slot) {
            return owner.clone();
        }
        preferred(nodes, slot).to_string()
    }

    async fn live(&self) -> Vec<String> {
        let token = self.bearer.get().await;
        self.members.current(token).await.live.clone()
    }
}

fn unavailable() -> Error {
    Error::HeadsUnavailable
}

fn odd(answer: Answer) -> Error {
    Error::Corrupt(format!("unexpected answer from a cache server: {answer:?}"))
}

fn refused(branch: &str, status: u16) -> Error {
    let why = match status {
        403 => "this caller may not change it",
        401 => "the cache token or pass is wrong or has expired",
        _ => "the cache servers refused the request",
    };
    Error::Store(object_store::Error::PermissionDenied {
        path: format!("refs/{branch}"),
        source: why.into(),
    })
}
