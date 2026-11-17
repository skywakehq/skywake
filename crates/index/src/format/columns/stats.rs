use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::chunk::Chunk;
use crate::Value;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub(crate) struct Stats {
    pub rows: u32,
    pub missing: u32,
    pub min: Option<Value>,
    pub max: Option<Value>,
    pub histogram: Option<Vec<(u32, u32)>>,
    pub sum: Option<f64>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub(crate) struct Totals {
    pub rows: u64,
    pub missing: u64,
    pub min: Option<Value>,
    pub max: Option<Value>,
    pub histogram: Vec<u64>,
}

impl Stats {
    pub(crate) fn of(chunk: &Chunk, values: &[Option<Value>]) -> Self {
        let present = || values.iter().flatten().filter(|value| scalar(value));
        let missing = values.iter().filter(|value| value.is_none()).count() as u32;
        let histogram = chunk.codes().map(|codes| {
            let mut counts: BTreeMap<u32, u32> = BTreeMap::new();
            for (row, code) in codes.into_iter().enumerate() {
                if !chunk.is_missing(row) {
                    *counts.entry(code).or_default() += 1;
                }
            }
            counts.into_iter().collect()
        });
        let numbers: Vec<f64> = present()
            .filter_map(|value| match value {
                Value::Number(n) => Some(*n),
                Value::Int(n) => Some(*n as f64),
                _ => None,
            })
            .collect();
        let nan = (values.iter().flatten()).any(|v| matches!(v, Value::Number(n) if n.is_nan()));
        let bounded = |pick: Option<&Value>| pick.filter(|_| !nan).cloned();
        Self {
            rows: values.len() as u32,
            missing,
            min: bounded(present().min_by(|a, b| a.order(b))),
            max: bounded(present().max_by(|a, b| a.order(b))),
            histogram,
            sum: (!numbers.is_empty()).then(|| numbers.iter().sum()),
        }
    }
}

impl Totals {
    pub(crate) fn add(&mut self, stats: &Stats) {
        self.rows += stats.rows as u64;
        self.missing += stats.missing as u64;
        self.min = extreme(self.min.take(), stats.min.clone(), true);
        self.max = extreme(self.max.take(), stats.max.clone(), false);
        for &(code, count) in stats.histogram.iter().flatten() {
            let code = code as usize;
            if self.histogram.len() <= code {
                self.histogram.resize(code + 1, 0);
            }
            self.histogram[code] += count as u64;
        }
    }
}

fn scalar(value: &Value) -> bool {
    match value {
        Value::Number(n) => !n.is_nan(),
        Value::String(_) | Value::Bool(_) | Value::Int(_) | Value::Uuid(_) | Value::Datetime(_) => {
            true
        }
        _ => false,
    }
}

fn extreme(a: Option<Value>, b: Option<Value>, lowest: bool) -> Option<Value> {
    match (a, b) {
        (Some(a), Some(b)) => {
            let b_wins = match lowest {
                true => b.order(&a).is_lt(),
                false => b.order(&a).is_gt(),
            };
            Some(if b_wins { b } else { a })
        }
        (a, b) => a.or(b),
    }
}

#[cfg(test)]
mod tests {
    use super::super::chunk::Layout;
    use super::super::dictionary::{Coder, Dictionary};
    use super::*;

    #[test]
    fn stats_and_totals_count_what_is_there() {
        let mut coder = Coder::new(Dictionary::default());
        let pages: Vec<Vec<Option<Value>>> = vec![
            vec![Some("b".into()), None, Some("a".into()), Some("b".into())],
            vec![Some("c".into()), Some("a".into()), None],
        ];
        let mut totals = Totals::default();
        for values in &pages {
            let chunk = Chunk::encode(values, Layout::Dictionary, &mut coder);
            totals.add(&Stats::of(&chunk, values));
        }
        let dictionary = coder.finish();
        assert_eq!((totals.rows, totals.missing), (7, 2));
        assert_eq!(totals.min, Some(Value::from("a")));
        assert_eq!(totals.max, Some(Value::from("c")));
        let by_value: BTreeMap<String, u64> = (totals.histogram.iter().enumerate())
            .map(|(code, &n)| match &dictionary.values[code] {
                Value::String(s) => (s.clone(), n),
                other => panic!("{other:?}"),
            })
            .collect();
        assert_eq!(
            by_value,
            BTreeMap::from([("a".into(), 2), ("b".into(), 2), ("c".into(), 1)])
        );

        let numbers = vec![Some(Value::Number(2.5)), None, Some(Value::Number(-1.0))];
        let mut coder = Coder::new(Dictionary::default());
        let chunk = Chunk::encode(&numbers, Layout::Floats, &mut coder);
        let stats = Stats::of(&chunk, &numbers);
        assert_eq!(stats.sum, Some(1.5));
        assert_eq!(stats.histogram, None);
        assert_eq!(stats.min, Some(Value::Number(-1.0)));
    }
}
