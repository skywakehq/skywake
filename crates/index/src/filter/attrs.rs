//! The attributes section of a cluster.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::{Attributes, Filter, Id, Kind, Pattern, Value};

#[derive(Default, Serialize, Deserialize)]
pub(crate) struct Attrs {
    pub seqs: Vec<u64>,
    pub columns: BTreeMap<String, Vec<Option<Value>>>,
    pub sets: BTreeMap<String, BTreeMap<Key, Set>>,
}

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub(crate) enum Key {
    Bool(bool),
    String(String),
    Int(i64),
    Uuid(u128),
}

#[derive(Serialize, Deserialize)]
pub(crate) enum Set {
    Bits(Vec<u64>),
    Rows(Vec<u32>),
}

pub(crate) type Bits = Vec<u64>;

impl Attrs {
    pub(crate) fn new(seqs: Vec<u64>, rows: &[Attributes], kinds: &BTreeMap<String, Kind>) -> Self {
        let mut columns: BTreeMap<String, Vec<Option<Value>>> = BTreeMap::new();
        let mut lists: BTreeMap<String, BTreeMap<Key, Vec<u32>>> = BTreeMap::new();
        for (row, attributes) in rows.iter().enumerate() {
            for (name, value) in attributes {
                let column = columns
                    .entry(name.clone())
                    .or_insert_with(|| vec![None; rows.len()]);
                column[row] = Some(value.clone());
                if !matches!(
                    kinds.get(name),
                    Some(
                        Kind::String
                            | Kind::Strings
                            | Kind::Bool
                            | Kind::Int
                            | Kind::Ints
                            | Kind::Uuid
                    )
                ) {
                    continue;
                }
                let keys: Vec<Key> = match value {
                    Value::Strings(list) => list.iter().map(|s| Key::String(s.clone())).collect(),
                    Value::Ints(list) => list.iter().map(|&n| Key::Int(n)).collect(),
                    one => key(one).into_iter().collect(),
                };
                let sets = lists.entry(name.clone()).or_default();
                for key in keys {
                    let list = sets.entry(key).or_default();
                    if list.last() != Some(&(row as u32)) {
                        list.push(row as u32);
                    }
                }
            }
        }
        let sets = lists
            .into_iter()
            .map(|(name, values)| {
                let values = (values.into_iter())
                    .map(|(key, list)| (key, Set::new(list, rows.len())))
                    .collect();
                (name, values)
            })
            .collect();
        Self {
            seqs,
            columns,
            sets,
        }
    }

    pub(crate) fn row(&self, row: usize, names: Option<&[String]>) -> Attributes {
        let wanted = |name: &String| names.is_none_or(|names| names.contains(name));
        (self.columns.iter())
            .filter(|(name, _)| wanted(name))
            .filter_map(|(name, column)| Some((name.clone(), column[row].clone()?)))
            .collect()
    }

    pub(crate) fn eval(&self, filter: &Filter, ids: Option<&[Id]>, rows: usize) -> Bits {
        match filter {
            Filter::And(all) => all.iter().fold(full(rows), |bits, filter| {
                combine(bits, self.eval(filter, ids, rows), |a, b| a & b)
            }),
            Filter::Or(any) => (any.iter()).fold(vec![0; rows.div_ceil(64)], |bits, filter| {
                combine(bits, self.eval(filter, ids, rows), |a, b| a | b)
            }),
            Filter::Not(filter) => combine(full(rows), self.eval(filter, ids, rows), |a, b| a & !b),
            Filter::Ids(_) | Filter::IdRange(..) => {
                let mut bits = vec![0; rows.div_ceil(64)];
                for (row, id) in ids.unwrap_or_default().iter().enumerate() {
                    if filter.matches(id, &Default::default()) {
                        set_bit(&mut bits, row);
                    }
                }
                bits
            }
            Filter::Eq(name, value) => self
                .set(name, value, rows)
                .unwrap_or_else(|| self.scan(filter, name, rows)),
            Filter::In(name, values) => {
                let sets: Option<Vec<Bits>> =
                    values.iter().map(|v| self.set(name, v, rows)).collect();
                match sets {
                    Some(sets) => (sets.into_iter()).fold(vec![0; rows.div_ceil(64)], |a, b| {
                        combine(a, b, |a, b| a | b)
                    }),
                    None => self.scan(filter, name, rows),
                }
            }
            Filter::ContainsAll(name, values) => {
                let sets: Option<Vec<Bits>> =
                    values.iter().map(|v| self.set(name, v, rows)).collect();
                match sets {
                    Some(sets) => {
                        (sets.into_iter()).fold(full(rows), |a, b| combine(a, b, |a, b| a & b))
                    }
                    None => self.scan(filter, name, rows),
                }
            }
            Filter::Lt(name, _)
            | Filter::Lte(name, _)
            | Filter::Gt(name, _)
            | Filter::Gte(name, _) => self.scan(filter, name, rows),
            Filter::Matches(name, pattern) => self
                .matching(name, pattern, rows)
                .unwrap_or_else(|| self.scan(filter, name, rows)),
            Filter::Exists(name) => self.scan(filter, name, rows),
        }
    }

    fn matching(&self, name: &str, pattern: &Pattern, rows: usize) -> Option<Bits> {
        let sets = self.sets.get(name)?;
        let prefix = pattern.prefix();
        let mut bits = vec![0; rows.div_ceil(64)];
        for (key, set) in sets.range(Key::String(prefix.to_string())..) {
            let Key::String(text) = key else { break };
            if !text.starts_with(prefix) {
                break;
            }
            if pattern.is_match(text) {
                set.add_to(&mut bits);
            }
        }
        Some(bits)
    }

    fn set(&self, name: &str, value: &Value, rows: usize) -> Option<Bits> {
        let sets = self.sets.get(name)?;
        let key = key(value)?;
        let mut bits = vec![0; rows.div_ceil(64)];
        if let Some(set) = sets.get(&key) {
            set.add_to(&mut bits);
        }
        Some(bits)
    }

    fn scan(&self, filter: &Filter, name: &str, rows: usize) -> Bits {
        let mut bits = vec![0; rows.div_ceil(64)];
        let column = self.columns.get(name);
        for row in 0..rows {
            if filter.test(column.and_then(|c| c[row].as_ref())) {
                set_bit(&mut bits, row);
            }
        }
        bits
    }
}

impl Set {
    fn new(list: Vec<u32>, rows: usize) -> Self {
        if list.len() * 16 < rows {
            return Set::Rows(list);
        }
        let mut bits = vec![0; rows.div_ceil(64)];
        list.iter()
            .for_each(|&row| set_bit(&mut bits, row as usize));
        Set::Bits(bits)
    }

    fn add_to(&self, bits: &mut Bits) {
        match self {
            Set::Bits(set) => bits.iter_mut().zip(set).for_each(|(a, b)| *a |= b),
            Set::Rows(list) => list.iter().for_each(|&row| set_bit(bits, row as usize)),
        }
    }
}

fn key(value: &Value) -> Option<Key> {
    match value {
        Value::Bool(b) => Some(Key::Bool(*b)),
        Value::String(s) => Some(Key::String(s.clone())),
        Value::Int(n) => Some(Key::Int(*n)),
        Value::Uuid(u) => Some(Key::Uuid(*u)),
        _ => None,
    }
}

pub(crate) fn has(bits: &[u64], row: usize) -> bool {
    bits[row / 64] >> (row % 64) & 1 == 1
}

fn set_bit(bits: &mut [u64], row: usize) {
    bits[row / 64] |= 1 << (row % 64);
}

fn full(rows: usize) -> Bits {
    let mut bits = vec![u64::MAX; rows.div_ceil(64)];
    if !rows.is_multiple_of(64)
        && let Some(last) = bits.last_mut()
    {
        *last = (1 << (rows % 64)) - 1;
    }
    bits
}

fn combine(mut a: Bits, b: Bits, op: fn(u64, u64) -> u64) -> Bits {
    a.iter_mut().zip(b).for_each(|(a, b)| *a = op(*a, b));
    a
}

#[cfg(test)]
mod tests {
    use std::ops::Bound;

    use super::*;

    #[test]
    fn sets_agree_with_testing_each_row() {
        let kinds: BTreeMap<String, Kind> = [
            ("lang", Kind::String),
            ("n", Kind::Number),
            ("ok", Kind::Bool),
            ("tags", Kind::Strings),
        ]
        .into_iter()
        .map(|(n, k)| (n.to_string(), k))
        .collect();
        let langs = ["go", "rust", "c"];
        let rows: Vec<Attributes> = (0..200)
            .map(|i: usize| {
                let mut row = Attributes::new();
                if !i.is_multiple_of(7) {
                    row.insert("lang".into(), Value::from(langs[i % 3]));
                }
                row.insert("n".into(), Value::Number(i as f64));
                row.insert("ok".into(), Value::Bool(i.is_multiple_of(5)));
                let tags = vec![langs[i % 2].to_string(), "x".repeat(i % 50)];
                row.insert("tags".into(), Value::Strings(tags));
                row
            })
            .collect();
        let attrs = Attrs::new(vec![0; rows.len()], &rows, &kinds);
        let filters = [
            Filter::eq("lang", "rust"),
            Filter::eq("lang", "nope"),
            Filter::eq("ok", true),
            Filter::eq("ok", "true"),
            Filter::eq("tags", "go"),
            Filter::eq("tags", "xxxxx"),
            Filter::is_in("lang", vec!["go".into(), "c".into()]),
            Filter::is_in("n", vec![3.0.into(), 4.0.into()]),
            Filter::eq("lang", "go").negate(),
            Filter::And(vec![Filter::gt("n", 50.0), Filter::eq("ok", false)]),
            Filter::Or(vec![Filter::lt("n", 10.0), Filter::eq("lang", "c")]),
            Filter::gte("lang", "d"),
            Filter::glob("lang", "ru*").unwrap(),
            Filter::glob("lang", "*o").unwrap(),
            Filter::glob("lang", "rust").unwrap(),
            Filter::glob("tags", "xx?x*").unwrap(),
            Filter::Matches(
                "lang".into(),
                Pattern::new("GO", crate::Syntax::IGlob).unwrap(),
            ),
            Filter::regex("tags", "^x{3,4}$").unwrap(),
            Filter::regex("n", "1").unwrap(),
            Filter::ids(vec![Id::Num(5), Id::Num(1), Id::Num(5)]),
            Filter::And(vec![
                Filter::ids(vec![Id::Num(2)]).negate(),
                Filter::eq("ok", true),
            ]),
            Filter::IdRange(Bound::Excluded(Id::Num(150)), Bound::Unbounded),
            Filter::IdRange(Bound::Included(Id::Num(10)), Bound::Excluded(Id::Num(20))),
        ];
        let ids: Vec<Id> = (0..rows.len() as u64).map(Id::Num).collect();
        let after = Filter::IdRange(Bound::Excluded(Id::Num(197)), Bound::Unbounded);
        let bits = attrs.eval(&after, Some(&ids), rows.len());
        let found: Vec<usize> = (0..rows.len()).filter(|&row| has(&bits, row)).collect();
        assert_eq!(found, vec![198, 199]);
        for filter in filters {
            let bits = attrs.eval(&filter, Some(&ids), rows.len());
            for (row, attributes) in rows.iter().enumerate() {
                assert_eq!(
                    has(&bits, row),
                    filter.matches(&ids[row], attributes),
                    "{filter:?} {row}"
                );
            }
            assert_eq!(bits.len(), rows.len().div_ceil(64));
            assert_eq!(bits[3] >> (rows.len() % 64), 0, "{filter:?}");
        }
    }
}
