//! Files, folders and edits as plain JavaScript objects, and back.

use napi::Result;
use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use skywake_core::{Chunk, Content, Entry, Resolution, Take};

use super::commits::maybe_hash;
use crate::error::failure;

#[napi(object)]
pub struct FileEdit {
    pub path: String,
    pub content: Option<Buffer>,
    pub chunks: Option<Vec<FileChunk>>,
    pub from: Option<CopySource>,
    pub folder: Option<bool>,
    pub executable: Option<bool>,
}

/// What one path becomes in a merge: `take` one side, or new `content` or
/// `chunks`. With none of them, the path is removed.
#[napi(object)]
pub struct MergeResolution {
    pub path: String,
    pub take: Option<String>,
    pub content: Option<Buffer>,
    pub chunks: Option<Vec<FileChunk>>,
    pub executable: Option<bool>,
}

#[napi(object)]
pub struct FileChunk {
    pub hash: String,
    pub size: u32,
}

#[napi(object)]
pub struct CopySource {
    pub path: String,
    pub at: Option<String>,
}

#[napi(object)]
pub struct FileInfo {
    pub name: String,
    pub kind: String,
    pub size: i64,
    pub executable: bool,
    pub target: Option<String>,
    pub modified: i64,
}

#[napi(object)]
pub struct Listing {
    pub info: FileInfo,
    pub entries: Vec<FileInfo>,
}

#[napi(object)]
pub struct SearchMatch {
    pub path: String,
    pub line: u32,
    pub text: String,
}

pub(crate) fn info(name: &str, entry: &Entry) -> FileInfo {
    let (kind, size, executable, target, modified_ns) = match entry {
        Entry::File {
            size, modified_ns, ..
        } => (
            "file",
            *size as i64,
            entry.is_executable(),
            None,
            *modified_ns,
        ),
        Entry::Dir { .. } => ("folder", 0, false, None, 0),
        Entry::Symlink { target } => ("symlink", 0, false, Some(target.clone()), 0),
    };
    FileInfo {
        name: name.to_string(),
        kind: kind.to_string(),
        size,
        executable,
        target,
        modified: (modified_ns / 1_000_000) as i64,
    }
}

pub(crate) fn content(edit: &mut FileEdit) -> Result<Content> {
    let given = [
        edit.content.is_some(),
        edit.chunks.is_some(),
        edit.from.is_some(),
        edit.folder == Some(true),
    ];
    if given.iter().filter(|&&given| given).count() > 1 {
        let message = "give at most one of content, chunks, from or folder";
        return Err(failure("invalid", format!("{}: {message}", edit.path)));
    }
    Ok(if let Some(bytes) = edit.content.take() {
        Content::Bytes(bytes.to_vec())
    } else if let Some(chunks) = edit.chunks.take() {
        Content::Chunks(parsed(chunks)?)
    } else if let Some(from) = edit.from.take() {
        Content::From {
            path: from.path,
            at: maybe_hash(from.at)?,
        }
    } else if edit.folder == Some(true) {
        Content::Folder
    } else {
        Content::Remove
    })
}

fn parsed(chunks: Vec<FileChunk>) -> Result<Vec<Chunk>> {
    chunks
        .into_iter()
        .map(|chunk| {
            Ok(Chunk {
                hash: chunk.hash.parse().map_err(|_| {
                    failure("invalid", format!("`{}` is not a chunk hash", chunk.hash))
                })?,
                size: chunk.size,
            })
        })
        .collect()
}

pub(crate) fn resolution(resolved: MergeResolution, mode: u32) -> Result<Resolution> {
    let given = [
        resolved.take.is_some(),
        resolved.content.is_some(),
        resolved.chunks.is_some(),
    ];
    if given.iter().filter(|&&given| given).count() > 1 {
        let message = "give at most one of take, content or chunks";
        return Err(failure("invalid", format!("{}: {message}", resolved.path)));
    }
    let take = match (resolved.take.as_deref(), resolved.content, resolved.chunks) {
        (Some("ours"), ..) => Take::Ours,
        (Some("theirs"), ..) => Take::Theirs,
        (Some(other), ..) => {
            let message = format!("take is `ours` or `theirs`, not `{other}`");
            return Err(failure("invalid", message));
        }
        (_, Some(bytes), _) => Take::Bytes(bytes.to_vec(), mode),
        (_, _, Some(chunks)) => Take::Chunks(parsed(chunks)?, mode),
        _ => Take::Remove,
    };
    Ok(Resolution {
        path: resolved.path,
        take,
    })
}
