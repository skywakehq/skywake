mod branch;
mod mount;

use std::path::Path;
use std::sync::Arc;

use anyhow::{Result, anyhow, bail};
use skywake_core::{HeadNodes, HeadsAt, Repo, granted_heads, open_store, remember_checks};
use skywake_daemon::{Request, Response, call, socket_path};

use crate::cli::{Command, Create, Global};
use crate::session::confirm;
use crate::target::MAIN;
use branch::Op;

const DEFAULT_STORE: &str = ".skywake";

pub(crate) fn is_mount(command: &Command) -> bool {
    matches!(
        command,
        Command::Mount { .. }
            | Command::Sync { .. }
            | Command::Unmount { .. }
            | Command::Mounts
            | Command::Status
    )
}

pub(crate) async fn mounts(global: &Global, command: Command) -> Result<()> {
    mount::run(&global.root, command).await
}

pub(crate) async fn run(global: &Global, command: Command) -> Result<()> {
    let op = op(command)?;
    let named = std::env::var("SKYWAKE_STORE").ok();
    let chosen = [global.local.as_deref(), named.as_deref()]
        .into_iter()
        .flatten()
        .find(|store| !store.is_empty());
    let via_daemon = chosen.is_none() && socket_path(&global.root).exists();
    let store = chosen.unwrap_or(DEFAULT_STORE);
    if chosen.is_none() && !via_daemon && !op.makes() && !Path::new(store).exists() {
        bail!(
            "no store here: `{DEFAULT_STORE}` does not exist. Pass --local DIR, or upload to make one"
        );
    }
    remember_checks(global.root.join("checked-stores"));
    let repo = open(global, store).await?;
    branch::run(&repo, &global.root, via_daemon, op).await
}

async fn open(global: &Global, store: &str) -> Result<Repo> {
    let repo = Repo::new(open_store(store)?).with_cache(global.root.join("objects"));
    if let Some(nodes) = granted_heads(store).await? {
        return Ok(repo.with_head_nodes(Arc::new(nodes)));
    }
    if global.heads != HeadsAt::Tier {
        return Ok(repo);
    }
    let token = global.cache_token.clone().filter(|token| !token.is_empty());
    let nodes = HeadNodes::new(global.cache_nodes.clone(), token)
        .ok_or_else(|| anyhow!("--heads tier needs SKYWAKE_CACHE_NODES"))?;
    Ok(repo.with_head_nodes(Arc::new(nodes)))
}

fn op(command: Command) -> Result<Op> {
    Ok(match command {
        Command::Create {
            what: Create::Disk { name, .. },
        } => Op::Fork {
            name: branch_of(&name),
            from: None,
        },
        Command::Fork { target, new, from } => Op::Fork {
            name: new,
            from: Some(from.unwrap_or_else(|| branch_of(&target))),
        },
        Command::Upload {
            dir,
            target,
            message,
        } => Op::Upload {
            branch: branch_of(&target),
            dir,
            message: message.unwrap_or_default(),
        },
        Command::Download { target, dir, at } => {
            if at.is_some() {
                bail!("--at works through the API only");
            }
            Op::Download {
                branch: branch_of(&target),
                dir,
            }
        }
        Command::Diff { target, against } => Op::Diff {
            from: against,
            to: branch_of(&target),
        },
        Command::Merge {
            target,
            into,
            message,
            dry_run,
        } => {
            if dry_run {
                bail!("--dry-run works through the API only");
            }
            Op::Merge {
                from: branch_of(&target),
                into,
                message,
            }
        }
        Command::Log {
            target,
            path: Some(path),
            ..
        } => Op::History {
            branch: branch_of(&target),
            path,
        },
        Command::Log { target, limit, .. } => Op::Log {
            branch: branch_of(&target),
            limit: limit.map(|limit| limit as usize),
        },
        Command::Branches { .. } => Op::Branches,
        Command::Destroy {
            target,
            confirm: asked,
        } => {
            let Some((_, branch)) = target.split_once('@') else {
                bail!("with --local, destroy a branch: NAME@BRANCH");
            };
            confirm(&format!("Delete branch {branch}?"), asked.yes)?;
            Op::Destroy {
                branch: branch.to_string(),
            }
        }
        Command::Gc {
            grace_minutes,
            dry_run,
        } => Op::Gc {
            grace_minutes,
            dry_run,
        },
        Command::Recover {
            folder,
            branch,
            message,
        } => Op::Recover {
            folder,
            branch,
            message,
        },
        _ => bail!("this works through the API only: drop --local"),
    })
}

pub(crate) fn branch_of(target: &str) -> String {
    match target.split_once('@') {
        Some((_, branch)) if !branch.is_empty() => branch.to_string(),
        _ => MAIN.to_string(),
    }
}

pub(crate) async fn daemon(root: &Path, request: Request) -> Result<Response> {
    let response = call(root, &request).await.map_err(|error| {
        anyhow!(
            "can't reach skywaked at {} ({error}); is it running?",
            root.display()
        )
    })?;
    match response {
        Response::Error(error) => bail!(error),
        Response::NotMounted => bail!("not a mounted folder"),
        response => Ok(response),
    }
}
