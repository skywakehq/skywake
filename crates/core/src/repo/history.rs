//! Commits on a branch, and what each changed.

use super::Repo;
use crate::model::Packs;
use crate::ops::diff::{self, Change};
use crate::ops::files;
use crate::{Commit, Entry, Hash, Objects, Result, Tree, Trees};

impl Repo {
    pub async fn changes(&self, commit: &Commit) -> Result<Vec<Change>> {
        let trees = Trees::new(self.objects.clone(), &commit.packs)?;
        let parent = match commit.parent {
            Some(parent) => self.parent(parent).await?,
            None => None,
        };
        let (parent_tree, parent_trees) = match parent {
            Some(parent) => (
                parent.tree,
                Trees::new(self.objects.clone(), &parent.packs)?,
            ),
            None => {
                let empty = Packs {
                    recent: vec![Tree::new()],
                    ..Packs::default()
                };
                (
                    Objects::address(&Tree::new())?,
                    Trees::new(self.objects.clone(), &empty)?,
                )
            }
        };
        diff::diff((&parent_trees, parent_tree), (&trees, commit.tree)).await
    }

    pub async fn log(&self, branch: &str) -> Result<Vec<(Hash, Commit)>> {
        self.recent(branch, usize::MAX).await
    }

    pub async fn recent(&self, branch: &str, limit: usize) -> Result<Vec<(Hash, Commit)>> {
        let mut log = Vec::new();
        let mut commit = self.head(branch).await?.commit;
        let mut hash = Objects::address(&commit)?;
        loop {
            let parent = commit.parent;
            if !commit.autosave {
                log.push((hash, commit));
            }
            let Some(parent) = parent.filter(|_| log.len() < limit) else {
                return Ok(log);
            };
            let Some(stored) = self.parent(parent).await? else {
                return Ok(log);
            };
            commit = stored;
            hash = parent;
        }
    }

    pub async fn file_history(
        &self,
        branch: &str,
        path: &str,
    ) -> Result<Vec<(Hash, Commit, Option<Entry>)>> {
        self.file_history_page(branch, path, None, usize::MAX).await
    }

    pub async fn file_history_page(
        &self,
        branch: &str,
        path: &str,
        after: Option<Hash>,
        limit: usize,
    ) -> Result<Vec<(Hash, Commit, Option<Entry>)>> {
        let first = match after {
            Some(after) => Some((after, self.objects.get_commit(after).await?)),
            None => {
                let head = self.head(branch).await?.commit;
                let hash = Objects::address(&head)?;
                self.named(hash, head).await?
            }
        };
        let Some((mut hash, mut commit)) = first else {
            return Ok(Vec::new());
        };
        let mut entry = self.entry_at(&commit, path).await?;
        let mut versions = Vec::new();
        while versions.len() < limit {
            let older = match commit.parent {
                Some(parent) => match self.parent(parent).await? {
                    Some(stored) => self.named(parent, stored).await?,
                    None => None,
                },
                None => None,
            };
            let older_entry = match &older {
                Some((_, older)) => Some(self.entry_at(older, path).await?),
                None => None,
            };
            let changed = match (&entry, &older_entry) {
                (Some(entry), Some(Some(before))) => !entry.same_content(before),
                (None, Some(None)) | (None, None) => false,
                _ => true,
            };
            if changed && Some(hash) != after {
                versions.push((hash, commit.clone(), entry.clone()));
            }
            let (Some((next_hash, next)), Some(next_entry)) = (older, older_entry) else {
                break;
            };
            (hash, commit, entry) = (next_hash, next, next_entry);
        }
        Ok(versions)
    }

    async fn named(&self, mut hash: Hash, mut commit: Commit) -> Result<Option<(Hash, Commit)>> {
        while commit.autosave {
            let Some(parent) = commit.parent else {
                return Ok(None);
            };
            let Some(stored) = self.parent(parent).await? else {
                return Ok(None);
            };
            (hash, commit) = (parent, stored);
        }
        Ok(Some((hash, commit)))
    }

    async fn entry_at(&self, commit: &Commit, path: &str) -> Result<Option<Entry>> {
        let trees = Trees::new(self.objects.clone(), &commit.packs)?;
        files::find(&trees, commit.tree, path).await
    }
}
