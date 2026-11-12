//! Branch heads: in the bucket, or kept by the cache servers that own them.

mod bucket;
mod head;
mod pass;
mod served;
pub mod wire;

use std::sync::Arc;
use std::time::SystemTime;

use futures::{StreamExt, TryStreamExt, stream};
use object_store::ObjectStore;

use crate::clock::secs;
use crate::{Commit, Error, Result};
pub(crate) use bucket::DELETED;
pub use bucket::{Slot, read, write, write_deleted};
pub use head::Head;
use head::Version;
pub use pass::Pass;
pub use served::{HeadNodes, PassSource};
use wire::Held;
pub use wire::preferred;

const PARALLELISM: usize = 64;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum HeadsAt {
    Bucket,
    Tier,
}

impl std::str::FromStr for HeadsAt {
    type Err = String;

    fn from_str(text: &str) -> std::result::Result<Self, String> {
        match text {
            "bucket" => Ok(Self::Bucket),
            "tier" => Ok(Self::Tier),
            _ => Err(format!("`{text}`: use `bucket` or `tier`")),
        }
    }
}

#[derive(Clone)]
pub struct Refs {
    bucket: bucket::Bucket,
    served: Option<Arc<HeadNodes>>,
}

impl Refs {
    pub fn new(store: Arc<dyn ObjectStore>) -> Self {
        Self {
            bucket: bucket::Bucket::new(store),
            served: None,
        }
    }

    pub fn served_by(mut self, nodes: Arc<HeadNodes>) -> Self {
        self.served = Some(nodes);
        self
    }

    pub async fn head(&self, branch: &str) -> Result<Option<Head>> {
        validate(branch)?;
        match &self.served {
            Some(nodes) => nodes.head(branch).await,
            None => self.bucket.head(branch).await,
        }
    }

    pub async fn create(&self, branch: &str, commit: Commit) -> Result<Head> {
        self.create_with(branch, commit, false).await
    }

    pub(crate) async fn create_with(
        &self,
        branch: &str,
        commit: Commit,
        keep_commit: bool,
    ) -> Result<Head> {
        validate(branch)?;
        match &self.served {
            Some(nodes) => nodes.create(branch, commit, keep_commit).await,
            None => self.bucket.create(branch, commit).await,
        }
    }

    pub async fn advance(&self, branch: &str, from: &Head, commit: Commit) -> Result<Head> {
        validate(branch)?;
        match &self.served {
            Some(nodes) => nodes
                .advance(branch, from, commit, Vec::new(), None)
                .await?
                .ok_or_else(|| Error::Corrupt("an owner asked to settle a plain advance".into())),
            None => self.bucket.advance(branch, from, commit).await,
        }
    }

    pub async fn advance_holding(
        &self,
        branch: &str,
        from: &Head,
        commit: Commit,
        objects: Vec<Held>,
        since: SystemTime,
    ) -> Result<Option<Head>> {
        validate(branch)?;
        let nodes = self
            .served
            .as_ref()
            .ok_or_else(|| Error::Corrupt("no owners to hold objects".into()))?;
        nodes
            .advance(branch, from, commit, objects, Some(secs(since)))
            .await
    }

    pub async fn delete(&self, branch: &str) -> Result<()> {
        let head = self
            .head(branch)
            .await?
            .ok_or_else(|| Error::BranchNotFound(branch.to_string()))?;
        let Some(nodes) = &self.served else {
            return self.bucket.delete(branch, &head).await;
        };
        let record = self.bucket.keep_deleted(&head.commit).await?;
        let deleted = nodes.delete(branch, &head).await;
        if let Err(Error::Conflict(_)) = deleted {
            self.bucket.forget_deleted(&record).await;
        }
        deleted
    }

    pub async fn list(&self) -> Result<Vec<String>> {
        match &self.served {
            Some(nodes) => {
                let mut names: Vec<String> = nodes
                    .all(false)
                    .await?
                    .into_iter()
                    .map(|(name, _)| name)
                    .collect();
                names.sort();
                Ok(names)
            }
            None => self.bucket.list().await,
        }
    }

    pub(crate) async fn heads(&self) -> Result<Vec<Commit>> {
        if let Some(nodes) = &self.served {
            return Ok(nodes
                .all(true)
                .await?
                .into_iter()
                .map(|(_, head)| head.commit)
                .collect());
        }
        let branches = self.bucket.list().await?;
        stream::iter(branches)
            .map(|branch| async move { self.bucket.head(&branch).await })
            .buffer_unordered(PARALLELISM)
            .try_filter_map(|head| async move { Ok(head.map(|head| head.commit)) })
            .try_collect()
            .await
    }

    pub fn served(&self) -> bool {
        self.served.is_some()
    }
}

fn conflict(branch: &str) -> Error {
    metrics::counter!("skywake_head_conflicts_total").increment(1);
    Error::Conflict(branch.to_string())
}

fn validate(branch: &str) -> Result<()> {
    if valid_name(branch) {
        Ok(())
    } else {
        Err(Error::InvalidBranchName(branch.to_string()))
    }
}

pub fn valid_name(name: &str) -> bool {
    name.split('/').all(|part| {
        !part.is_empty()
            && !part.starts_with('.')
            && part
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
    })
}
