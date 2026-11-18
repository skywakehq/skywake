use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::Value;

pub(crate) const MAX_CODES: usize = 1 << 16;
pub(crate) const GROUPED_CODES: usize = 1 << 20;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub(crate) struct Dictionary {
    pub values: Vec<Value>,
    pub ranks: Vec<u32>,
}

#[derive(Clone, PartialEq, Eq, Hash)]
pub(crate) enum Word {
    Bool(bool),
    Int(i64),
    Number(u64),
    String(String),
    Uuid(u128),
    Datetime(i64),
}

impl Word {
    pub(crate) fn of(value: &Value) -> Option<Self> {
        Some(match value {
            Value::Bool(b) => Word::Bool(*b),
            Value::Int(n) => Word::Int(*n),
            Value::Number(n) if !n.is_nan() => Word::Number(n.to_bits()),
            Value::String(s) => Word::String(s.clone()),
            Value::Uuid(u) => Word::Uuid(*u),
            Value::Datetime(t) => Word::Datetime(*t),
            _ => return None,
        })
    }
}

pub(crate) struct Coder {
    pub dictionary: Dictionary,
    codes: HashMap<Word, u32>,
    limit: usize,
}

impl Coder {
    #[cfg(test)]
    pub(crate) fn new(dictionary: Dictionary) -> Self {
        Self::with_limit(dictionary, MAX_CODES)
    }

    pub(crate) fn with_limit(dictionary: Dictionary, limit: usize) -> Self {
        let codes = (dictionary.values.iter().enumerate())
            .filter_map(|(code, value)| Some((Word::of(value)?, code as u32)))
            .collect();
        Self {
            dictionary,
            codes,
            limit,
        }
    }

    pub(crate) fn code(&mut self, value: &Value) -> Option<u32> {
        let word = Word::of(value)?;
        if let Some(&code) = self.codes.get(&word) {
            return Some(code);
        }
        if self.dictionary.values.len() >= self.limit {
            return None;
        }
        let code = self.dictionary.values.len() as u32;
        self.dictionary.values.push(value.clone());
        self.codes.insert(word, code);
        Some(code)
    }

    pub(crate) fn finish(mut self) -> Dictionary {
        let values = &self.dictionary.values;
        let mut order: Vec<u32> = (0..values.len() as u32).collect();
        order.sort_by(|&a, &b| values[a as usize].order(&values[b as usize]));
        let mut ranks = vec![0; values.len()];
        for (rank, code) in order.into_iter().enumerate() {
            ranks[code as usize] = rank as u32;
        }
        self.dictionary.ranks = ranks;
        self.dictionary
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_stay_put_and_ranks_follow_value_order() {
        let mut coder = Coder::new(Dictionary::default());
        for word in ["pear", "apple", "fig", "apple"] {
            coder.code(&Value::from(word));
        }
        let first = coder.finish();
        assert_eq!(first.values.len(), 3);
        assert_eq!(first.ranks, vec![2, 0, 1]);

        let mut coder = Coder::new(first.clone());
        assert_eq!(coder.code(&Value::from("fig")), Some(2));
        assert_eq!(coder.code(&Value::from("banana")), Some(3));
        let second = coder.finish();
        assert_eq!(second.values[..3], first.values[..]);
        assert_eq!(second.ranks, vec![3, 0, 2, 1]);
    }

    #[test]
    fn zeros_keep_their_sign_and_nan_has_no_code() {
        let mut coder = Coder::new(Dictionary::default());
        let zero = coder.code(&Value::Number(0.0));
        assert_ne!(coder.code(&Value::Number(-0.0)), zero);
        assert_eq!(coder.code(&Value::Number(f64::NAN)), None);
    }
}
