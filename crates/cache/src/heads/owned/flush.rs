//! Copies an owner's changed heads, and the objects they need, to the bucket.

use std::sync::Arc;

use futures::{StreamExt, stream};
use object_store::{ObjectStore, PutMode, UpdateVersion};
use skywake_core::Objects;
use skywake_core::cache::WriteLog;
use skywake_core::cluster::slots;
use skywake_core::heads::{Held, Stored};
use skywake_core::store::held;
use skywake_core::store::refs::{self, Slot};
use tracing::warn;

use super::{Name, Owned};
use crate::in_folder;

const PARALLELISM: usize = 32;

impl Owned {
    pub(in crate::heads) async fn flush(&self, log: &WriteLog, root: &Arc<dyn ObjectStore>) {
        let pending: Vec<Pending> = {
            let state = self.state.lock().await;
            state
                .heads
                .iter()
                .filter_map(|(name, entry)| {
                    Some(Pending {
                        name: name.clone(),
                        head: entry.head.clone(),
                        bucket: entry.bucket.clone(),
                        known: entry.known,
                        n: entry.dirty?,
                        keep_commit: entry.keep_commit,
                        objects: entry.objects.clone(),
                    })
                })
                .collect()
        };
        let fence = Fence {
            root,
            slot: self.slot,
            epoch: self.epoch,
        };
        let fence = &fence;
        let written: Vec<(Name, u64, usize, Option<UpdateVersion>)> = stream::iter(pending)
            .map(|pending| async move {
                let store = in_folder(root, &pending.name.folder);
                let version = flush_one(&store, &pending, fence).await;
                (pending.name, pending.n, pending.objects.len(), version)
            })
            .buffer_unordered(PARALLELISM)
            .collect()
            .await;
        let mut state = self.state.lock().await;
        for (name, n, stored, version) in written {
            let Some(entry) = state.heads.get_mut(&name) else {
                continue;
            };
            let Some(version) = version else { continue };
            entry.bucket = Some(version);
            entry.known = true;
            entry.objects.drain(..stored.min(entry.objects.len()));
            if entry.dirty == Some(n) {
                entry.dirty = None;
                entry.keep_commit = false;
            }
        }
        let below = state
            .heads
            .values()
            .filter_map(|entry| entry.dirty)
            .min()
            .unwrap_or(state.next);
        // The trim watermark only rises, and only past changes already in the bucket.
        let logged = state.next > 0;
        if logged
            && (below > state.trimmed || state.trimmed == 0)
            && log
                .trim(&self.key, self.epoch, below, below.saturating_sub(1))
                .await
        {
            state.trimmed = below.max(1);
        }
    }
}

struct Pending {
    name: Name,
    head: Option<Stored>,
    bucket: Option<UpdateVersion>,
    known: bool,
    n: u64,
    keep_commit: bool,
    objects: Vec<Held>,
}

// A deposed owner must never overwrite a head that a newer owner wrote.
struct Fence<'a> {
    root: &'a Arc<dyn ObjectStore>,
    slot: u32,
    epoch: u64,
}

impl Fence<'_> {
    async fn holds(&self) -> bool {
        match slots::epoch(self.root.as_ref(), "heads", self.slot).await {
            Ok(epoch) => epoch == self.epoch,
            Err(error) => {
                warn!(%error, "can't read the slot's claim");
                false
            }
        }
    }
}

async fn flush_one(
    store: &Arc<dyn ObjectStore>,
    pending: &Pending,
    fence: &Fence<'_>,
) -> Option<UpdateVersion> {
    let branch = pending.name.branch.as_str();
    let head = pending.head.as_ref();
    if let Err(error) = held::put_all(store.as_ref(), pending.objects.clone()).await {
        warn!(%error, branch, "can't put a checkpoint's objects in the bucket");
        return None;
    }
    if let (Some(head), true) = (head, pending.keep_commit)
        && let Err(error) = Objects::new(store.clone()).put_commit(&head.commit).await
    {
        warn!(%error, branch, "can't put the commit of a new branch");
        return None;
    }
    let mut bucket = pending.bucket.clone();
    if !pending.known {
        bucket = bucket_version(store.as_ref(), branch).await.ok()?;
        if !fence.holds().await {
            return None;
        }
    }
    for attempt in 0..2 {
        let mode = match bucket.clone() {
            Some(version) => PutMode::Update(version),
            None => PutMode::Create,
        };
        let written = match head {
            Some(head) => refs::write(store.as_ref(), branch, head, mode).await,
            None => refs::write_deleted(store.as_ref(), branch, mode).await,
        };
        match written {
            Ok(version) => return Some(version),
            Err(
                object_store::Error::Precondition { .. }
                | object_store::Error::AlreadyExists { .. },
            ) if attempt == 0 => {
                bucket = bucket_version(store.as_ref(), branch).await.ok()?;
                if !fence.holds().await {
                    warn!(
                        branch,
                        "a newer owner wrote this branch head; this server no longer owns it"
                    );
                    return None;
                }
                warn!(
                    branch,
                    "a branch head was written past its owner; the owner's head wins"
                );
            }
            Err(error) => {
                warn!(%error, branch, "can't copy a branch head to the bucket");
                return None;
            }
        }
    }
    None
}

async fn bucket_version(
    store: &dyn ObjectStore,
    branch: &str,
) -> skywake_core::Result<Option<UpdateVersion>> {
    Ok(match refs::read(store, branch).await? {
        Slot::Live(found) => found.bucket_version().cloned(),
        Slot::Deleted(version) => Some(version),
        Slot::Missing => None,
    })
}

#[cfg(test)]
mod tests {
    use object_store::memory::InMemory;
    use skywake_core::{Commit, Hash, Packs};

    use super::*;

    const SLOT: u32 = 3;

    fn stored(message: &str) -> Stored {
        let commit = Commit::new(
            Hash::of(message.as_bytes()),
            Packs::default(),
            None,
            message,
        );
        Stored {
            seq: 1,
            token: 1,
            commit,
        }
    }

    fn pending(head: &str, bucket: Option<UpdateVersion>, known: bool) -> Pending {
        Pending {
            name: Name {
                folder: String::new(),
                branch: "main".into(),
            },
            head: Some(stored(head)),
            bucket,
            known,
            n: 0,
            keep_commit: false,
            objects: Vec::new(),
        }
    }

    async fn owned_at(root: &Arc<dyn ObjectStore>, epoch: u64) {
        let path = object_store::path::Path::from(format!("slots/heads/{SLOT}"));
        let claim = format!(r#"{{"owner":null,"epoch":{epoch}}}"#);
        object_store::ObjectStoreExt::put(root.as_ref(), &path, claim.into_bytes().into())
            .await
            .unwrap();
    }

    async fn message(root: &Arc<dyn ObjectStore>) -> String {
        match refs::read(root.as_ref(), "main").await.unwrap() {
            Slot::Live(head) => head.commit.message.clone(),
            _ => panic!("no head"),
        }
    }

    async fn bucket_holding(text: &str) -> (Arc<dyn ObjectStore>, UpdateVersion) {
        let root: Arc<dyn ObjectStore> = Arc::new(InMemory::new());
        let first = refs::write(root.as_ref(), "main", &stored("first"), PutMode::Create)
            .await
            .unwrap();
        refs::write(
            root.as_ref(),
            "main",
            &stored(text),
            PutMode::Update(first.clone()),
        )
        .await
        .unwrap();
        (root, first)
    }

    #[tokio::test]
    async fn a_deposed_owner_never_overwrites_a_newer_owners_head() {
        let (root, stale) = bucket_holding("newer owner").await;
        owned_at(&root, 6).await;
        let fence = Fence {
            root: &root,
            slot: SLOT,
            epoch: 5,
        };
        assert!(
            flush_one(&root, &pending("deposed", Some(stale), true), &fence)
                .await
                .is_none()
        );
        assert!(
            flush_one(&root, &pending("deposed", None, false), &fence)
                .await
                .is_none()
        );
        assert_eq!(message(&root).await, "newer owner");
    }

    #[tokio::test]
    async fn the_owner_overwrites_a_head_written_past_it() {
        let (root, stale) = bucket_holding("stray").await;
        owned_at(&root, 6).await;
        let fence = Fence {
            root: &root,
            slot: SLOT,
            epoch: 6,
        };
        assert!(
            flush_one(&root, &pending("owner", Some(stale), true), &fence)
                .await
                .is_some()
        );
        assert_eq!(message(&root).await, "owner");
    }
}
