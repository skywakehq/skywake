//! Commands on branches, through the store or skywaked.

use std::path::Path;

use anyhow::{Context, Result, bail};
use skywake_core::{Change, Entry, Merged, Repo};
use skywake_daemon::{Request, Response, call, delete_branch, manifest};

use crate::{Command, daemon};

pub(crate) async fn run(
    repo: &Repo,
    root: &Path,
    via_daemon: bool,
    command: Command,
) -> Result<()> {
    match command {
        Command::New { name, from } if via_daemon => {
            let request = Request::Create {
                branch: name.clone(),
                from,
            };
            if let Response::Committed(commit) = daemon(root, request).await? {
                println!("{name} → {}", &commit[..12]);
            }
        }
        Command::New { name, from } => {
            let commit = repo.create_branch(&name, from.as_deref()).await?;
            println!("{name} → {}", commit.short());
        }
        Command::Commit {
            branch,
            dir,
            message,
            ..
        } => {
            let path = std::path::absolute(&dir)?;
            let request = Request::Commit {
                branch: branch.clone(),
                path,
                message: message.clone(),
            };
            match call(root, &request).await {
                Ok(Response::Committed(commit)) if commit.is_empty() => {
                    println!("{branch}: nothing changed")
                }
                Ok(Response::Committed(commit)) => println!("{branch} → {}", &commit[..12]),
                Ok(Response::Error(error)) => bail!(error),
                _ => {
                    let commit = repo.commit(&branch, &dir, &message).await?;
                    println!("{branch} → {}", commit.short());
                }
            }
        }
        Command::Checkout { branch, dir, .. } => repo.checkout(&branch, &dir).await?,
        Command::Diff { from, to } => {
            for change in repo.diff(&from, &to).await? {
                match change {
                    Change::Added(path) => println!("+ {path}"),
                    Change::Removed(path) => println!("- {path}"),
                    Change::Modified(path) => println!("~ {path}"),
                }
            }
        }
        Command::Merge {
            from,
            into,
            message,
        } => {
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
                        Response::Committed(commit) => Ok(commit[..12].to_string()),
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
        }
        Command::Log { branch } => {
            for (hash, commit) in repo.log(&branch).await? {
                println!("{}  {}", hash.short(), commit.message);
            }
        }
        Command::History { branch, path } => {
            let versions = repo.file_history(&branch, &path).await?;
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
        }
        Command::Branches => {
            for branch in repo.branches().await? {
                println!("{branch}");
            }
        }
        Command::Delete { branch } if via_daemon => {
            daemon(root, Request::Delete { branch }).await?;
        }
        Command::Delete { branch } => delete_branch(repo, &branch).await?,
        Command::Gc {
            grace_minutes,
            dry_run,
        } => {
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
        }
        Command::Recover {
            folder,
            branch,
            message,
        } => {
            let (commit, missing) = match via_daemon {
                true => {
                    let request = Request::Recover {
                        folder: std::path::absolute(&folder)?,
                        branch: branch.clone(),
                        message,
                    };
                    match daemon(root, request).await? {
                        Response::Recovered { commit, missing } => {
                            (commit[..12].to_string(), missing)
                        }
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
                "compare with `skywake diff <branch> {branch}`, then delete {}",
                folder.display()
            );
        }
        _ => unreachable!("not a branch command"),
    }
    Ok(())
}
