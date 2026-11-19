use std::path::PathBuf;

use anyhow::{Context, Result, bail};
use futures::TryStreamExt;
use serde_json::{Value, json};
use skywake::Branch;

use crate::cli::Create;
use crate::output::{self, short, table, time};
use crate::session::{Session, confirm};
use crate::target::Target;

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
    let Create::Index {
        name,
        schema,
        region,
        embed,
        no_embed,
    } = what;
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
    let name = format!("index {name}");
    output::report(
        session.json,
        json!({ "created": name }),
        format!("Made {name}."),
    )
}

pub(crate) async fn destroy(session: &Session, target: &Target, yes: bool) -> Result<()> {
    let what = match &target.branch {
        Some(branch) => format!("branch {branch} of {}", target.name),
        None => format!("index {} with every branch and row", target.name),
    };
    confirm(&format!("Delete {what}?"), yes)?;
    session.index(target).destroy().await?;
    output::report(
        session.json,
        json!({ "destroyed": target.label() }),
        format!("Deleted {what}."),
    )
}

pub(crate) async fn branches(session: &Session, target: &Target) -> Result<()> {
    let branches = session.index(target).branches().await?;
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
    session.index(&source).fork(new).await?;
    let made = format!("{}@{new}", target.name);
    output::report(
        session.json,
        json!({ "forked": made, "from": source.label() }),
        format!("{made} ← {}", source.label()),
    )
}

pub(crate) async fn merge(session: &Session, target: &Target, into: &str) -> Result<()> {
    if target.branch() == into {
        bail!(
            "`{}` is already {into}: name the branch to merge, such as {}@agent-1",
            target.label(),
            target.name
        );
    }
    let merged = session.index(target).merge_into(into).await?;
    output::either(session.json, &merged, |merged| {
        println!("{} → {into}: {} rows", target.label(), merged.rows)
    })
}

pub(crate) async fn log(session: &Session, target: &Target, limit: Option<u32>) -> Result<()> {
    let mut versions = session.index(target).versions().await?;
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

fn read_json(path: &PathBuf) -> Result<Value> {
    let text =
        std::fs::read_to_string(path).with_context(|| format!("can't read {}", path.display()))?;
    serde_json::from_str(&text).with_context(|| format!("{} is not JSON", path.display()))
}
