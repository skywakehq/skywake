//! Reads and changes single files of a stored tree, with no local folder.

use std::time::{SystemTime, UNIX_EPOCH};

use fastcdc::v2020::FastCDC;
use futures::{StreamExt, TryStreamExt, stream};

use crate::model::valid_entry_name;
use crate::ops::worktree::{AVG_CHUNK, INLINE_MAX, MAX_CHUNK, MIN_CHUNK};
use crate::{Chunk, Data, Entry, Error, Hash, Objects, Result, Tree, Trees, permissions};

const PARALLELISM: usize = 16;

pub fn parts(path: &str) -> Result<Vec<&str>> {
    let path = path.trim_matches('/');
    if path.is_empty() {
        return Ok(Vec::new());
    }
    let parts: Vec<&str> = path.split('/').collect();
    if !parts.iter().all(|part| valid_entry_name(part)) {
        return Err(Error::InvalidPath(path.to_string()));
    }
    Ok(parts)
}

pub async fn find(trees: &Trees, root: Hash, path: &str) -> Result<Option<Entry>> {
    let mut entry = Entry::Dir { tree: root };
    for part in parts(path)? {
        let Entry::Dir { tree } = entry else {
            return Ok(None);
        };
        match trees.entry(tree, part).await? {
            Some(child) => entry = child,
            None => return Ok(None),
        }
    }
    Ok(Some(entry))
}

pub async fn put(trees: &Trees, root: Hash, path: &str, entry: Option<Entry>) -> Result<Hash> {
    let parts = parts(path)?;
    let Some((name, folders)) = parts.split_last() else {
        return Err(Error::InvalidPath(path.to_string()));
    };
    let mut chain = vec![Tree::clone(&*trees.get(root).await?)];
    for (depth, folder) in folders.iter().enumerate() {
        let next = match chain[depth].get(*folder) {
            Some(Entry::Dir { tree }) => Tree::clone(&*trees.get(*tree).await?),
            None if entry.is_some() => Tree::new(),
            None => return Err(Error::NotFound(path.to_string())),
            Some(_) => return Err(Error::NotAFolder(folders[..=depth].join("/"))),
        };
        chain.push(next);
    }
    let mut tree = chain.pop().unwrap();
    match entry {
        Some(entry) => {
            tree.insert(name.to_string(), entry);
        }
        None => {
            tree.remove(*name)
                .ok_or_else(|| Error::NotFound(path.to_string()))?;
        }
    }
    let mut hash = trees.add(tree)?;
    for folder in folders.iter().rev() {
        let mut parent = chain.pop().unwrap();
        parent.insert(folder.to_string(), Entry::Dir { tree: hash });
        hash = trees.add(parent)?;
    }
    Ok(hash)
}

pub async fn walk(trees: &Trees, root: Hash) -> Result<Vec<(String, Entry)>> {
    let mut found = Vec::new();
    let mut todo = vec![(String::new(), root)];
    while let Some((prefix, tree)) = todo.pop() {
        for (name, entry) in trees.get(tree).await?.iter() {
            let path = format!("{prefix}{name}");
            match entry {
                Entry::Dir { tree } => todo.push((format!("{path}/"), *tree)),
                _ => found.push((path, entry.clone())),
            }
        }
    }
    found.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(found)
}

pub async fn read(objects: &Objects, data: &Data, offset: u64, len: u64) -> Result<Vec<u8>> {
    let end = offset.saturating_add(len).min(data.len());
    if offset >= end {
        return Ok(Vec::new());
    }
    let chunks = match data {
        Data::Inline(bytes) => return Ok(bytes[offset as usize..end as usize].to_vec()),
        Data::Bundled(at) => {
            let bytes = objects.get_bundled(at).await?;
            return Ok(bytes[offset as usize..end as usize].to_vec());
        }
        Data::Chunks(chunks) => chunks,
    };
    let mut start = 0;
    let mut first = None;
    let mut wanted = Vec::new();
    for chunk in chunks {
        let stop = start + u64::from(chunk.size);
        if stop > offset && start < end {
            first.get_or_insert(start);
            wanted.push(*chunk);
        }
        start = stop;
    }
    let parts: Vec<Vec<u8>> = stream::iter(wanted)
        .map(|chunk| get_chunk(objects, chunk))
        .buffered(PARALLELISM)
        .try_collect()
        .await?;
    let first = first.unwrap_or(0);
    Ok(parts.concat()[(offset - first) as usize..(end - first) as usize].to_vec())
}

pub(crate) async fn get_chunk(objects: &Objects, chunk: Chunk) -> Result<Vec<u8>> {
    let bytes = objects.get_chunk(chunk.hash).await?;
    if bytes.len() != chunk.size as usize {
        return Err(Error::Corrupt(format!(
            "chunk {} has {} bytes, but its file says {}",
            chunk.hash,
            bytes.len(),
            chunk.size
        )));
    }
    Ok(bytes)
}

pub async fn store(objects: &Objects, bytes: &[u8], mode: u32) -> Result<Entry> {
    let data = if bytes.len() as u64 <= INLINE_MAX {
        Data::Inline(bytes.to_vec())
    } else {
        Data::Chunks(store_chunks(objects, bytes).await?)
    };
    Ok(file(data, mode))
}

pub async fn store_chunks(objects: &Objects, bytes: &[u8]) -> Result<Vec<Chunk>> {
    stream::iter(FastCDC::new(bytes, MIN_CHUNK, AVG_CHUNK, MAX_CHUNK))
        .map(|chunk| async move {
            let data = bytes[chunk.offset..chunk.offset + chunk.length].to_vec();
            let hash = objects.put_chunk(data).await?;
            Ok::<_, Error>(Chunk {
                hash,
                size: chunk.length as u32,
            })
        })
        .buffered(PARALLELISM)
        .try_collect()
        .await
}

pub fn file(data: Data, mode: u32) -> Entry {
    let modified_ns = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_nanos() as u64);
    Entry::File {
        size: data.len(),
        modified_ns,
        mode: permissions(mode),
        data,
    }
}
