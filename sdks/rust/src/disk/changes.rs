use serde::Serialize;

use super::Disk;
use super::types::Content;
use crate::Result;
use crate::shared::batches::Limits;
use crate::shared::bytes::{as_text, base64};

pub(crate) const COMMIT: Limits = Limits {
    count: 10_000,
    bytes: 32 * 1024 * 1024,
};
pub(crate) const INLINE_MAX: usize = 4 * 1024 * 1024;
pub(crate) const PART_MAX: usize = 16 * 1024 * 1024;

#[derive(Default, Serialize)]
pub(crate) struct FileChange {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base64: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parts: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delete: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<Source>,
}

#[derive(Serialize)]
pub(crate) struct Source {
    pub path: String,
}

pub(crate) fn clean(path: &str) -> String {
    path.trim_matches('/').to_string()
}

pub(crate) fn weight(path: &str, size: usize) -> usize {
    let content = if size > INLINE_MAX {
        size.div_ceil(PART_MAX) * 70
    } else {
        size.div_ceil(3) * 4
    };
    path.len() * 6 + 64 + content
}

pub(crate) async fn change_of(
    disk: &Disk,
    path: String,
    content: Content,
    executable: Option<bool>,
) -> Result<FileChange> {
    let change = FileChange {
        path,
        executable,
        ..FileChange::default()
    };
    let bytes = match content {
        Content::Text(text) if text.len() * 3 <= INLINE_MAX => {
            return Ok(FileChange {
                text: Some(text),
                ..change
            });
        }
        Content::Text(text) => text.into_bytes(),
        Content::Bytes(bytes) => bytes,
    };
    if bytes.len() > INLINE_MAX {
        let parts = upload_parts(disk, &bytes).await?;
        return Ok(FileChange {
            parts: Some(parts),
            ..change
        });
    }
    Ok(match as_text(&bytes) {
        Some(text) => FileChange {
            text: Some(text),
            ..change
        },
        None => FileChange {
            base64: Some(base64(&bytes)),
            ..change
        },
    })
}

async fn upload_parts(disk: &Disk, bytes: &[u8]) -> Result<Vec<String>> {
    let mut parts = Vec::new();
    for chunk in bytes.chunks(PART_MAX) {
        parts.push(disk.part(chunk.to_vec()).await?);
    }
    Ok(parts)
}
