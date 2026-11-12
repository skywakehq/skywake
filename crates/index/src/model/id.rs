//! Document ids, and the kind of ids an index takes.

use std::fmt;

use serde::{Deserialize, Serialize};

use crate::{Result, invalid};

#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Id {
    Num(u64),
    Str(String),
    Uuid([u8; 16]),
}

impl From<u64> for Id {
    fn from(id: u64) -> Self {
        Id::Num(id)
    }
}

impl From<&str> for Id {
    fn from(id: &str) -> Self {
        Id::Str(id.to_string())
    }
}

impl From<String> for Id {
    fn from(id: String) -> Self {
        Id::Str(id)
    }
}

impl fmt::Display for Id {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Id::Num(id) => write!(f, "{id}"),
            Id::Str(id) => f.write_str(id),
            Id::Uuid(bytes) => f.write_str(&uuid_text(u128::from_be_bytes(*bytes))),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum IdKind {
    #[default]
    Any,
    Uuid,
}

impl IdKind {
    pub(crate) fn check(self, id: Id) -> Result<Id> {
        match (self, id) {
            (IdKind::Any, Id::Uuid(bytes)) => Err(invalid(format!(
                "id {}: this index takes number and string ids",
                Id::Uuid(bytes)
            ))),
            (IdKind::Uuid, Id::Str(text)) => match parse_uuid(&text) {
                Some(uuid) => Ok(Id::Uuid(uuid.to_be_bytes())),
                None => Err(invalid(format!("id `{text}` is not a UUID"))),
            },
            (IdKind::Uuid, Id::Num(n)) => Err(invalid(format!("id {n} is not a UUID"))),
            (_, id) => Ok(id),
        }
    }
}

pub fn parse_uuid(text: &str) -> Option<u128> {
    let dashes = [8, 13, 18, 23];
    let digits: String = match text.len() {
        36 if dashes.iter().all(|&at| text.as_bytes()[at] == b'-') => {
            text.chars().filter(|&c| c != '-').collect()
        }
        32 => text.to_string(),
        _ => return None,
    };
    if !digits.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    u128::from_str_radix(&digits, 16).ok()
}

pub fn uuid_text(uuid: u128) -> String {
    let hex = format!("{uuid:032x}");
    format!(
        "{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    )
}
