//! What a folder holds: a filesystem or a search index. Both keep `refs/`,
//! `objects/` and `chunks/`, so each garbage collector checks the folder is its
//! own kind before it deletes anything; one run on the other kind's folder
//! would see none of that kind's roots and delete its data.
//!
//! A folder says its kind in `skywake.json`, written when it is made. A folder
//! made before the marker is judged by the folders only one kind writes, and
//! marked then.

use object_store::path::Path;
use object_store::{ObjectStore, ObjectStoreExt, PutMode};
use serde::{Deserialize, Serialize};

use super::io::found;
use crate::{Error, Result};

pub const MARKER: &str = "skywake.json";
const FORMAT: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Filesystem,
    Index,
}

impl Kind {
    /// Folders only this kind writes.
    fn own(self) -> &'static [&'static str] {
        match self {
            Kind::Filesystem => &["commits", "bundles", "moved"],
            Kind::Index => &["blobs", "shards"],
        }
    }

    fn other(self) -> Kind {
        match self {
            Kind::Filesystem => Kind::Index,
            Kind::Index => Kind::Filesystem,
        }
    }

    fn name(self) -> &'static str {
        match self {
            Kind::Filesystem => "filesystem",
            Kind::Index => "search index",
        }
    }
}

#[derive(Serialize, Deserialize)]
struct Marker {
    kind: Kind,
    format: u32,
}

/// Marks the folder as `kind`. Already marked so, nothing changes; marked as
/// the other kind, it fails.
pub async fn mark(store: &dyn ObjectStore, kind: Kind) -> Result<()> {
    let bytes = serde_json::to_vec(&Marker { kind, format: FORMAT }).expect("a marker is plain data");
    match store
        .put_opts(&Path::from(MARKER), bytes.into(), PutMode::Create.into())
        .await
    {
        Ok(_) => Ok(()),
        Err(object_store::Error::AlreadyExists { .. } | object_store::Error::Precondition { .. }) => {
            match read(store).await? {
                Some(found) if found != kind => Err(wrong(kind, found)),
                _ => Ok(()),
            }
        }
        Err(error) => Err(error.into()),
    }
}

/// Fails unless the folder holds `kind`, or nothing yet. An unmarked folder of
/// `kind` is marked.
pub async fn require(store: &dyn ObjectStore, kind: Kind) -> Result<()> {
    if let Some(found) = read(store).await? {
        return match found == kind {
            true => Ok(()),
            false => Err(wrong(kind, found)),
        };
    }
    if holds_any(store, kind.other()).await? {
        return Err(wrong(kind, kind.other()));
    }
    if holds_any(store, kind).await? {
        mark(store, kind).await?;
    }
    Ok(())
}

async fn read(store: &dyn ObjectStore) -> Result<Option<Kind>> {
    let Some(object) = found(store.get(&Path::from(MARKER)).await)? else {
        return Ok(None);
    };
    let bytes = object.bytes().await?;
    let marker: Marker = serde_json::from_slice(&bytes)
        .map_err(|error| Error::Corrupt(format!("{MARKER}: {error}")))?;
    Ok(Some(marker.kind))
}

async fn holds_any(store: &dyn ObjectStore, kind: Kind) -> Result<bool> {
    for folder in kind.own() {
        let listed = store.list_with_delimiter(Some(&Path::from(*folder))).await?;
        if !listed.objects.is_empty() || !listed.common_prefixes.is_empty() {
            return Ok(true);
        }
    }
    Ok(false)
}

fn wrong(wanted: Kind, found: Kind) -> Error {
    Error::WrongKind(format!(
        "this folder holds a {}, not a {}; nothing was deleted",
        found.name(),
        wanted.name()
    ))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use object_store::memory::InMemory;

    use super::*;

    async fn put(store: &InMemory, path: &str) {
        store.put(&Path::from(path), vec![1].into()).await.unwrap();
    }

    #[tokio::test]
    async fn a_marked_folder_takes_only_its_kind() {
        let store = Arc::new(InMemory::new());
        mark(store.as_ref(), Kind::Index).await.unwrap();
        mark(store.as_ref(), Kind::Index).await.unwrap();
        require(store.as_ref(), Kind::Index).await.unwrap();
        assert!(matches!(
            mark(store.as_ref(), Kind::Filesystem).await,
            Err(Error::WrongKind(_))
        ));
        assert!(matches!(
            require(store.as_ref(), Kind::Filesystem).await,
            Err(Error::WrongKind(_))
        ));
    }

    #[tokio::test]
    async fn an_unmarked_folder_is_judged_by_what_it_holds() {
        let empty = InMemory::new();
        require(&empty, Kind::Filesystem).await.unwrap();
        require(&empty, Kind::Index).await.unwrap();
        assert!(read(&empty).await.unwrap().is_none());

        let filesystem = InMemory::new();
        put(&filesystem, "commits/ab").await;
        put(&filesystem, "objects/cd").await;
        assert!(matches!(
            require(&filesystem, Kind::Index).await,
            Err(Error::WrongKind(_))
        ));
        require(&filesystem, Kind::Filesystem).await.unwrap();
        assert_eq!(read(&filesystem).await.unwrap(), Some(Kind::Filesystem));

        let index = InMemory::new();
        put(&index, "shards/0/blobs/ef").await;
        require(&index, Kind::Index).await.unwrap();
        assert_eq!(read(&index).await.unwrap(), Some(Kind::Index));
    }

    #[tokio::test]
    async fn a_folder_holding_both_kinds_is_refused_by_both() {
        let mixed = InMemory::new();
        put(&mixed, "commits/ab").await;
        put(&mixed, "blobs/cd").await;
        assert!(require(&mixed, Kind::Filesystem).await.is_err());
        assert!(require(&mixed, Kind::Index).await.is_err());
    }
}
