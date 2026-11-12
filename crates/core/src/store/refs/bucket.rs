//! Branch heads kept in the bucket, each moved by a conditional write.

use std::sync::Arc;

use futures::TryStreamExt;
use object_store::path::Path;
use object_store::{ObjectStore, ObjectStoreExt, PutMode, PutPayload, UpdateVersion};

use super::wire::Stored;
use super::{Head, Version, conflict, valid_name};
use crate::retry::random;
use crate::store::io::{found, generic, lost_race, version_of, written};
use crate::store::objects::{OBJECT_LIMIT, decode, encode};
use crate::{Commit, Error, Result};

pub(crate) const DELETED: &str = "deleted";

#[derive(Clone)]
pub(super) struct Bucket {
    store: Arc<dyn ObjectStore>,
}

pub enum Slot {
    Missing,
    Deleted(UpdateVersion),
    Live(Box<Head>),
}

impl Bucket {
    pub(super) fn new(store: Arc<dyn ObjectStore>) -> Self {
        Self { store }
    }

    pub(super) async fn head(&self, branch: &str) -> Result<Option<Head>> {
        Ok(match read(self.store.as_ref(), branch).await? {
            Slot::Live(head) => Some(*head),
            Slot::Missing | Slot::Deleted(_) => None,
        })
    }

    pub(super) async fn create(&self, branch: &str, commit: Commit) -> Result<Head> {
        let exists = || Error::BranchExists(branch.to_string());
        let token = random();
        match self
            .write(branch, 0, token, commit.clone(), PutMode::Create)
            .await
        {
            Err(Error::Conflict(_)) => {}
            created => return created,
        }
        match read(self.store.as_ref(), branch).await? {
            Slot::Deleted(version) => self
                .write(branch, 0, token, commit, PutMode::Update(version))
                .await
                .map_err(|error| match error {
                    Error::Conflict(_) => exists(),
                    error => error,
                }),
            Slot::Live(_) | Slot::Missing => Err(exists()),
        }
    }

    pub(super) async fn advance(&self, branch: &str, from: &Head, commit: Commit) -> Result<Head> {
        let Version::Bucket(version) = &from.version else {
            return Err(conflict(branch));
        };
        let mode = PutMode::Update(version.clone());
        self.write(branch, from.seq + 1, random(), commit, mode)
            .await
    }

    pub(super) async fn delete(&self, branch: &str, head: &Head) -> Result<()> {
        let Version::Bucket(version) = &head.version else {
            return Err(conflict(branch));
        };
        let record = self.keep_deleted(&head.commit).await?;
        let written = write_deleted(
            self.store.as_ref(),
            branch,
            PutMode::Update(version.clone()),
        )
        .await;
        let Err(error) = written else {
            return Ok(());
        };
        let result = match read(self.store.as_ref(), branch).await {
            Ok(Slot::Deleted(_)) => return Ok(()),
            Ok(_) if lost_race(&error) => Err(conflict(branch)),
            Ok(_) => Err(error.into()),
            Err(_) => return Err(Error::Unsettled(branch.to_string())),
        };
        self.forget_deleted(&record).await;
        result
    }

    pub(super) async fn keep_deleted(&self, commit: &Commit) -> Result<Path> {
        let record = Path::from(format!("{DELETED}/{:016x}", random()));
        let bytes = encode(&postcard::to_stdvec(commit)?)?;
        self.store.put(&record, bytes.into()).await?;
        Ok(record)
    }

    pub(super) async fn forget_deleted(&self, record: &Path) {
        let _ = self.store.delete(record).await;
    }

    pub(super) async fn list(&self) -> Result<Vec<String>> {
        let mut branches: Vec<String> = self
            .store
            .list(Some(&Path::from("refs")))
            .try_filter_map(|meta| async move {
                let name = meta.location.as_ref().strip_prefix("refs/");
                Ok(name
                    .filter(|name| meta.size > 0 && valid_name(name))
                    .map(str::to_string))
            })
            .try_collect()
            .await?;
        branches.sort();
        Ok(branches)
    }

    async fn write(
        &self,
        branch: &str,
        seq: u64,
        token: u64,
        commit: Commit,
        mode: PutMode,
    ) -> Result<Head> {
        let stored = Stored { seq, token, commit };
        match write(self.store.as_ref(), branch, &stored, mode).await {
            Ok(version) => Ok(Head::in_bucket(stored, version)),
            Err(error) => match read(self.store.as_ref(), branch).await {
                Ok(Slot::Live(head)) if head.token == token && head.seq == seq => Ok(*head),
                Ok(_) if lost_race(&error) => Err(conflict(branch)),
                Ok(_) => Err(error.into()),
                Err(_) => Err(Error::Unsettled(branch.to_string())),
            },
        }
    }
}

pub async fn read(store: &dyn ObjectStore, branch: &str) -> Result<Slot> {
    let path = ref_path(branch);
    let Some(object) = found(store.get(&path).await)? else {
        return Ok(Slot::Missing);
    };
    let version = version_of(&object.meta);
    let bytes = object.bytes().await?;
    if bytes.is_empty() {
        return Ok(Slot::Deleted(version));
    }
    let stored: Stored = postcard::from_bytes(&decode(&path, &bytes, OBJECT_LIMIT)?)?;
    Ok(Slot::Live(Box::new(Head::in_bucket(stored, version))))
}

pub async fn write(
    store: &dyn ObjectStore,
    branch: &str,
    stored: &Stored,
    mode: PutMode,
) -> object_store::Result<UpdateVersion> {
    let bytes = postcard::to_stdvec(stored)
        .map_err(generic)
        .and_then(|bytes| encode(&bytes).map_err(generic))?;
    let result = store
        .put_opts(&ref_path(branch), bytes.into(), mode.into())
        .await?;
    Ok(written(result))
}

pub async fn write_deleted(
    store: &dyn ObjectStore,
    branch: &str,
    mode: PutMode,
) -> object_store::Result<UpdateVersion> {
    let result = store
        .put_opts(&ref_path(branch), PutPayload::new(), mode.into())
        .await?;
    Ok(written(result))
}

fn ref_path(branch: &str) -> Path {
    Path::from(format!("refs/{branch}"))
}
