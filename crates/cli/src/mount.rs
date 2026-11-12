//! Commands on mounts, through skywaked.

use std::path::Path;

use anyhow::Result;
use skywake_daemon::{Request, Response};

use crate::{Command, daemon};

pub(crate) async fn run(root: &Path, command: Command) -> Result<()> {
    match command {
        Command::Mount {
            branch,
            mountpoint,
            vm,
            read_only,
            fork,
            owner,
            allow_other,
        } => {
            let path = std::path::absolute(&mountpoint)?;
            let branch = match fork {
                Some(fork) => {
                    let request = Request::Create {
                        branch: fork.clone(),
                        from: Some(branch),
                    };
                    daemon(root, request).await?;
                    fork
                }
                None => branch,
            };
            let request = Request::Mount {
                branch,
                path,
                vm,
                read_only,
                owner,
                allow_other,
            };
            daemon(root, request).await?;
        }
        Command::Sync { mountpoint } => {
            let path = std::path::absolute(&mountpoint)?;
            daemon(root, Request::Sync { path }).await?;
        }
        Command::Unmount { mountpoint } => {
            let path = std::path::absolute(&mountpoint)?;
            daemon(root, Request::Unmount { path }).await?;
        }
        Command::Mounts => {
            if let Response::Mounts(mounts) = daemon(root, Request::List).await? {
                for mount in mounts {
                    let note = match (mount.moved, mount.read_only) {
                        (true, _) => "  (moved to another machine)",
                        (false, true) => "  (read-only)",
                        (false, false) => "",
                    };
                    println!("{}  {}{note}", mount.branch, mount.path.display());
                }
            }
        }
        Command::Status => {
            if let Response::Status(status) = daemon(root, Request::Status).await? {
                for mount in &status.mounts {
                    let state = match (mount.moved, mount.read_only) {
                        (true, _) => "moved",
                        (false, true) => "read-only",
                        (false, false) => "ok",
                    };
                    println!(
                        "{}  {}  {state}  lag {:.1}s  unsaved {}",
                        mount.branch,
                        mount.path.display(),
                        mount.save_lag_ms as f64 / 1000.0,
                        bytes(mount.unsaved_bytes)
                    );
                    if let Some(error) = &mount.last_error {
                        println!("  last save failed: {error}");
                    }
                }
                let reads = status.cache_hits + status.cache_misses;
                let hit_rate = match reads {
                    0 => 0.0,
                    _ => 100.0 * status.cache_hits as f64 / reads as f64,
                };
                println!(
                    "chunk cache: {} of {}, {hit_rate:.1}% of {reads} reads from disk",
                    bytes(status.cache_bytes),
                    bytes(status.cache_max_bytes)
                );
            }
        }
        _ => unreachable!("not a mount command"),
    }
    Ok(())
}

fn bytes(count: u64) -> String {
    match count {
        0..1_000_000 => format!("{:.1} kB", count as f64 / 1e3),
        _ => format!("{:.1} MB", count as f64 / 1e6),
    }
}
