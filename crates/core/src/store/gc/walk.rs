//! Following commits, packs and trees to the data they use, for the marking and for each sweep.

use std::collections::HashSet;

use futures::stream::{self, StreamExt, TryStreamExt};

use super::{Lock, held};
use crate::error::missing;
use crate::model::{Bundled, Commit, Data, Entry, Pack, Tree};
use crate::{Hash, Objects, Result};

const PARALLELISM: usize = 64;

const TREES_AT_ONCE: usize = 16;

pub(super) trait Sink {
    async fn seen(&mut self, hash: Hash) -> Result<bool>;
    fn mark(&mut self, hash: Hash) -> Result<()>;
    fn chunk(&mut self, hash: Hash) -> Result<()>;
    fn file(&mut self, file: Bundled) -> Result<()>;
    fn missing(&mut self);
}

async fn first(sink: &mut impl Sink, hash: Hash) -> Result<bool> {
    if sink.seen(hash).await? {
        return Ok(false);
    }
    sink.mark(hash)?;
    Ok(true)
}

pub(super) async fn walk(
    objects: &Objects,
    sink: &mut impl Sink,
    roots: Vec<(Hash, Commit)>,
    lease: &mut Lock<'_>,
) -> Result<()> {
    let mut packs = Vec::new();
    let mut level = roots;
    while !level.is_empty() {
        held(lease).await?;
        let mut parents = Vec::new();
        for (hash, commit) in level {
            if !first(sink, hash).await? {
                continue;
            }
            for tree in &commit.packs.recent {
                chunks_in(sink, tree)?;
            }
            for &(_, pack) in &commit.packs.packed {
                if first(sink, pack).await? {
                    packs.push(pack);
                }
            }
            parents.extend(commit.parents());
        }
        level = commits(objects, sink, parents).await?;
    }
    walk_packs(objects, sink, packs, lease).await
}

pub(super) async fn commits(
    objects: &Objects,
    sink: &mut impl Sink,
    hashes: Vec<Hash>,
) -> Result<Vec<(Hash, Commit)>> {
    let mut todo = Vec::new();
    for hash in hashes.into_iter().collect::<HashSet<_>>() {
        if !sink.seen(hash).await? {
            todo.push(hash);
        }
    }
    let mut found = Vec::new();
    let mut loaded = fetch(todo, PARALLELISM, |hash| objects.get_commit(hash));
    while let Some((hash, commit)) = loaded.try_next().await? {
        match commit {
            Some(commit) => found.push((hash, commit)),
            None => sink.missing(),
        }
    }
    Ok(found)
}

async fn walk_packs(
    objects: &Objects,
    sink: &mut impl Sink,
    mut todo: Vec<Hash>,
    lease: &mut Lock<'_>,
) -> Result<()> {
    while !todo.is_empty() {
        held(lease).await?;
        let mut parts = Vec::new();
        let batch = std::mem::take(&mut todo);
        let mut loaded = fetch(batch, TREES_AT_ONCE, |hash| objects.get::<Pack>(hash));
        while let Some((_, pack)) = loaded.try_next().await? {
            let Some(pack) = pack else {
                sink.missing();
                continue;
            };
            for (_, tree) in &pack.trees {
                chunks_in(sink, tree)?;
            }
            for (_, list) in &pack.sharded {
                for &part in list {
                    if first(sink, part).await? {
                        parts.push(part);
                    }
                }
            }
            for &(_, pack) in &pack.packed {
                if first(sink, pack).await? {
                    todo.push(pack);
                }
            }
        }
        let mut loaded = fetch(parts, TREES_AT_ONCE, |hash| objects.get::<Tree>(hash));
        while let Some((_, part)) = loaded.try_next().await? {
            match part {
                Some(part) => chunks_in(sink, &part)?,
                None => sink.missing(),
            }
        }
    }
    Ok(())
}

fn chunks_in(sink: &mut impl Sink, tree: &Tree) -> Result<()> {
    for entry in tree.values() {
        match entry {
            Entry::File {
                data: Data::Bundled(bundled),
                ..
            } => sink.file(*bundled)?,
            Entry::File { data, .. } => {
                for chunk in data.chunks() {
                    sink.chunk(chunk.hash)?;
                }
            }
            _ => {}
        }
    }
    Ok(())
}

pub(super) fn fetch<T, F>(
    hashes: Vec<Hash>,
    at_once: usize,
    get: impl Fn(Hash) -> F,
) -> impl futures::Stream<Item = Result<(Hash, Option<T>)>>
where
    F: Future<Output = Result<T>>,
{
    stream::iter(hashes)
        .map(move |hash| {
            let got = get(hash);
            async move {
                let value = missing(got.await)?;
                if value.is_none() {
                    tracing::warn!(object = %hash, "garbage collection found a missing object");
                }
                Ok((hash, value))
            }
        })
        .buffer_unordered(at_once)
}
