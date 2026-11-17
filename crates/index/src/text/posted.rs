use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::Arc;

use futures::future::try_join_all;
use tantivy::query::Bm25Weight;

use super::part::PartRef;
use super::postings::Directory;
use super::postings::read;
use super::postings::score::{Hit, Term, search};
use super::postings::span::Span;
use crate::store::Storage;
use crate::{Id, Result};

pub(super) struct Posted {
    pub directory: Arc<Directory>,
    pub spans: Vec<Option<Arc<Span>>>,
}

impl Posted {
    pub(super) async fn load(
        storage: &Storage,
        directory: Option<Arc<Directory>>,
        clauses: &[(&str, &str)],
    ) -> Result<Option<Self>> {
        let Some(directory) = directory else {
            return Ok(None);
        };
        let distinct: BTreeSet<(&str, &str)> = clauses.iter().copied().collect();
        let reads =
            (distinct.iter()).map(|(field, term)| read::span(storage, &directory, field, term));
        let read: BTreeMap<_, _> = distinct.iter().zip(try_join_all(reads).await?).collect();
        let spans = clauses.iter().map(|clause| read[clause].clone()).collect();
        Ok(Some(Self { directory, spans }))
    }

    pub(super) fn search(
        &self,
        weights: &[Bm25Weight],
        blocked: Option<&[u64]>,
        k: usize,
        floor: f32,
    ) -> Vec<Hit> {
        let terms: Vec<Term> = (self.spans.iter().zip(weights))
            .filter_map(|(span, weight)| {
                Some(Term {
                    span: span.clone()?,
                    weight: weight.clone(),
                })
            })
            .collect();
        search(&terms, self.directory.docs, blocked, k, floor)
    }

    pub(super) async fn ids(&self, storage: &Storage, docs: &[u32]) -> Result<HashMap<u32, Id>> {
        let known: HashMap<u32, Id> = (self.spans.iter().flatten())
            .flat_map(|span| &span.head.best)
            .filter(|best| docs.contains(&best.doc))
            .filter_map(|best| Some((best.doc, best.id.clone()?)))
            .collect();
        let ids = read::ids(storage, &self.directory, docs, &known).await?;
        Ok(docs.iter().copied().zip(ids).collect())
    }
}

pub(super) async fn dead_words(storage: &Storage, part: &PartRef) -> Result<Option<Arc<Vec<u64>>>> {
    let Some(hash) = part.dead.filter(|_| part.postings.is_some()) else {
        return Ok(None);
    };
    let key = crate::store::part(hash, "words");
    if let Some(found) = storage.cache().get(key) {
        return Ok(Some(found));
    }
    let bits = storage.get::<Vec<u8>>(hash).await?;
    let words: Vec<u64> = (bits.chunks(8))
        .map(|chunk| {
            let mut eight = [0u8; 8];
            eight[..chunk.len()].copy_from_slice(chunk);
            u64::from_le_bytes(eight)
        })
        .collect();
    let words = Arc::new(words);
    storage
        .cache()
        .insert(key, words.clone(), 8 * words.len() + 64);
    Ok(Some(words))
}

pub(super) async fn directory(storage: &Storage, part: &PartRef) -> Result<Option<Arc<Directory>>> {
    match &part.postings {
        Some(postings) => Ok(Some(read::opened(storage, postings).await?)),
        None => Ok(None),
    }
}

pub(super) fn blocked<'a>(
    docs: u32,
    dead: Option<&'a [u64]>,
    hidden: impl Iterator<Item = u32>,
    allowed: Option<&[u8]>,
) -> Option<Cow<'a, [u64]>> {
    let mut hidden = hidden.peekable();
    if allowed.is_none() && hidden.peek().is_none() {
        return dead.map(Cow::Borrowed);
    }
    let mut words = vec![0u64; (docs as usize).div_ceil(64)];
    for (word, dead) in words.iter_mut().zip(dead.unwrap_or_default()) {
        *word = *dead;
    }
    if let Some(allowed) = allowed {
        for (at, word) in words.iter_mut().enumerate() {
            let mut eight = [0u8; 8];
            let from = allowed.get(at * 8..).unwrap_or_default();
            let len = from.len().min(8);
            eight[..len].copy_from_slice(&from[..len]);
            *word |= !u64::from_le_bytes(eight);
        }
    }
    for doc in hidden {
        if let Some(word) = words.get_mut(doc as usize / 64) {
            *word |= 1 << (doc % 64);
        }
    }
    Some(Cow::Owned(words))
}
