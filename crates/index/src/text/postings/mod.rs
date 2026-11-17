pub(crate) mod build;
mod cursor;
mod pack;
pub(crate) mod read;
pub(crate) mod score;
pub(crate) mod span;
#[cfg(test)]
mod tests;

use serde::{Deserialize, Serialize};
use skywake_core::Hash;

use super::engine;
use super::part::IdMap;
use crate::{Error, Result};

pub(crate) const ID_BLOCK: usize = 1024;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct PostingsRef {
    pub directory: Hash,
    pub directory_bytes: u64,
    pub blobs: Vec<Hash>,
    pub bytes: u64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub(crate) struct Place {
    pub blob: u32,
    pub start: u64,
    pub len: u64,
}

#[derive(Serialize, Deserialize)]
pub(crate) struct Directory {
    pub docs: u32,
    pub fields: Vec<(String, u64)>,
    pub blobs: Vec<Hash>,
    pub buckets: Vec<Place>,
    pub long: Vec<(u64, Place)>,
    pub id_blocks: Vec<Place>,
    pub ids: IdMap,
}

impl Directory {
    fn encode(&self) -> Result<Vec<u8>> {
        let raw = postcard::to_stdvec(self)?;
        zstd::encode_all(&raw[..], 3).map_err(engine)
    }

    fn decode(bytes: &[u8]) -> Result<Self> {
        let raw = zstd::decode_all(bytes).map_err(engine)?;
        Ok(postcard::from_bytes(&raw)?)
    }

    fn weight(&self) -> usize {
        1024 + 32 * (self.buckets.len() + self.long.len() + self.id_blocks.len() + self.blobs.len())
            + 8 * self.ids.firsts.len()
    }

    pub(crate) fn field(&self, name: &str) -> Option<u16> {
        let at = self.fields.iter().position(|(field, _)| field == name)?;
        u16::try_from(at).ok()
    }

    pub(crate) fn tokens(&self, name: &str) -> u64 {
        (self.fields.iter())
            .find(|(field, _)| field == name)
            .map_or(0, |(_, tokens)| *tokens)
    }

    fn blob(&self, place: &Place) -> Result<Hash> {
        (self.blobs.get(place.blob as usize).copied())
            .ok_or_else(|| Error::Corrupt("a posting directory names a blob it lacks".into()))
    }
}

pub(crate) fn sum(bytes: &[u8]) -> u64 {
    let hash = blake3::hash(bytes);
    u64::from_le_bytes(hash.as_bytes()[..8].try_into().unwrap_or_default())
}

pub(crate) fn term_key(field: &str, term: &str) -> u64 {
    let mut hasher = blake3::Hasher::new();
    hasher.update(&(field.len() as u64).to_le_bytes());
    hasher.update(field.as_bytes());
    hasher.update(term.as_bytes());
    let hash = hasher.finalize();
    u64::from_le_bytes(hash.as_bytes()[..8].try_into().unwrap_or_default())
}
