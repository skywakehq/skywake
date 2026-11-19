//! Storing the long lists of a Version as trees of small nodes.

use std::collections::HashSet;

use futures::{StreamExt, TryStreamExt, stream};
use serde::Serialize;
use serde::de::DeserializeOwned;
use skywake_core::Hash;
use skywake_core::list::{List, Node, Walked};

use crate::Result;
use crate::store::{PARALLELISM, Storage, Written};

pub(crate) const INLINE: usize = if cfg!(test) { 4 } else { 256 };

pub(crate) trait Entry:
    Clone + Serialize + DeserializeOwned + Send + Sync + 'static
{
}

impl<T: Clone + Serialize + DeserializeOwned + Send + Sync + 'static> Entry for T {}

pub(crate) async fn walk<T: Entry>(storage: &Storage, list: &List<T>) -> Result<Walked<T>> {
    list.walk(|hash| storage.get::<Node<T>>(hash)).await
}

pub(crate) async fn all<T: Entry>(storage: &Storage, list: &List<T>) -> Result<Vec<T>> {
    list.all(|hash| storage.get::<Node<T>>(hash)).await
}

pub(crate) async fn get_many<T: Entry>(
    storage: &Storage,
    list: &List<T>,
    at: &[u64],
) -> Result<Vec<T>> {
    list.get_many(at, |hash| storage.get::<Node<T>>(hash)).await
}

pub(crate) async fn store<T: Entry>(
    storage: &Storage,
    entries: Vec<T>,
    old: &HashSet<Hash>,
    written: &mut Written,
) -> Result<List<T>> {
    let built = List::build(entries, INLINE)?;
    let fresh = (built.nodes.into_iter())
        .filter(|(hash, _)| !old.contains(hash))
        .map(|(_, bytes)| bytes);
    let stored: Vec<Hash> = stream::iter(fresh)
        .map(|bytes| storage.put(bytes))
        .buffered(PARALLELISM)
        .try_collect()
        .await?;
    written.chunks(stored);
    Ok(built.list)
}
