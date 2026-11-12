//! The analyzed text of tail segments.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use skywake_core::Hash;

use super::TextOptions;
use super::fields::{analyzer, analyzer_name, tokens};
use super::part::blocking;
use crate::format::Segment;
use crate::store::Storage;
use crate::{Result, Value};

pub(crate) struct TailText {
    vocab: HashMap<String, u32>,
    terms: Vec<String>,
    rows: Vec<Vec<Option<Vec<u32>>>>,
}

impl TailText {
    fn new(segment: &Segment, fields: &[(String, TextOptions)]) -> Self {
        let mut analyzers: Vec<_> = fields.iter().map(|(_, o)| analyzer(o)).collect();
        let mut text = TailText {
            vocab: HashMap::new(),
            terms: Vec::new(),
            rows: Vec::with_capacity(segment.attributes.len()),
        };
        for attributes in &segment.attributes {
            let row = (fields.iter().zip(&mut analyzers))
                .map(|((name, _), analyzer)| match attributes.get(name) {
                    Some(Value::String(value)) => Some(
                        (tokens(analyzer, value).into_iter())
                            .map(|token| text.number(token))
                            .collect(),
                    ),
                    Some(Value::Strings(list)) => Some(
                        (list.iter())
                            .flat_map(|value| tokens(analyzer, value))
                            .map(|token| text.number(token))
                            .collect(),
                    ),
                    _ => None,
                })
                .collect();
            text.rows.push(row);
        }
        text
    }

    fn number(&mut self, token: String) -> u32 {
        if let Some(&n) = self.vocab.get(&token) {
            return n;
        }
        let n = self.terms.len() as u32;
        self.terms.push(token.clone());
        self.vocab.insert(token, n);
        n
    }

    fn weight(&self) -> usize {
        let tokens: usize = (self.rows.iter().flatten().flatten())
            .map(|tokens| 4 * tokens.len() + 24)
            .sum();
        tokens + self.terms.iter().map(|t| 2 * t.len() + 48).sum::<usize>()
    }

    pub(super) fn term(&self, token: &str) -> Option<u32> {
        self.vocab.get(token).copied()
    }

    pub(super) fn tokens(&self, row: usize, f: usize) -> Option<&[u32]> {
        self.rows[row][f].as_deref()
    }

    pub(super) fn terms(&self) -> &[String] {
        &self.terms
    }

    pub(super) fn starting(&self, prefix: &str) -> HashSet<u32> {
        (self.terms.iter().enumerate())
            .filter(|(_, term)| term.starts_with(prefix))
            .map(|(n, _)| n as u32)
            .collect()
    }
}

pub(crate) fn holds(tokens: &[u32], phrase: &[u32], last: Option<&HashSet<u32>>) -> bool {
    let len = phrase.len() + last.is_some() as usize;
    if len == 0 || tokens.len() < len {
        return false;
    }
    tokens.windows(len).any(|window| {
        window[..phrase.len()] == *phrase
            && last.is_none_or(|last| last.contains(&window[phrase.len()]))
    })
}

pub(crate) async fn analyzed(
    storage: &Storage,
    hash: Hash,
    segment: Arc<Segment>,
    fields: Arc<Vec<(String, TextOptions)>>,
) -> Result<Arc<TailText>> {
    let names: Vec<String> = (fields.iter())
        .map(|(name, options)| format!("{name}:{}", analyzer_name(options)))
        .collect();
    let key = Hash::of(format!("{hash}/text/{}", names.join(",")).as_bytes());
    if let Some(found) = storage.cache().get(key) {
        return Ok(found);
    }
    let text = Arc::new(blocking(move || TailText::new(&segment, &fields)).await?);
    storage.cache().insert(key, text.clone(), text.weight());
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phrases_and_prefixes_match_in_order() {
        let tokens = [1, 2, 3, 4];
        assert!(holds(&tokens, &[2, 3], None));
        assert!(!holds(&tokens, &[3, 2], None));
        let last: HashSet<u32> = [4].into();
        assert!(holds(&tokens, &[3], Some(&last)));
        assert!(!holds(&tokens, &[2], Some(&last)));
        assert!(holds(&tokens, &[], Some(&last)));
        assert!(!holds(&tokens, &[], None));
    }
}
