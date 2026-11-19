//! Branch heads.

use std::hash::{BuildHasher, RandomState};
use std::io::Read;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use futures::TryStreamExt;
use object_store::path::Path;
use object_store::{ObjectStore, ObjectStoreExt, PutMode, UpdateVersion};
use skywake_core::Hash;

use crate::{Error, Result};

/// The version a branch points at. A small version travels inside the head,
/// so one read opens the branch.
pub(crate) struct Head {
    pub version: Hash,
    pub hints: Vec<Hint>,
    pub inline: Option<Vec<u8>>,
    tag: UpdateVersion,
}

const INLINE_BYTES: usize = 64 << 10;
const INLINE_LIMIT: usize = 64 << 20;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Hint {
    Centroids(Hash),
    Table(Hash),
    Filters(Hash),
    Text(Hash, u64),
    Segment(Hash),
    Directory(Hash),
    Clusters(Hash),
    Postings(Hash, u64),
    Dictionary(Hash),
    Totals(Hash),
    Pages(Hash),
    Spans(Hash),
    Leaders(Hash),
    Projection(Hash),
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
            Hint::Postings(hash, bytes) => format!("postings {hash} {bytes}"),
            Hint::Dictionary(hash) => format!("dictionary {hash}"),
            Hint::Totals(hash) => format!("totals {hash}"),
            Hint::Pages(hash) => format!("pages {hash}"),
            Hint::Spans(hash) => format!("spans {hash}"),
            Hint::Leaders(hash) => format!("leaders {hash}"),
            Hint::Projection(hash) => format!("projection {hash}"),
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
            "postings" => Some(Hint::Postings(hash, more.parse().ok()?)),
            "dictionary" => Some(Hint::Dictionary(hash)),
            "totals" => Some(Hint::Totals(hash)),
            "pages" => Some(Hint::Pages(hash)),
            "spans" => Some(Hint::Spans(hash)),
            "leaders" => Some(Hint::Leaders(hash)),
            "projection" => Some(Hint::Projection(hash)),
            _ => None,
        }
    }
}

fn text(version: Hash, hints: &[Hint], inline: Option<&[u8]>) -> String {
    let mut text = version.to_string();
    for hint in hints {
        text.push('\n');
        text.push_str(&hint.line());
    }
    if let Some(packed) = inline.and_then(pack) {
        text.push_str("\ninline ");
        text.push_str(&packed);
    }
    text
}

fn pack(raw: &[u8]) -> Option<String> {
    let packed = zstd::bulk::compress(raw, 3).ok()?;
    (packed.len() <= INLINE_BYTES).then(|| STANDARD.encode(packed))
}

fn unpack(line: &str, version: Hash) -> Option<Vec<u8>> {
    let packed = STANDARD.decode(line.strip_prefix("inline ")?).ok()?;
    let mut raw = Vec::new();
    (zstd::stream::read::Decoder::new(packed.as_slice()).ok()?)
        .take(INLINE_LIMIT as u64)
        .read_to_end(&mut raw)
        .ok()?;
    (Hash::of(&raw) == version).then_some(raw)
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
    let (inline, hints): (Vec<&str>, Vec<&str>) = lines.partition(|l| l.starts_with("inline "));
    Ok(Some(Head {
        version,
        hints: hints.into_iter().filter_map(Hint::parse).collect(),
        inline: inline.first().and_then(|line| unpack(line, version)),
        tag,
    }))
}

pub(crate) async fn create(
    store: &dyn ObjectStore,
    branch: &str,
    version: Hash,
    hints: &[Hint],
    inline: Option<&[u8]>,
) -> Result<()> {
    let written = store
        .put_opts(
            &path(branch)?,
            text(version, hints, inline).into(),
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
    inline: Option<&[u8]>,
) -> Result<bool> {
    let mode = PutMode::Update(from.tag.clone());
    let text = text(version, hints, inline);
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
        let written = format!("{}\nsomething new {b}", text(b, &hints, None));
        let mut lines = written.lines();
        assert_eq!(lines.next().unwrap().parse::<Hash>().unwrap(), b);
        let parsed: Vec<Hint> = lines.filter_map(Hint::parse).collect();
        assert_eq!(parsed, hints);
        assert_eq!(text(a, &[], None), a.to_string());
    }

    #[test]
    fn an_inline_version_comes_back_only_when_it_matches_its_hash() {
        let raw = b"a version".to_vec();
        let version = Hash::of(&raw);
        let written = text(version, &[Hint::Segment(version)], Some(&raw));
        let line = written.lines().find(|l| l.starts_with("inline ")).unwrap();
        assert_eq!(unpack(line, version), Some(raw));
        assert_eq!(unpack(line, Hash::of(b"other")), None);
        assert_eq!(Hint::parse(line), None);
        let large: Vec<u8> = (0..1u32 << 20)
            .flat_map(|n| n.wrapping_mul(2654435761).to_le_bytes())
            .collect();
        assert!(!text(Hash::of(&large), &[], Some(&large)).contains("inline"));
    }
}
