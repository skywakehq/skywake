//! Copies a folder into the store, and a stored tree back into a folder.

use std::collections::HashSet;
use std::fs::{Metadata, Permissions};
use std::io;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, UNIX_EPOCH};

use fastcdc::v2020::StreamCDC;
use futures::{StreamExt, TryStreamExt, stream};
use tokio::fs;
use tokio::io::AsyncWriteExt;
use tokio::sync::{Semaphore, mpsc};

use crate::model::valid_entry_name;
use crate::ops::files;
use crate::ops::ignore::{ignored, is_ignored};
use crate::store::bundles::{self, Bundler};
use crate::{Chunk, Data, Entry, Error, Hash, Objects, Result, Tree, Trees, permissions};

pub(crate) const MIN_CHUNK: usize = 256 * 1024;
pub(crate) const AVG_CHUNK: usize = 1024 * 1024;
pub(crate) const MAX_CHUNK: usize = 4 * 1024 * 1024;

const PARALLELISM: usize = 16;

const READ_AHEAD: usize = 4;

static OPEN_FILES: Semaphore = Semaphore::const_new(64);

pub const INLINE_MAX: u64 = 4096;

pub const INLINE_BUDGET: usize = 64 * 1024;

pub(crate) async fn snapshot(
    objects: &Objects,
    trees: &Trees,
    dir: &Path,
    previous: Hash,
) -> Result<Hash> {
    let snapshot = Snapshot {
        objects,
        known: trees,
        ignored: ignored(dir)?,
        new: Mutex::new(Vec::new()),
        bundler: Bundler::new(objects),
    };
    let root = snapshot.dir(dir, "", Some(previous)).await?;
    snapshot.bundler.finish().await?;
    let new = snapshot.new.into_inner();
    for tree in new.unwrap_or_else(PoisonError::into_inner) {
        trees.add(tree)?;
    }
    Ok(root)
}

struct Snapshot<'a> {
    objects: &'a Objects,
    known: &'a Trees,
    ignored: Vec<String>,
    new: Mutex<Vec<Tree>>,
    bundler: Bundler,
}

impl Snapshot<'_> {
    async fn dir(&self, dir: &Path, relative: &str, previous: Option<Hash>) -> Result<Hash> {
        let previous_hash = previous;
        let previous = match previous {
            Some(tree) => self.known.get(tree).await?,
            None => Default::default(),
        };
        let mut paths = Vec::new();
        {
            let _open = OPEN_FILES.acquire().await.map_err(io::Error::other)?;
            let mut listing = fs::read_dir(dir).await?;
            while let Some(item) = listing.next_entry().await? {
                paths.push(item.path());
            }
        }
        let tree: Tree = stream::iter(paths)
            .map(|path| self.entry(path, relative, &previous))
            .buffer_unordered(PARALLELISM)
            .try_filter_map(|entry| async move { Ok(entry) })
            .try_collect()
            .await?;
        let tree = limit_inline(&self.bundler, tree).await?;
        let hash = Objects::address(&tree)?;
        if Some(hash) != previous_hash {
            let mut new = self.new.lock().unwrap_or_else(PoisonError::into_inner);
            new.push(tree);
        }
        Ok(hash)
    }

    async fn entry(
        &self,
        path: PathBuf,
        parent: &str,
        previous: &Tree,
    ) -> Result<Option<(String, Entry)>> {
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| Error::NonUtf8Path(path.clone()))?
            .to_string();
        let relative = if parent.is_empty() {
            name.clone()
        } else {
            format!("{parent}/{name}")
        };
        if is_ignored(&self.ignored, &relative) {
            return Ok(None);
        }
        let metadata = fs::symlink_metadata(&path).await?;
        let before = previous.get(&name);

        let entry = if metadata.is_symlink() {
            let target = fs::read_link(&path).await?;
            let target = target.to_str().ok_or(Error::NonUtf8Path(target.clone()))?;
            Entry::Symlink {
                target: target.to_string(),
            }
        } else if metadata.is_dir() {
            let previous = match before {
                Some(Entry::Dir { tree }) => Some(*tree),
                _ => None,
            };
            Entry::Dir {
                tree: Box::pin(self.dir(&path, &relative, previous)).await?,
            }
        } else if metadata.is_file() {
            match before {
                Some(entry) if is_unchanged(entry, &metadata) => entry.clone(),
                _ => Entry::File {
                    size: metadata.len(),
                    modified_ns: modified_ns_of(&metadata),
                    mode: mode_of(&metadata),
                    data: store_file_reusing(
                        self.objects,
                        path,
                        metadata.len(),
                        &HashSet::new(),
                        Some(&self.bundler),
                    )
                    .await?,
                },
            }
        } else {
            return Ok(None);
        };
        Ok(Some((name, entry)))
    }
}

async fn limit_inline(bundler: &Bundler, mut tree: Tree) -> Result<Tree> {
    let mut used = 0;
    let mut over = Vec::new();
    for (name, entry) in &tree {
        if let Entry::File {
            data: Data::Inline(bytes),
            ..
        } = entry
        {
            used += bytes.len();
            if used > INLINE_BUDGET {
                over.push((name.clone(), bytes.clone()));
            }
        }
    }
    let stored: Vec<(String, Data)> = stream::iter(over)
        .map(|(name, bytes)| async move { Ok::<_, Error>((name, bundler.add(bytes).await?)) })
        .buffer_unordered(PARALLELISM)
        .try_collect()
        .await?;
    for (name, stored) in stored {
        if let Some(Entry::File { data, .. }) = tree.get_mut(&name) {
            *data = stored;
        }
    }
    Ok(tree)
}

pub(crate) async fn materialize(
    objects: &Objects,
    trees: &Trees,
    tree: Hash,
    dir: &Path,
) -> Result<()> {
    if let Ok(mut listing) = fs::read_dir(dir).await
        && listing.next_entry().await?.is_some()
    {
        return Err(Error::NotEmpty(dir.to_path_buf()));
    }
    fs::create_dir_all(dir).await?;
    write_tree(objects, trees, tree, dir).await
}

fn is_unchanged(entry: &Entry, metadata: &Metadata) -> bool {
    matches!(
        entry,
        Entry::File { size, modified_ns, mode, .. }
            if *size == metadata.len()
                && *modified_ns == modified_ns_of(metadata)
                && *mode == mode_of(metadata)
    )
}

pub async fn store_file(objects: &Objects, path: PathBuf, size: u64) -> Result<Data> {
    store_file_reusing(objects, path, size, &HashSet::new(), None).await
}

pub async fn store_file_reusing(
    objects: &Objects,
    path: PathBuf,
    size: u64,
    stored: &HashSet<Hash>,
    bundler: Option<&Bundler>,
) -> Result<Data> {
    let _open = OPEN_FILES.acquire().await.map_err(io::Error::other)?;
    if size <= INLINE_MAX {
        return Ok(Data::Inline(fs::read(path).await?));
    }
    if let Some(bundler) = bundler
        && size <= bundles::FILE_MAX
    {
        let bytes = fs::read(path).await?;
        let chunk = Chunk {
            hash: Hash::of(&bytes),
            size: bytes.len() as u32,
        };
        if stored.contains(&chunk.hash) {
            return Ok(Data::Chunks(vec![chunk]));
        }
        return bundler.add(bytes).await;
    }
    Ok(Data::Chunks(upload_chunks(objects, path, stored).await?))
}

async fn upload_chunks(
    objects: &Objects,
    path: PathBuf,
    stored: &HashSet<Hash>,
) -> Result<Vec<Chunk>> {
    let (sender, mut receiver) = mpsc::channel(READ_AHEAD);
    let reader = tokio::task::spawn_blocking(move || -> io::Result<()> {
        let file = std::fs::File::open(path)?;
        for chunk in StreamCDC::new(file, MIN_CHUNK, AVG_CHUNK, MAX_CHUNK) {
            let chunk = chunk.map_err(io::Error::other)?;
            if sender.blocking_send(chunk.data).is_err() {
                break;
            }
        }
        Ok(())
    });
    let uploaded: Result<Vec<Chunk>> = stream::poll_fn(|cx| receiver.poll_recv(cx))
        .map(|data: Vec<u8>| async move {
            let size = data.len() as u32;
            let hash = objects.put_chunk_unless(data, stored).await?;
            Ok(Chunk { hash, size })
        })
        .buffered(PARALLELISM)
        .try_collect()
        .await;
    drop(receiver);
    reader.await.map_err(io::Error::other)??;
    uploaded
}

async fn write_tree(objects: &Objects, trees: &Trees, tree: Hash, dir: &Path) -> Result<()> {
    let tree = trees.get(tree).await?;
    if let Some(name) = tree.keys().find(|name| !valid_entry_name(name)) {
        return Err(Error::InvalidPath(name.clone()));
    }
    stream::iter(tree.iter())
        .map(|(name, entry)| write_entry(objects, trees, dir.join(name), entry.clone()))
        .buffer_unordered(PARALLELISM)
        .try_collect()
        .await
}

async fn write_entry(objects: &Objects, trees: &Trees, path: PathBuf, entry: Entry) -> Result<()> {
    let written = match entry {
        Entry::File {
            modified_ns,
            mode,
            data,
            ..
        } => write_file(objects, &path, data, modified_ns, mode).await,
        Entry::Dir { tree } => match fs::create_dir(&path).await {
            Ok(()) => Box::pin(write_tree(objects, trees, tree, &path)).await,
            Err(error) => Err(error.into()),
        },
        Entry::Symlink { target } => fs::symlink(target, &path).await.map_err(Error::from),
    };
    match written {
        Err(Error::Io(error)) if error.kind() == io::ErrorKind::AlreadyExists => {
            Err(Error::InvalidPath(format!(
                "{} (another name is the same here)",
                path.display()
            )))
        }
        written => written,
    }
}

async fn write_file(
    objects: &Objects,
    path: &Path,
    data: Data,
    modified_ns: u64,
    mode: u32,
) -> Result<()> {
    let data = match data {
        Data::Inline(bytes) => Data::Inline(bytes),
        data if data.chunks().len() == 1 => {
            Data::Inline(files::read(objects, &data, 0, data.len()).await?)
        }
        data => data,
    };
    let _open = OPEN_FILES.acquire().await.map_err(io::Error::other)?;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .await?;
    match data {
        Data::Inline(bytes) => file.write_all(&bytes).await?,
        data => {
            let mut downloads = stream::iter(data.chunks().to_vec())
                .map(|chunk| files::get_chunk(objects, chunk))
                .buffered(PARALLELISM);
            while let Some(bytes) = downloads.try_next().await? {
                file.write_all(&bytes).await?;
            }
        }
    }
    file.flush().await?;
    let file = file.into_std().await;
    tokio::task::spawn_blocking(move || -> io::Result<()> {
        file.set_permissions(Permissions::from_mode(permissions(mode)))?;
        file.set_modified(UNIX_EPOCH + Duration::from_nanos(modified_ns))
    })
    .await
    .map_err(io::Error::other)??;
    Ok(())
}

fn modified_ns_of(metadata: &Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |elapsed| elapsed.as_nanos() as u64)
}

fn mode_of(metadata: &Metadata) -> u32 {
    permissions(metadata.permissions().mode())
}
