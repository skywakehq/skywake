//! The requests and responses between skywake and skywaked, one JSON line each.

use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;

use crate::socket_path;

pub const MAX_REQUEST: u64 = 64 * 1024;

pub const MAX_RESPONSE: u64 = 16 * 1024 * 1024;

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Request {
    Mount {
        branch: String,
        path: PathBuf,
        #[serde(default)]
        vm: bool,
        #[serde(default)]
        read_only: bool,
        #[serde(default)]
        owner: Option<(u32, u32)>,
        #[serde(default)]
        allow_other: bool,
    },
    Unmount {
        path: PathBuf,
    },
    Sync {
        path: PathBuf,
    },
    Commit {
        branch: String,
        path: PathBuf,
        message: String,
    },
    List,
    Status,
    Create {
        branch: String,
        #[serde(default)]
        from: Option<String>,
    },
    Merge {
        from: String,
        into: String,
        message: String,
    },
    Delete {
        branch: String,
    },
    Recover {
        folder: PathBuf,
        branch: String,
        message: String,
    },
}

impl Request {
    fn timeout(&self) -> Option<Duration> {
        match self {
            Request::List | Request::Status => Some(Duration::from_secs(30)),
            Request::Mount { .. } | Request::Create { .. } | Request::Delete { .. } => {
                Some(Duration::from_secs(300))
            }
            Request::Unmount { .. }
            | Request::Sync { .. }
            | Request::Commit { .. }
            | Request::Merge { .. }
            | Request::Recover { .. } => None,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Response {
    Done,
    Committed(String),
    NotMounted,
    Mounts(Vec<MountInfo>),
    Status(Status),
    Conflicts(Vec<String>),
    Recovered {
        commit: String,
        missing: Vec<String>,
    },
    Error(String),
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MountInfo {
    pub branch: String,
    pub path: PathBuf,
    pub moved: bool,
    #[serde(default)]
    pub read_only: bool,
    #[serde(default)]
    pub save_lag_ms: u64,
    #[serde(default)]
    pub unsaved_bytes: u64,
    #[serde(default)]
    pub last_error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Status {
    pub mounts: Vec<MountInfo>,
    pub cache_hits: u64,
    pub cache_misses: u64,
    pub cache_bytes: u64,
    pub cache_max_bytes: u64,
}

pub async fn read_line(reader: &mut (impl AsyncBufRead + Unpin), max: u64) -> io::Result<String> {
    let mut line = String::new();
    reader.take(max + 1).read_line(&mut line).await?;
    if !line.ends_with('\n') {
        let problem = match line.len() as u64 > max {
            true => "line too long",
            false => "connection closed before the end of the line",
        };
        return Err(io::Error::new(io::ErrorKind::InvalidData, problem));
    }
    line.pop();
    Ok(line)
}

pub async fn call(root: &Path, request: &Request) -> io::Result<Response> {
    let exchange = async {
        let (read, mut write) = UnixStream::connect(socket_path(root)).await?.into_split();
        let mut line = serde_json::to_string(request)?;
        line.push('\n');
        write.write_all(line.as_bytes()).await?;
        let reply = read_line(&mut BufReader::new(read), MAX_RESPONSE).await?;
        Ok(serde_json::from_str(&reply)?)
    };
    match request.timeout() {
        Some(limit) => tokio::time::timeout(limit, exchange)
            .await
            .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "skywaked did not answer"))?,
        None => exchange.await,
    }
}
