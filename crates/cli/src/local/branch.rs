use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use skywake_core::{Change, Entry, Merged, Repo};
use skywake_daemon::{Request, Response, call, delete_branch, manifest};

use super::daemon;

pub(crate) enum Op {
    Fork {
        name: String,
        from: Option<String>,
    },
    Upload {
        branch: String,
        dir: PathBuf,
        message: String,
    },
    Download {
        branch: String,
        dir: PathBuf,
    },
    Diff {
        from: String,
        to: String,
    },
    Merge {
        from: String,
        into: String,
        message: Option<String>,
    },
    Log {
        branch: String,
        limit: Option<usize>,
    },
    History {
        branch: String,
        path: String,
    },
    Branches,
    Destroy {
        branch: String,
    },
    Gc {
        grace_minutes: u64,
        dry_run: bool,
    },
    Recover {
        folder: PathBuf,
        branch: String,
        message: String,
    },
}

impl Op {
    pub(crate) fn makes(&self) -> bool {
        matches!(
            self,
            Op::Fork { .. } | Op::Upload { .. } | Op::Recover { .. }
        )
    }
}

pub(crate) async fn run(repo: &Repo, root: &Path, via_daemon: bool, op: Op) -> Result<()> {
    match op {
        Op::Fork { name, from } => fork(repo, root, via_daemon, name, from).await,
        Op::Upload {
            branch,
            dir,
            message,
        } => upload(repo, root, branch, dir, message).await,
        Op::Download { branch, dir } => Ok(repo.checkout(&branch, &dir).await?),
        Op::Diff { from, to } => {
            for change in repo.diff(&from, &to).await? {
                match change {
                    Change::Added(path) => println!("+ {path}"),
                    Change::Removed(path) => println!("- {path}"),
                    Change::Modified(path) => println!("~ {path}"),
                }
            }
            Ok(())
        }
        Op::Merge {
            from,
            into,
            message,
        } => merge(repo, root, via_daemon, from, into, message).await,
        Op::Log { branch, limit } => {
            let log = repo.log(&branch).await?;
            for (hash, commit) in log.into_iter().take(limit.unwrap_or(usize::MAX)) {
                println!("{}  {}", hash.short(), commit.message);
            }
            Ok(())
        }
        Op::History { branch, path } => history(repo, &branch, &path).await,
        Op::Branches => {
            for branch in repo.branches().await? {
                println!("{branch}");
            }
            Ok(())
        }
        Op::Destroy { branch } if via_daemon => {
            daemon(root, Request::Delete { branch }).await.map(drop)
        }
        Op::Destroy { branch } => Ok(delete_branch(repo, &branch).await?),
        Op::Gc {
            grace_minutes,
            dry_run,
        } => gc(repo, grace_minutes, dry_run).await,
        Op::Recover {
            folder,
            branch,
            message,
        } => recover(repo, root, via_daemon, folder, branch, message).await,
    }
}

async fn fork(
    repo: &Repo,
    root: &Path,
    via_daemon: bool,
    name: String,
    from: Option<String>,
) -> Result<()> {
    if via_daemon {
        let request = Request::Create {
            branch: name.clone(),
            from,
        };
        if let Response::Committed(commit) = daemon(root, request).await? {
            println!("{name} → {}", short(&commit));
        }
        return Ok(());
    }
    let commit = repo.create_branch(&name, from.as_deref()).await?;
    println!("{name} → {}", commit.short());
    Ok(())
}

async fn upload(
    repo: &Repo,
    root: &Path,
    branch: String,
    dir: PathBuf,
    message: String,
) -> Result<()> {
    let request = Request::Commit {
        branch: branch.clone(),
        path: std::path::absolute(&dir)?,
        message: message.clone(),
    };
    match call(root, &request).await {
        Ok(Response::Committed(commit)) if commit.is_empty() => {
            println!("{branch}: nothing changed")
        }
        Ok(Response::Committed(commit)) => println!("{branch} → {}", short(&commit)),
        Ok(Response::Error(error)) => bail!(error),
        _ => {
            if !repo.branches().await?.contains(&branch) {
                repo.create_branch(&branch, None).await?;
            }
            let commit = repo.commit(&branch, &dir, &message).await?;
            println!("{branch} → {}", commit.short());
        }
    }
    Ok(())
}

async fn merge(
    repo: &Repo,
    root: &Path,
    via_daemon: bool,
    from: String,
    into: String,
    message: Option<String>,
) -> Result<()> {
    let message = message.unwrap_or_else(|| format!("Merge {from} into {into}"));
    let merged = match via_daemon {
        true => {
            let request = Request::Merge {
                from,
                into: into.clone(),
                message,
            };
            match daemon(root, request).await? {
                Response::Conflicts(paths) => Err(paths),
                Response::Committed(commit) => Ok(short(&commit).to_string()),
                other => bail!("unexpected answer from skywaked: {other:?}"),
            }
        }
        false => match repo.merge(&into, &from, &message, None).await? {
            Merged::Done(commit) => Ok(commit.short()),
            Merged::Conflicts(paths) => Err(paths),
        },
    };
    match merged {
        Ok(commit) => println!("{into} → {commit}"),
        Err(paths) => {
            for path in paths {
                println!("conflict: {path}");
            }
            bail!("nothing was merged");
        }
    }
    Ok(())
}

async fn history(repo: &Repo, branch: &str, path: &str) -> Result<()> {
    let versions = repo.file_history(branch, path).await?;
    if versions.is_empty() {
        bail!("`{path}` was never on {branch}");
    }
    for (hash, commit, entry) in versions {
        let size = match entry {
            Some(Entry::File { size, .. }) => format!("{size} bytes"),
            Some(Entry::Dir { .. }) => "folder".to_string(),
            Some(Entry::Symlink { target }) => format!("link to {target}"),
            None => "deleted".to_string(),
        };
        println!("{}  {size}  {}", hash.short(), commit.message);
    }
    Ok(())
}

async fn gc(repo: &Repo, grace_minutes: u64, dry_run: bool) -> Result<()> {
    if grace_minutes < 2 * 24 * 60 {
        eprintln!(
            "warning: a grace period under 2 days can delete data that a running save or fork still needs; use it only when nothing writes to the store"
        );
    }
    let grace = std::time::Duration::from_secs(grace_minutes * 60);
    let collected = repo.collect_garbage(grace, dry_run).await?;
    let (verb, compact) = match dry_run {
        true => ("would delete", "would compact"),
        false => ("deleted", "compacted"),
    };
    println!(
        "kept {} objects, {verb} {}, {compact} {} bundles ({:.1} MB freed)",
        collected.kept,
        collected.deleted,
        collected.compacted,
        collected.deleted_bytes as f64 / 1e6
    );
    Ok(())
}

async fn recover(
    repo: &Repo,
    root: &Path,
    via_daemon: bool,
    folder: PathBuf,
    branch: String,
    message: String,
) -> Result<()> {
    let (commit, missing) = match via_daemon {
        true => {
            let request = Request::Recover {
                folder: std::path::absolute(&folder)?,
                branch: branch.clone(),
                message,
            };
            match daemon(root, request).await? {
                Response::Recovered { commit, missing } => (short(&commit).to_string(), missing),
                other => bail!("unexpected answer from skywaked: {other:?}"),
            }
        }
        false => {
            let (commit, missing) = manifest::recover(repo, &folder, &branch, &message)
                .await
                .with_context(|| format!("can't recover from `{}`", folder.display()))?;
            (commit.short(), missing)
        }
    };
    for path in missing {
        eprintln!("left out {path}: its copy is missing");
    }
    println!("{branch} → {commit}");
    println!(
        "compare with `skywake diff --local @{branch} <branch>`, then delete {}",
        folder.display()
    );
    Ok(())
}

fn short(commit: &str) -> &str {
    commit.get(..12).unwrap_or(commit)
}
