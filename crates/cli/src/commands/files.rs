use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use serde_json::json;
use skywake::{Committed, Content, Kind};

use crate::cli::FindKind;
use crate::output::{self, short, table};
use crate::session::Session;
use crate::target::Target;

pub(crate) async fn list(
    session: &Session,
    target: &Target,
    recursive: bool,
    at: Option<String>,
) -> Result<()> {
    let disk = session.disk(target);
    let mut list = disk.list(target.path()).recursive(recursive);
    if let Some(at) = at {
        list = list.at(at);
    }
    let entries = list.send().await?;
    output::either(session.json, &entries, |entries| {
        let rows = entries
            .iter()
            .map(|entry| {
                let size = match entry.kind {
                    Kind::File => entry.size.to_string(),
                    Kind::Folder => "-".to_string(),
                    Kind::Symlink => format!("→ {}", entry.target.clone().unwrap_or_default()),
                };
                let name = match entry.kind {
                    Kind::Folder => format!("{}/", entry.path),
                    _ => entry.path.clone(),
                };
                vec![name, size]
            })
            .collect::<Vec<_>>();
        table(&["PATH", "SIZE"], &rows);
    })
}

pub(crate) async fn read(session: &Session, target: &Target, at: Option<String>) -> Result<()> {
    let disk = session.disk(target);
    let mut read = disk.read(target.file()?);
    if let Some(at) = at {
        read = read.at(at);
    }
    let bytes = read.bytes().await?;
    std::io::stdout().write_all(&bytes)?;
    Ok(())
}

pub(crate) async fn write(
    session: &Session,
    target: &Target,
    file: Option<PathBuf>,
    message: Option<String>,
    executable: bool,
) -> Result<()> {
    let bytes = input(file.as_deref())?;
    let content = match String::from_utf8(bytes) {
        Ok(text) => Content::Text(text),
        Err(error) => Content::Bytes(error.into_bytes()),
    };
    let path = target.file()?;
    let disk = session.disk(target);
    let mut write = disk.write(path, content).executable(executable);
    if let Some(message) = message {
        write = write.message(message);
    }
    committed(session, &write.await?, &format!("wrote {}", target.label()))
}

pub(crate) async fn delete(
    session: &Session,
    target: &Target,
    more: Vec<String>,
    message: Option<String>,
) -> Result<()> {
    let mut paths = vec![target.file()?.to_string()];
    for other in more {
        let other = Target::parse(&other)?;
        if other.name != target.name || other.branch != target.branch {
            bail!(
                "delete files from one disk at a time: `{}` is not on {}",
                other.label(),
                target.label()
            );
        }
        paths.push(other.file()?.to_string());
    }
    let disk = session.disk(target);
    let mut delete = disk.delete(paths.clone());
    if let Some(message) = message {
        delete = delete.message(message);
    }
    let done = delete.await?;
    committed(session, &done, &format!("deleted {}", paths.join(", ")))
}

pub(crate) async fn grep(
    session: &Session,
    pattern: &str,
    target: &Target,
    glob: Option<String>,
    ignore_case: bool,
    limit: Option<u32>,
    at: Option<String>,
) -> Result<()> {
    let disk = session.disk(target);
    let mut grep = disk.grep(pattern).ignore_case(ignore_case);
    if let Some(path) = &target.path {
        grep = grep.path(path);
    }
    if let Some(glob) = glob {
        grep = grep.glob(glob);
    }
    if let Some(limit) = limit {
        grep = grep.limit(limit);
    }
    if let Some(at) = at {
        grep = grep.at(at);
    }
    let matches = grep.send().await?;
    output::either(session.json, &matches, |matches| {
        for found in matches {
            println!("{}:{}:{}", found.path, found.line, found.text);
        }
    })
}

pub(crate) async fn find(
    session: &Session,
    glob: &str,
    target: &Target,
    kind: Option<FindKind>,
    limit: Option<u32>,
    at: Option<String>,
) -> Result<()> {
    let disk = session.disk(target);
    let mut find = disk.find(glob);
    if let Some(path) = &target.path {
        find = find.path(path);
    }
    if let Some(kind) = kind {
        find = find.kind(match kind {
            FindKind::Files => skywake::FindKind::Files,
            FindKind::Folders => skywake::FindKind::Folders,
            FindKind::Any => skywake::FindKind::Any,
        });
    }
    if let Some(limit) = limit {
        find = find.limit(limit);
    }
    if let Some(at) = at {
        find = find.at(at);
    }
    let found = find.send().await?;
    output::either(session.json, &found, |found| {
        for each in found {
            match each.kind {
                Kind::Folder => println!("{}/", each.path),
                _ => println!("{}", each.path),
            }
        }
    })
}

pub(crate) async fn query(
    session: &Session,
    disk: skywake::Disk,
    text: &str,
    path: Option<&str>,
    limit: Option<u32>,
) -> Result<()> {
    let mut query = disk.query(text);
    if let Some(path) = path {
        query = query.path(path);
    }
    if let Some(limit) = limit {
        query = query.limit(limit);
    }
    let hits = query.send().await?;
    output::either(session.json, &hits, |hits| {
        for hit in hits {
            println!("{}  {:.3}", hit.path, hit.score);
            for line in hit.snippet.lines().filter(|line| !line.trim().is_empty()) {
                println!("    {line}");
            }
        }
    })
}

pub(crate) async fn upload(
    session: &Session,
    dir: &Path,
    target: &Target,
    message: Option<String>,
) -> Result<()> {
    let disk = session.disk(target);
    let mut upload = disk.upload(dir);
    if let Some(message) = message {
        upload = upload.message(message);
    }
    let commit = upload.send().await?;
    head(
        session,
        commit,
        &format!("uploaded {} to {}", dir.display(), target.label()),
    )
}

pub(crate) async fn download(
    session: &Session,
    target: &Target,
    dir: &Path,
    at: Option<String>,
) -> Result<()> {
    let disk = session.disk(target);
    let mut download = disk.download(dir);
    if let Some(at) = at {
        download = download.at(at);
    }
    let commit = download.send().await?;
    head(
        session,
        commit,
        &format!("downloaded {} to {}", target.label(), dir.display()),
    )
}

fn committed(session: &Session, done: &Committed, what: &str) -> Result<()> {
    output::either(session.json, done, |done| match done.changed {
        true => println!("{what} → {}", short(&done.commit)),
        false => println!("{what}: nothing changed"),
    })
}

fn head(session: &Session, commit: Option<String>, what: &str) -> Result<()> {
    let text = match &commit {
        Some(commit) => format!("{what} → {}", short(commit)),
        None => format!("{what}: the branch is empty"),
    };
    output::report(session.json, json!({ "commit": commit }), text)
}

pub(crate) fn input(file: Option<&Path>) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    match file.filter(|path| path.as_os_str() != "-") {
        Some(path) => {
            bytes = std::fs::read(path).with_context(|| format!("can't read {}", path.display()))?
        }
        None => drop(std::io::stdin().read_to_end(&mut bytes)?),
    }
    Ok(bytes)
}
