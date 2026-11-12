//! Listing, reading and deleting the objects a collection looks at.

use std::time::Duration;

use chrono::{DateTime, Utc};
use futures::stream::{self, StreamExt, TryStreamExt};
use object_store::path::Path;
use object_store::{ObjectMeta, ObjectStore, ObjectStoreExt};
use serde::de::DeserializeOwned;

use super::PARALLELISM;
use crate::store::io::found;
use crate::store::objects::{OBJECT_LIMIT, decode};
use crate::{Error, Hash, Result};

pub(super) async fn delete(store: &dyn ObjectStore, paths: Vec<Path>) -> Result<()> {
    if paths.is_empty() {
        return Ok(());
    }
    let paths = stream::iter(paths.into_iter().map(Ok)).boxed();
    store
        .delete_stream(paths)
        .try_for_each(|_| async { Ok(()) })
        .await
        .map_err(|error| match error {
            object_store::Error::PermissionDenied { .. }
            | object_store::Error::Unauthenticated { .. } => Error::Collection(format!(
                "these credentials may not delete from the store ({error}); \
                 run garbage collection with keys for the whole bucket"
            )),
            error => error.into(),
        })
}

pub(super) fn hash(meta: &ObjectMeta) -> Option<Hash> {
    meta.location.filename().and_then(|name| name.parse().ok())
}

pub(super) fn old(meta: &ObjectMeta, now: DateTime<Utc>, grace: Duration) -> bool {
    (now - meta.last_modified)
        .to_std()
        .is_ok_and(|age| age >= grace)
}

pub(super) async fn recent(
    store: &dyn ObjectStore,
    prefix: &str,
    grace: Duration,
    expired: &mut Vec<Path>,
) -> Result<Vec<Path>> {
    let now = Utc::now();
    let mut found = Vec::new();
    let mut listing = store.list(Some(&Path::from(prefix)));
    while let Some(meta) = listing.try_next().await? {
        match old(&meta, now, grace) {
            true => expired.push(meta.location),
            false => found.push(meta.location),
        }
    }
    Ok(found)
}

pub(super) async fn read_all<T: DeserializeOwned>(
    store: &dyn ObjectStore,
    paths: Vec<Path>,
) -> Result<Vec<T>> {
    stream::iter(paths)
        .map(|path| async move {
            let Some(object) = found(store.get(&path).await)? else {
                return Ok(None);
            };
            let bytes = object.bytes().await?;
            let raw = decode(&path, &bytes, OBJECT_LIMIT)?;
            Ok::<_, Error>(Some(postcard::from_bytes(&raw)?))
        })
        .buffer_unordered(PARALLELISM)
        .try_filter_map(|value| async move { Ok(value) })
        .try_collect()
        .await
}
