//! Branch heads.

use std::hash::{BuildHasher, RandomState};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use futures::TryStreamExt;
use object_store::path::Path;
use object_store::{ObjectStore, ObjectStoreExt, PutMode, UpdateVersion};
use skywake_core::Hash;

use crate::{Error, Result};

pub(crate) struct Head {
    pub version: Hash,
    pub hints: Vec<Hint>,
    tag: UpdateVersion,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Hint {
    Centroids(Hash),
    Table(Hash),
    Filters(Hash),
    Text(Hash, u64),
    Segment(Hash),
    Directory(Hash),
    Clusters(Hash),
}

impl Hint {
    fn line(&self) -> String {
        match self {
            Hint::Centroids(hash) => format!("centroids {hash}"),
            Hint::Table(hash) => format!("table {hash}"),
            Hint::Filters(hash) => format!("filters {hash}"),
            Hint::Text(hash, bytes) => format!("text {hash} {bytes}"),
            Hint::Segment(hash) => format!("segment {hash}"),
            Hint::Directory(hash) => format!("directory {hash}"),
            Hint::Clusters(hash) => format!("clusters {hash}"),
        }
    }

    fn parse(line: &str) -> Option<Self> {
        let (kind, rest) = line.split_once(' ')?;
        let (hash, more) = rest.split_once(' ').unwrap_or((rest, ""));
        let hash = hash.parse().ok()?;
        match kind {
            "centroids" => Some(Hint::Centroids(hash)),
            "table" => Some(Hint::Table(hash)),
            "filters" => Some(Hint::Filters(hash)),
            "text" => Some(Hint::Text(hash, more.parse().ok()?)),
            "segment" => Some(Hint::Segment(hash)),
            "directory" => Some(Hint::Directory(hash)),
            "clusters" => Some(Hint::Clusters(hash)),
            _ => None,
        }
    }
}

fn text(version: Hash, hints: &[Hint]) -> String {
    let mut text = version.to_string();
    for hint in hints {
        text.push('\n');
        text.push_str(&hint.line());
    }
    text
}

pub(crate) async fn read(store: &dyn ObjectStore, branch: &str) -> Result<Option<Head>> {
    let path = path(branch)?;
    let object = match store.get(&path).await {
        Ok(object) => object,
        Err(object_store::Error::NotFound { .. }) => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    let tag = UpdateVersion {
        e_tag: object.meta.e_tag.clone(),
        version: object.meta.version.clone(),
    };
    let bytes = object.bytes().await?;
    let mut lines = std::str::from_utf8(&bytes).unwrap_or_default().lines();
    let version = (lines.next())
        .and_then(|hex| hex.parse().ok())
        .ok_or_else(|| Error::Corrupt(format!("{path} is not a hash")))?;
    let hints = lines.filter_map(Hint::parse).collect();
    Ok(Some(Head {
        version,
        hints,
        tag,
    }))
}

pub(crate) async fn create(
    store: &dyn ObjectStore,
    branch: &str,
    version: Hash,
    hints: &[Hint],
) -> Result<()> {
    let written = store
        .put_opts(
            &path(branch)?,
            text(version, hints).into(),
            PutMode::Create.into(),
        )
        .await;
    match written {
        Ok(_) => Ok(()),
        Err(object_store::Error::AlreadyExists { .. }) => {
            Err(Error::BranchExists(branch.to_string()))
        }
        Err(error) => settle(store, branch, version, error).await,
    }
}

pub(crate) async fn advance(
    store: &dyn ObjectStore,
    branch: &str,
    from: &Head,
    version: Hash,
    hints: &[Hint],
) -> Result<bool> {
    let mode = PutMode::Update(from.tag.clone());
    let text = text(version, hints);
    let written = store
        .put_opts(&path(branch)?, text.into(), mode.into())
        .await;
    match written {
        Ok(_) => Ok(true),
        Err(
            object_store::Error::Precondition { .. }
            | object_store::Error::AlreadyExists { .. }
            | object_store::Error::NotFound { .. },
        ) => Ok(false),
        Err(error) => settle(store, branch, version, error).await.map(|()| true),
    }
}

async fn settle(
    store: &dyn ObjectStore,
    branch: &str,
    version: Hash,
    error: object_store::Error,
) -> Result<()> {
    match read(store, branch).await {
        Ok(Some(head)) if head.version == version => Ok(()),
        _ => Err(error.into()),
    }
}

pub(crate) async fn list(store: &dyn ObjectStore) -> Result<Vec<String>> {
    let mut names: Vec<String> = store
        .list(Some(&Path::from("refs")))
        .try_filter_map(|meta| async move {
            let name = meta.location.as_ref().strip_prefix("refs/");
            Ok(name
                .filter(|name| skywake_core::valid_name(name))
                .map(str::to_string))
        })
        .try_collect()
        .await?;
    names.sort();
    Ok(names)
}

pub(crate) const DELETED: &str = "deleted";

pub(crate) async fn delete(store: &dyn ObjectStore, branch: &str) -> Result<()> {
    let head = read(store, branch)
        .await?
        .ok_or_else(|| Error::BranchNotFound(branch.to_string()))?;
    let record = Path::from(format!("{DELETED}/{}", head.version));
    store.put(&record, Vec::new().into()).await?;
    store.delete(&path(branch)?).await?;
    Ok(())
}

fn path(branch: &str) -> Result<Path> {
    if !skywake_core::valid_name(branch) {
        return Err(Error::InvalidBranchName(branch.to_string()));
    }
    Ok(Path::from(format!("refs/{branch}")))
}

pub(crate) async fn backoff(attempt: u32) {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let longest = Duration::from_millis(2 << attempt.min(8)).min(Duration::from_millis(500));
    let random = RandomState::new().hash_one(NEXT.fetch_add(1, Ordering::Relaxed));
    let micros = random % (longest.as_micros() as u64 + 1);
    tokio::time::sleep(Duration::from_micros(micros)).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hints_come_back_and_unknown_lines_are_skipped() {
        let (a, b) = (Hash::of(b"a"), Hash::of(b"b"));
        let hints = [
            Hint::Centroids(a),
            Hint::Table(b),
            Hint::Filters(a),
            Hint::Text(b, 1234),
            Hint::Segment(a),
            Hint::Directory(b),
        ];
        let written = format!("{}\nsomething new {b}", text(b, &hints));
        let mut lines = written.lines();
        assert_eq!(lines.next().unwrap().parse::<Hash>().unwrap(), b);
        let parsed: Vec<Hint> = lines.filter_map(Hint::parse).collect();
        assert_eq!(parsed, hints);
        assert_eq!(text(a, &[]), a.to_string());
    }
}
