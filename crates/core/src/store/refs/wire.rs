//! What mounts and cache servers say to each other about branch heads.

use serde::{Deserialize, Serialize};

use crate::Commit;
pub use crate::cluster::slots::preferred;

pub const SLOTS: u32 = 1024;

pub const OWNER: &str = "skywake-owner";

pub const FOLDER: &str = "skywake-folder";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Stored {
    pub seq: u64,
    pub token: u64,
    pub commit: Commit,
}

#[derive(Serialize, Deserialize, Debug)]
pub enum Ask {
    Head {
        branch: String,
    },
    Create {
        branch: String,
        token: u64,
        commit: Commit,
        keep_commit: bool,
    },
    Advance {
        branch: String,
        from_seq: u64,
        from_token: u64,
        token: u64,
        commit: Commit,
        objects: Vec<Held>,
        since: Option<u64>,
    },
    Delete {
        branch: String,
        from_seq: u64,
        from_token: u64,
    },
    List,
}

#[derive(Serialize, Deserialize, Debug)]
pub enum Answer {
    Head(Option<Stored>),
    Done(Stored),
    Deleted,
    Exists,
    Conflict,
    Settle,
    List {
        slots: Vec<u32>,
        heads: Vec<(String, Stored)>,
        pending: bool,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Held {
    pub path: String,
    pub stored: Vec<u8>,
}

pub fn slot(folder: &str, branch: &str) -> u32 {
    let mut hasher = blake3::Hasher::new();
    hasher.update(folder.as_bytes());
    hasher.update(b"\n");
    hasher.update(branch.as_bytes());
    let hash = hasher.finalize();
    u32::from_le_bytes(hash.as_bytes()[..4].try_into().unwrap()) % SLOTS
}
