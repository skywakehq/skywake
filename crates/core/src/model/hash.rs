use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Deserializer, Serialize, Serializer};

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct Hash(blake3::Hash);

impl Hash {
    pub fn of(bytes: &[u8]) -> Self {
        Self(blake3::hash(bytes))
    }

    pub(crate) fn as_bytes(&self) -> &[u8; 32] {
        self.0.as_bytes()
    }

    pub(crate) fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(blake3::Hash::from_bytes(bytes))
    }

    pub fn short(&self) -> String {
        self.to_string()[..12].to_string()
    }
}

impl fmt::Display for Hash {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.0.to_hex().as_str())
    }
}

impl fmt::Debug for Hash {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Hash({})", self.short())
    }
}

impl FromStr for Hash {
    type Err = blake3::HexError;

    fn from_str(hex: &str) -> Result<Self, Self::Err> {
        blake3::Hash::from_hex(hex).map(Self)
    }
}

impl Serialize for Hash {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.0.as_bytes().serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for Hash {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        <[u8; 32]>::deserialize(deserializer).map(|bytes| Self(blake3::Hash::from_bytes(bytes)))
    }
}
