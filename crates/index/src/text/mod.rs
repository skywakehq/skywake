//! Full-text search: BM25 over text attributes, on Tantivy.

pub(crate) mod build;
mod dir;
mod fields;
mod highlight;
mod hybrid;
pub(crate) mod part;
mod search;
mod tail;
#[cfg(test)]
mod tests;

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

pub use dir::sync_misses;
pub(crate) use hybrid::hybrid;
pub(crate) use search::search;

use crate::format::Version;
use crate::store::Storage;
use crate::{Attributes, Error, Filter, Id, Per, Query, Result, Score};

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct TextOptions {
    pub k1: f32,
    pub b: f32,
    pub language: Language,
    pub stopwords: bool,
    #[serde(default = "yes")]
    pub stemming: bool,
    /// Also filtered by its whole value, like a string attribute.
    #[serde(default)]
    pub filterable: bool,
    #[serde(default)]
    pub case_sensitive: bool,
    /// Letters with accents match the same letters without them.
    #[serde(default)]
    pub ascii_folding: bool,
    /// Longer words are left out.
    #[serde(default = "max_token")]
    pub max_token: u16,
    /// A list of strings, each one word as it is.
    #[serde(default)]
    pub pre_tokenized: bool,
}

fn yes() -> bool {
    true
}

fn max_token() -> u16 {
    39
}

impl Default for TextOptions {
    fn default() -> Self {
        Self {
            k1: 1.2,
            b: 0.75,
            language: Language::English,
            stopwords: false,
            stemming: true,
            filterable: false,
            case_sensitive: false,
            ascii_folding: false,
            max_token: max_token(),
            pre_tokenized: false,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    #[default]
    English,
    Arabic,
    Danish,
    Dutch,
    Finnish,
    French,
    German,
    Greek,
    Hungarian,
    Italian,
    Norwegian,
    Portuguese,
    Romanian,
    Russian,
    Spanish,
    Swedish,
    Tamil,
    Turkish,
    None,
}

#[derive(Clone, Debug, Default)]
pub struct TextQuery {
    pub query: String,
    pub fields: Vec<(String, f32)>,
    pub top_k: usize,
    pub k1: Option<f32>,
    pub b: Option<f32>,
    pub filter: Option<Filter>,
    pub matches: Vec<Match>,
    pub include: Vec<String>,
    pub highlight: Vec<String>,
    pub offset: usize,
    pub per: Option<Per>,
    pub fuzzy: u8,
    /// The last word also matches the longer words it starts.
    pub last_as_prefix: bool,
}

impl TextQuery {
    pub fn new(query: &str, top_k: usize) -> Self {
        Self {
            query: query.to_string(),
            top_k,
            ..Self::default()
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Match {
    Phrase(String, String),
    Prefix(String, String),
    AllTokens(String, String),
    AnyToken(String, String),
}

impl Match {
    pub fn name(&self) -> &str {
        let (Match::Phrase(name, _)
        | Match::Prefix(name, _)
        | Match::AllTokens(name, _)
        | Match::AnyToken(name, _)) = self;
        name
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct TextHit {
    pub id: Id,
    pub score: f32,
    pub attributes: Attributes,
    pub highlights: BTreeMap<String, Highlight>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Highlight {
    pub text: String,
    pub marks: Vec<(u32, u32)>,
}

#[derive(Clone, Debug)]
pub enum Search {
    Vector(Query),
    Text(TextQuery),
}

#[derive(Clone, Debug)]
pub struct Hybrid {
    pub searches: Vec<(String, Search)>,
    pub k: f32,
    pub weights: BTreeMap<String, f32>,
    pub top_k: usize,
    pub offset: usize,
    pub per: Option<Per>,
    pub rank: Option<Score>,
}

impl Hybrid {
    pub(crate) fn include(&self) -> Vec<String> {
        let mut names: Vec<String> = (self.searches.iter())
            .flat_map(|(_, search)| match search {
                Search::Vector(query) => &query.include,
                Search::Text(query) => &query.include,
            })
            .cloned()
            .collect();
        names.sort();
        names.dedup();
        names
    }

    pub(crate) fn widened(&self, top_k: usize, include: &[String]) -> Hybrid {
        let asked = (self.top_k + self.offset).max(1);
        let mut hybrid = Hybrid {
            top_k,
            offset: 0,
            per: None,
            ..self.clone()
        };
        for (_, search) in &mut hybrid.searches {
            let (k, names) = match search {
                Search::Vector(query) => (&mut query.top_k, &mut query.include),
                Search::Text(query) => (&mut query.top_k, &mut query.include),
            };
            *k = (*k * top_k).div_ceil(asked);
            *names = include.to_vec();
        }
        hybrid
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct FusedHit {
    pub id: Id,
    pub score: f32,
    pub ranks: BTreeMap<String, u32>,
    pub scores: BTreeMap<String, f32>,
    pub attributes: Attributes,
    pub highlights: BTreeMap<String, Highlight>,
}

pub(crate) async fn counts(
    storage: &Storage,
    version: &Version,
    tail: impl Iterator<Item = &Id>,
) -> Result<(u64, u64, u64)> {
    let Some(text) = &version.text else {
        return Ok((0, 0, 0));
    };
    let mut keys: Vec<u64> = tail.map(fields::key).collect();
    keys.sort_unstable();
    keys.dedup();
    let (mut live, mut replaced, mut bytes) = (0, 0, 0);
    for p in &text.parts {
        live += (p.docs - p.dead_docs) as u64;
        bytes += p.bytes;
        let opened = part::open(storage, p.hot, p.hot_bytes).await?;
        let dead = part::dead(storage, p).await?;
        let found = part::find(storage, &opened.ids, &keys).await?;
        replaced += (found.values())
            .filter(|&&doc| !dead.as_deref().is_some_and(|bits| part::is_set(bits, doc)))
            .count() as u64;
    }
    Ok((live, replaced, bytes))
}

fn engine(error: impl std::fmt::Display) -> Error {
    Error::Store(object_store::Error::Generic {
        store: "skywake-text",
        source: error.to_string().into(),
    })
}
