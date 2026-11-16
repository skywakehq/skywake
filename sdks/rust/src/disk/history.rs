use std::time::SystemTime;

use futures::TryStreamExt;
use serde::Serialize;

use super::Disk;
use super::types::{Commit, Committed, Merged, Prefer};
use crate::shared::awaitable;
use crate::shared::paging::{List, collect, pages};
use crate::shared::time;
use crate::{Error, Result};

#[derive(Serialize)]
struct MergeBody {
    from: String,
    into: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    dry_run: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    prefer: Option<Prefer>,
}

#[must_use]
pub struct Merge<'a> {
    disk: &'a Disk,
    body: MergeBody,
}

impl<'a> Merge<'a> {
    pub(crate) fn new(disk: &'a Disk, into: &str) -> Self {
        let body = MergeBody {
            from: disk.place.branch.clone(),
            into: into.to_string(),
            message: None,
            dry_run: None,
            prefer: None,
        };
        Merge { disk, body }
    }

    pub fn message(mut self, message: impl Into<String>) -> Self {
        self.body.message = Some(message.into());
        self
    }

    pub fn dry_run(mut self, dry_run: bool) -> Self {
        self.body.dry_run = Some(dry_run);
        self
    }

    pub fn prefer(mut self, prefer: Prefer) -> Self {
        self.body.prefer = Some(prefer);
        self
    }

    pub async fn send(self) -> Result<Merged> {
        let place = &self.disk.place;
        place.http.post(&place.route("/merges"), &self.body).await
    }
}

awaitable!(Merge => Merged);

#[must_use]
pub struct Log<'a> {
    disk: &'a Disk,
    path: Option<String>,
    limit: Option<u32>,
}

impl<'a> Log<'a> {
    pub(crate) fn new(disk: &'a Disk) -> Self {
        Log {
            disk,
            path: None,
            limit: None,
        }
    }

    pub fn path(mut self, path: impl Into<String>) -> Self {
        self.path = Some(path.into());
        self
    }

    pub fn limit(mut self, limit: u32) -> Self {
        self.limit = Some(limit);
        self
    }

    pub fn stream(self) -> List<Commit> {
        let mut params = self.disk.place.params();
        params.extend(self.path.map(|path| ("path", path)));
        params.extend(self.limit.map(|limit| ("limit", limit.to_string())));
        pages(
            self.disk.place.http.clone(),
            self.disk.place.route("/commits"),
            params,
        )
    }

    pub async fn send(self) -> Result<Vec<Commit>> {
        collect(self.stream()).await
    }
}

awaitable!(Log => Vec<Commit>);

#[derive(Serialize)]
struct RevertBody {
    commit: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    branch: String,
}

#[must_use]
pub struct Revert<'a> {
    disk: &'a Disk,
    body: RevertBody,
}

impl<'a> Revert<'a> {
    pub(crate) fn new(disk: &'a Disk, commit: &str) -> Self {
        let body = RevertBody {
            commit: commit.to_string(),
            message: None,
            branch: disk.place.branch.clone(),
        };
        Revert { disk, body }
    }

    pub fn message(mut self, message: impl Into<String>) -> Self {
        self.body.message = Some(message.into());
        self
    }

    pub async fn send(self) -> Result<Committed> {
        let place = &self.disk.place;
        place.http.post(&place.route("/revert"), &self.body).await
    }
}

awaitable!(Revert => Committed);

pub(crate) async fn commit_at(disk: &Disk, when: SystemTime) -> Result<String> {
    let mut log = disk.log().limit(1000).stream();
    while let Some(commit) = log.try_next().await? {
        if time::parse(&commit.created).is_some_and(|created| created <= when) {
            return Ok(commit.id);
        }
    }
    Err(Error::Usage(format!(
        "disk `{}` has no commit from {} or before",
        disk.name(),
        time::format(when)
    )))
}
