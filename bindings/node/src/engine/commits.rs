//! Commits, changes and merges as plain JavaScript objects, and hashes from text.

use napi::Result;
use napi_derive::napi;
use skywake_core::{Change, Commit, Hash};

use crate::error::failure;

#[napi(object)]
pub struct CommitInfo {
    pub hash: String,
    pub message: String,
    pub time: i64,
    pub session: Option<String>,
    pub parent: Option<String>,
    pub merged: Option<String>,
}

#[napi(object)]
pub struct Changed {
    pub kind: String,
    pub path: String,
}

#[napi(object)]
pub struct CommitChanges {
    pub commit: CommitInfo,
    pub changes: Vec<Changed>,
}

#[napi(object)]
pub struct FileVersion {
    pub commit: CommitInfo,
    pub size: Option<i64>,
}

#[napi(object)]
pub struct MergeResult {
    pub head: Option<String>,
    pub conflicts: Vec<String>,
}

pub(crate) fn hash(text: &str) -> Result<Hash> {
    text.parse()
        .map_err(|_| failure("invalid", format!("`{text}` is not a commit hash")))
}

pub(crate) fn maybe_hash(text: Option<String>) -> Result<Option<Hash>> {
    text.as_deref().map(hash).transpose()
}

pub(crate) fn commit_info(hash: Hash, commit: &Commit) -> CommitInfo {
    CommitInfo {
        hash: hash.to_string(),
        message: commit.message.clone(),
        time: commit.time as i64,
        session: commit.session.clone(),
        parent: commit.parent.map(|hash| hash.to_string()),
        merged: commit.merged.map(|hash| hash.to_string()),
    }
}

pub(crate) fn changed(change: Change) -> Changed {
    let (kind, path) = match change {
        Change::Added(path) => ("added", path),
        Change::Removed(path) => ("removed", path),
        Change::Modified(path) => ("modified", path),
    };
    Changed {
        kind: kind.to_string(),
        path,
    }
}
