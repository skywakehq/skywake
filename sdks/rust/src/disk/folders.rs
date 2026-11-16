use std::io;
use std::path::{Component, Path, PathBuf};

use futures::stream::{self, StreamExt, TryStreamExt};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

use super::Disk;
use super::browse::entries;
use super::changes::{COMMIT, FileChange, INLINE_MAX, PART_MAX, change_of, weight};
use super::types::{Content, Entry, Kind};
use crate::Result;
use crate::shared::awaitable;
use crate::shared::batches::batches;
use crate::shared::paging::collect;

const CONCURRENCY: usize = 8;

#[must_use]
pub struct Download<'a> {
    disk: &'a Disk,
    dir: PathBuf,
    at: Option<String>,
}

impl<'a> Download<'a> {
    pub(crate) fn new(disk: &'a Disk, dir: impl AsRef<Path>) -> Self {
        Download {
            disk,
            dir: dir.as_ref().to_path_buf(),
            at: None,
        }
    }

    pub fn at(mut self, at: impl Into<String>) -> Self {
        self.at = Some(at.into());
        self
    }

    pub async fn send(self) -> Result<Option<String>> {
        let at = match self.at {
            Some(at) => Some(at),
            None => self.disk.head().await?,
        };
        let root = std::path::absolute(&self.dir)?;
        tokio::fs::create_dir_all(&root).await?;
        let Some(at) = at else {
            return Ok(None);
        };
        let all = walk(self.disk, &at).await?;
        let (folders, files): (Vec<_>, Vec<_>) = all
            .into_iter()
            .partition(|entry| entry.kind == Kind::Folder);
        for folder in &folders {
            tokio::fs::create_dir_all(local(&root, &folder.path)?).await?;
        }
        stream::iter(files)
            .map(|entry| fetch(self.disk, &root, entry, &at))
            .buffer_unordered(CONCURRENCY)
            .try_collect::<()>()
            .await?;
        Ok(Some(at))
    }
}

awaitable!(Download => Option<String>);

async fn walk(disk: &Disk, at: &str) -> Result<Vec<Entry>> {
    let mut found = Vec::new();
    let mut folders = vec![String::new()];
    while let Some(folder) = folders.pop() {
        for entry in collect(entries(disk, &folder, false, Some(at))).await? {
            if entry.kind == Kind::Folder {
                folders.push(entry.path.clone());
            }
            found.push(entry);
        }
    }
    Ok(found)
}

fn local(root: &Path, name: &str) -> io::Result<PathBuf> {
    let mut file = root.to_path_buf();
    for part in Path::new(name).components() {
        match part {
            Component::Normal(part) => file.push(part),
            Component::CurDir => {}
            _ => {
                let message = format!("`{name}` is outside {}", root.display());
                return Err(io::Error::new(io::ErrorKind::InvalidInput, message));
            }
        }
    }
    Ok(file)
}

async fn fetch(disk: &Disk, root: &Path, entry: Entry, at: &str) -> Result<()> {
    let file = local(root, &entry.path)?;
    if entry.kind == Kind::Symlink {
        let _ = tokio::fs::remove_file(&file).await;
        symlink(entry.target.as_deref().unwrap_or(""), &file)?;
        return Ok(());
    }
    let mut body = disk
        .read(&entry.path)
        .at(at)
        .response()
        .await?
        .bytes_stream();
    let mut out = tokio::fs::File::create(&file).await?;
    while let Some(chunk) = body.try_next().await? {
        out.write_all(&chunk).await?;
    }
    out.flush().await?;
    if entry.executable {
        make_executable(&file)?;
    }
    Ok(())
}

#[cfg(unix)]
fn symlink(target: &str, file: &Path) -> io::Result<()> {
    std::os::unix::fs::symlink(target, file)
}

#[cfg(not(unix))]
fn symlink(target: &str, file: &Path) -> io::Result<()> {
    std::fs::write(file, target)
}

#[cfg(unix)]
fn make_executable(file: &Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(file, std::fs::Permissions::from_mode(0o755))
}

#[cfg(not(unix))]
fn make_executable(_: &Path) -> io::Result<()> {
    Ok(())
}

#[must_use]
pub struct Upload<'a> {
    disk: &'a Disk,
    dir: PathBuf,
    message: Option<String>,
}

impl<'a> Upload<'a> {
    pub(crate) fn new(disk: &'a Disk, dir: impl AsRef<Path>) -> Self {
        Upload {
            disk,
            dir: dir.as_ref().to_path_buf(),
            message: None,
        }
    }

    pub fn message(mut self, message: impl Into<String>) -> Self {
        self.message = Some(message.into());
        self
    }

    pub async fn send(self) -> Result<Option<String>> {
        let mut files = Vec::new();
        local_files(&std::path::absolute(&self.dir)?, "", &mut files)?;
        files.sort_by(|a, b| a.path.cmp(&b.path));
        let mut head = None;
        for batch in batches(files, &COMMIT, |file| weight(&file.path, file.size)) {
            let changes = stream::iter(batch)
                .map(|file| change_from(self.disk, file))
                .buffered(CONCURRENCY)
                .try_collect()
                .await?;
            head = Some(
                self.disk
                    .commit(changes, self.message.clone())
                    .await?
                    .commit,
            );
        }
        match head {
            Some(head) => Ok(Some(head)),
            None => self.disk.head().await,
        }
    }
}

awaitable!(Upload => Option<String>);

struct LocalFile {
    path: String,
    file: PathBuf,
    size: usize,
    executable: bool,
}

fn local_files(folder: &Path, prefix: &str, found: &mut Vec<LocalFile>) -> io::Result<()> {
    for entry in std::fs::read_dir(folder)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == ".git" {
            continue;
        }
        let kind = entry.file_type()?;
        let path = format!("{prefix}{name}");
        if kind.is_dir() {
            local_files(&entry.path(), &format!("{path}/"), found)?;
        } else if kind.is_file() {
            let meta = entry.metadata()?;
            found.push(LocalFile {
                path,
                file: entry.path(),
                size: meta.len() as usize,
                executable: is_executable(&meta),
            });
        }
    }
    Ok(())
}

#[cfg(unix)]
fn is_executable(meta: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    meta.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn is_executable(_: &std::fs::Metadata) -> bool {
    false
}

async fn change_from(disk: &Disk, file: LocalFile) -> Result<FileChange> {
    if file.size <= INLINE_MAX {
        let bytes = tokio::fs::read(&file.file).await?;
        return change_of(
            disk,
            file.path,
            Content::Bytes(bytes),
            Some(file.executable),
        )
        .await;
    }
    let mut handle = tokio::fs::File::open(&file.file).await?;
    let mut parts = Vec::new();
    for offset in (0..file.size).step_by(PART_MAX) {
        let mut bytes = vec![0; PART_MAX.min(file.size - offset)];
        handle.seek(io::SeekFrom::Start(offset as u64)).await?;
        handle.read_exact(&mut bytes).await?;
        parts.push(disk.part(bytes).await?);
    }
    Ok(FileChange {
        path: file.path,
        executable: Some(file.executable),
        parts: Some(parts),
        ..FileChange::default()
    })
}
