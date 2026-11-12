//! Garbage collection: deletes data that no branch uses any more.

use std::time::{Duration, SystemTime};

use object_store::ObjectStore;
use object_store::path::Path;

use lock::{Lease, lost};

mod bucket;
pub mod lock;
mod mark;
mod run;
mod slices;
mod sweep;
mod walk;

#[cfg(test)]
mod tests;

use crate::clock::millis;
use crate::retry::random;
use crate::{Error, Objects, Refs, Result};
use bucket::delete;
use run::{Claim, Phase, Run, Shelf};
use sweep::Sweep;

const PARALLELISM: usize = 64;

const BATCH: usize = 1000;

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Collected {
    pub kept: u64,
    pub deleted: u64,
    pub deleted_bytes: u64,
    pub missing: u64,
    pub unknown: u64,
    pub compacted: u64,
    pub slices: u64,
}

type Lock<'a> = Option<Lease<'a>>;

pub(crate) async fn collect(
    objects: &Objects,
    refs: &Refs,
    grace: Duration,
    dry_run: bool,
) -> Result<Collected> {
    collect_in(objects, refs, grace, dry_run, None).await
}

async fn collect_in(
    objects: &Objects,
    refs: &Refs,
    grace: Duration,
    dry_run: bool,
    slices: Option<usize>,
) -> Result<Collected> {
    let collected = match dry_run {
        true => dry(objects, refs, grace, slices).await?,
        false => {
            let mut lease = Some(Lease::join(objects.store().as_ref()).await?);
            let collected = shared(objects, refs, grace, &mut lease, slices).await;
            if let Some(lease) = lease {
                lease.release().await;
            }
            collected?
        }
    };
    metrics::counter!("skywake_gc_deleted_total").increment(collected.deleted);
    Ok(collected)
}

async fn dry(
    objects: &Objects,
    refs: &Refs,
    grace: Duration,
    slices: Option<usize>,
) -> Result<Collected> {
    let shelf = Shelf::local()?;
    let marked = mark::mark(objects, refs, grace, &mut None, &shelf, slices).await?;
    let mut sweep = Sweep::new(objects, refs, grace, None, &shelf, marked.slices);
    for work in 0..marked.slices {
        sweep.slice(work, &mut None).await?;
    }
    Ok(sweep.finish(marked.missing))
}

async fn shared(
    objects: &Objects,
    refs: &Refs,
    grace: Duration,
    lease: &mut Lock<'_>,
    slices: Option<usize>,
) -> Result<Collected> {
    let store = objects.store().as_ref();
    let me = lease.as_ref().map_or(0, Lease::id);
    loop {
        let (current, version) = run::read(store).await?;
        if let Some(current) = current {
            let marking = current.phase == Phase::Marking;
            if marking && lock::alive(store).await?.contains(&current.marker) {
                return Err(Error::CollectionRunning);
            }
            if current.open() {
                return join(objects, refs, grace, lease, current, 0).await;
            }
        }
        let mut new = Run {
            id: random(),
            marker: me,
            phase: Phase::Marking,
            started: millis(SystemTime::now()),
            grace: grace.as_millis() as u64,
            slices: 0,
        };
        let Some(version) = run::write(store, &new, version).await? else {
            continue;
        };
        run::clear(store, |id| id != new.id).await?;
        let shelf = Shelf::Bucket(store, new.id);
        let marked = mark::mark(objects, refs, grace, lease, &shelf, slices).await?;
        tracing::info!(
            slices = marked.slices,
            in_memory = marked.in_memory,
            "garbage collection marked what branches use"
        );
        new.phase = Phase::Sweeping;
        new.slices = marked.slices as u32;
        if run::write(store, &new, Some(version)).await?.is_none() {
            return Err(lost());
        }
        return join(objects, refs, grace, lease, new, marked.missing).await;
    }
}

async fn join(
    objects: &Objects,
    refs: &Refs,
    grace: Duration,
    lease: &mut Lock<'_>,
    run: Run,
    missing: u64,
) -> Result<Collected> {
    let store = objects.store().as_ref();
    let me = lease.as_ref().map_or(0, Lease::id);
    let grace = grace.max(Duration::from_millis(run.grace));
    let shelf = Shelf::Bucket(store, run.id);
    let slices = run.slices as usize;
    let mut sweep = Sweep::new(objects, refs, grace, run.deadline(), &shelf, slices);
    let first = random() as usize % slices;
    let mut busy = Vec::new();
    for step in 0..slices {
        let work = (first + step) % slices;
        let name = format!("slice-{work}");
        match run::claim(store, run.id, &name, me).await? {
            Claim::Taken(version) => {
                sweep.slice(work, lease).await?;
                run::done(store, run.id, &name, me, version).await?;
                sweep.collected.slices += 1;
            }
            Claim::Done => {}
            Claim::Busy => busy.push(name),
        }
    }
    for name in busy {
        if !run::is_done(store, run.id, &name).await? {
            return Ok(sweep.finish(missing));
        }
    }
    end(store, lease, &run, me).await?;
    Ok(sweep.finish(missing))
}

async fn end(store: &dyn ObjectStore, lease: &mut Lock<'_>, run: &Run, me: u64) -> Result<()> {
    let Claim::Taken(version) = run::claim(store, run.id, "end", me).await? else {
        return Ok(());
    };
    let expired = Shelf::Bucket(store, run.id).get("expired").await?;
    let expired = String::from_utf8_lossy(&expired)
        .lines()
        .map(Path::from)
        .collect();
    if let Some(lease) = lease {
        remove(store, lease, expired).await?;
    }
    run::done(store, run.id, "end", me, version).await?;
    let (current, version) = run::read(store).await?;
    if current.is_some_and(|current| current.id == run.id) {
        let done = Run {
            phase: Phase::Done,
            ..run.clone()
        };
        run::write(store, &done, version).await?;
    }
    run::clear(store, |id| id == run.id).await
}

async fn remove(store: &dyn ObjectStore, lease: &mut Lease<'_>, paths: Vec<Path>) -> Result<()> {
    if paths.is_empty() {
        return Ok(());
    }
    if !lease.keep().await {
        return Err(lost());
    }
    lease.deleting(true).await?;
    let deleted = lease.within(delete(store, paths)).await;
    let unmarked = lease.deleting(false).await;
    deleted.and(unmarked)
}

async fn mark(lease: &mut Lock<'_>, deleting: bool) -> Result<()> {
    match lease {
        Some(lease) => lease.deleting(deleting).await,
        None => Ok(()),
    }
}

async fn held(lease: &mut Lock<'_>) -> Result<()> {
    if let Some(lease) = lease
        && !lease.keep().await
    {
        return Err(lost());
    }
    Ok(())
}
