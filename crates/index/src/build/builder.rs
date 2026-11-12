//! Builds a branch in the background when enough was written.

use std::time::Duration;

use tokio::sync::watch;
use tokio::task::JoinHandle;

use crate::Index;

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
        let mut failures = 0;
        loop {
            match due(&index, &policy).await {
                Ok(false) => failures = 0,
                Ok(true) => match index.build_inner(false).await {
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

async fn due(index: &Index, policy: &BuildPolicy) -> crate::Result<bool> {
    let version = index.version().await?;
    let tail = version.tail();
    let rows: u64 = tail.iter().map(|segment| segment.rows).sum();
    let bytes: u64 = tail.iter().map(|segment| segment.bytes).sum();
    Ok(!tail.is_empty() && (rows >= policy.tail_rows || bytes >= policy.tail_bytes))
}
