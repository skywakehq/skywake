//! Merging one branch into another.

use std::collections::{BinaryHeap, HashMap, HashSet};
use std::time::SystemTime;

use futures::future::try_join_all;

use super::{Claim, Repo};
use crate::model::Packs;
use crate::ops::files;
use crate::ops::merge::{self, Sides};
use crate::retry::{SAVE_ATTEMPTS, backoff};
use crate::store::gc::lock;
use crate::store::objects::chunk_path;
use crate::{Chunk, Commit, Data, Entry, Error, Hash, Objects, Result, Trees};

/// What one path becomes in a merge, chosen by the caller.
pub struct Resolution {
    pub path: String,
    pub take: Take,
}

pub enum Take {
    /// The path as it is on the branch merged into.
    Ours,
    /// The path as it is on the branch merged in.
    Theirs,
    Bytes(Vec<u8>, u32),
    Chunks(Vec<Chunk>, u32),
    Remove,
}

enum Pick {
    Ours,
    Theirs,
    Put(Option<Entry>),
}

impl Repo {
    pub async fn merge(
        &self,
        into: &str,
        from: &str,
        message: &str,
        session: Option<&str>,
    ) -> Result<Merged> {
        self.merge_resolved(into, from, message, session, Vec::new())
            .await
    }

    /// Merges like `merge`, then sets each resolved path as the caller chose.
    /// Conflicts that no resolution covers still stop the merge.
    pub async fn merge_resolved(
        &self,
        into: &str,
        from: &str,
        message: &str,
        session: Option<&str>,
        resolved: Vec<Resolution>,
    ) -> Result<Merged> {
        let since = SystemTime::now();
        let mut picks = Vec::new();
        for resolution in resolved {
            files::parts(&resolution.path)?;
            let pick = match resolution.take {
                Take::Ours => Pick::Ours,
                Take::Theirs => Pick::Theirs,
                Take::Bytes(bytes, mode) => {
                    Pick::Put(Some(files::store(&self.objects, &bytes, mode).await?))
                }
                Take::Chunks(chunks, mode) => {
                    let paths: Vec<_> = chunks.iter().map(|chunk| chunk_path(chunk.hash)).collect();
                    lock::revive(self.objects.store().as_ref(), &paths).await?;
                    Pick::Put(Some(files::file(Data::Chunks(chunks), mode)))
                }
                Take::Remove => Pick::Put(None),
            };
            picks.push((resolution.path, pick));
        }
        let mut attempt = 1;
        loop {
            match self
                .merge_once(into, from, message, session, &picks, since)
                .await
            {
                Err(Error::Conflict(_)) if attempt < SAVE_ATTEMPTS => {
                    backoff(attempt).await;
                    attempt += 1;
                }
                merged => return merged,
            }
        }
    }

    async fn merge_once(
        &self,
        into: &str,
        from: &str,
        message: &str,
        session: Option<&str>,
        picks: &[(String, Pick)],
        since: SystemTime,
    ) -> Result<Merged> {
        let mut ours = self.position(into).await?;
        let Some(merge) = self.combine(&ours, from).await? else {
            return Ok(Merged::Done(self.head_commit(into).await?)); // nothing new
        };
        let open: Vec<String> = merge
            .conflicts
            .into_iter()
            .filter(|path| !picks.iter().any(|(picked, _)| covers(picked, path)))
            .collect();
        if !open.is_empty() {
            return Ok(Merged::Conflicts(open));
        }
        ours.trees.absorb(&merge.theirs_trees);
        let mut tree = merge.tree;
        if !picks.is_empty() {
            ours.trees.started(since);
        }
        for (path, pick) in picks {
            let entry = match pick {
                Pick::Ours => files::find(&ours.trees, ours.tree, path).await?,
                Pick::Theirs => files::find(&ours.trees, merge.theirs_tree, path).await?,
                Pick::Put(entry) => entry.clone(),
            };
            // Removing what is already gone is no change.
            if entry.is_none() && files::find(&ours.trees, tree, path).await?.is_none() {
                continue;
            }
            tree = files::put(&ours.trees, tree, path, entry).await?;
        }
        ours.merged = Some(merge.theirs);
        ours.session = session.map(str::to_string);
        Ok(Merged::Done(
            self.save(&mut ours, tree, Some(message)).await?,
        ))
    }

    pub async fn conflicts(&self, into: &str, from: &str) -> Result<Vec<String>> {
        let ours = self.position(into).await?;
        let merge = self.combine(&ours, from).await?;
        Ok(merge.map(|merge| merge.conflicts).unwrap_or_default())
    }

    /// The newest commit both branches have: where they forked, or where
    /// one was last merged into the other. None if they share no history.
    pub async fn merge_base_of(&self, a: &str, b: &str) -> Result<Option<Hash>> {
        let (ours, theirs) = futures::try_join!(self.position(a), self.position(b))?;
        self.merge_base(&ours.head.commit, theirs.last_commit).await
    }

    async fn combine(&self, ours: &Claim, from: &str) -> Result<Option<Combined>> {
        let theirs = self.position(from).await?;
        let theirs_hash = theirs.last_commit;
        let theirs: Commit = match theirs.head.commit.autosave {
            true => self.objects.get_commit(theirs_hash).await?,
            false => theirs.head.commit,
        };
        let base = self.merge_base(&ours.head.commit, theirs_hash).await?;
        if base == Some(theirs_hash) {
            return Ok(None);
        }
        let base = match base {
            Some(base) => self.parent(base).await?,
            None => None,
        };
        let (base_tree, base_packs) = match base {
            Some(base) => (Some(base.tree), base.packs),
            None => (None, Packs::default()),
        };
        let theirs_trees = Trees::new(self.objects.clone(), &theirs.packs)?;
        let sides = Sides {
            base: &Trees::new(self.objects.clone(), &base_packs)?,
            ours: &ours.trees,
            theirs: &theirs_trees,
        };
        let (tree, conflicts) =
            merge::merge(&self.objects, &sides, base_tree, ours.tree, theirs.tree).await?;
        Ok(Some(Combined {
            tree,
            conflicts,
            theirs: theirs_hash,
            theirs_tree: theirs.tree,
            theirs_trees,
        }))
    }

    async fn merge_base(&self, ours: &Commit, theirs: Hash) -> Result<Option<Hash>> {
        const OURS: u8 = 1;
        const THEIRS: u8 = 2;
        const BOTH: u8 = OURS | THEIRS;
        const BELOW: u8 = 4;

        let mut pending: Vec<(Hash, u8)> = match ours.autosave {
            true => ours.parents().map(|hash| (hash, OURS)).collect(),
            false => vec![(Objects::address(ours)?, OURS)],
        };
        pending.push((theirs, THEIRS));
        let mut commits = HashMap::new();
        let mut flags: HashMap<Hash, u8> = HashMap::new();
        let mut queue = BinaryHeap::new();
        let mut found = Vec::new();
        loop {
            self.learn(&mut commits, pending.iter().map(|(hash, _)| *hash))
                .await?;
            for (hash, flag) in pending.drain(..) {
                if flag & BELOW != 0 {
                    found.retain(|best| *best != hash);
                }
                let old = flags.entry(hash).or_default();
                if *old | flag != *old {
                    *old |= flag;
                    queue.push((commits[&hash].0, *hash.as_bytes()));
                }
            }
            if queue
                .iter()
                .all(|(_, hash)| flags[&Hash::from_bytes(*hash)] & BELOW != 0)
            {
                break;
            }
            let Some((_, hash)) = queue.pop() else {
                break;
            };
            let hash = Hash::from_bytes(hash);
            let mut flag = flags[&hash];
            if flag & BOTH == BOTH && flag & BELOW == 0 {
                found.push(hash);
                flag |= BELOW;
                flags.insert(hash, flag);
            }
            pending = commits[&hash]
                .1
                .iter()
                .map(|&parent| (parent, flag))
                .collect();
        }
        if found.len() > 1 {
            let mut below = HashSet::new();
            let mut level: Vec<Hash> = found
                .iter()
                .flat_map(|hash| commits[hash].1.clone())
                .collect();
            while !level.is_empty() {
                level.retain(|hash| below.insert(*hash));
                self.learn(&mut commits, level.iter().copied()).await?;
                level = level
                    .iter()
                    .flat_map(|hash| commits[hash].1.clone())
                    .collect();
            }
            found.retain(|hash| !below.contains(hash));
        }
        Ok(found
            .into_iter()
            .max_by_key(|hash| (commits[hash].0, *hash.as_bytes())))
    }

    async fn learn(
        &self,
        commits: &mut HashMap<Hash, (u64, Vec<Hash>)>,
        hashes: impl Iterator<Item = Hash>,
    ) -> Result<()> {
        let todo: Vec<Hash> = hashes
            .filter(|hash| !commits.contains_key(hash))
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        let fetched = try_join_all(todo.iter().map(|&hash| self.parent(hash))).await?;
        for (hash, commit) in todo.into_iter().zip(fetched) {
            match commit {
                Some(commit) => commits.insert(hash, (commit.time, commit.parents().collect())),
                None => commits.insert(hash, (0, Vec::new())),
            };
        }
        Ok(())
    }
}

struct Combined {
    tree: Hash,
    conflicts: Vec<String>,
    theirs: Hash,
    theirs_tree: Hash,
    theirs_trees: Trees,
}

/// Whether resolving `picked` settles the conflict at `path`: the same path, or a folder holding it.
fn covers(picked: &str, path: &str) -> bool {
    let (picked, path) = (picked.trim_matches('/'), path.trim_matches('/'));
    path == picked
        || path
            .strip_prefix(picked)
            .is_some_and(|rest| rest.starts_with('/'))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Merged {
    Done(Hash),
    Conflicts(Vec<String>),
}
