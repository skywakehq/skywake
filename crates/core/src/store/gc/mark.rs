//! Marking: what branches, deleted branches and young commits use, kept on disk and published by slice.

use std::collections::HashSet;
use std::time::{Duration, Instant};

use chrono::Utc;
use futures::TryStreamExt;
use object_store::ObjectStoreExt;
use object_store::path::Path;

use super::bucket::{hash, old, read_all, recent};
use super::run::Shelf;
use super::slices::{SLICES, Spill, contains, encode_file, files, hashes};
use super::walk::{Sink, commits, walk};
use super::{BATCH, Lock, held};
use crate::model::{Bundled, Commit};
use crate::store::bundles::{MOVES_MAX, Moved, moved_path};
use crate::store::io::found;
use crate::store::objects::{OBJECT_LIMIT, decode};
use crate::store::open::PROBES;
use crate::store::refs::DELETED;
use crate::{Error, Hash, Objects, Refs, Result};

const TARGET: u64 = 1 << 16;

pub(super) struct Marked {
    pub(super) slices: usize,
    pub(super) missing: u64,
    pub(super) in_memory: usize,
}

struct Marking {
    seen: HashSet<Hash>,
    chunks: Spill,
    names: Spill,
    files: Spill,
    missing: u64,
}

impl Sink for Marking {
    async fn seen(&mut self, hash: Hash) -> Result<bool> {
        Ok(self.seen.contains(&hash))
    }

    fn mark(&mut self, hash: Hash) -> Result<()> {
        self.seen.insert(hash);
        Ok(self.names.hash(hash)?)
    }

    fn chunk(&mut self, hash: Hash) -> Result<()> {
        Ok(self.chunks.hash(hash)?)
    }

    fn file(&mut self, file: Bundled) -> Result<()> {
        Ok(self.files.file(&file)?)
    }

    fn missing(&mut self) {
        self.missing += 1;
    }
}

pub(super) async fn mark(
    objects: &Objects,
    refs: &Refs,
    grace: Duration,
    lease: &mut Lock<'_>,
    shelf: &Shelf<'_>,
    slices: Option<usize>,
) -> Result<Marked> {
    let started = Instant::now();
    let store = objects.store().as_ref();
    let mut marking = Marking {
        seen: HashSet::new(),
        chunks: Spill::new()?,
        names: Spill::new()?,
        files: Spill::new()?,
        missing: 0,
    };
    let mut expired = Vec::new();

    let heads = refs.heads().await?;
    let deleted = recent(store, DELETED, grace, &mut expired).await?;
    let deleted: Vec<Commit> = read_all(store, deleted).await?;
    recent(store, PROBES, grace, &mut expired).await?;
    let mut roots = Vec::new();
    for commit in heads.into_iter().chain(deleted) {
        roots.push((Objects::address(&commit)?, commit));
    }
    walk(objects, &mut marking, roots, lease).await?;

    // Young commits no branch names yet may be named soon, so what they use stays too.
    let now = Utc::now();
    let mut young = Vec::new();
    let mut listing = store.list(Some(&Path::from("commits")));
    while let Some(meta) = listing.try_next().await? {
        if !old(&meta, now, grace)
            && let Some(hash) = hash(&meta)
        {
            young.push(hash);
        }
    }
    let young = commits(objects, &mut marking, young).await?;
    walk(objects, &mut marking, young, lease).await?;
    let mut live = resolve(objects, &mut marking, lease).await?;

    if !grace.is_zero() && started.elapsed() > grace / 2 {
        return Err(Error::Collection(
            "marking took longer than half the grace period; nothing was deleted".into(),
        ));
    }
    let most = (marking.chunks.count)
        .max(marking.names.count)
        .max(live.count);
    let slices = slices
        .unwrap_or((most / TARGET + 1) as usize)
        .clamp(1, SLICES)
        .next_power_of_two();
    publish(shelf, &mut marking, &mut live, slices, lease).await?;
    let expired: Vec<String> = expired.iter().map(ToString::to_string).collect();
    shelf.put("expired", expired.join("\n").as_bytes()).await?;
    Ok(Marked {
        slices,
        missing: marking.missing,
        in_memory: marking.seen.len(),
    })
}

enum Moves {
    Absent,
    Bad,
    Record(Moved),
}

async fn resolve(objects: &Objects, marking: &mut Marking, lease: &mut Lock<'_>) -> Result<Spill> {
    let store = objects.store().as_ref();
    let mut listed = Spill::new()?;
    let mut listing = store.list(Some(&Path::from("bundles")));
    let mut count = 0;
    while let Some(meta) = listing.try_next().await? {
        if let Some(bundle) = hash(&meta) {
            listed.hash(bundle)?;
        }
        count += 1;
        if count % BATCH == 0 {
            held(lease).await?;
        }
    }

    let mut live = Spill::new()?;
    let mut pending = std::mem::replace(&mut marking.files, Spill::new()?);
    for _ in 0..MOVES_MAX {
        let mut next = Spill::new()?;
        for slice in 0..SLICES {
            let todo = files(&pending.take(slice)?);
            if todo.is_empty() {
                continue;
            }
            held(lease).await?;
            let present = hashes(&listed.read(slice)?);
            let mut moves: Option<(Hash, Moves)> = None;
            for at in todo {
                if contains(&present, at.bundle) {
                    keep(marking, &mut live, &at)?;
                    continue;
                }
                if moves
                    .as_ref()
                    .is_none_or(|(bundle, _)| *bundle != at.bundle)
                {
                    moves = Some((at.bundle, read_moved(objects, at.bundle).await?));
                }
                match moves.as_ref().map(|(_, moves)| moves) {
                    // Not listed and never moved: written since the listing, so it stays.
                    Some(Moves::Absent) => keep(marking, &mut live, &at)?,
                    Some(Moves::Record(moved)) => match moved.find(&at) {
                        Some(to) => {
                            marking.names.hash(at.bundle)?;
                            next.file(&to)?;
                        }
                        None => marking.missing += 1,
                    },
                    _ => marking.missing += 1,
                }
            }
        }
        pending = next;
        if pending.count == 0 {
            break;
        }
    }
    marking.missing += pending.count;
    Ok(live)
}

fn keep(marking: &mut Marking, live: &mut Spill, at: &Bundled) -> Result<()> {
    marking.names.hash(at.bundle)?;
    Ok(live.file(at)?)
}

async fn read_moved(objects: &Objects, bundle: Hash) -> Result<Moves> {
    let path = moved_path(bundle);
    let Some(object) = found(objects.store().get(&path).await)? else {
        return Ok(Moves::Absent);
    };
    let stored = object.bytes().await?;
    match decode(&path, &stored, OBJECT_LIMIT) {
        Ok(raw) => Ok(Moves::Record(postcard::from_bytes(&raw)?)),
        Err(Error::Corrupt(_)) => Ok(Moves::Bad),
        Err(error) => Err(error),
    }
}

async fn publish(
    shelf: &Shelf<'_>,
    marking: &mut Marking,
    live: &mut Spill,
    slices: usize,
    lease: &mut Lock<'_>,
) -> Result<()> {
    let per = SLICES / slices;
    for work in 0..slices {
        held(lease).await?;
        let (mut chunks, mut names, mut small) = (Vec::new(), Vec::new(), Vec::new());
        for slice in work * per..(work + 1) * per {
            for hash in hashes(&marking.chunks.take(slice)?) {
                chunks.extend_from_slice(hash.as_bytes());
            }
            for hash in hashes(&marking.names.take(slice)?) {
                names.extend_from_slice(hash.as_bytes());
            }
            for file in files(&live.take(slice)?) {
                small.extend_from_slice(&encode_file(&file));
            }
        }
        shelf.put(&format!("chunks-{work}"), &chunks).await?;
        shelf.put(&format!("names-{work}"), &names).await?;
        shelf.put(&format!("files-{work}"), &small).await?;
    }
    Ok(())
}
