//! `Engine`: a repo of files in one store, with branches, commits and merges.

mod commits;
mod files;

use std::sync::Arc;

use napi::Result;
use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use skywake_core::{
    EXECUTABLE_MODE, Edit, Entry, FILE_MODE, HeadNodes, Merged, Repo, bucket_folder, open_store,
};

use self::commits::{
    Changed, CommitChanges, CommitInfo, FileVersion, MergeResult, changed, commit_info, hash,
    maybe_hash,
};
use self::files::{
    FileChunk, FileEdit, Listing, MergeResolution, SearchMatch, content, info, resolution,
};
use crate::error::{fail, failure, invalid};

#[napi(object)]
pub struct Stored {
    pub objects: i64,
    pub bytes: i64,
}

#[napi(object)]
pub struct EngineOpenOptions {
    pub heads: Option<bool>,
}

fn head_nodes(location: &str) -> Result<HeadNodes> {
    let folder = bucket_folder(location)
        .ok_or_else(|| invalid("branch heads on the cache tier need an s3:// store"))?;
    let nodes: Vec<String> = std::env::var("SKYWAKE_CACHE_NODES")
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|url| !url.is_empty())
        .map(String::from)
        .collect();
    let token = std::env::var("SKYWAKE_CACHE_TOKEN")
        .ok()
        .filter(|token| !token.is_empty());
    let nodes = HeadNodes::new(nodes, token)
        .ok_or_else(|| invalid("branch heads on the cache tier need SKYWAKE_CACHE_NODES"))?;
    Ok(nodes.in_folder(folder))
}

#[napi]
pub struct Engine {
    repo: Repo,
}

#[napi]
impl Engine {
    #[napi(factory)]
    pub fn open(location: String, options: Option<EngineOpenOptions>) -> Result<Self> {
        let store = open_store(&location).map_err(fail)?;
        let mut repo = Repo::new(store);
        if options.and_then(|options| options.heads).unwrap_or(false) {
            repo = repo.with_head_nodes(Arc::new(head_nodes(&location)?));
        }
        Ok(Self { repo })
    }

    #[napi]
    pub async fn create_branch(&self, name: String, from: Option<String>) -> Result<String> {
        let head = self.repo.create_branch(&name, from.as_deref()).await;
        Ok(head.map_err(fail)?.to_string())
    }

    #[napi]
    pub async fn fork_at(&self, name: String, at: String) -> Result<String> {
        let head = self.repo.fork_at(&name, hash(&at)?).await;
        Ok(head.map_err(fail)?.to_string())
    }

    #[napi]
    pub async fn delete_branch(&self, name: String) -> Result<()> {
        match self.repo.delete_branch(&name).await {
            Err(skywake_core::Error::Conflict(_)) => Err(failure(
                "conflict",
                format!(
                    "branch `{name}` changed while it was being deleted, so it was kept; a mount may be saving to it: try again"
                ),
            )),
            deleted => deleted.map_err(fail),
        }
    }

    #[napi]
    pub async fn head(&self, branch: String) -> Result<String> {
        let head = self.repo.head_commit(&branch).await;
        Ok(head.map_err(fail)?.to_string())
    }

    #[napi]
    pub async fn branches(&self) -> Result<Vec<String>> {
        self.repo.branches().await.map_err(fail)
    }

    #[napi]
    pub async fn stored(&self, budget_ms: u32) -> Result<Option<Stored>> {
        let store = self.repo.objects().store();
        let budget = std::time::Duration::from_millis(budget_ms.into());
        let found = skywake_core::store::measure::measure(store.as_ref(), budget).await;
        Ok(found.map_err(fail)?.map(|found| Stored {
            objects: found.objects as i64,
            bytes: found.bytes as i64,
        }))
    }

    #[napi]
    pub async fn list(
        &self,
        branch: String,
        path: String,
        at: Option<String>,
        after: Option<String>,
        limit: Option<u32>,
    ) -> Result<Listing> {
        let at = maybe_hash(at)?;
        let listed = match limit {
            Some(limit) => {
                let (after, limit) = (after.as_deref(), limit as usize);
                self.repo.list_page(&branch, at, &path, after, limit).await
            }
            None => self.repo.list(&branch, at, &path).await,
        };
        let (entry, inside) = listed.map_err(fail)?;
        let name = path.trim_matches('/').rsplit('/').next().unwrap_or("");
        Ok(Listing {
            info: info(name, &entry),
            entries: inside
                .iter()
                .map(|(name, entry)| info(name, entry))
                .collect(),
        })
    }

    #[napi]
    pub async fn read(
        &self,
        branch: String,
        path: String,
        offset: Option<i64>,
        length: Option<i64>,
        at: Option<String>,
    ) -> Result<Buffer> {
        let at = maybe_hash(at)?;
        let offset = offset.unwrap_or(0).max(0) as u64;
        let length = length.map_or(u64::MAX, |length| length.max(0) as u64);
        let bytes = self.repo.read(&branch, at, &path, offset, length).await;
        Ok(bytes.map_err(fail)?.into())
    }

    #[napi]
    pub async fn search(
        &self,
        branch: String,
        pattern: String,
        folder: Option<String>,
        limit: Option<u32>,
    ) -> Result<Vec<SearchMatch>> {
        let folder = folder.unwrap_or_default();
        let limit = limit.unwrap_or(100).clamp(1, 10_000) as usize;
        let found = self.repo.search(&branch, &folder, &pattern, limit).await;
        Ok(found
            .map_err(fail)?
            .into_iter()
            .map(|found| SearchMatch {
                path: found.path,
                line: found.line as u32,
                text: found.text,
            })
            .collect())
    }

    #[napi]
    pub async fn commit_files(
        &self,
        branch: String,
        message: String,
        edits: Vec<FileEdit>,
        session: Option<String>,
    ) -> Result<String> {
        let edits = edits
            .into_iter()
            .map(|mut edit| {
                Ok(Edit {
                    content: content(&mut edit)?,
                    path: edit.path,
                    mode: match edit.executable {
                        Some(true) => EXECUTABLE_MODE,
                        _ => FILE_MODE,
                    },
                })
            })
            .collect::<Result<_>>()?;
        let head = self
            .repo
            .commit_files(&branch, &message, session.as_deref(), edits)
            .await;
        Ok(head.map_err(fail)?.to_string())
    }

    #[napi]
    pub async fn store_part(&self, data: Buffer) -> Result<Vec<FileChunk>> {
        let chunks = self.repo.store_part(&data).await.map_err(fail)?;
        Ok(chunks
            .into_iter()
            .map(|chunk| FileChunk {
                hash: chunk.hash.to_string(),
                size: chunk.size,
            })
            .collect())
    }

    #[napi]
    pub async fn log(&self, branch: String, limit: Option<u32>) -> Result<Vec<CommitInfo>> {
        let limit = limit.unwrap_or(50) as usize;
        let log = self.repo.recent(&branch, limit).await.map_err(fail)?;
        Ok(log
            .iter()
            .map(|(hash, commit)| commit_info(*hash, commit))
            .collect())
    }

    #[napi]
    pub async fn commit(&self, at: String) -> Result<CommitChanges> {
        let at = hash(&at)?;
        let commit = self.repo.objects().get_commit(at).await.map_err(fail)?;
        let changes = self.repo.changes(&commit).await.map_err(fail)?;
        Ok(CommitChanges {
            commit: commit_info(at, &commit),
            changes: changes.into_iter().map(changed).collect(),
        })
    }

    #[napi]
    pub async fn changes_since(
        &self,
        branch: String,
        since: Option<String>,
        limit: Option<u32>,
    ) -> Result<Vec<CommitChanges>> {
        let since = maybe_hash(since)?;
        let limit = limit.unwrap_or(50) as usize;
        let feed = self.repo.changes_since(&branch, since, limit).await;
        Ok(feed
            .map_err(fail)?
            .into_iter()
            .map(|(hash, commit, changes)| CommitChanges {
                commit: commit_info(hash, &commit),
                changes: changes.into_iter().map(changed).collect(),
            })
            .collect())
    }

    #[napi]
    pub async fn file_history(
        &self,
        branch: String,
        path: String,
        after: Option<String>,
        limit: Option<u32>,
    ) -> Result<Vec<FileVersion>> {
        let after = after.as_deref().map(hash).transpose()?;
        let limit = limit.map_or(usize::MAX, |limit| limit as usize);
        let versions = self
            .repo
            .file_history_page(&branch, &path, after, limit)
            .await
            .map_err(fail)?;
        Ok(versions
            .iter()
            .map(|(hash, commit, entry)| FileVersion {
                commit: commit_info(*hash, commit),
                size: match entry {
                    Some(Entry::File { size, .. }) => Some(*size as i64),
                    _ => None,
                },
            })
            .collect())
    }

    #[napi]
    pub async fn diff(&self, from: String, to: String) -> Result<Vec<Changed>> {
        let changes = self.repo.diff(&from, &to).await.map_err(fail)?;
        Ok(changes.into_iter().map(changed).collect())
    }

    #[napi]
    pub async fn diff_commits(&self, from: String, to: String) -> Result<Vec<Changed>> {
        let (from, to) = (hash(&from)?, hash(&to)?);
        let changes = self.repo.diff_commits(from, to).await.map_err(fail)?;
        Ok(changes.into_iter().map(changed).collect())
    }

    #[napi]
    pub async fn merge_base(&self, a: String, b: String) -> Result<Option<String>> {
        let base = self.repo.merge_base_of(&a, &b).await.map_err(fail)?;
        Ok(base.map(|hash| hash.to_string()))
    }

    #[napi]
    pub async fn merge(
        &self,
        into: String,
        from: String,
        message: String,
        session: Option<String>,
        resolved: Option<Vec<MergeResolution>>,
    ) -> Result<MergeResult> {
        let resolved = resolved
            .unwrap_or_default()
            .into_iter()
            .map(|resolved| {
                let mode = match resolved.executable {
                    Some(true) => EXECUTABLE_MODE,
                    _ => FILE_MODE,
                };
                resolution(resolved, mode)
            })
            .collect::<Result<_>>()?;
        let merged = self
            .repo
            .merge_resolved(&into, &from, &message, session.as_deref(), resolved)
            .await;
        Ok(match merged.map_err(fail)? {
            Merged::Done(head) => MergeResult {
                head: Some(head.to_string()),
                conflicts: Vec::new(),
            },
            Merged::Conflicts(conflicts) => MergeResult {
                head: None,
                conflicts,
            },
        })
    }

    #[napi]
    pub async fn conflicts(&self, into: String, from: String) -> Result<Vec<String>> {
        self.repo.conflicts(&into, &from).await.map_err(fail)
    }
}
