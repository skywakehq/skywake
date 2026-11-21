use anyhow::{Result, bail};
use futures::TryStreamExt;
use serde_json::json;
use skywake::{Branch, ErrorKind, Visibility};

use crate::cli::Create;
use crate::output::{self, short, table, time};
use crate::session::{Session, confirm};
use crate::target::Target;

pub(crate) async fn disks(session: &Session) -> Result<()> {
    let disks: Vec<_> = session.sky.list_disks().try_collect().await?;
    output::either(session.json, &disks, |disks| {
        let rows = disks
            .iter()
            .map(|disk| vec![disk.name.clone(), disk.region.clone(), time(&disk.created)])
            .collect::<Vec<_>>();
        table(&["NAME", "REGION", "CREATED"], &rows);
    })
}

pub(crate) async fn create(session: &Session, what: Create) -> Result<()> {
    let Create::Disk {
        name,
        region,
        search,
        public,
    } = what;
    let mut create = session.sky.create_disk(&name).search(search);
    if let Some(region) = region {
        create = create.region(region);
    }
    if public {
        create = create.visibility(Visibility::Public);
    }
    create.send().await?;
    output::report(
        session.json,
        json!({ "created": format!("disk {name}") }),
        format!("Made disk {name}."),
    )
}

pub(crate) async fn destroy(session: &Session, target: &Target, yes: bool) -> Result<()> {
    let disk = session.found(target).await?;
    let what = match &target.branch {
        Some(branch) => format!("branch {branch} of {}", target.name),
        None => format!("disk {} with every branch and file", target.name),
    };
    confirm(&format!("Delete {what}?"), yes)?;
    disk.destroy().await?;
    output::report(
        session.json,
        json!({ "destroyed": target.label() }),
        format!("Deleted {what}."),
    )
}

pub(crate) async fn branches(session: &Session, target: &Target) -> Result<()> {
    let branches = session.found(target).await?.branches().await?;
    output::either(session.json, &branches, |branches| {
        table(&["BRANCH", "FROM", "CREATED"], &branch_rows(branches));
    })
}

fn branch_rows(branches: &[Branch]) -> Vec<Vec<String>> {
    branches
        .iter()
        .map(|branch| {
            vec![
                branch.name.clone(),
                branch.from.clone().unwrap_or_default(),
                time(&branch.created),
            ]
        })
        .collect()
}

pub(crate) async fn fork(
    session: &Session,
    target: &Target,
    new: &str,
    from: Option<String>,
) -> Result<()> {
    let source = Target {
        branch: from.or_else(|| target.branch.clone()),
        ..target.clone()
    };
    session.found(&source).await?.fork(new).await?;
    let made = format!("{}@{new}", target.name);
    output::report(
        session.json,
        json!({ "forked": made, "from": source.label() }),
        format!("{made} ← {}", source.label()),
    )
}

pub(crate) async fn merge(
    session: &Session,
    target: &Target,
    into: &str,
    message: Option<String>,
    dry_run: bool,
) -> Result<()> {
    if target.branch() == into {
        bail!(
            "`{}` is already {into}: name the branch to merge, such as {}@agent-1",
            target.label(),
            target.name
        );
    }
    let disk = session.found(target).await?;
    let mut merge = disk.merge_into(into).dry_run(dry_run);
    if let Some(message) = message {
        merge = merge.message(message);
    }
    let merged = match merge.send().await {
        Err(error) => match error.kind() {
            Some(ErrorKind::MergeConflict { conflicts }) => {
                for path in conflicts {
                    eprintln!("conflict: {path}");
                }
                bail!("nothing was merged: both sides changed these files");
            }
            _ => return Err(error.into()),
        },
        Ok(merged) => merged,
    };
    output::either(session.json, &merged, |merged| {
        for path in &merged.conflicts {
            println!("conflict: {path}");
        }
        match &merged.commit {
            Some(commit) => println!("{} → {into} {}", target.label(), short(commit)),
            None if dry_run => println!("{} merges into {into} cleanly", target.label()),
            None => println!("{into}: nothing to merge"),
        }
    })
}

pub(crate) async fn log(
    session: &Session,
    target: &Target,
    path: Option<String>,
    limit: Option<u32>,
) -> Result<()> {
    let disk = session.found(target).await?;
    let mut log = disk.log();
    if let Some(path) = path {
        log = log.path(path);
    }
    if let Some(limit) = limit {
        log = log.limit(limit);
    }
    let commits = log.send().await?;
    output::either(session.json, &commits, |commits| {
        for commit in commits {
            println!(
                "{}  {}  {}",
                short(&commit.id),
                time(&commit.created),
                commit.message
            );
        }
    })
}

pub(crate) async fn diff(session: &Session, target: &Target, against: &str) -> Result<()> {
    let changes = session.disk(target).diff(against).await?;
    output::either(session.json, &changes, |changes| {
        for change in changes {
            let mark = match change.change.as_str() {
                "added" => "+",
                "removed" => "-",
                _ => "~",
            };
            println!("{mark} {}", change.path);
        }
    })
}
