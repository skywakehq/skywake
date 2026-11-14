//! The main API: branches of whole filesystems in one bucket.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use futures::try_join;
use object_store::ObjectStore;

use crate::error::missing;
use crate::model::Packs;
use crate::ops::diff::{self, Change};
use crate::ops::worktree;
use crate::retry::{SAVE_ATTEMPTS, backoff};
use crate::store::gc::lock;
use crate::store::gc::{self, Collected};
use crate::store::kind::{self, Kind};
use crate::store::objects::commit_path;
use crate::{Commit, Error, Hash, Head, Objects, Refs, Result, Tree, Trees};

mod files;
mod history;
mod merge;
mod save;

pub use files::{Content, Edit, Match};
pub use merge::{Merged, Resolution, Take};

#[derive(Clone)]
pub struct Repo {
    objects: Objects,
    refs: Refs,
}

impl Repo {
    pub fn new(store: Arc<dyn ObjectStore>) -> Self {
        Self {
            objects: Objects::new(store.clone()),
            refs: Refs::new(store),
        }
    }

    pub fn with_head_nodes(mut self, nodes: Arc<crate::HeadNodes>) -> Self {
        self.refs = self.refs.served_by(nodes);
        self.objects = self.objects.with_owners();
        self
    }

    pub fn refs(&self) -> &Refs {
        &self.refs
    }

    pub fn with_cache(mut self, dir: PathBuf) -> Self {
        self.objects = self.objects.with_cache(dir);
        self
    }

    pub async fn create_branch(&self, name: &str, from: Option<&str>) -> Result<Hash> {
        let commit = match from {
            Some(source) => self.stored_head(source).await?.commit,
            None => {
                // A branch from nothing is how a folder starts. Credentials scoped to
                // the folder may not write the marker; GC marks such a folder later.
                match kind::mark(self.objects.store().as_ref(), Kind::Filesystem).await {
                    Err(error @ crate::Error::WrongKind(_)) => return Err(error),
                    _ => {}
                }
                let empty = Tree::new();
                let packs = Packs {
                    recent: vec![empty.clone()],
                    ..Packs::default()
                };
                let commit = Commit::new(Objects::address(&empty)?, packs, None, "empty");
                let hash = Objects::address(&commit)?;
                if self.refs.served() {
                    self.refs.create_with(name, commit, true).await?;
                } else {
                    try_join!(
                        self.objects.put_commit(&commit),
                        self.refs.create(name, commit.clone())
                    )?;
                }
                return Ok(hash);
            }
        };
        let hash = Objects::address(&commit)?;
        self.refs.create(name, commit).await?;
        Ok(hash)
    }

    pub async fn fork_at(&self, name: &str, commit: Hash) -> Result<Hash> {
        lock::revive(self.objects.store().as_ref(), &[commit_path(commit)]).await?;
        let stored = self.objects.get_commit(commit).await?;
        self.refs.create(name, stored).await?;
        Ok(commit)
    }

    pub async fn commit_tree(&self, commit: Hash) -> Result<(Hash, Trees)> {
        let commit = self.objects.get_commit(commit).await?;
        Ok((
            commit.tree,
            Trees::new(self.objects.clone(), &commit.packs)?,
        ))
    }

    pub async fn commit(&self, branch: &str, dir: &Path, message: &str) -> Result<Hash> {
        let mut position = self.position(branch).await?;
        let tree = worktree::snapshot(&self.objects, &position.trees, dir, position.tree).await?;
        if tree == position.tree && !position.head.commit.autosave {
            return Objects::address(&position.head.commit);
        }
        self.save(&mut position, tree, Some(message)).await
    }

    pub async fn position(&self, branch: &str) -> Result<Claim> {
        let head = self.head(branch).await?;
        let trees = Trees::new(self.objects.clone(), &head.commit.packs)?;
        Claim::new(branch, head, trees)
    }

    pub async fn checkout(&self, branch: &str, dir: &Path) -> Result<()> {
        let position = self.position(branch).await?;
        worktree::materialize(&self.objects, &position.trees, position.tree, dir).await
    }

    pub async fn diff(&self, from: &str, to: &str) -> Result<Vec<Change>> {
        let (from, to) = try_join!(self.position(from), self.position(to))?;
        diff::diff((&from.trees, from.tree), (&to.trees, to.tree)).await
    }

    pub async fn diff_commits(&self, from: Hash, to: Hash) -> Result<Vec<Change>> {
        let ((from_tree, from), (to_tree, to)) =
            try_join!(self.commit_tree(from), self.commit_tree(to))?;
        diff::diff((&from, from_tree), (&to, to_tree)).await
    }

    async fn parent(&self, hash: Hash) -> Result<Option<Commit>> {
        missing(self.objects.get_commit(hash).await)
    }

    pub async fn delete_branch(&self, branch: &str) -> Result<()> {
        self.refs.delete(branch).await
    }

    pub async fn collect_garbage(&self, grace: Duration, dry_run: bool) -> Result<Collected> {
        gc::collect(&self.objects, &self.refs, grace, dry_run).await
    }

    pub async fn head_commit(&self, branch: &str) -> Result<Hash> {
        Objects::address(&self.stored_head(branch).await?.commit)
    }

    async fn stored_head(&self, branch: &str) -> Result<Head> {
        let mut attempt = 0;
        loop {
            let head = self.head(branch).await?;
            if !head.commit.autosave {
                return Ok(head);
            }
            self.objects.put_commit(&head.commit).await?;
            if self.head(branch).await?.same_write(&head) {
                return Ok(head);
            }
            attempt += 1;
            if attempt == SAVE_ATTEMPTS {
                return Err(Error::Conflict(branch.to_string()));
            }
            backoff(attempt).await;
        }
    }

    pub async fn branches(&self) -> Result<Vec<String>> {
        self.refs.list().await
    }

    async fn head(&self, branch: &str) -> Result<Head> {
        self.refs
            .head(branch)
            .await?
            .ok_or_else(|| Error::BranchNotFound(branch.to_string()))
    }

    pub async fn head_tree(&self, branch: &str) -> Result<(Hash, Trees)> {
        let position = self.position(branch).await?;
        Ok((position.tree, position.trees))
    }

    pub fn objects(&self) -> &Objects {
        &self.objects
    }
}

#[derive(Clone)]
pub struct Claim {
    branch: String,
    head: Head,
    last_commit: Hash,
    merged: Option<Hash>,
    pub session: Option<String>,
    pub tree: Hash,
    pub trees: Trees,
}

impl Claim {
    fn new(branch: &str, head: Head, trees: Trees) -> Result<Self> {
        let last_commit = match head.commit.parent {
            Some(parent) if head.commit.autosave => parent,
            _ => Objects::address(&head.commit)?,
        };
        Ok(Self {
            branch: branch.to_string(),
            tree: head.commit.tree,
            head,
            last_commit,
            merged: None,
            session: None,
            trees,
        })
    }

    pub fn branch(&self) -> &str {
        &self.branch
    }

    pub fn head(&self) -> Result<Hash> {
        Objects::address(&self.head.commit)
    }

    pub fn seq(&self) -> u64 {
        self.head.seq
    }

    pub fn packs(&self) -> &Packs {
        &self.head.commit.packs
    }
}
