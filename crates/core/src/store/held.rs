//! Objects a checkpoint holds back from the bucket for its branch owner to keep.

use std::sync::{Arc, Mutex};

use futures::{StreamExt, TryStreamExt, stream};
use object_store::path::Path;
use object_store::{ObjectStore, ObjectStoreExt};

use super::refs::wire::Held;
use crate::Result;
use crate::sync::lock;

pub const HOLD_MAX: usize = 16 << 20;

const PARALLELISM: usize = 32;

tokio::task_local! {
    static HOLDING: Arc<Mutex<Holding>>;
}

#[derive(Default)]
struct Holding {
    objects: Vec<Held>,
    bytes: usize,
}

pub async fn holding<T, E: From<crate::Error>>(
    store: &dyn ObjectStore,
    work: impl Future<Output = std::result::Result<T, E>>,
) -> std::result::Result<T, E> {
    let holding = Arc::new(Mutex::new(Holding::default()));
    let done = HOLDING.scope(holding.clone(), work).await;
    let left = std::mem::take(&mut lock(&holding).objects);
    put_all(store, left).await?;
    done
}

pub(crate) fn hold(path: &Path, stored: &[u8]) -> bool {
    HOLDING
        .try_with(|holding| {
            let mut holding = lock(holding);
            if holding.bytes + stored.len() > HOLD_MAX {
                return false;
            }
            holding.bytes += stored.len();
            holding.objects.push(Held {
                path: path.to_string(),
                stored: stored.to_vec(),
            });
            true
        })
        .unwrap_or(false)
}

pub(crate) fn is_holding() -> bool {
    HOLDING.try_with(|_| ()).is_ok()
}

pub(crate) fn take() -> Vec<Held> {
    HOLDING
        .try_with(|holding| {
            let mut holding = lock(holding);
            holding.bytes = 0;
            std::mem::take(&mut holding.objects)
        })
        .unwrap_or_default()
}

pub async fn put_all(store: &dyn ObjectStore, objects: Vec<Held>) -> Result<()> {
    stream::iter(objects)
        .map(|held| async move {
            store
                .put(&Path::from(held.path), held.stored.into())
                .await
                .map(drop)
        })
        .buffer_unordered(PARALLELISM)
        .try_collect::<Vec<()>>()
        .await?;
    Ok(())
}
