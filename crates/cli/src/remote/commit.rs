//! Send a folder's changes to a branch through the API.

use std::io::Read;
use std::path::Path;

use anyhow::{Context, Result, bail};
use base64::Engine as _;
use bytes::Bytes;
use reqwest::Method;
use serde_json::{Value, json};

use super::tree::{Change, Kept, Manifest, diff, scan};
use super::{Branch, segment};
use crate::api::Api;

/// The most changes in one commit (the API's limit).
const CHANGES_MAX: usize = 10_000;
/// Files up to this size go inside the commit; larger ones are uploaded as parts.
const INLINE_MAX: u64 = 1024 * 1024;
/// The most base64 in one commit, well under the API's 64 MiB request limit.
const BODY_MAX: usize = 32 * 1024 * 1024;
/// The most bytes in one uploaded part (the API's limit).
const PART_MAX: usize = 16 * 1024 * 1024;

pub(super) async fn run(
    api: Api,
    namespace: Option<String>,
    branch: &str,
    dir: &Path,
    message: &str,
) -> Result<()> {
    let manifest = Manifest::read(dir)?;
    let namespace = match (namespace, &manifest) {
        (Some(namespace), _) => namespace,
        (None, Some(manifest)) => manifest.namespace.clone(),
        (None, None) => bail!("name the namespace: set SKYWAKE_NAMESPACE or pass --namespace"),
    };
    if let Some(manifest) = &manifest
        && (manifest.namespace != namespace || manifest.branch != branch)
    {
        bail!(
            "{} was checked out from {} {}; commit to that branch, or delete {} to send every file",
            dir.display(),
            manifest.namespace,
            manifest.branch,
            super::tree::MANIFEST
        );
    }
    let target = Branch::new(api, namespace, branch);
    let head = target.head().await?;
    // Without a checkout to compare with, every file is sent, and what the
    // branch has but the folder doesn't is deleted.
    let old = match &manifest {
        Some(manifest) => {
            if manifest.commit != head {
                eprintln!(
                    "warning: {branch} moved since checkout; your changes go on top of {}",
                    &head[..12.min(head.len())]
                );
            }
            manifest.paths.clone()
        }
        None => (target.tree(&head).await?)
            .into_iter()
            .map(|(path, entry)| (path, entry.kept))
            .collect(),
    };
    let mut new = scan(dir)?;
    let changes = diff(&old, &new);
    if changes.is_empty() {
        println!("{branch}: nothing changed");
        return Ok(());
    }

    let message = match message.is_empty() {
        true => "Commit from skywake",
        false => message,
    };
    let mut sender = Sender {
        branch: &target,
        message,
        batch: Vec::new(),
        bytes: 0,
        head: head.clone(),
        commits: 0,
    };
    for change in changes {
        let body = match change {
            Change::Delete(path) => json!({ "path": path, "delete": true }),
            Change::Folder(path) => json!({ "path": path, "folder": true }),
            Change::Link(path) => {
                eprintln!("left out {path}: the API can't make symlinks");
                // Not remembered, so it is reported again next time.
                new.remove(&path);
                continue;
            }
            Change::Write { path, executable } => {
                let (body, hash) = sender
                    .content(&dir.join(&path), &path, executable)
                    .await
                    .with_context(|| format!("sending {path}"))?;
                // The hash of what was sent, in case the file changed meanwhile.
                new.insert(path, Kept::File { hash, executable });
                body
            }
        };
        sender.push(body).await?;
    }
    sender.flush().await?;

    let manifest = Manifest {
        namespace: target.namespace.clone(),
        branch: branch.to_string(),
        commit: sender.head.clone(),
        paths: new,
    };
    manifest.write(dir)?;
    if sender.commits > 1 {
        eprintln!(
            "saved as {} commits: one holds at most {CHANGES_MAX} changes and {} MiB",
            sender.commits,
            BODY_MAX >> 20
        );
    }
    println!("{branch} → {}", &sender.head[..12.min(sender.head.len())]);
    Ok(())
}

/// Fills commits up to the API's limits and sends each when full.
struct Sender<'a> {
    branch: &'a Branch,
    message: &'a str,
    batch: Vec<Value>,
    bytes: usize,
    head: String,
    commits: usize,
}

impl Sender<'_> {
    /// The change that writes the file, and the hash of the bytes sent.
    async fn content(&self, local: &Path, path: &str, executable: bool) -> Result<(Value, String)> {
        let mut file = std::fs::File::open(local)?;
        let mut hasher = blake3::Hasher::new();
        if file.metadata()?.len() <= INLINE_MAX {
            let mut bytes = Vec::new();
            file.read_to_end(&mut bytes)?;
            hasher.update(&bytes);
            let base64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
            let body = json!({ "path": path, "base64": base64, "executable": executable });
            return Ok((body, hasher.finalize().to_hex().to_string()));
        }
        let upload = format!("/namespaces/{}/uploads", segment(&self.branch.namespace));
        let mut parts = Vec::new();
        loop {
            let mut piece = Vec::with_capacity(PART_MAX);
            (&mut file).take(PART_MAX as u64).read_to_end(&mut piece)?;
            if piece.is_empty() && !parts.is_empty() {
                break;
            }
            hasher.update(&piece);
            let last = piece.len() < PART_MAX;
            let sent = self.branch.api.upload(&upload, Bytes::from(piece)).await?;
            parts.push(sent["part"].clone());
            if last {
                break;
            }
        }
        let body = json!({ "path": path, "parts": parts, "executable": executable });
        Ok((body, hasher.finalize().to_hex().to_string()))
    }

    async fn push(&mut self, change: Value) -> Result<()> {
        let size = change["base64"].as_str().map_or(0, str::len);
        if self.batch.len() == CHANGES_MAX
            || (self.bytes + size > BODY_MAX && !self.batch.is_empty())
        {
            self.flush().await?;
        }
        self.bytes += size;
        self.batch.push(change);
        Ok(())
    }

    async fn flush(&mut self) -> Result<()> {
        if self.batch.is_empty() {
            return Ok(());
        }
        let changes = std::mem::take(&mut self.batch);
        self.bytes = 0;
        let body = json!({ "message": self.message, "changes": changes });
        // Not retried: a commit whose answer was lost may have landed.
        let path = self.branch.path("/commits");
        let made = self
            .branch
            .api
            .call(Method::POST, &path, Some(&body), false)
            .await?;
        if let Some(head) = made["head"].as_str() {
            self.head = head.to_string();
        }
        self.commits += usize::from(made["changed"].as_bool().unwrap_or(false));
        Ok(())
    }
}
