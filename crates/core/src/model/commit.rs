use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::{Hash, Tree};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Commit {
    pub tree: Hash,
    pub packs: Packs,
    pub parent: Option<Hash>,
    pub message: String,
    pub time: u64,
    pub autosave: bool,
    pub merged: Option<Hash>,
    pub session: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Packs {
    pub recent: Vec<Tree>,
    pub packed: Vec<(Hash, Hash)>,
    pub written: u64,
    pub repacked: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pack {
    pub trees: Vec<(Hash, Tree)>,
    pub sharded: Vec<(Hash, Vec<Hash>)>,
    pub packed: Vec<(Hash, Hash)>,
}

impl Commit {
    pub fn new(tree: Hash, packs: Packs, parent: Option<Hash>, message: &str) -> Self {
        let time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_secs());
        Self {
            tree,
            packs,
            parent,
            message: message.to_string(),
            time,
            autosave: false,
            merged: None,
            session: None,
        }
    }

    pub fn autosave(tree: Hash, packs: Packs, parent: Hash) -> Self {
        Self {
            autosave: true,
            ..Self::new(tree, packs, Some(parent), "autosave")
        }
    }

    pub fn parents(&self) -> impl Iterator<Item = Hash> + use<> {
        self.parent.into_iter().chain(self.merged)
    }
}
