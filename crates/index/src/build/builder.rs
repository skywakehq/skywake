//! Builds a branch in the background when enough was written, or when the
//! queries it serves want a column layout it does not have.

use std::time::Duration;

use tokio::sync::watch;
use tokio::task::{JoinHandle, JoinSet};

use super::Mode;
use crate::Index;
use crate::layout::Wanted;

#[derive(Clone, Debug)]
pub struct BuildPolicy {
    pub tail_rows: u64,
    pub tail_bytes: u64,
    pub interval: Duration,
}

impl Default for BuildPolicy {
    fn default() -> Self {
        Self {
            tail_rows: 10_000,
            tail_bytes: 64 << 20,
            interval: Duration::from_secs(10),
        }
    }
}

pub struct Builder {
    task: JoinHandle<()>,
    builds: watch::Receiver<u64>,
}

impl Builder {
    pub fn builds(&self) -> u64 {
        *self.builds.borrow()
    }

    pub async fn wait_for(&mut self, count: u64) {
        let _ = self.builds.wait_for(|&builds| builds >= count).await;
    }
}

impl Drop for Builder {
    fn drop(&mut self) {
        self.task.abort();
    }
}

pub(crate) fn spawn(index: Index, policy: BuildPolicy) -> Builder {
    let (count, builds) = watch::channel(0);
    let task = tokio::spawn(async move {
        if let Err(error) = index.storage.inline_head(index.branch()).await {
            tracing::warn!(%error, branch = index.branch(), "could not inline the version");
        }
        let mut failures = 0;
        let mut laid = None;
        let mut calibrating = JoinSet::new();
        loop {
            while calibrating.try_join_next().is_some() {}
            if calibrating.is_empty() && index.calibration_wanted().await {
                let index = index.clone();
                calibrating.spawn(async move {
                    if let Err(error) = index.recalibrate().await {
                        tracing::warn!(%error, branch = index.branch(), "index calibration failed");
                    }
                });
            }
            let next = match due(&index, &policy).await {
                Ok(true) => {
                    laid = None;
                    Ok(Some(Mode::Grow))
                }
                Ok(false) => Ok(relayout(&index, &mut laid).await),
                Err(error) => Err(error),
            };
            match next {
                Ok(None) => failures = 0,
                Ok(Some(mode)) => match built(&index, mode).await {
                    Ok(true) => {
                        failures = 0;
                        count.send_modify(|builds| *builds += 1);
                        continue;
                    }
                    Ok(false) => failures += 1,
                    Err(error) => {
                        tracing::warn!(%error, branch = index.branch(), "index build failed");
                        failures += 1;
                    }
                },
                Err(error) => {
                    tracing::warn!(%error, branch = index.branch(), "could not read the index");
                    failures += 1;
                }
            }
            let wait = match failures {
                0 => policy.interval,
                n => Duration::from_millis(100 << (n - 1).min(7)).min(policy.interval),
            };
            tokio::select! {
                _ = index.written() => {}
                _ = tokio::time::sleep(wait) => {}
            }
        }
    });
    Builder { task, builds }
}

async fn built(index: &Index, mode: Mode) -> crate::Result<bool> {
    let started = std::time::Instant::now();
    tracing::info!(branch = index.branch(), ?mode, "index build started");
    let saved = index.build_inner(mode).await;
    let seconds = started.elapsed().as_secs_f64();
    if let Ok(saved) = saved {
        tracing::info!(
            branch = index.branch(),
            ?mode,
            seconds,
            saved,
            "index build finished"
        );
    }
    saved
}

/// A layout the queries want, once per wanted layout until new rows arrive, so a
/// layout that cannot be reached is not rebuilt again and again.
async fn relayout(index: &Index, laid: &mut Option<Wanted>) -> Option<Mode> {
    let wanted = (index.layout_wanted().await).filter(|wanted| laid.as_ref() != Some(wanted))?;
    let mode = Mode::Layout { sort: wanted.sort };
    *laid = Some(wanted);
    Some(mode)
}

async fn due(index: &Index, policy: &BuildPolicy) -> crate::Result<bool> {
    let version = index.version().await?;
    let tail = version.tail();
    let rows: u64 = tail.iter().map(|segment| segment.rows).sum();
    let bytes: u64 = tail.iter().map(|segment| segment.bytes).sum();
    Ok(!tail.is_empty() && (rows >= policy.tail_rows || bytes >= policy.tail_bytes))
}
