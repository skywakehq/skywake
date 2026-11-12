//! Files on a branch with no local folder: list, read, search, edit.

use std::time::SystemTime;

use futures::future::try_join_all;
use futures::{StreamExt, TryStreamExt, stream, try_join};
use regex::RegexBuilder;

use crate::ops::files;
use crate::retry::{SAVE_ATTEMPTS, backoff};
use crate::store::gc::lock;
use crate::store::objects::{chunk_path, commit_path};
use crate::{Change, Chunk, Commit, Data, Entry, Error, Hash, Repo, Result, Tree, Trees};
const SEARCH_FILE_MAX: u64 = 1 << 20;
const SEARCH_PARALLELISM: usize = 16;
const SEARCH_LINE_MAX: usize = 500;

pub struct Edit {
    pub path: String,
    pub content: Content,
    pub mode: u32,
}

pub enum Content {
    Bytes(Vec<u8>),
    Chunks(Vec<Chunk>),
    From { path: String, at: Option<Hash> },
    Folder,
    Remove,
}

enum Step {
    Put(Option<Entry>),
    Copy(String),
    Folder,
}

pub struct Match {
    pub path: String,
    pub line: usize,
    pub text: String,
}

impl Repo {
    pub async fn tree_at(&self, branch: &str, at: Option<Hash>) -> Result<(Hash, Trees)> {
        match at {
            Some(at) => self.commit_tree(at).await,
            None => self.head_tree(branch).await,
        }
    }

    pub async fn list(
        &self,
        branch: &str,
        at: Option<Hash>,
        path: &str,
    ) -> Result<(Entry, Vec<(String, Entry)>)> {
        let (root, trees) = self.tree_at(branch, at).await?;
        let entry = files::find(&trees, root, path)
            .await?
            .ok_or_else(|| Error::NotFound(path.to_string()))?;
        let inside = match &entry {
            Entry::Dir { tree } => trees
                .get(*tree)
                .await?
                .iter()
                .map(|(name, entry)| (name.clone(), entry.clone()))
                .collect(),
            _ => Vec::new(),
        };
        Ok((entry, inside))
    }

    pub async fn list_page(
        &self,
        branch: &str,
        at: Option<Hash>,
        path: &str,
        after: Option<&str>,
        limit: usize,
    ) -> Result<(Entry, Vec<(String, Entry)>)> {
        let (root, trees) = self.tree_at(branch, at).await?;
        let entry = files::find(&trees, root, path)
            .await?
            .ok_or_else(|| Error::NotFound(path.to_string()))?;
        let inside = match &entry {
            Entry::Dir { tree } => trees.page(*tree, after, limit).await?,
            _ => Vec::new(),
        };
        Ok((entry, inside))
    }

    pub async fn read(
        &self,
        branch: &str,
        at: Option<Hash>,
        path: &str,
        offset: u64,
        len: u64,
    ) -> Result<Vec<u8>> {
        let (root, trees) = self.tree_at(branch, at).await?;
        let Some(Entry::File { data, .. }) = files::find(&trees, root, path).await? else {
            return Err(Error::NotFound(path.to_string()));
        };
        files::read(self.objects(), &data, offset, len).await
    }

    pub async fn search(
        &self,
        branch: &str,
        folder: &str,
        pattern: &str,
        limit: usize,
    ) -> Result<Vec<Match>> {
        let pattern = RegexBuilder::new(pattern)
            .size_limit(1 << 20)
            .build()
            .map_err(|error| Error::BadPattern(error.to_string()))?;
        let (root, trees) = self.head_tree(branch).await?;
        let tree = match files::find(&trees, root, folder).await? {
            Some(Entry::Dir { tree }) => tree,
            Some(_) => return Err(Error::NotAFolder(folder.to_string())),
            None => return Err(Error::NotFound(folder.to_string())),
        };
        let prefix: String = files::parts(folder)?
            .iter()
            .map(|part| format!("{part}/"))
            .collect();
        let candidates =
            files::walk(&trees, tree)
                .await?
                .into_iter()
                .filter_map(|(path, entry)| match entry {
                    Entry::File { size, data, .. } if size <= SEARCH_FILE_MAX => {
                        Some((path, data, size))
                    }
                    _ => None,
                });
        let objects = self.objects();
        let mut reads = stream::iter(candidates)
            .map(|(path, data, size)| async move {
                let bytes = files::read(objects, &data, 0, size).await?;
                Ok::<_, Error>((path, bytes))
            })
            .buffered(SEARCH_PARALLELISM);
        let mut found = Vec::new();
        while let Some((path, bytes)) = reads.try_next().await? {
            if bytes.contains(&0) {
                continue;
            }
            for (number, line) in String::from_utf8_lossy(&bytes).lines().enumerate() {
                if pattern.is_match(line) {
                    found.push(Match {
                        path: format!("{prefix}{path}"),
                        line: number + 1,
                        text: line.chars().take(SEARCH_LINE_MAX).collect(),
                    });
                    if found.len() == limit {
                        return Ok(found);
                    }
                }
            }
        }
        Ok(found)
    }

    pub async fn commit_files(
        &self,
        branch: &str,
        message: &str,
        session: Option<&str>,
        edits: Vec<Edit>,
    ) -> Result<Hash> {
        match self.commit_edits(branch, message, session, &edits).await {
            Err(Error::Store(object_store::Error::NotFound { .. })) => {
                self.commit_edits(branch, message, session, &edits).await
            }
            committed => committed,
        }
    }

    async fn commit_edits(
        &self,
        branch: &str,
        message: &str,
        session: Option<&str>,
        edits: &[Edit],
    ) -> Result<Hash> {
        let since = SystemTime::now();
        let store = self.objects().store().as_ref();
        let mut steps = Vec::new();
        let mut sources = Vec::new();
        for edit in edits {
            let step = match &edit.content {
                Content::Bytes(bytes) => {
                    Step::Put(Some(files::store(self.objects(), bytes, edit.mode).await?))
                }
                Content::Chunks(chunks) => {
                    let paths: Vec<_> = chunks.iter().map(|chunk| chunk_path(chunk.hash)).collect();
                    lock::revive(store, &paths).await?;
                    Step::Put(Some(files::file(Data::Chunks(chunks.clone()), edit.mode)))
                }
                Content::From { path, at: Some(at) } => {
                    lock::revive(store, &[commit_path(*at)]).await?;
                    let (root, trees) = self.commit_tree(*at).await?;
                    let entry = files::find(&trees, root, path).await?;
                    sources.push(trees);
                    Step::Put(Some(entry.ok_or(Error::MissingSource(path.clone()))?))
                }
                Content::From { path, at: None } => Step::Copy(path.clone()),
                Content::Folder => Step::Folder,
                Content::Remove => Step::Put(None),
            };
            steps.push((edit.path.clone(), step));
        }
        let mut first: Option<(Trees, Hash)> = None;
        let mut attempt = 1;
        loop {
            let mut position = self.position(branch).await?;
            position.trees.started(since);
            position.session = session.map(str::to_string);
            sources
                .iter()
                .for_each(|trees| position.trees.absorb(trees));
            let base = position.tree;
            if let Some((trees, tree)) = &first {
                unchanged(&steps, (trees, *tree), (&position.trees, base)).await?;
            }
            let mut tree = base;
            for (path, step) in &steps {
                let entry = match step {
                    Step::Put(entry) => entry.clone(),
                    Step::Copy(from) => Some(
                        files::find(&position.trees, base, from)
                            .await?
                            .ok_or_else(|| Error::MissingSource(from.clone()))?,
                    ),
                    Step::Folder => match files::find(&position.trees, tree, path).await? {
                        Some(Entry::Dir { .. }) => continue,
                        Some(_) => return Err(Error::NotAFolder(path.clone())),
                        None => Some(Entry::Dir {
                            tree: position.trees.add(Tree::new())?,
                        }),
                    },
                };
                if let (Some(new), Some(old)) =
                    (&entry, files::find(&position.trees, tree, path).await?)
                    && new.same_content(&old)
                {
                    continue;
                }
                tree = files::put(&position.trees, tree, path, entry).await?;
            }
            if tree == base {
                return self.head_commit(branch).await;
            }
            match self.save(&mut position, tree, Some(message)).await {
                Err(Error::Conflict(_)) if attempt < SAVE_ATTEMPTS => {
                    first.get_or_insert((position.trees, base));
                    backoff(attempt).await;
                    attempt += 1;
                }
                saved => return saved,
            }
        }
    }

    pub async fn store_part(&self, bytes: &[u8]) -> Result<Vec<Chunk>> {
        files::store_chunks(self.objects(), bytes).await
    }

    pub async fn changes_since(
        &self,
        branch: &str,
        since: Option<Hash>,
        limit: usize,
    ) -> Result<Vec<(Hash, Commit, Vec<Change>)>> {
        let mut log = self.recent(branch, limit).await?;
        if let Some(seen) = since.and_then(|since| log.iter().position(|(hash, _)| *hash == since))
        {
            log.truncate(seen);
        }
        log.reverse();
        let changes = try_join_all(log.iter().map(|(_, commit)| self.changes(commit))).await?;
        Ok(log
            .into_iter()
            .zip(changes)
            .map(|((hash, commit), changes)| (hash, commit, changes))
            .collect())
    }
}

async fn unchanged(
    steps: &[(String, Step)],
    before: (&Trees, Hash),
    now: (&Trees, Hash),
) -> Result<()> {
    if before.1 == now.1 {
        return Ok(());
    }
    for (path, step) in steps {
        let source = match step {
            Step::Copy(from) => Some(from),
            _ => None,
        };
        for path in [Some(path), source].into_iter().flatten() {
            let (old, new) = try_join!(
                files::find(before.0, before.1, path),
                files::find(now.0, now.1, path),
            )?;
            let same = match (step, &old, &new) {
                (Step::Folder, old, new) => is_folder(old) == is_folder(new),
                (_, Some(old), Some(new)) => old.same_content(new),
                (_, old, new) => old.is_none() && new.is_none(),
            };
            if !same {
                return Err(Error::EditConflict(path.clone()));
            }
        }
    }
    Ok(())
}

fn is_folder(entry: &Option<Entry>) -> bool {
    matches!(entry, Some(Entry::Dir { .. }))
}
