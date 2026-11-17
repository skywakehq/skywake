//! Adaptive layout: the attributes queries range over or order by, and the key a rebuild sorts rows on.

use std::cmp::{Ordering, Reverse};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering as Atomic};
use std::sync::{PoisonError, RwLock};

use serde::{Deserialize, Serialize};

use crate::format::columns::{self, Columns};
use crate::store::Storage;
use crate::{Attributes, Filter, Id, Kind, Result, Schema, Value};

const NAMES: usize = 256;
const HALVE_AT: u64 = 1 << 20;
const LEAST: u64 = 16;
const SIGN: u64 = 1 << 63;

#[derive(Debug, Default)]
pub(crate) struct Shapes {
    seen: RwLock<HashMap<String, AtomicU64>>,
}

impl Shapes {
    pub(crate) fn order<V>(&self, by: &str, filter: Option<&Filter<V>>) {
        let mut names = vec![by];
        if let Some(filter) = filter {
            ranged(filter, &mut names);
        }
        self.add(names);
    }

    pub(crate) fn filter<V>(&self, filter: Option<&Filter<V>>) {
        let mut names = Vec::new();
        if let Some(filter) = filter {
            ranged(filter, &mut names);
        }
        self.add(names);
    }

    fn add(&self, mut names: Vec<&str>) {
        names.sort_unstable();
        names.dedup();
        let mut halve = false;
        let mut new = Vec::new();
        {
            let seen = self.seen.read().unwrap_or_else(PoisonError::into_inner);
            for name in names {
                match seen.get(name) {
                    Some(count) => halve |= count.fetch_add(1, Atomic::Relaxed) + 1 >= HALVE_AT,
                    None => new.push(name),
                }
            }
        }
        if new.is_empty() && !halve {
            return;
        }
        let mut seen = self.seen.write().unwrap_or_else(PoisonError::into_inner);
        for name in new {
            if seen.len() < NAMES || seen.contains_key(name) {
                let count = seen.entry(name.to_string()).or_default();
                count.fetch_add(1, Atomic::Relaxed);
            }
        }
        if halve {
            seen.retain(|_, count| {
                let half = count.load(Atomic::Relaxed) / 2;
                count.store(half, Atomic::Relaxed);
                half > 0
            });
        }
    }

    #[cfg(test)]
    pub(crate) fn forget(&self) {
        self.seen
            .write()
            .unwrap_or_else(PoisonError::into_inner)
            .clear();
    }

    fn busiest(&self, schema: &Schema) -> Option<String> {
        let seen = self.seen.read().unwrap_or_else(PoisonError::into_inner);
        (seen.iter())
            .map(|(name, count)| (name, count.load(Atomic::Relaxed)))
            .filter(|&(name, count)| count >= LEAST && sortable(schema, name))
            .max_by_key(|&(name, count)| (count, Reverse(name)))
            .map(|(name, _)| name.clone())
    }
}

fn ranged<'a, V>(filter: &'a Filter<V>, names: &mut Vec<&'a str>) {
    match filter {
        Filter::Lt(name, _) | Filter::Lte(name, _) | Filter::Gt(name, _) | Filter::Gte(name, _) => {
            names.push(name);
        }
        Filter::And(all) | Filter::Or(all) => all.iter().for_each(|f| ranged(f, names)),
        Filter::Not(inner) => ranged(inner, names),
        _ => {}
    }
}

fn sortable(schema: &Schema, name: &str) -> bool {
    matches!(
        schema.attributes.get(name),
        Some(Kind::Number | Kind::Int | Kind::Datetime | Kind::String)
    )
}

pub(crate) async fn key(
    storage: &Storage,
    schema: &Schema,
    base: Option<&Columns>,
) -> Result<Option<String>> {
    if let Some(busiest) = storage.shapes().busiest(schema) {
        return Ok(Some(busiest));
    }
    let Some(base) = base.filter(|base| base.pages > 1) else {
        return Ok(None);
    };
    for (name, column) in base
        .columns
        .iter()
        .filter(|(name, _)| sortable(schema, name))
    {
        let pages = columns::pages(storage, column).await?;
        if sorted(pages.iter().map(|page| (&page.stats.min, &page.stats.max))) {
            return Ok(Some(name.clone()));
        }
    }
    Ok(None)
}

fn sorted<'a>(mut pages: impl Iterator<Item = (&'a Option<Value>, &'a Option<Value>)>) -> bool {
    let mut last: Option<&Value> = None;
    let mut missing = false;
    pages.all(|(min, max)| match (min, max) {
        (Some(min), Some(max)) => {
            let after = last.is_none_or(|last| last.order(min).is_le());
            last = Some(max);
            !missing && after
        }
        _ => {
            missing = true;
            true
        }
    })
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
enum Key {
    Scalar(u64),
    Text(String),
    Missing,
}

impl Key {
    fn of(value: Option<&Value>) -> Self {
        match value {
            Some(Value::Number(n)) if n.is_nan() => Key::Scalar(u64::MAX),
            Some(Value::Number(n)) => {
                let bits = (n + 0.0).to_bits();
                Key::Scalar(if bits & SIGN == 0 { bits | SIGN } else { !bits })
            }
            Some(Value::Int(n) | Value::Datetime(n)) => Key::Scalar(*n as u64 ^ SIGN),
            Some(Value::String(s)) => Key::Text(s.clone()),
            _ => Key::Missing,
        }
    }
}

#[derive(Serialize, Deserialize)]
pub(crate) struct Keyed {
    key: Key,
    pub seq: u64,
    pub id: Id,
    pub attributes: Attributes,
}

impl Keyed {
    pub(crate) fn new(name: &str, seq: u64, id: Id, attributes: Attributes) -> Self {
        Self {
            key: Key::of(attributes.get(name)),
            seq,
            id,
            attributes,
        }
    }
}

impl Ord for Keyed {
    fn cmp(&self, other: &Self) -> Ordering {
        (self.key.cmp(&other.key)).then(self.seq.cmp(&other.seq))
    }
}

impl PartialOrd for Keyed {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl PartialEq for Keyed {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other).is_eq()
    }
}

impl Eq for Keyed {}

#[cfg(test)]
mod tests {
    use super::*;

    fn schema() -> Schema {
        let mut schema = Schema::default();
        schema.attributes.insert("at".into(), Kind::Datetime);
        schema.attributes.insert("tags".into(), Kind::Strings);
        schema.attributes.insert("price".into(), Kind::Number);
        schema
    }

    #[test]
    fn the_busiest_ranged_attribute_is_the_key() {
        let shapes = Shapes::default();
        let schema = schema();
        assert_eq!(shapes.busiest(&schema), None);
        for _ in 0..LEAST {
            let at = Filter::And(vec![
                Filter::Gte("at".into(), Value::Datetime(1)),
                Filter::Lt("at".into(), Value::Datetime(9)),
            ]);
            shapes.filter(Some(&at));
            shapes.filter(Some(&Filter::Gt("tags".into(), Value::from("a"))));
        }
        assert_eq!(shapes.busiest(&schema), Some("at".into()));
        for _ in 0..=LEAST {
            shapes.order::<Value>("price", None);
        }
        assert_eq!(shapes.busiest(&schema), Some("price".into()));
    }

    #[test]
    fn pages_in_key_order_are_sorted() {
        let n = |x: f64| Some(Value::Number(x));
        let pages = [(n(1.0), n(3.0)), (n(3.0), n(5.0)), (None, None)];
        assert!(sorted(pages.iter().map(|(a, b)| (a, b))));
        let pages = [(n(1.0), n(4.0)), (n(3.0), n(5.0))];
        assert!(!sorted(pages.iter().map(|(a, b)| (a, b))));
        let pages = [(None, None), (n(3.0), n(5.0))];
        assert!(!sorted(pages.iter().map(|(a, b)| (a, b))));
    }

    #[test]
    fn keys_sort_like_values() {
        let values = [
            Value::Number(f64::NEG_INFINITY),
            Value::Number(-2.5),
            Value::Number(-0.0),
            Value::Number(1e-9),
            Value::Number(7.0),
            Value::Number(f64::INFINITY),
            Value::Number(f64::NAN),
        ];
        for pair in values.windows(2) {
            let (a, b) = (Key::of(Some(&pair[0])), Key::of(Some(&pair[1])));
            assert!(a < b, "{:?} < {:?}", pair[0], pair[1]);
            assert!(pair[0].order(&pair[1]).is_le());
        }
        assert!(Key::of(Some(&Value::Int(-3))) < Key::of(Some(&Value::Int(2))));
        assert!(Key::of(Some(&Value::Datetime(i64::MAX))) < Key::Missing);
        assert!(Key::of(Some(&Value::from("b"))) > Key::of(Some(&Value::from("a"))));
    }
}
