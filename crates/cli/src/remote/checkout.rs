//! Copy a branch into a folder through the API.

use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::sync::Arc;

use anyhow::{Context, Result, bail};
use reqwest::Method;
use tokio::io::AsyncWriteExt;
use tokio::task::JoinSet;

use super::tree::{Kept, Manifest};
use super::{Branch, segment};

/// Files downloaded at once.
const AT_ONCE: usize = 16;

pub(super) async fn run(branch: &Branch, dir: &Path) -> Result<()> {
    if dir.exists() && std::fs::read_dir(dir)?.next().is_some() {
        bail!("{} is not empty", dir.display());
    }
    std::fs::create_dir_all(dir)?;
    let head = branch.head().await?;
    let tree = branch.tree(&head).await?;

    let mut paths = tree
        .iter()
        .map(|(path, entry)| (path.clone(), entry.kept.clone()))
        .collect::<std::collections::BTreeMap<_, _>>();
    let mut downloads = Vec::new();
    for (path, entry) in &tree {
        let local = dir.join(path);
        match &entry.kept {
            Kept::Folder => std::fs::create_dir_all(&local)?,
            Kept::Symlink { target } => std::os::unix::fs::symlink(target, &local)?,
            Kept::File { executable, .. } => {
                downloads.push((path.clone(), entry.size, *executable))
            }
        }
    }

    // A shared handle, so each download task can reach the API.
    let shared = Arc::new((branch.api.clone(), branch.path("/files/content")));
    let mut running = JoinSet::new();
    let mut pending = downloads.into_iter();
    loop {
        while running.len() < AT_ONCE {
            let Some((path, size, executable)) = pending.next() else {
                break;
            };
            let (shared, local, head) = (shared.clone(), dir.join(&path), head.clone());
            running.spawn(async move {
                let url = format!("{}?path={}&at={head}", shared.1, segment(&path));
                let hash = download(&shared.0, &url, &local, size, executable)
                    .await
                    .with_context(|| format!("reading {path}"))?;
                anyhow::Ok((path, hash, executable))
            });
        }
        let Some(done) = running.join_next().await else {
            break;
        };
        let (path, hash, executable) = done??;
        paths.insert(path, Kept::File { hash, executable });
    }

    let manifest = Manifest {
        namespace: branch.namespace.clone(),
        branch: branch.name.clone(),
        commit: head.clone(),
        paths,
    };
    manifest.write(dir)?;
    println!(
        "{} @ {} → {}",
        branch.name,
        &head[..12.min(head.len())],
        dir.display()
    );
    Ok(())
}

/// Writes one file and returns the hash of its bytes.
async fn download(
    api: &crate::api::Api,
    url: &str,
    local: &Path,
    size: u64,
    executable: bool,
) -> Result<String> {
    let mut response = api.raw(Method::GET, url, None, true).await?;
    let mut file = tokio::fs::File::create(local).await?;
    let mut hasher = blake3::Hasher::new();
    let mut written = 0;
    while let Some(piece) = response.chunk().await? {
        hasher.update(&piece);
        file.write_all(&piece).await?;
        written += piece.len() as u64;
    }
    file.flush().await?;
    if written != size {
        bail!("got {written} of {size} bytes");
    }
    if executable {
        tokio::fs::set_permissions(local, std::fs::Permissions::from_mode(0o755)).await?;
    }
    Ok(hasher.finalize().to_hex().to_string())
}
