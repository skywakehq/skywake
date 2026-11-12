//! The manifest of what a mount could not save, and recovering it as a branch.

use std::collections::BTreeMap;
use std::io;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use skywake_core::{Entry, Error, Hash, Packs, Repo, Tree, Trees, is_ignored, store_file};

pub const MANIFEST: &str = "manifest.json";
const BASE: &str = "base.packs";

#[derive(Serialize, Deserialize)]
pub struct Manifest {
    pub branch: String,
    pub mountpoint: PathBuf,
    pub reason: String,
    pub written: u64,
    pub ignored: Vec<String>,
    pub paths: Vec<Item>,
}

#[derive(Serialize, Deserialize)]
pub struct Item {
    pub path: String,
    pub what: What,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum What {
    Folder,
    Entry(Entry),
    File {
        file: String,
        mode: u32,
        modified_ns: u64,
    },
}

impl Manifest {
    pub fn write(&self, folder: &Path, base: &Packs) -> io::Result<()> {
        let packs = folder.join(BASE);
        if !packs.exists() {
            let bytes = postcard::to_stdvec(base).map_err(io::Error::other)?;
            write_atomic(&packs, &bytes)?;
        }
        write_atomic(&folder.join(MANIFEST), &serde_json::to_vec(self)?)
    }

    pub fn read(folder: &Path) -> Result<(Manifest, Packs)> {
        Self::read_with(folder, |path| std::fs::File::open(path))
    }

    pub fn read_with(
        folder: &Path,
        open: impl Fn(&Path) -> io::Result<std::fs::File>,
    ) -> Result<(Manifest, Packs)> {
        let read = |name: &str| {
            let mut bytes = Vec::new();
            io::Read::read_to_end(&mut open(&folder.join(name))?, &mut bytes)?;
            io::Result::Ok(bytes)
        };
        let manifest =
            read(MANIFEST).with_context(|| format!("no {MANIFEST} in {}", folder.display()))?;
        let packs = read(BASE).with_context(|| format!("no {BASE} in {}", folder.display()))?;
        Ok((
            serde_json::from_slice(&manifest)?,
            postcard::from_bytes(&packs)?,
        ))
    }

    pub fn changed_files(&self) -> impl Iterator<Item = &str> {
        self.paths.iter().filter_map(|item| match item.what {
            What::File { .. } => Some(item.path.as_str()),
            _ => None,
        })
    }
}

pub async fn recover(
    repo: &Repo,
    folder: &Path,
    branch: &str,
    message: &str,
) -> Result<(Hash, Vec<String>)> {
    crate::kept::check_owner(folder)?;
    let (manifest, base) = Manifest::read(folder)?;
    recover_from(repo, folder, &manifest, &base, branch, message, |file| {
        crate::kept::open_copy(folder, file)
    })
    .await
}

pub async fn recover_from(
    repo: &Repo,
    folder: &Path,
    manifest: &Manifest,
    base: &Packs,
    branch: &str,
    message: &str,
    open: impl Fn(&str) -> io::Result<std::fs::File>,
) -> Result<(Hash, Vec<String>)> {
    let trees = Trees::new(repo.objects().clone(), base)?;
    let packs = trees.load_packs().await?;
    let mut missing = Vec::new();
    let root = build(repo, folder, manifest, &trees, &open, &mut missing).await?;
    match repo.create_branch(branch, Some(&manifest.branch)).await {
        Ok(_) => {}
        Err(Error::BranchNotFound(_)) => {
            repo.create_branch(branch, None).await?;
        }
        Err(error) => return Err(error.into()),
    }
    let mut position = repo.position(branch).await?;
    position.trees.absorb(&trees);
    repo.revive(&position, root, &packs)
        .await
        .context("data the unsaved changes use is gone from the store")?;
    let commit = repo.save(&mut position, root, Some(message)).await?;
    Ok((commit, missing))
}

async fn build(
    repo: &Repo,
    folder: &Path,
    manifest: &Manifest,
    trees: &Trees,
    open: impl Fn(&str) -> io::Result<std::fs::File>,
    missing: &mut Vec<String>,
) -> Result<Hash> {
    let mut folders: BTreeMap<&str, Tree> = BTreeMap::new();
    for item in manifest.paths.iter().rev() {
        if !item.path.is_empty() && is_ignored(&manifest.ignored, &item.path) {
            continue;
        }
        let entry = match &item.what {
            What::Folder => Entry::Dir {
                tree: trees.add(folders.remove(item.path.as_str()).unwrap_or_default())?,
            },
            What::Entry(entry) => entry.clone(),
            What::File {
                file,
                mode,
                modified_ns,
            } => {
                let copy = match open(file) {
                    Ok(copy) => copy,
                    Err(error) if error.kind() == io::ErrorKind::NotFound => {
                        missing.push(item.path.clone());
                        continue;
                    }
                    Err(error) => {
                        return Err(error)
                            .with_context(|| format!("{}", folder.join(file).display()));
                    }
                };
                let size = copy.metadata()?.len();
                let data = store_file(repo.objects(), crate::kept::fd_path(&copy), size).await?;
                Entry::File {
                    size: data.len(),
                    modified_ns: *modified_ns,
                    mode: *mode,
                    data,
                }
            }
        };
        if item.path.is_empty() {
            let Entry::Dir { tree } = entry else {
                bail!("the root is not a folder");
            };
            return Ok(tree);
        }
        let (parent, name) = item.path.rsplit_once('/').unwrap_or(("", &item.path));
        folders
            .entry(parent)
            .or_default()
            .insert(name.to_string(), entry);
    }
    bail!("the manifest has no root")
}

fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let temp = path.with_extension("partial");
    let mut file = std::fs::File::create(&temp)?;
    io::Write::write_all(&mut file, bytes)?;
    file.sync_all()?;
    std::fs::rename(&temp, path)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use object_store::memory::InMemory;

    use super::*;

    #[tokio::test]
    async fn recover_skips_a_missing_copy() {
        let repo = Repo::new(Arc::new(InMemory::new()));
        repo.create_branch("main", None).await.unwrap();
        let folder = tempfile::tempdir().unwrap();
        std::fs::create_dir(folder.path().join("files")).unwrap();
        std::fs::write(folder.path().join("files/1"), "kept").unwrap();
        let file = |copy: &str| What::File {
            file: format!("files/{copy}"),
            mode: 0o644,
            modified_ns: 0,
        };
        let item = |path: &str, what| Item {
            path: path.into(),
            what,
        };
        let manifest = Manifest {
            branch: "main".into(),
            mountpoint: "/mnt".into(),
            reason: "test".into(),
            written: 0,
            ignored: Vec::new(),
            paths: vec![
                item("", What::Folder),
                item("kept", file("1")),
                item("lost", file("2")),
            ],
        };
        manifest.write(folder.path(), &Packs::default()).unwrap();
        recover(&repo, folder.path(), "rescued", "recovered")
            .await
            .unwrap();
        assert_eq!(
            repo.read("rescued", None, "kept", 0, 100).await.unwrap(),
            b"kept"
        );
        assert!(repo.read("rescued", None, "lost", 0, 100).await.is_err());
    }

    #[tokio::test]
    async fn recover_never_commits_chunks_a_collection_deleted() {
        let store = Arc::new(InMemory::new());
        let repo = Repo::new(store.clone());
        repo.create_branch("main", None).await.unwrap();
        let bytes: Vec<u8> = (0..300_000u32)
            .map(|i| (i.wrapping_mul(2654435761) >> 13) as u8)
            .collect();
        let chunks = repo.store_part(&bytes).await.unwrap();
        let folder = tempfile::tempdir().unwrap();
        let manifest = Manifest {
            branch: "main".into(),
            mountpoint: "/mnt".into(),
            reason: "test".into(),
            written: 0,
            ignored: Vec::new(),
            paths: vec![
                Item {
                    path: "".into(),
                    what: What::Folder,
                },
                Item {
                    path: "big".into(),
                    what: What::Entry(Entry::File {
                        size: bytes.len() as u64,
                        modified_ns: 0,
                        mode: 0o644,
                        data: skywake_core::Data::Chunks(chunks),
                    }),
                },
            ],
        };
        manifest.write(folder.path(), &Packs::default()).unwrap();
        use futures::TryStreamExt;
        use object_store::ObjectStoreExt;
        let listed: Vec<_> = object_store::ObjectStore::list(&*store, Some(&"chunks".into()))
            .try_collect()
            .await
            .unwrap();
        assert!(!listed.is_empty());
        for meta in listed {
            store.delete(&meta.location).await.unwrap();
        }
        match recover(&repo, folder.path(), "rescued", "recovered").await {
            Err(_) => {}
            Ok(_) => {
                let read = repo.read("rescued", None, "big", 0, 100).await;
                panic!(
                    "recover made a commit pointing to deleted chunks; reading it: {:?}",
                    read.err()
                );
            }
        }
    }

    #[tokio::test]
    async fn recover_keeps_a_folder_never_opened_in_a_large_branch() {
        let store = Arc::new(InMemory::new());
        let repo = Repo::new(store.clone());
        repo.create_branch("main", None).await.unwrap();
        let work = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(work.path().join("top/deep")).unwrap();
        for i in 0..3000 {
            let name = format!("top/deep/a-file-with-a-long-name-{i}");
            std::fs::write(work.path().join(name), i.to_string()).unwrap();
        }
        repo.commit("main", work.path(), "many files")
            .await
            .unwrap();
        let head = skywake_core::Refs::new(store.clone())
            .head("main")
            .await
            .unwrap()
            .unwrap();
        let (root, trees) = repo.head_tree("main").await.unwrap();
        let top = match trees.get(root).await.unwrap().get("top") {
            Some(Entry::Dir { tree }) => *tree,
            _ => unreachable!(),
        };
        let deep = trees.get(top).await.unwrap().get("deep").unwrap().clone();
        std::fs::remove_dir_all(work.path().join("top")).unwrap();
        repo.commit("main", work.path(), "none left").await.unwrap();
        let folder = tempfile::tempdir().unwrap();
        let manifest = Manifest {
            branch: "main".into(),
            mountpoint: "/mnt".into(),
            reason: "test".into(),
            written: 0,
            ignored: Vec::new(),
            paths: vec![
                Item {
                    path: "".into(),
                    what: What::Folder,
                },
                Item {
                    path: "moved".into(),
                    what: What::Entry(deep),
                },
            ],
        };
        manifest.write(folder.path(), &head.commit.packs).unwrap();
        recover(&repo, folder.path(), "rescued", "recovered")
            .await
            .unwrap();
        let read = repo.read("rescued", None, "moved/a-file-with-a-long-name-7", 0, 10);
        assert_eq!(read.await.unwrap(), b"7");
    }

    #[tokio::test]
    async fn recover_reads_only_copies_inside_the_folder() {
        let repo = Repo::new(Arc::new(InMemory::new()));
        repo.create_branch("main", None).await.unwrap();
        let outside = tempfile::tempdir().unwrap();
        let secret = outside.path().join("shadow");
        std::fs::write(&secret, "root-only secret").unwrap();
        let folder = tempfile::tempdir().unwrap();
        std::fs::create_dir(folder.path().join("files")).unwrap();
        std::os::unix::fs::symlink(&secret, folder.path().join("files/7")).unwrap();
        let item = |path: &str, file: String| Item {
            path: path.into(),
            what: What::File {
                file,
                mode: 0o644,
                modified_ns: 0,
            },
        };
        let manifest = Manifest {
            branch: "main".into(),
            mountpoint: "/mnt".into(),
            reason: "test".into(),
            written: 0,
            ignored: Vec::new(),
            paths: vec![
                Item {
                    path: "".into(),
                    what: What::Folder,
                },
                item("abs", secret.to_string_lossy().into_owned()),
                item("link", "files/7".into()),
            ],
        };
        manifest.write(folder.path(), &Packs::default()).unwrap();
        let _ = recover(&repo, folder.path(), "rescued", "recovered").await;
        let abs = repo.read("rescued", None, "abs", 0, 100).await.ok();
        let link = repo.read("rescued", None, "link", 0, 100).await.ok();
        assert!(
            abs.is_none(),
            "absolute `file` read outside the folder: {abs:?}"
        );
        assert!(
            link.is_none(),
            "symlinked copy followed outside the folder: {link:?}"
        );
    }
}
