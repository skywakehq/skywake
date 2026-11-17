use std::path::PathBuf;

use anyhow::{Context, Result, bail};
use futures::TryStreamExt;
use serde_json::{Value, json};
use skywake::{Branch, ErrorKind, Visibility};

use crate::cli::Create;
use crate::output::{self, short, table, time};
use crate::session::{Place, Session, confirm};
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

pub(crate) async fn indexes(session: &Session) -> Result<()> {
    let indexes: Vec<_> = session.sky.list_indexes().try_collect().await?;
    output::either(session.json, &indexes, |indexes| {
        let rows = indexes
            .iter()
            .map(|index| {
                vec![
                    index.name.clone(),
                    index.region.clone(),
                    time(&index.created),
                ]
            })
            .collect::<Vec<_>>();
        table(&["NAME", "REGION", "CREATED"], &rows);
    })
}

pub(crate) async fn create(session: &Session, what: Create) -> Result<()> {
    let name = match what {
        Create::Disk {
            name,
            region,
            search,
            public,
        } => {
            let mut create = session.sky.create_disk(&name).search(search);
            if let Some(region) = region {
                create = create.region(region);
            }
            if public {
                create = create.visibility(Visibility::Public);
            }
            create.send().await?;
            format!("disk {name}")
        }
        Create::Index {
            name,
            schema,
            region,
            embed,
            no_embed,
        } => {
            let mut create = session.sky.create_index(&name);
            if let Some(schema) = schema {
                create = create.schema(read_json(&schema)?);
            }
            if let Some(region) = region {
                create = create.region(region);
            }
            if embed.is_some() || no_embed {
                create = create.embed(embed.as_deref());
            }
            create.send().await?;
            format!("index {name}")
        }
    };
    output::report(
        session.json,
        json!({ "created": name }),
        format!("Made {name}."),
    )
}

pub(crate) async fn destroy(session: &Session, target: &Target, yes: bool) -> Result<()> {
    let place = session.place(target).await?;
    let what = match (&place, &target.branch) {
        (_, Some(branch)) => format!("branch {branch} of {}", target.name),
        (Place::Disk(_), None) => format!("disk {} with every branch and file", target.name),
        (Place::Index(_), None) => format!("index {} with every branch and row", target.name),
    };
    confirm(&format!("Delete {what}?"), yes)?;
    match place {
        Place::Disk(disk) => disk.destroy().await?,
        Place::Index(index) => index.destroy().await?,
    }
    output::report(
        session.json,
        json!({ "destroyed": target.label() }),
        format!("Deleted {what}."),
    )
}

pub(crate) async fn branches(session: &Session, target: &Target) -> Result<()> {
    let branches = match session.place(target).await? {
        Place::Disk(disk) => disk.branches().await?,
        Place::Index(index) => index.branches().await?,
    };
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
    match session.place(&source).await? {
        Place::Disk(disk) => drop(disk.fork(new).await?),
        Place::Index(index) => drop(index.fork(new).await?),
    }
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
    match session.place(target).await? {
        Place::Index(index) => {
            if dry_run {
                bail!("--dry-run works on disks only");
            }
            let merged = index.merge_into(into).await?;
            output::either(session.json, &merged, |merged| {
                println!("{} → {into}: {} rows", target.label(), merged.rows)
            })
        }
        Place::Disk(disk) => {
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
    }
}

pub(crate) async fn log(
    session: &Session,
    target: &Target,
    path: Option<String>,
    limit: Option<u32>,
) -> Result<()> {
    match session.place(target).await? {
        Place::Disk(disk) => {
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
        Place::Index(index) => {
            if path.is_some() {
                bail!("--path works on disks only");
            }
            let mut versions = index.versions().await?;
            if let Some(limit) = limit {
                versions.truncate(limit as usize);
            }
            output::either(session.json, &versions, |versions| {
                for version in versions {
                    let rows = version
                        .rows
                        .map(|rows| format!("{rows} rows"))
                        .unwrap_or_default();
                    println!("{}  {}  {rows}", short(&version.id), time(&version.created));
                }
            })
        }
    }
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

fn read_json(path: &PathBuf) -> Result<Value> {
    let text =
        std::fs::read_to_string(path).with_context(|| format!("can't read {}", path.display()))?;
    serde_json::from_str(&text).with_context(|| format!("{} is not JSON", path.display()))
}
