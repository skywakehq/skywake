//! `checkout` and `commit` through the HTTP API, for machines that can't
//! reach the bucket or mount a branch.

mod checkout;
mod commit;
mod tree;

use std::collections::BTreeMap;
use std::path::PathBuf;

use anyhow::{Result, bail};
use clap::Args;
use serde_json::Value;

use crate::api::{Api, segment};
use tree::Kept;

#[derive(Args)]
pub(crate) struct Remote {
    /// The API. With SKYWAKE_KEY too, and no --store, the folder is copied
    /// through the API.
    #[arg(long, env = "SKYWAKE_URL")]
    url: Option<String>,

    /// An API key (`sw_...`), made in the console.
    #[arg(long, env = "SKYWAKE_KEY", hide_env_values = true)]
    key: Option<String>,

    /// The namespace, such as `prod/app`, when going through the API.
    #[arg(long, env = "SKYWAKE_NAMESPACE")]
    namespace: Option<String>,
}

impl Remote {
    pub(crate) fn chosen(&self) -> bool {
        let set = |value: &Option<String>| value.as_deref().is_some_and(|text| !text.is_empty());
        set(&self.url) && set(&self.key)
    }

    fn api(&self) -> Result<Api> {
        Api::new(self.url.as_deref().unwrap_or_default(), self.key.clone())
    }
}

pub(crate) async fn checkout(remote: &Remote, branch: &str, dir: PathBuf) -> Result<()> {
    let Some(namespace) = remote.namespace.clone() else {
        bail!("name the namespace: set SKYWAKE_NAMESPACE or pass --namespace");
    };
    let branch = Branch::new(remote.api()?, namespace, branch);
    checkout::run(&branch, &dir).await
}

pub(crate) async fn commit(
    remote: &Remote,
    branch: &str,
    dir: PathBuf,
    message: &str,
) -> Result<()> {
    let api = remote.api()?;
    commit::run(api, remote.namespace.clone(), branch, &dir, message).await
}

/// A branch of a namespace, as the API names it.
struct Branch {
    api: Api,
    namespace: String,
    name: String,
}

impl Branch {
    fn new(api: Api, namespace: String, name: &str) -> Self {
        let name = name.to_string();
        Self {
            api,
            namespace,
            name,
        }
    }

    fn path(&self, rest: &str) -> String {
        let (namespace, name) = (segment(&self.namespace), segment(&self.name));
        format!("/namespaces/{namespace}/branches/{name}{rest}")
    }

    async fn head(&self) -> Result<String> {
        let found = self.api.get(&self.path("")).await?;
        Ok(found["head"].as_str().unwrap_or_default().to_string())
    }

    /// Everything in the tree at `commit`, parents before children.
    async fn tree(&self, commit: &str) -> Result<BTreeMap<String, Entry>> {
        let mut found = BTreeMap::new();
        let mut folders = vec![String::new()];
        while let Some(folder) = folders.pop() {
            let mut after: Option<String> = None;
            loop {
                let mut query = format!("?path={}&at={commit}&limit=1000", segment(&folder));
                if let Some(after) = &after {
                    query.push_str(&format!("&after={}", segment(after)));
                }
                let listing = self.api.get(&self.path(&format!("/files{query}"))).await?;
                let entries = listing["entries"].as_array().cloned().unwrap_or_default();
                for entry in &entries {
                    let name = entry["name"].as_str().unwrap_or_default();
                    let path = match folder.is_empty() {
                        true => name.to_string(),
                        false => format!("{folder}/{name}"),
                    };
                    let entry = Entry::from(entry);
                    if matches!(entry.kept, Kept::Folder) {
                        folders.push(path.clone());
                    }
                    found.insert(path, entry);
                }
                match entries.last() {
                    Some(last) if entries.len() == 1000 => {
                        after = last["name"].as_str().map(String::from);
                    }
                    _ => break,
                }
            }
        }
        Ok(found)
    }
}

/// One path of a branch's tree.
struct Entry {
    kept: Kept,
    size: u64,
}

impl From<&Value> for Entry {
    fn from(info: &Value) -> Self {
        let kept = match info["kind"].as_str() {
            Some("folder") => Kept::Folder,
            Some("symlink") => Kept::Symlink {
                target: info["target"].as_str().unwrap_or_default().to_string(),
            },
            // The API gives no hash, so it is learned when the file is read.
            _ => Kept::File {
                hash: String::new(),
                executable: info["executable"].as_bool().unwrap_or(false),
            },
        };
        let size = info["size"].as_u64().unwrap_or(0);
        Self { kept, size }
    }
}
