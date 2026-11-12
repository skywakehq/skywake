//! Claiming a branch and saving to it.

use futures::future::try_join_all;
use futures::try_join;

use super::{Claim, Repo};
use crate::Head;
use crate::ops::diff::{self, Change};
use crate::ops::files;
use crate::store::bundles;
use crate::store::gc::lock;
use crate::store::held;
use crate::store::objects::{commit_path, object_path};
use crate::{Commit, Entry, Hash, Objects, Result, Trees};

impl Repo {
    pub async fn claim(&self, branch: &str) -> Result<Claim> {
        let head = self.head(branch).await?;
        let trees = Trees::new(self.objects.clone(), &head.commit.packs)?;
        let (head, _) = try_join!(
            self.refs.advance(branch, &head, head.commit.clone()),
            trees.get(head.commit.tree),
        )?;
        Claim::new(branch, head, trees)
    }

    pub async fn save(&self, claim: &mut Claim, tree: Hash, message: Option<&str>) -> Result<Hash> {
        let (packs, new_packs, new_parts) =
            claim.trees.layout(tree, &claim.head.commit.packs).await?;
        let commit = match message {
            Some(message) => Commit {
                merged: claim.merged,
                session: claim.session.clone(),
                ..Commit::new(tree, packs, Some(claim.last_commit), message)
            },
            None => Commit::autosave(tree, packs, claim.last_commit),
        };
        let store_packs = try_join_all(new_packs.iter().map(|pack| self.objects.put(pack)));
        let store_parts = try_join_all(new_parts.iter().map(|part| self.objects.put(part)));
        let store_commit = async {
            match message {
                Some(_) => self.objects.put_commit(&commit).await.map(drop),
                None => Ok(()),
            }
        };
        let store = self.objects.store().as_ref();
        let since = claim.trees.since();
        let hash = Objects::address(&commit)?;
        let deleted = if self.refs.served() && held::is_holding() {
            try_join!(store_packs, store_parts, store_commit)?;
            let objects = held::take();
            let advanced = self
                .refs
                .advance_holding(
                    &claim.branch,
                    &claim.head,
                    commit.clone(),
                    objects.clone(),
                    since,
                )
                .await?;
            if let Some(head) = advanced {
                return claim.saved(head, tree, &new_packs, message.is_some(), hash);
            }
            held::put_all(store, objects).await?;
            lock::settle(store, since).await?
        } else {
            let (_, _, _, deleted) = try_join!(
                store_packs,
                store_parts,
                store_commit,
                lock::settle(store, since)
            )?;
            deleted
        };
        held::put_all(store, held::take()).await?;
        let mut stored = Vec::new();
        for pack in &new_packs {
            stored.push(object_path(Objects::address(pack)?));
        }
        for part in &new_parts {
            stored.push(object_path(Objects::address(part)?));
        }
        if message.is_some() {
            stored.push(commit_path(hash));
        }
        if deleted {
            stored.extend(changed_chunks(&self.objects, claim, tree).await?);
            lock::exist(store, stored).await?;
        }
        let head = self
            .refs
            .advance(&claim.branch, &claim.head, commit)
            .await?;
        claim.saved(head, tree, &new_packs, message.is_some(), hash)
    }

    pub async fn revive(&self, claim: &Claim, tree: Hash, objects: &[Hash]) -> Result<()> {
        let mut paths: Vec<_> = objects.iter().map(|hash| object_path(*hash)).collect();
        paths.extend(changed_chunks(&self.objects, claim, tree).await?);
        lock::revive(self.objects.store().as_ref(), &paths).await
    }
}

async fn changed_chunks(
    objects: &Objects,
    claim: &Claim,
    tree: Hash,
) -> Result<Vec<object_store::path::Path>> {
    let trees = &claim.trees;
    let mut files = Vec::new();
    for change in diff::diff((trees, claim.tree), (trees, tree)).await? {
        let (Change::Added(path) | Change::Modified(path)) = change else {
            continue;
        };
        match files::find(trees, tree, &path).await? {
            Some(Entry::Dir { tree }) => {
                files.extend(files::walk(trees, tree).await?.into_iter().map(|(_, e)| e))
            }
            Some(entry) => files.push(entry),
            None => {}
        }
    }
    let data = files.iter().filter_map(|entry| match entry {
        Entry::File { data, .. } => Some(data),
        _ => None,
    });
    bundles::live_paths(objects, data).await
}

impl Claim {
    fn saved(
        &mut self,
        head: Head,
        tree: Hash,
        new_packs: &[crate::Pack],
        committed: bool,
        hash: Hash,
    ) -> Result<Hash> {
        self.head = head;
        self.trees.saved(tree, new_packs)?;
        self.tree = tree;
        if committed {
            self.last_commit = hash;
            self.merged = None;
        }
        Ok(hash)
    }
}
