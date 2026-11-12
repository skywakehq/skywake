//! What a folder held at checkout, what it holds now, and the changes between.

use std::collections::BTreeMap;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};

/// The file in the folder that remembers the checkout. It is never sent.
pub(super) const MANIFEST: &str = ".skywake-checkout";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub(super) enum Kept {
    File { hash: String, executable: bool },
    Folder,
    Symlink { target: String },
}

#[derive(Serialize, Deserialize)]
pub(super) struct Manifest {
    pub namespace: String,
    pub branch: String,
    pub commit: String,
    pub paths: BTreeMap<String, Kept>,
}

impl Manifest {
    pub(super) fn read(dir: &Path) -> Result<Option<Self>> {
        let path = dir.join(MANIFEST);
        match std::fs::read(&path) {
            Ok(bytes) => Ok(Some(
                serde_json::from_slice(&bytes).with_context(|| format!("{}", path.display()))?,
            )),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error.into()),
        }
    }

    pub(super) fn write(&self, dir: &Path) -> Result<()> {
        std::fs::write(dir.join(MANIFEST), serde_json::to_vec_pretty(self)?)?;
        Ok(())
    }
}

/// Every path under `dir`, with the hash of each file.
pub(super) fn scan(dir: &Path) -> Result<BTreeMap<String, Kept>> {
    let mut found = BTreeMap::new();
    let mut folders = vec![String::new()];
    while let Some(folder) = folders.pop() {
        for item in std::fs::read_dir(dir.join(&folder))? {
            let item = item?;
            let name = item
                .file_name()
                .into_string()
                .map_err(|name| anyhow!("{name:?} in {folder}: names must be UTF-8"))?;
            if folder.is_empty() && name == MANIFEST {
                continue;
            }
            let path = match folder.is_empty() {
                true => name,
                false => format!("{folder}/{name}"),
            };
            let meta = item.metadata()?;
            let kept = if meta.is_dir() {
                folders.push(path.clone());
                Kept::Folder
            } else if meta.is_symlink() {
                let target = std::fs::read_link(item.path())?;
                Kept::Symlink {
                    target: target.to_string_lossy().into_owned(),
                }
            } else if meta.is_file() {
                Kept::File {
                    hash: hash_file(&item.path())?,
                    executable: meta.permissions().mode() & 0o111 != 0,
                }
            } else {
                continue;
            };
            found.insert(path, kept);
        }
    }
    Ok(found)
}

fn hash_file(path: &Path) -> Result<String> {
    let mut hasher = blake3::Hasher::new();
    hasher.update_reader(std::fs::File::open(path)?)?;
    Ok(hasher.finalize().to_hex().to_string())
}

#[derive(Debug, PartialEq)]
pub(super) enum Change {
    Delete(String),
    Write {
        path: String,
        executable: bool,
    },
    Folder(String),
    /// A new or changed symlink. The API can't make one.
    Link(String),
}

/// The changes that turn `old` into `new`, deletes first.
pub(super) fn diff(old: &BTreeMap<String, Kept>, new: &BTreeMap<String, Kept>) -> Vec<Change> {
    let gone: Vec<&String> = old
        .iter()
        .filter(|(path, kept)| !same_kind(Some(kept), new.get(*path)))
        .map(|(path, _)| path)
        .collect();
    // Deleting a folder deletes what it holds too.
    let gone_folders: Vec<&String> = gone
        .iter()
        .copied()
        .filter(|path| matches!(old[*path], Kept::Folder))
        .collect();
    let mut changes: Vec<Change> = gone
        .iter()
        .filter(|path| {
            !gone_folders
                .iter()
                .any(|folder| path.starts_with(&format!("{folder}/")))
        })
        .map(|path| Change::Delete(path.to_string()))
        .collect();
    for (path, kept) in new {
        let before = old.get(path);
        match kept {
            Kept::File { executable, .. } if before != Some(kept) => changes.push(Change::Write {
                path: path.clone(),
                executable: *executable,
            }),
            Kept::Symlink { .. } if before != Some(kept) => {
                changes.push(Change::Link(path.clone()))
            }
            // Only an empty folder needs its own change; a file in it makes it.
            Kept::Folder if !same_kind(before, Some(kept)) => {
                let inside = format!("{path}/");
                let empty = !new
                    .range(inside.clone()..)
                    .next()
                    .is_some_and(|(next, _)| next.starts_with(&inside));
                if empty {
                    changes.push(Change::Folder(path.clone()));
                }
            }
            _ => {}
        }
    }
    changes
}

fn same_kind(a: Option<&Kept>, b: Option<&Kept>) -> bool {
    matches!(
        (a, b),
        (Some(Kept::File { .. }), Some(Kept::File { .. }))
            | (Some(Kept::Folder), Some(Kept::Folder))
            | (Some(Kept::Symlink { .. }), Some(Kept::Symlink { .. }))
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(hash: &str) -> Kept {
        Kept::File {
            hash: hash.into(),
            executable: false,
        }
    }

    fn tree(paths: &[(&str, Kept)]) -> BTreeMap<String, Kept> {
        paths
            .iter()
            .map(|(path, kept)| (path.to_string(), kept.clone()))
            .collect()
    }

    fn write(path: &str) -> Change {
        Change::Write {
            path: path.into(),
            executable: false,
        }
    }

    #[test]
    fn only_what_changed_is_sent() {
        let old = tree(&[
            ("a.txt", file("1")),
            ("b.txt", file("2")),
            ("gone", Kept::Folder),
            ("gone/x", file("3")),
            ("kept", Kept::Folder),
            ("kept/y", file("4")),
        ]);
        let new = tree(&[
            ("a.txt", file("1")),
            ("b.txt", file("9")),
            ("kept", Kept::Folder),
            ("kept/y", file("4")),
            ("new", Kept::Folder),
            ("new/z", file("5")),
            ("empty", Kept::Folder),
        ]);
        assert_eq!(
            diff(&old, &new),
            [
                Change::Delete("gone".into()),
                write("b.txt"),
                Change::Folder("empty".into()),
                write("new/z"),
            ]
        );
    }

    #[test]
    fn a_file_can_become_a_folder() {
        let old = tree(&[("a", file("1")), ("b", Kept::Folder), ("b/c", file("2"))]);
        let new = tree(&[("a", Kept::Folder), ("a/x", file("3")), ("b", file("4"))]);
        assert_eq!(
            diff(&old, &new),
            [
                Change::Delete("a".into()),
                Change::Delete("b".into()),
                write("a/x"),
                write("b"),
            ]
        );
    }

    #[test]
    fn a_new_mode_is_a_change() {
        let old = tree(&[("run.sh", file("1"))]);
        let new = tree(&[(
            "run.sh",
            Kept::File {
                hash: "1".into(),
                executable: true,
            },
        )]);
        let expected = Change::Write {
            path: "run.sh".into(),
            executable: true,
        };
        assert_eq!(diff(&old, &new), [expected]);
    }
}
