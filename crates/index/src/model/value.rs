//! Attribute values and documents.

use std::cmp::Ordering;
use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::{Id, Kind, parse_uuid};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum Value {
    String(String),
    Number(f64),
    Bool(bool),
    Strings(Vec<String>),
    Int(i64),
    Uuid(u128),
    Datetime(i64),
    Ints(Vec<i64>),
    Numbers(Vec<f64>),
    Sparse(Vec<(u32, f32)>),
    Vectors(Vec<Vec<f32>>),
}

impl Value {
    pub fn kind(&self) -> Kind {
        match self {
            Value::String(_) => Kind::String,
            Value::Number(_) => Kind::Number,
            Value::Bool(_) => Kind::Bool,
            Value::Strings(_) => Kind::Strings,
            Value::Int(_) => Kind::Int,
            Value::Uuid(_) => Kind::Uuid,
            Value::Datetime(_) => Kind::Datetime,
            Value::Ints(_) => Kind::Ints,
            Value::Numbers(_) => Kind::Numbers,
            Value::Sparse(_) => Kind::Sparse,
            Value::Vectors(_) => Kind::Vectors,
        }
    }

    pub fn to_kind(self, kind: Kind) -> Option<Value> {
        let whole = |n: f64| (n.fract() == 0.0 && n.abs() < 9.2e18).then_some(n as i64);
        Some(match (self, kind) {
            (Value::Sparse(mut pairs), Kind::Sparse) => {
                pairs.sort_by_key(|pair| pair.0);
                let rising = pairs.windows(2).all(|two| two[0].0 < two[1].0);
                let finite = pairs.iter().all(|pair| pair.1.is_finite());
                return (rising && finite).then_some(Value::Sparse(pairs));
            }
            (Value::Vectors(list), Kind::Vectors) => {
                let dims = list.first().map_or(0, Vec::len);
                let fit = |v: &Vec<f32>| v.len() == dims && v.iter().all(|x| x.is_finite());
                return (dims > 0 && list.iter().all(fit)).then_some(Value::Vectors(list));
            }
            (value, kind) if value.kind() == kind => value,
            (Value::String(text), Kind::Uuid) => Value::Uuid(parse_uuid(&text)?),
            (Value::String(text), Kind::Datetime) => Value::Datetime(parse_datetime(&text)?),
            (Value::Number(n), Kind::Int) => Value::Int(whole(n)?),
            (Value::Number(n), Kind::Datetime) => Value::Datetime(whole(n)?),
            (Value::Int(n), Kind::Number) => Value::Number(n as f64),
            (Value::Int(n), Kind::Datetime) => Value::Datetime(n),
            (Value::Numbers(list), Kind::Ints) => {
                Value::Ints(list.into_iter().map(whole).collect::<Option<_>>()?)
            }
            (Value::Ints(list), Kind::Numbers) => {
                Value::Numbers(list.into_iter().map(|n| n as f64).collect())
            }
            (Value::Strings(list), Kind::Ints) if list.is_empty() => Value::Ints(Vec::new()),
            (Value::Strings(list), Kind::Numbers) if list.is_empty() => Value::Numbers(Vec::new()),
            _ => return None,
        })
    }

    pub(crate) fn compare(&self, other: &Value) -> Option<Ordering> {
        match (self, other) {
            (Value::Number(a), Value::Number(b)) => a.partial_cmp(b),
            (Value::Int(a), Value::Int(b)) => Some(a.cmp(b)),
            (Value::Int(a), Value::Number(b)) => (*a as f64).partial_cmp(b),
            (Value::Number(a), Value::Int(b)) => a.partial_cmp(&(*b as f64)),
            (Value::String(a), Value::String(b)) => Some(a.cmp(b)),
            (Value::Uuid(a), Value::Uuid(b)) => Some(a.cmp(b)),
            (Value::Datetime(a), Value::Datetime(b)) => Some(a.cmp(b)),
            (Value::Bool(a), Value::Bool(b)) => Some(a.cmp(b)),
            _ => None,
        }
    }

    /// A list's items, or the value itself.
    pub(crate) fn items(&self) -> Vec<Value> {
        match self {
            Value::Strings(list) => list.iter().map(|s| Value::String(s.clone())).collect(),
            Value::Ints(list) => list.iter().map(|&n| Value::Int(n)).collect(),
            Value::Numbers(list) => list.iter().map(|&n| Value::Number(n)).collect(),
            one => vec![one.clone()],
        }
    }

    pub(super) fn any(&self, test: &dyn Fn(&Value) -> bool) -> bool {
        match self {
            Value::Strings(list) => list.iter().any(|s| test(&Value::String(s.clone()))),
            Value::Ints(list) => list.iter().any(|&n| test(&Value::Int(n))),
            Value::Numbers(list) => list.iter().any(|&n| test(&Value::Number(n))),
            one => test(one),
        }
    }

    pub(super) fn matches(&self, other: &Value) -> bool {
        match (self, other) {
            (Value::Strings(list), Value::String(one)) => list.contains(one),
            _ => self == other || self.any(&|item| item.compare(other) == Some(Ordering::Equal)),
        }
    }

    pub(crate) fn order(&self, other: &Value) -> Ordering {
        self.compare(other).unwrap_or(Ordering::Equal)
    }
}

pub fn parse_datetime(text: &str) -> Option<i64> {
    if let Ok(time) = chrono::DateTime::parse_from_rfc3339(text) {
        return Some(time.timestamp_millis());
    }
    let date = chrono::NaiveDate::parse_from_str(text, "%Y-%m-%d").ok()?;
    Some(date.and_hms_opt(0, 0, 0)?.and_utc().timestamp_millis())
}

pub fn datetime_text(millis: i64) -> String {
    match chrono::DateTime::from_timestamp_millis(millis) {
        Some(time) => time.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        None => millis.to_string(),
    }
}

impl From<&str> for Value {
    fn from(value: &str) -> Self {
        Value::String(value.to_string())
    }
}

impl From<String> for Value {
    fn from(value: String) -> Self {
        Value::String(value)
    }
}

impl From<f64> for Value {
    fn from(value: f64) -> Self {
        Value::Number(value)
    }
}

impl From<i64> for Value {
    fn from(value: i64) -> Self {
        Value::Int(value)
    }
}

impl From<bool> for Value {
    fn from(value: bool) -> Self {
        Value::Bool(value)
    }
}

impl From<Vec<String>> for Value {
    fn from(value: Vec<String>) -> Self {
        Value::Strings(value)
    }
}

pub type Attributes = BTreeMap<String, Value>;

#[derive(Clone, Debug)]
pub struct Doc {
    pub id: Id,
    pub vectors: BTreeMap<String, Vec<f32>>,
    pub attributes: Attributes,
}

impl Doc {
    pub fn new(id: impl Into<Id>) -> Self {
        Self {
            id: id.into(),
            vectors: BTreeMap::new(),
            attributes: Attributes::new(),
        }
    }

    pub fn vector(mut self, column: &str, vector: Vec<f32>) -> Self {
        self.vectors.insert(column.to_string(), vector);
        self
    }

    pub fn attribute(mut self, name: &str, value: impl Into<Value>) -> Self {
        self.attributes.insert(name.to_string(), value.into());
        self
    }
}
