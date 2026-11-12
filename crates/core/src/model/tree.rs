//! Directory trees: entries, file data and where its chunks are stored.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::Hash;

pub type Tree = BTreeMap<String, Entry>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Entry {
    File {
        size: u64,
        modified_ns: u64,
        mode: u32,
        data: Data,
    },
    Dir {
        tree: Hash,
    },
    Symlink {
        target: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Data {
    Inline(Vec<u8>),
    Chunks(Vec<Chunk>),
    // Last, so trees written before it still read.
    Bundled(Bundled),
}

impl Data {
    pub fn len(&self) -> u64 {
        match self {
            Data::Inline(bytes) => bytes.len() as u64,
            data => data
                .chunks()
                .iter()
                .map(|chunk| u64::from(chunk.size))
                .sum(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn same_bytes(&self, other: &Data) -> bool {
        match (self, other) {
            (Data::Inline(a), Data::Inline(b)) => a == b,
            (Data::Inline(bytes), data) | (data, Data::Inline(bytes)) => match data.chunks() {
                [] => bytes.is_empty(),
                [chunk] => chunk.size as usize == bytes.len() && chunk.hash == Hash::of(bytes),
                _ => false,
            },
            (a, b) => a.chunks() == b.chunks(),
        }
    }

    pub fn chunks(&self) -> &[Chunk] {
        match self {
            Data::Inline(_) => &[],
            Data::Chunks(chunks) => chunks,
            Data::Bundled(bundled) => std::slice::from_ref(&bundled.chunk),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Chunk {
    pub hash: Hash,
    pub size: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Bundled {
    pub chunk: Chunk,
    pub bundle: Hash,
    pub offset: u32,
    pub len: u32,
}

pub const FILE_MODE: u32 = 0o644;
pub const EXECUTABLE_MODE: u32 = 0o755;

pub(crate) fn valid_entry_name(name: &str) -> bool {
    !matches!(name, "" | "." | "..") && !name.contains(['/', '\0'])
}

pub fn permissions(mode: u32) -> u32 {
    mode & 0o7777
}

impl Entry {
    pub fn is_executable(&self) -> bool {
        matches!(self, Entry::File { mode, .. } if mode & 0o111 != 0)
    }
    pub fn same_content(&self, other: &Entry) -> bool {
        match (self, other) {
            (
                Entry::File {
                    size: a,
                    mode: x,
                    data: p,
                    ..
                },
                Entry::File {
                    size: b,
                    mode: y,
                    data: q,
                    ..
                },
            ) => a == b && x == y && p.same_bytes(q),
            _ => self == other,
        }
    }
}
