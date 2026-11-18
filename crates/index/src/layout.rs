use std::cmp::{Ordering, Reverse};
use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash as _, Hasher};
use std::sync::atomic::{AtomicU64, Ordering as Atomic};
use std::sync::{PoisonError, RwLock};

use serde::{Deserialize, Serialize};

use crate::format::columns::{self, Columns};
use crate::store::Storage;
use crate::{Attributes, Filter, Id, Kind, Result, Schema, Value};

const SHAPES: usize = 1024;
const HALVE_AT: u64 = 1 << 20;
const LEAST: u64 = 16;
const SIGN: u64 = 1 << 63;
pub(crate) const PROJECTIONS: usize = 2;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
enum Use {
    Range,
    Group,
    Pair,
}

#[derive(Debug)]
struct Counted {
    used: Use,
    first: String,
    second: String,
    count: AtomicU64,
}

type Seen<'a> = (Use, &'a str, &'a str);

#[derive(Debug, Default)]
pub(crate) struct Shapes {
    seen: RwLock<HashMap<u64, Counted>>,
}

impl Shapes {
    pub(crate) fn order<V>(&self, by: &str, filter: Option<&Filter<V>>) {
        let mut shapes = vec![(Use::Range, by, "")];
        if let Some(filter) = filter {
            ranged(filter, &mut shapes);
            let mut equal = Vec::new();
            equals(filter, &mut equal);
            shapes.extend(equal.into_iter().map(|name| (Use::Pair, name, by)));
        }
        self.add(shapes);
    }

    pub(crate) fn filter<V>(&self, filter: Option<&Filter<V>>) {
        let Some(filter) = filter else { return };
        let mut shapes = Vec::new();
        ranged(filter, &mut shapes);
        let mut equal = Vec::new();
        equals(filter, &mut equal);
        let pairs: Vec<Seen> = (equal.iter())
            .flat_map(|&e| shapes.iter().map(move |&(_, r, _)| (Use::Pair, e, r)))
            .collect();
        shapes.extend(pairs);
        self.add(shapes);
    }

    pub(crate) fn group(&self, names: &[String]) {
        self.add(
            names
                .iter()
                .map(|name| (Use::Group, name.as_str(), ""))
                .collect(),
        );
    }

    fn add(&self, mut shapes: Vec<Seen>) {
        if shapes.is_empty() {
            return;
        }
        shapes.sort_unstable_by_key(|&(used, a, b)| (used as u8, a, b));
        shapes.dedup();
        let mut halve = false;
        let mut new = Vec::new();
        {
            let seen = self.seen.read().unwrap_or_else(PoisonError::into_inner);
            for shape in shapes {
                match seen.get(&key_of(shape)) {
                    Some(counted) => {
                        halve |= counted.count.fetch_add(1, Atomic::Relaxed) + 1 >= HALVE_AT
                    }
                    None => new.push(shape),
                }
            }
        }
        if new.is_empty() && !halve {
            return;
        }
        let mut seen = self.seen.write().unwrap_or_else(PoisonError::into_inner);
        for shape @ (used, first, second) in new {
            let key = key_of(shape);
            if seen.len() >= SHAPES && !seen.contains_key(&key) {
                continue;
            }
            let counted = seen.entry(key).or_insert_with(|| Counted {
                used,
                first: first.to_string(),
                second: second.to_string(),
                count: AtomicU64::new(0),
            });
            counted.count.fetch_add(1, Atomic::Relaxed);
        }
        if halve {
            seen.retain(|_, counted| {
                let half = counted.count.load(Atomic::Relaxed) / 2;
                counted.count.store(half, Atomic::Relaxed);
                half > 0
            });
        }
    }

    #[cfg(test)]
    pub(crate) fn forget(&self) {
        (self.seen.write())
            .unwrap_or_else(PoisonError::into_inner)
            .clear();
    }

    fn ranked(&self, used: Use, keep: impl Fn(&str, &str) -> bool) -> Vec<(String, String)> {
        let seen = self.seen.read().unwrap_or_else(PoisonError::into_inner);
        let mut found: Vec<(u64, &Counted)> = (seen.values())
            .filter(|c| c.used == used && keep(&c.first, &c.second))
            .map(|c| (c.count.load(Atomic::Relaxed), c))
            .filter(|&(count, _)| count >= LEAST)
            .collect();
        found.sort_unstable_by_key(|&(count, c)| (Reverse(count), &c.first, &c.second));
        (found.into_iter())
            .map(|(_, c)| (c.first.clone(), c.second.clone()))
            .collect()
    }

    fn busiest(&self, schema: &Schema) -> Option<String> {
        let ranked = self.ranked(Use::Range, |name, _| sortable(schema, name));
        ranked.into_iter().next().map(|(name, _)| name)
    }

    pub(crate) fn grouped(&self, schema: &Schema) -> Vec<String> {
        let ranked = self.ranked(Use::Group, |name, _| schema.attributes.contains_key(name));
        ranked.into_iter().map(|(name, _)| name).collect()
    }

    fn pairs(&self, schema: &Schema) -> Vec<(String, String)> {
        let mut ranked = self.ranked(Use::Pair, |by, sort| {
            by != sort && coded(schema, by) && scalar_kind(schema, sort)
        });
        ranked.truncate(PROJECTIONS);
        ranked
    }
}

fn key_of((used, first, second): Seen) -> u64 {
    let mut hasher = DefaultHasher::new();
    (used, first, second).hash(&mut hasher);
    hasher.finish()
}

fn ranged<'a, V>(filter: &'a Filter<V>, shapes: &mut Vec<Seen<'a>>) {
    match filter {
        Filter::Lt(name, _) | Filter::Lte(name, _) | Filter::Gt(name, _) | Filter::Gte(name, _) => {
            shapes.push((Use::Range, name, ""));
        }
        Filter::And(all) | Filter::Or(all) => all.iter().for_each(|f| ranged(f, shapes)),
        Filter::Not(inner) => ranged(inner, shapes),
        _ => {}
    }
}

fn equals<'a, V>(filter: &'a Filter<V>, names: &mut Vec<&'a str>) {
    match filter {
        Filter::Eq(name, _) => names.push(name),
        Filter::And(all) => all.iter().for_each(|f| equals(f, names)),
        _ => {}
    }
}

fn coded(schema: &Schema, name: &str) -> bool {
    matches!(
        schema.attributes.get(name),
        Some(Kind::String | Kind::Bool | Kind::Uuid)
    )
}

fn scalar_kind(schema: &Schema, name: &str) -> bool {
    matches!(
        schema.attributes.get(name),
        Some(Kind::Number | Kind::Int | Kind::Datetime)
    )
}

pub(crate) fn projections(
    schema: &Schema,
    storage: &Storage,
    old: Option<&Columns>,
) -> Vec<(String, String)> {
    let wanted = storage.shapes().pairs(schema);
    if !wanted.is_empty() {
        return wanted;
    }
    (old.iter().flat_map(|c| &c.projections))
        .map(|p| (p.by.clone(), p.sort.clone()))
        .collect()
}

pub(crate) fn scalar(value: &Value) -> Option<u64> {
    match value {
        Value::Number(n) if n.is_nan() => None,
        Value::Number(n) => {
            let bits = (n + 0.0).to_bits();
            Some(if bits & SIGN == 0 { bits | SIGN } else { !bits })
        }
        Value::Int(n) | Value::Datetime(n) => Some(*n as u64 ^ SIGN),
        _ => None,
    }
}

fn sortable(schema: &Schema, name: &str) -> bool {
    matches!(
        schema.attributes.get(name),
        Some(Kind::Number | Kind::Int | Kind::Datetime | Kind::String)
    )
}

pub(crate) fn sorts(storage: &Storage, schema: &Schema) -> bool {
    storage.shapes().busiest(schema).is_some()
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
            Some(Value::String(s)) => Key::Text(s.clone()),
            Some(value) if let Some(key) = scalar(value) => Key::Scalar(key),
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
    fn pairs_and_groups_are_counted() {
        let shapes = Shapes::default();
        let mut schema = schema();
        schema.attributes.insert("city".into(), Kind::String);
        for _ in 0..LEAST {
            let eq = Filter::Eq("city".into(), Value::from("a"));
            shapes.order("price", Some(&eq));
            shapes.group(&["city".to_string()]);
        }
        assert_eq!(shapes.pairs(&schema), vec![("city".into(), "price".into())]);
        assert_eq!(shapes.grouped(&schema), vec!["city".to_string()]);
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
