use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::dictionary::{Coder, Dictionary};
use super::packed::Packed;
use crate::Value;

const RUN_SHARE: usize = 8;
const FREQUENT_SHARE: f64 = 0.9;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct Chunk {
    pub rows: u32,
    pub missing: Option<Vec<u64>>,
    pub data: Data,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) enum Data {
    Empty,
    Constant(u32),
    Runs {
        codes: Vec<u32>,
        ends: Vec<u32>,
    },
    Frequent {
        common: u32,
        rows: Vec<u32>,
        codes: Vec<u32>,
    },
    Codes(Packed),
    Ints {
        base: i64,
        packed: Packed,
    },
    Floats(Vec<f64>),
    Values(Vec<Value>),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum Layout {
    Dictionary,
    Ints,
    Datetimes,
    Floats,
    Values,
}

impl Chunk {
    pub(crate) fn encode(values: &[Option<Value>], layout: Layout, coder: &mut Coder) -> Self {
        let rows = values.len() as u32;
        let missing = missing_bits(values);
        let present = || values.iter().flatten();
        let data = if present().next().is_none() {
            Data::Empty
        } else {
            match layout {
                Layout::Dictionary => match codes(values, coder) {
                    Some(codes) => by_codes(codes),
                    None => Data::Values(filled(values)),
                },
                Layout::Ints | Layout::Datetimes => match ints(values) {
                    Some(ints) => frame(&ints),
                    None => Data::Values(filled(values)),
                },
                Layout::Floats => match floats(values) {
                    Some(floats) => Data::Floats(floats),
                    None => Data::Values(filled(values)),
                },
                Layout::Values => Data::Values(filled(values)),
            }
        };
        Self {
            rows,
            missing,
            data,
        }
    }

    pub(crate) fn is_missing(&self, row: usize) -> bool {
        match &self.data {
            Data::Empty => true,
            _ => (self.missing.as_ref()).is_some_and(|bits| bits[row / 64] >> (row % 64) & 1 == 1),
        }
    }

    pub(crate) fn codes(&self) -> Option<Vec<u32>> {
        let rows = self.rows as usize;
        Some(match &self.data {
            Data::Constant(code) => vec![*code; rows],
            Data::Runs { codes, ends } => {
                let mut out = Vec::with_capacity(rows);
                for (&code, &end) in codes.iter().zip(ends) {
                    out.resize(end as usize, code);
                }
                out
            }
            Data::Frequent {
                common,
                rows: at,
                codes,
            } => {
                let mut out = vec![*common; rows];
                for (&row, &code) in at.iter().zip(codes) {
                    out[row as usize] = code;
                }
                out
            }
            Data::Codes(packed) => packed.unpack().into_iter().map(|c| c as u32).collect(),
            _ => return None,
        })
    }

    pub(crate) fn values(&self, layout: Layout, dictionary: &Dictionary) -> Vec<Option<Value>> {
        let rows = self.rows as usize;
        let all: Vec<Value> = match (&self.data, self.codes()) {
            (Data::Empty, _) => return vec![None; rows],
            (_, Some(codes)) => (codes.into_iter())
                .map(|code| dictionary.values[code as usize].clone())
                .collect(),
            (Data::Ints { base, packed }, _) => (packed.unpack().into_iter())
                .map(|offset| {
                    let n = base.wrapping_add(offset as i64);
                    match layout {
                        Layout::Datetimes => Value::Datetime(n),
                        _ => Value::Int(n),
                    }
                })
                .collect(),
            (Data::Floats(floats), _) => floats.iter().map(|&n| Value::Number(n)).collect(),
            (Data::Values(values), _) => values.clone(),
            _ => unreachable!("every coded layout has codes"),
        };
        (all.into_iter().enumerate())
            .map(|(row, value)| (!self.is_missing(row)).then_some(value))
            .collect()
    }
}

fn missing_bits(values: &[Option<Value>]) -> Option<Vec<u64>> {
    if values.iter().all(Option::is_some) {
        return None;
    }
    let mut bits = vec![0u64; values.len().div_ceil(64)];
    for (row, value) in values.iter().enumerate() {
        if value.is_none() {
            bits[row / 64] |= 1 << (row % 64);
        }
    }
    Some(bits)
}

fn filled(values: &[Option<Value>]) -> Vec<Value> {
    let filler = values.iter().flatten().next().cloned();
    (values.iter())
        .map(|value| value.clone().or_else(|| filler.clone()))
        .collect::<Option<_>>()
        .unwrap_or_default()
}

fn codes(values: &[Option<Value>], coder: &mut Coder) -> Option<Vec<u32>> {
    let mut codes = Vec::with_capacity(values.len());
    let mut filler = None;
    for value in values {
        match value {
            Some(value) => {
                let code = coder.code(value)?;
                filler.get_or_insert(code);
                codes.push(Some(code));
            }
            None => codes.push(None),
        }
    }
    let filler = filler?;
    Some(codes.into_iter().map(|c| c.unwrap_or(filler)).collect())
}

fn by_codes(codes: Vec<u32>) -> Data {
    let first = codes[0];
    if codes.iter().all(|&c| c == first) {
        return Data::Constant(first);
    }
    let runs = 1 + codes.windows(2).filter(|w| w[0] != w[1]).count();
    let mut counts: HashMap<u32, usize> = HashMap::new();
    codes
        .iter()
        .for_each(|&c| *counts.entry(c).or_default() += 1);
    let (&common, &most) = (counts.iter())
        .max_by_key(|&(code, count)| (count, std::cmp::Reverse(code)))
        .expect("a chunk with values has a most common code");
    let exceptions = codes.len() - most;
    let frequent = most as f64 >= FREQUENT_SHARE * codes.len() as f64;
    if frequent && exceptions <= runs {
        return exceptions_of(&codes, common);
    }
    if runs * RUN_SHARE <= codes.len() {
        return runs_of(&codes, runs);
    }
    if frequent {
        return exceptions_of(&codes, common);
    }
    let wide: Vec<u64> = codes.into_iter().map(u64::from).collect();
    Data::Codes(Packed::new(&wide))
}

fn exceptions_of(codes: &[u32], common: u32) -> Data {
    let rows: Vec<u32> = (0..codes.len() as u32)
        .filter(|&row| codes[row as usize] != common)
        .collect();
    let others = rows.iter().map(|&row| codes[row as usize]).collect();
    Data::Frequent {
        common,
        rows,
        codes: others,
    }
}

fn runs_of(codes: &[u32], runs: usize) -> Data {
    let (mut values, mut ends) = (Vec::with_capacity(runs), Vec::with_capacity(runs));
    for (row, &code) in codes.iter().enumerate() {
        if values.last() != Some(&code) {
            if !values.is_empty() {
                ends.push(row as u32);
            }
            values.push(code);
        }
    }
    ends.push(codes.len() as u32);
    Data::Runs {
        codes: values,
        ends,
    }
}

fn ints(values: &[Option<Value>]) -> Option<Vec<i64>> {
    let present = values.iter().flatten().map(|value| match value {
        Value::Int(n) | Value::Datetime(n) => Some(*n),
        _ => None,
    });
    let present: Vec<i64> = present.collect::<Option<_>>()?;
    let filler = present.first().copied().unwrap_or(0);
    let mut next = present.into_iter();
    Some(
        (values.iter())
            .map(|value| match value {
                Some(_) => next.next().unwrap_or(filler),
                None => filler,
            })
            .collect(),
    )
}

fn frame(ints: &[i64]) -> Data {
    let base = ints.iter().copied().min().unwrap_or(0);
    let offsets: Vec<u64> = (ints.iter())
        .map(|&n| n.wrapping_sub(base) as u64)
        .collect();
    Data::Ints {
        base,
        packed: Packed::new(&offsets),
    }
}

fn floats(values: &[Option<Value>]) -> Option<Vec<f64>> {
    let filler = values.iter().flatten().find_map(|value| match value {
        Value::Number(n) => Some(*n),
        _ => None,
    })?;
    (values.iter())
        .map(|value| match value {
            Some(Value::Number(n)) => Some(*n),
            Some(_) => None,
            None => Some(filler),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn round_trip(values: Vec<Option<Value>>, layout: Layout) -> Data {
        let mut coder = Coder::new(Dictionary::default());
        let chunk = Chunk::encode(&values, layout, &mut coder);
        let dictionary = coder.finish();
        let bytes = postcard::to_stdvec(&chunk).unwrap();
        let back: Chunk = postcard::from_bytes(&bytes).unwrap();
        assert_eq!(back.values(layout, &dictionary), values);
        back.data
    }

    #[test]
    fn each_encoding_is_chosen_and_round_trips() {
        let constant = vec![Some(Value::from("a")); 100];
        assert!(matches!(
            round_trip(constant, Layout::Dictionary),
            Data::Constant(0)
        ));

        let runs: Vec<Option<Value>> = (0..1000)
            .map(|i| Some(Value::from(format!("r{}", i / 100))))
            .collect();
        assert!(matches!(
            round_trip(runs, Layout::Dictionary),
            Data::Runs { .. }
        ));

        let frequent: Vec<Option<Value>> = (0..1000)
            .map(|i| Some(Value::from(if i % 37 == 0 { "rare" } else { "common" })))
            .collect();
        assert!(matches!(
            round_trip(frequent, Layout::Dictionary),
            Data::Frequent { .. }
        ));

        let mixed: Vec<Option<Value>> = (0..1000u64)
            .map(|i| match i.wrapping_mul(2_654_435_761) % 10 {
                0 => None,
                n => Some(Value::from(format!("v{n}"))),
            })
            .collect();
        assert!(matches!(
            round_trip(mixed, Layout::Dictionary),
            Data::Codes(_)
        ));

        let ints: Vec<Option<Value>> = (0..500)
            .map(|i| (i % 9 != 0).then_some(Value::Int(-1_000 + i * 7)))
            .collect();
        assert!(matches!(round_trip(ints, Layout::Ints), Data::Ints { .. }));

        let times: Vec<Option<Value>> = (0..500)
            .map(|i| Some(Value::Datetime(1_700_000_000_000 + i)))
            .collect();
        assert!(matches!(
            round_trip(times, Layout::Datetimes),
            Data::Ints { .. }
        ));

        let floats: Vec<Option<Value>> = (0..500)
            .map(|i| (i % 4 != 0).then_some(Value::Number(i as f64 / 3.0)))
            .collect();
        assert!(matches!(
            round_trip(floats, Layout::Floats),
            Data::Floats(_)
        ));

        let lists: Vec<Option<Value>> = (0..50)
            .map(|i| Some(Value::Strings(vec![format!("t{i}"); i % 3])))
            .collect();
        assert!(matches!(round_trip(lists, Layout::Values), Data::Values(_)));

        assert!(matches!(
            round_trip(vec![None; 10], Layout::Dictionary),
            Data::Empty
        ));
    }

    #[test]
    fn a_full_dictionary_falls_back_to_values() {
        let mut coder = Coder::new(Dictionary::default());
        for n in 0..super::super::dictionary::MAX_CODES as i64 {
            coder.code(&Value::Int(n));
        }
        let values = vec![Some(Value::Int(-1)), Some(Value::Int(0))];
        let chunk = Chunk::encode(&values, Layout::Dictionary, &mut coder);
        assert!(matches!(chunk.data, Data::Values(_)));
        assert_eq!(chunk.values(Layout::Dictionary, &coder.finish()), values);
    }
}
