//! The write log of a mount: fsync answers once changes are on the cache tier, and a new mount replays them.

use std::sync::Arc;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use skywake_core::cache::{LogError, LogRecord, WriteLog};
use skywake_core::{Claim, Hash, Repo};
use skywake_mount::{BranchFs, Op};
use tracing::{info, warn};

pub(crate) struct Log {
    store: Arc<WriteLog>,
    key: String,
    claim: u64,
    progress: tokio::sync::Mutex<Progress>,
}

#[derive(Default)]
struct Progress {
    next: u64,
    marker: Option<(u64, u64)>,
    lost: u64,
    unmarked: bool,
}

#[derive(Serialize, Deserialize)]
struct Marker {
    tree: Hash,
    through: u64,
}

#[derive(Serialize, Deserialize)]
struct Entry {
    marker: Option<Marker>,
    ops: Vec<(u64, Op)>,
}

impl Log {
    pub(crate) async fn open(
        store: Arc<WriteLog>,
        key: String,
        claim: u64,
        head_tree: Hash,
    ) -> Result<(Self, Vec<Op>)> {
        let records = store.seal(&key, claim).await.map_err(|error| match error {
            LogError::Unreachable => {
                anyhow::anyhow!("can't reach the cache nodes that hold this branch's write log")
            }
            LogError::TakenOver => anyhow::anyhow!("a newer mount of this branch exists"),
        })?;
        let ops = unsaved(records, head_tree)?;
        let log = Self {
            store,
            key,
            claim,
            progress: Default::default(),
        };
        Ok((log, ops))
    }

    pub(crate) async fn sync(&self, fs: &BranchFs) -> bool {
        let mut progress = self.progress.lock().await;
        let taken = fs.take_ops();
        progress.lost = progress.lost.max(taken.lost);
        let Some(last) = taken.ops.last().map(|(tag, _)| *tag) else {
            return progress.usable();
        };
        if !progress.usable() {
            progress.lost = last;
            return false;
        }
        let entry = Entry {
            marker: None,
            ops: taken.ops,
        };
        match self.append(&mut progress, &entry, last).await {
            Ok(()) => true,
            Err(error) => {
                warn!(%error, "can't add to the write log; fsync waits for the bucket");
                progress.lost = last;
                false
            }
        }
    }

    // Marked before the save lands, so a new mount can tell which changes the bucket holds.
    pub(crate) async fn mark(&self, tree: Hash, through: u64, needed: bool) -> Option<u64> {
        let mut progress = self.progress.lock().await;
        if progress.lost > through || (!needed && !progress.unmarked) {
            return None;
        }
        let n = progress.next;
        let entry = Entry {
            marker: Some(Marker { tree, through }),
            ops: Vec::new(),
        };
        match self.append(&mut progress, &entry, through).await {
            Ok(()) => Some(n),
            Err(error) => {
                warn!(%error, "can't add to the write log");
                None
            }
        }
    }

    pub(crate) async fn saved(&self, n: u64, through: u64) {
        {
            let mut progress = self.progress.lock().await;
            if progress.marker.is_none_or(|(at, _)| at < n) {
                progress.marker = Some((n, through));
                progress.unmarked = progress.next > n + 1;
            }
        }
        self.store.trim(&self.key, self.claim, n, through).await;
    }

    pub(crate) async fn clear(&self) {
        self.store
            .trim(&self.key, self.claim, u64::MAX, u64::MAX)
            .await;
    }

    pub(crate) async fn settle(&self, tree: Hash, through: u64, needed: bool) {
        if let Some(n) = self.mark(tree, through, needed).await {
            self.saved(n, through).await;
        }
    }

    async fn append(&self, progress: &mut Progress, entry: &Entry, max_tag: u64) -> Result<()> {
        let record = LogRecord {
            claim: self.claim,
            n: progress.next,
            max_tag,
            data: postcard::to_stdvec(entry)?,
        };
        progress.next += 1;
        self.store.append(&self.key, &record).await?;
        progress.unmarked = true;
        Ok(())
    }
}

pub(crate) async fn catch_up(
    log: &Log,
    repo: &Repo,
    claim: &mut Claim,
    fs: &BranchFs,
    ignored: &[String],
) -> Result<u64> {
    let mut save = fs.save(ignored).await?;
    for tree in std::mem::take(&mut save.trees) {
        claim.trees.add(tree)?;
    }
    if save.root != claim.tree {
        repo.save(claim, save.root, None).await?;
    }
    fs.committed(&save);
    log.settle(save.root, save.as_of(), true).await;
    fs.start_log();
    Ok(claim.seq())
}

impl Progress {
    fn usable(&self) -> bool {
        self.marker.is_some_and(|(_, through)| self.lost <= through)
    }
}

fn unsaved(records: Vec<LogRecord>, head_tree: Hash) -> Result<Vec<Op>> {
    let Some(newest) = records.iter().map(|record| record.claim).max() else {
        return Ok(Vec::new());
    };
    let mut entries = Vec::new();
    for record in records.into_iter().filter(|record| record.claim == newest) {
        let entry: Entry = postcard::from_bytes(&record.data)
            .context("a write log record this version can't read")?;
        entries.push(entry);
    }
    let through = entries
        .iter()
        .rev()
        .filter_map(|entry| entry.marker.as_ref())
        .find(|marker| marker.tree == head_tree)
        .map(|marker| marker.through);
    let Some(through) = through else {
        return Ok(Vec::new());
    };
    let ops: Vec<Op> = entries
        .into_iter()
        .flat_map(|entry| entry.ops)
        .filter(|(tag, _)| *tag > through)
        .map(|(_, op)| op)
        .collect();
    if !ops.is_empty() {
        info!(changes = ops.len(), "replaying changes from the write log");
    }
    Ok(ops)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(claim: u64, n: u64, entry: Entry) -> LogRecord {
        LogRecord {
            claim,
            n,
            max_tag: 0,
            data: postcard::to_stdvec(&entry).unwrap(),
        }
    }

    fn write(tag: u64, path: &str) -> (u64, Op) {
        let op = Op::Write {
            path: path.into(),
            offset: 0,
            data: b"x".to_vec(),
        };
        (tag, op)
    }

    fn marked(tree: Hash, through: u64) -> Entry {
        Entry {
            marker: Some(Marker { tree, through }),
            ops: Vec::new(),
        }
    }

    #[test]
    fn replays_only_changes_after_the_marker_of_the_head() {
        let (old, head) = (Hash::of(b"old"), Hash::of(b"head"));
        let records = vec![
            record(3, 0, marked(old, 0)),
            record(
                3,
                1,
                Entry {
                    marker: None,
                    ops: vec![write(1, "a"), write(2, "b")],
                },
            ),
            record(3, 2, marked(head, 2)),
            record(
                3,
                3,
                Entry {
                    marker: None,
                    ops: vec![write(3, "c")],
                },
            ),
            record(
                2,
                9,
                Entry {
                    marker: None,
                    ops: vec![write(9, "stale")],
                },
            ),
        ];
        let ops = unsaved(records, head).unwrap();
        assert_eq!(ops, vec![write(3, "c").1]);
    }

    #[test]
    fn a_head_newer_than_every_marker_needs_nothing() {
        let records = vec![
            record(3, 0, marked(Hash::of(b"old"), 0)),
            record(
                3,
                1,
                Entry {
                    marker: None,
                    ops: vec![write(1, "a")],
                },
            ),
        ];
        assert!(unsaved(records, Hash::of(b"newer")).unwrap().is_empty());
    }
}
