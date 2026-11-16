use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Visibility {
    Private,
    Public,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    File,
    Folder,
    Symlink,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FindKind {
    Any,
    Files,
    Folders,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Prefer {
    Ours,
    Theirs,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Entry {
    pub path: String,
    pub kind: Kind,
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub modified: Option<String>,
    #[serde(default)]
    pub executable: bool,
    #[serde(default)]
    pub target: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Commit {
    pub id: String,
    pub message: String,
    pub created: String,
    pub merged: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Committed {
    pub commit: String,
    pub changed: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Change {
    pub path: String,
    pub change: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Match {
    pub path: String,
    pub line: u64,
    pub text: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Found {
    pub path: String,
    pub kind: Kind,
    #[serde(default)]
    pub size: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FileHit {
    pub path: String,
    pub score: f64,
    pub snippet: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DiskSummary {
    pub name: String,
    #[serde(default)]
    pub region: String,
    pub visibility: Option<Visibility>,
    #[serde(default)]
    pub created: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DiskInfo {
    pub name: String,
    pub region: String,
    pub visibility: Visibility,
    pub created: String,
    pub search: bool,
    pub branches: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Merged {
    pub commit: Option<String>,
    #[serde(default)]
    pub conflicts: Vec<String>,
}

#[derive(Clone, Debug)]
pub enum Content {
    Text(String),
    Bytes(Vec<u8>),
}

impl From<&str> for Content {
    fn from(text: &str) -> Self {
        Content::Text(text.to_string())
    }
}

impl From<String> for Content {
    fn from(text: String) -> Self {
        Content::Text(text)
    }
}

impl From<Vec<u8>> for Content {
    fn from(bytes: Vec<u8>) -> Self {
        Content::Bytes(bytes)
    }
}

impl From<&[u8]> for Content {
    fn from(bytes: &[u8]) -> Self {
        Content::Bytes(bytes.to_vec())
    }
}

impl<const N: usize> From<&[u8; N]> for Content {
    fn from(bytes: &[u8; N]) -> Self {
        Content::Bytes(bytes.to_vec())
    }
}
