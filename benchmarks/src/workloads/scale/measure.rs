//! The timed operations, each run against a fresh client so nothing is cached, and how each one grows with size.

use std::time::{Duration, Instant};

use anyhow::Result;
use serde::{Deserialize, Serialize};
use skywake_core::{Content, Edit, FILE_MODE, Repo};

use super::synth::{BRANCH, Made};
use crate::metrics::requests::{Log, Op, count};
use crate::stores::Store;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Operation {
    OpenRoot,
    OpenDeep,
    CommitSame,
    CommitOne,
    Fork,
}

impl Operation {
    pub(crate) const ALL: [Operation; 5] = [
        Operation::OpenRoot,
        Operation::OpenDeep,
        Operation::CommitSame,
        Operation::CommitOne,
        Operation::Fork,
    ];

    pub(crate) fn label(self) -> &'static str {
        match self {
            Operation::OpenRoot => "open the root folder (a mount)",
            Operation::OpenDeep => "read the deepest file",
            Operation::CommitSame => "commit, nothing changed",
            Operation::CommitOne => "commit, one file changed",
            Operation::Fork => "fork the branch",
        }
    }

    async fn run(self, repo: &Repo, made: &Made, round: usize) -> Result<()> {
        match self {
            Operation::OpenRoot => drop(repo.list(BRANCH, None, "").await?),
            Operation::OpenDeep => drop(repo.read(BRANCH, None, &made.deep, 0, 1).await?),
            Operation::CommitSame => {
                let mut claim = repo.claim(BRANCH).await?;
                let tree = claim.tree;
                repo.save(&mut claim, tree, Some("nothing changed")).await?;
            }
            Operation::CommitOne => {
                let edit = Edit {
                    path: made.edited.clone(),
                    content: Content::Bytes(format!("round {round}").into_bytes()),
                    mode: FILE_MODE,
                };
                repo.commit_files(BRANCH, "one file", None, vec![edit])
                    .await?;
            }
            Operation::Fork => drop(
                repo.create_branch(&format!("fork-{round}"), Some(BRANCH))
                    .await?,
            ),
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Default, Serialize, Deserialize)]
pub(crate) struct Sample {
    pub ms: f64,
    pub requests: u64,
    pub lists: u64,
}

impl Sample {
    pub(crate) fn of(log: &Log, took: Duration) -> Self {
        let requests = log.take();
        Self {
            ms: took.as_secs_f64() * 1e3,
            requests: requests.len() as u64,
            lists: count(&requests, Op::List),
        }
    }
}

pub(crate) async fn sample(
    store: &Store,
    made: &Made,
    operation: Operation,
    runs: usize,
) -> Result<Sample> {
    let mut samples = Vec::with_capacity(runs);
    for round in 0..runs {
        let repo = Repo::new(store.store.clone());
        store.log.take();
        let started = Instant::now();
        operation.run(&repo, made, round).await?;
        samples.push(Sample::of(&store.log, started.elapsed()));
    }
    samples.sort_by(|a, b| a.ms.total_cmp(&b.ms));
    Ok(samples[samples.len() / 2])
}

#[derive(Clone, Copy, Default, Serialize, Deserialize)]
pub(crate) struct Collection {
    pub ms: f64,
    pub requests: u64,
    pub lists: u64,
    pub peak_bytes: u64,
    pub kept: u64,
}

pub(crate) fn growth(sizes: &[u64], values: &[f64]) -> Option<f64> {
    let (&first_size, &last_size) = (sizes.first()?, sizes.last()?);
    let (&first, &last) = (values.first()?, values.last()?);
    if last_size <= first_size || first <= 0.0 || last <= 0.0 {
        return None;
    }
    Some((last / first).ln() / (last_size as f64 / first_size as f64).ln())
}

#[cfg(test)]
mod tests {
    use super::growth;

    #[test]
    fn growth_is_the_exponent_of_size() {
        let sizes = [1_000, 100_000];
        assert_eq!(growth(&sizes, &[5.0, 5.0]), Some(0.0));
        assert!((growth(&sizes, &[1.0, 100.0]).unwrap() - 1.0).abs() < 1e-9);
        assert!((growth(&sizes, &[1.0, 10.0]).unwrap() - 0.5).abs() < 1e-9);
        assert_eq!(growth(&sizes[..1], &[1.0]), None);
    }
}
