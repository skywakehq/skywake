//! Filters on attributes, and the conditions of a write.

use std::cmp::Ordering;
use std::ops::{Bound, RangeBounds};

use regex::{Regex, RegexBuilder};

use super::{Attributes, Id, Kind, Schema, Value};
use crate::{Result, invalid};

#[derive(Clone, Debug)]
pub struct Pattern {
    pub source: String,
    pub syntax: Syntax,
    regex: Option<Regex>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Syntax {
    Glob,
    IGlob,
    Regex,
    /// Within this many edits: a character added, removed, changed, or two swapped.
    Fuzzy {
        edits: u8,
        ignore_case: bool,
    },
}

/// The most edits a fuzzy match allows.
pub const MAX_FUZZY_EDITS: u8 = 2;

impl PartialEq for Pattern {
    fn eq(&self, other: &Self) -> bool {
        self.source == other.source && self.syntax == other.syntax
    }
}

impl Pattern {
    pub fn new(source: &str, syntax: Syntax) -> Result<Self> {
        let whole = match syntax {
            Syntax::Glob => glob_regex(source)?,
            Syntax::IGlob => format!("(?i){}", glob_regex(source)?),
            Syntax::Regex => format!("(?s:.*)(?:{source})(?s:.*)"),
            Syntax::Fuzzy { edits, .. } if edits > MAX_FUZZY_EDITS => {
                return Err(invalid(format!("fuzzy takes 0 to {MAX_FUZZY_EDITS} edits")));
            }
            Syntax::Fuzzy { .. } => {
                return Ok(Self {
                    source: source.to_string(),
                    syntax,
                    regex: None,
                });
            }
        };
        let regex = RegexBuilder::new(&format!("^(?:{whole})$"))
            .size_limit(1 << 20)
            .build()
            .map_err(|e| invalid(format!("`{source}`: {e}")))?;
        Ok(Self {
            source: source.to_string(),
            syntax,
            regex: Some(regex),
        })
    }

    pub fn is_match(&self, text: &str) -> bool {
        match (&self.regex, self.syntax) {
            (Some(regex), _) => regex.is_match(text),
            (None, Syntax::Fuzzy { edits, ignore_case }) => {
                let fold = |s: &str| -> Vec<char> {
                    match ignore_case {
                        true => s.chars().flat_map(char::to_lowercase).collect(),
                        false => s.chars().collect(),
                    }
                };
                within(&fold(&self.source), &fold(text), edits as usize)
            }
            (None, _) => false,
        }
    }

    pub fn prefix(&self) -> &str {
        match self.syntax {
            Syntax::Glob => {
                let end = (self.source.find(['*', '?', '['])).unwrap_or(self.source.len());
                &self.source[..end]
            }
            Syntax::IGlob | Syntax::Regex | Syntax::Fuzzy { .. } => "",
        }
    }
}

/// Whether `b` is within `most` edits of `a`, counting a swap of two
/// neighbours as one.
fn within(a: &[char], b: &[char], most: usize) -> bool {
    if a.len().abs_diff(b.len()) > most {
        return false;
    }
    let width = b.len() + 1;
    let mut rows = vec![vec![0usize; width]; 3];
    rows[1] = (0..width).collect();
    for i in 1..=a.len() {
        let (before, last) = (rows[0].clone(), rows[1].clone());
        let row = &mut rows[2];
        row[0] = i;
        for j in 1..width {
            let cost = (a[i - 1] != b[j - 1]) as usize;
            row[j] = (last[j] + 1).min(row[j - 1] + 1).min(last[j - 1] + cost);
            if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                row[j] = row[j].min(before[j - 2] + 1);
            }
        }
        if row.iter().min().is_some_and(|&least| least > most) {
            return false;
        }
        rows.rotate_left(1);
        rows[2] = vec![0; width];
    }
    rows[1][b.len()] <= most
}

fn glob_regex(glob: &str) -> Result<String> {
    let mut out = String::new();
    let mut chars = glob.chars();
    while let Some(c) = chars.next() {
        match c {
            '*' => out.push_str("(?s:.*)"),
            '?' => out.push_str("(?s:.)"),
            '[' => {
                out.push('[');
                let mut first = true;
                loop {
                    match chars.next() {
                        None => return Err(invalid(format!("`{glob}`: a `[` is not closed"))),
                        Some(']') if !first => break,
                        Some('!') if first => out.push('^'),
                        Some('-') => out.push('-'),
                        Some(c) => out.push_str(&regex::escape(&c.to_string())),
                    }
                    first = false;
                }
                out.push(']');
            }
            c => out.push_str(&regex::escape(&c.to_string())),
        }
    }
    Ok(out)
}

#[derive(Clone, Debug, PartialEq)]
pub enum Filter<V = Value> {
    Eq(String, V),
    In(String, Vec<V>),
    Lt(String, V),
    Lte(String, V),
    Gt(String, V),
    Gte(String, V),
    ContainsAll(String, Vec<V>),
    Matches(String, Pattern),
    /// The document has the attribute.
    Exists(String),
    Ids(Vec<Id>),
    /// Ids between two bounds, in id order.
    IdRange(Bound<Id>, Bound<Id>),
    And(Vec<Filter<V>>),
    Or(Vec<Filter<V>>),
    Not(Box<Filter<V>>),
}

impl<V> Filter<V> {
    pub fn ids(mut ids: Vec<Id>) -> Self {
        ids.sort();
        ids.dedup();
        Filter::Ids(ids)
    }

    pub fn map<W>(&self, f: &dyn Fn(&str, &V) -> Result<Option<W>>) -> Result<Filter<W>> {
        let one = |name: &String, v: &V, make: fn(String, W) -> Filter<W>| {
            Ok::<_, crate::Error>(match f(name, v)? {
                Some(w) => make(name.clone(), w),
                None => Filter::Or(Vec::new()),
            })
        };
        let list = |name: &String, vs: &[V]| -> Result<Vec<Option<W>>> {
            vs.iter().map(|v| f(name, v)).collect()
        };
        Ok(match self {
            Filter::Eq(n, v) => one(n, v, Filter::Eq)?,
            Filter::Lt(n, v) => one(n, v, Filter::Lt)?,
            Filter::Lte(n, v) => one(n, v, Filter::Lte)?,
            Filter::Gt(n, v) => one(n, v, Filter::Gt)?,
            Filter::Gte(n, v) => one(n, v, Filter::Gte)?,
            Filter::In(n, vs) => {
                Filter::In(n.clone(), list(n, vs)?.into_iter().flatten().collect())
            }
            Filter::ContainsAll(n, vs) => match list(n, vs)?.into_iter().collect() {
                Some(all) => Filter::ContainsAll(n.clone(), all),
                None => Filter::Or(Vec::new()),
            },
            Filter::Matches(n, p) => Filter::Matches(n.clone(), p.clone()),
            Filter::Exists(n) => Filter::Exists(n.clone()),
            Filter::Ids(ids) => Filter::Ids(ids.clone()),
            Filter::IdRange(low, high) => Filter::IdRange(low.clone(), high.clone()),
            Filter::And(all) => Filter::And(all.iter().map(|x| x.map(f)).collect::<Result<_>>()?),
            Filter::Or(any) => Filter::Or(any.iter().map(|x| x.map(f)).collect::<Result<_>>()?),
            Filter::Not(inner) => Filter::Not(Box::new(inner.map(f)?)),
        })
    }

    pub(crate) fn names<'a>(&'a self, out: &mut Vec<&'a str>) {
        match self {
            Filter::And(all) | Filter::Or(all) => all.iter().for_each(|f| f.names(out)),
            Filter::Not(inner) => inner.names(out),
            Filter::Ids(_) | Filter::IdRange(..) => {}
            Filter::Eq(n, _)
            | Filter::In(n, _)
            | Filter::Lt(n, _)
            | Filter::Lte(n, _)
            | Filter::Gt(n, _)
            | Filter::Gte(n, _)
            | Filter::ContainsAll(n, _)
            | Filter::Matches(n, _)
            | Filter::Exists(n) => out.push(n),
        }
    }
}

#[derive(Clone, Debug)]
pub enum Operand {
    Value(Value),
    New(String),
}

pub type Condition = Filter<Operand>;

impl Condition {
    pub fn resolve(&self, new: &Attributes) -> Filter {
        let resolved = self.map(&|_, operand| {
            Ok(match operand {
                Operand::Value(value) => Some(value.clone()),
                Operand::New(name) => new.get(name).cloned(),
            })
        });
        resolved.unwrap_or_else(|_| Filter::Or(Vec::new()))
    }
}

impl Filter {
    pub fn eq(name: &str, value: impl Into<Value>) -> Self {
        Filter::Eq(name.to_string(), value.into())
    }

    pub fn is_in(name: &str, values: Vec<Value>) -> Self {
        Filter::In(name.to_string(), values)
    }

    pub fn lt(name: &str, value: impl Into<Value>) -> Self {
        Filter::Lt(name.to_string(), value.into())
    }

    pub fn lte(name: &str, value: impl Into<Value>) -> Self {
        Filter::Lte(name.to_string(), value.into())
    }

    pub fn gt(name: &str, value: impl Into<Value>) -> Self {
        Filter::Gt(name.to_string(), value.into())
    }

    pub fn gte(name: &str, value: impl Into<Value>) -> Self {
        Filter::Gte(name.to_string(), value.into())
    }

    pub fn glob(name: &str, glob: &str) -> Result<Self> {
        Ok(Filter::Matches(
            name.to_string(),
            Pattern::new(glob, Syntax::Glob)?,
        ))
    }

    pub fn regex(name: &str, regex: &str) -> Result<Self> {
        Ok(Filter::Matches(
            name.to_string(),
            Pattern::new(regex, Syntax::Regex)?,
        ))
    }

    pub fn negate(self) -> Self {
        Filter::Not(Box::new(self))
    }

    pub(crate) fn typed(&self, schema: &Schema) -> Result<Filter> {
        let mut names = Vec::new();
        self.names(&mut names);
        for name in names {
            let kind = schema.kind(name)?;
            if matches!(kind, Kind::Sparse | Kind::Vectors) {
                return Err(invalid(format!("`{name}` is only scored, not filtered on")));
            }
            if let Some(pattern) = self.pattern_on(name)
                && !matches!(kind, Kind::String | Kind::Strings)
            {
                return Err(invalid(format!(
                    "`{name}` is not a string: `{}` matches only strings",
                    pattern.source
                )));
            }
        }
        let typed = self.map(&|name, value| {
            let kind = schema.kind(name)?;
            let typed =
                (value.clone().to_kind(kind.item())).or_else(|| value.clone().to_kind(kind));
            match (typed, kind.item(), value) {
                (Some(value), ..) => Ok(Some(value)),
                (None, Kind::Int, Value::Number(_)) => Ok(Some(value.clone())),
                (None, ..) => Err(invalid(format!(
                    "`{name}` is {kind:?}: {value:?} is not one"
                ))),
            }
        })?;
        typed.typed_ids(schema)
    }

    fn typed_ids(self, schema: &Schema) -> Result<Filter> {
        let all = |list: Vec<Filter>| -> Result<Vec<Filter>> {
            list.into_iter().map(|f| f.typed_ids(schema)).collect()
        };
        Ok(match self {
            Filter::Ids(ids) => Filter::ids(
                ids.into_iter()
                    .map(|id| schema.id.check(id))
                    .collect::<Result<_>>()?,
            ),
            Filter::IdRange(low, high) => {
                let check = |bound: Bound<Id>| -> Result<Bound<Id>> {
                    Ok(match bound {
                        Bound::Included(id) => Bound::Included(schema.id.check(id)?),
                        Bound::Excluded(id) => Bound::Excluded(schema.id.check(id)?),
                        Bound::Unbounded => Bound::Unbounded,
                    })
                };
                Filter::IdRange(check(low)?, check(high)?)
            }
            Filter::And(list) => Filter::And(all(list)?),
            Filter::Or(list) => Filter::Or(all(list)?),
            Filter::Not(inner) => Filter::Not(Box::new(inner.typed_ids(schema)?)),
            other => other,
        })
    }

    fn pattern_on(&self, name: &str) -> Option<&Pattern> {
        match self {
            Filter::Matches(n, pattern) if n == name => Some(pattern),
            Filter::And(all) | Filter::Or(all) => all.iter().find_map(|f| f.pattern_on(name)),
            Filter::Not(inner) => inner.pattern_on(name),
            _ => None,
        }
    }

    pub fn matches(&self, id: &Id, attributes: &Attributes) -> bool {
        match self {
            Filter::And(all) => all.iter().all(|filter| filter.matches(id, attributes)),
            Filter::Or(any) => any.iter().any(|filter| filter.matches(id, attributes)),
            Filter::Not(filter) => !filter.matches(id, attributes),
            Filter::Ids(ids) => ids.binary_search(id).is_ok(),
            Filter::IdRange(low, high) => (low.as_ref(), high.as_ref()).contains(id),
            Filter::Eq(name, _)
            | Filter::In(name, _)
            | Filter::Lt(name, _)
            | Filter::Lte(name, _)
            | Filter::Gt(name, _)
            | Filter::Gte(name, _)
            | Filter::ContainsAll(name, _)
            | Filter::Matches(name, _)
            | Filter::Exists(name) => self.test(attributes.get(name)),
        }
    }

    pub(crate) fn test(&self, value: Option<&Value>) -> bool {
        let range = |other: &Value, ok: fn(Ordering) -> bool| {
            value.is_some_and(|v| v.any(&|item| item.compare(other).is_some_and(ok)))
        };
        match self {
            Filter::Eq(_, other) => value.is_some_and(|v| v.matches(other)),
            Filter::In(_, others) => value.is_some_and(|v| others.iter().any(|o| v.matches(o))),
            Filter::Lt(_, other) => range(other, Ordering::is_lt),
            Filter::Lte(_, other) => range(other, Ordering::is_le),
            Filter::Gt(_, other) => range(other, Ordering::is_gt),
            Filter::Gte(_, other) => range(other, Ordering::is_ge),
            Filter::ContainsAll(_, others) => {
                value.is_some_and(|v| others.iter().all(|o| v.matches(o)))
            }
            Filter::Exists(_) => value.is_some(),
            Filter::Matches(_, pattern) => value.is_some_and(|v| match v {
                Value::String(text) => pattern.is_match(text),
                Value::Strings(list) => list.iter().any(|text| pattern.is_match(text)),
                _ => false,
            }),
            Filter::Ids(_)
            | Filter::IdRange(..)
            | Filter::And(_)
            | Filter::Or(_)
            | Filter::Not(_) => false,
        }
    }
}

#[cfg(test)]
mod fuzzy_tests {
    use super::*;

    #[test]
    fn fuzzy_counts_edits_and_swaps() {
        let near = |source: &str, edits, ignore_case, text: &str| {
            Pattern::new(source, Syntax::Fuzzy { edits, ignore_case })
                .unwrap()
                .is_match(text)
        };
        assert!(near("kitten", 0, false, "kitten"));
        assert!(!near("kitten", 1, false, "sitting"));
        assert!(near("kitten", 2, false, "sittin"));
        assert!(near("teh", 1, false, "the"));
        assert!(!near("Paris", 0, false, "paris"));
        assert!(near("Paris", 0, true, "paris"));
        assert!(
            Pattern::new(
                "x",
                Syntax::Fuzzy {
                    edits: 3,
                    ignore_case: false
                }
            )
            .is_err()
        );
    }
}
