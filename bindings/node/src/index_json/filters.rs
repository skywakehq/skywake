//! Filters, write conditions and text match conditions from keyword JSON objects.

use std::ops::Bound;

use napi::{Either, Result};
use serde_json::{Map, Value as Json};
use skywake_index::{Condition, Filter, Id, Match, Operand, Pattern, Syntax};

use super::values::{id_from, value_from};
use crate::error::invalid;

pub(crate) fn filter_from(json: &Json) -> Result<Filter> {
    parse_filter(json, &value_from)
}

pub(crate) fn condition_from(json: &Json) -> Result<Condition> {
    parse_filter(json, &|json| match json.get("$ref_new") {
        Some(Json::String(name)) => Ok(Operand::New(name.clone())),
        Some(_) => Err(invalid("`$ref_new` takes an attribute name")),
        None => value_from(json).map(Operand::Value),
    })
}

type Parse<'a, V> = &'a dyn Fn(&Json) -> Result<V>;

fn parse_filter<V>(json: &Json, operand: Parse<V>) -> Result<Filter<V>> {
    let object = json
        .as_object()
        .ok_or_else(|| invalid("a filter is an object"))?;
    let mut all = Vec::new();
    for (key, inner) in object {
        all.push(match key.as_str() {
            "and" | "or" => {
                let list = inner
                    .as_array()
                    .ok_or_else(|| invalid(format!("`{key}` takes a list of filters")))?
                    .iter()
                    .map(|item| parse_filter(item, operand))
                    .collect::<Result<Vec<_>>>()?;
                if key == "and" {
                    Filter::And(list)
                } else {
                    Filter::Or(list)
                }
            }
            "not" => Filter::Not(Box::new(parse_filter(inner, operand)?)),
            name => parse_condition(name, inner, operand)?,
        });
    }
    Ok(if all.len() == 1 {
        all.remove(0)
    } else {
        Filter::And(all)
    })
}

fn parse_condition<V>(name: &str, ops: &Json, operand: Parse<V>) -> Result<Filter<V>> {
    let ops = ops
        .as_object()
        .ok_or_else(|| invalid(format!("`{name}` takes an object such as {{\"eq\": ...}}")))?;
    if name == "id" {
        return id_condition(ops);
    }
    let name = name.to_string();
    let mut all = Vec::new();
    for (op, value) in ops {
        let list = || -> Result<Vec<V>> {
            let items =
                (value.as_array()).ok_or_else(|| invalid(format!("`{name}.{op}` takes a list")))?;
            items.iter().map(operand).collect()
        };
        let pattern = |syntax| {
            let text =
                (value.as_str()).ok_or_else(|| invalid(format!("`{name}.{op}` takes a string")))?;
            Pattern::new(text, syntax).map_err(invalid)
        };
        let n = name.clone();
        all.push(match op.as_str() {
            "eq" => Filter::Eq(n, operand(value)?),
            "ne" => Filter::Not(Box::new(Filter::Eq(n, operand(value)?))),
            "in" | "contains_any" => Filter::In(n, list()?),
            "not_in" => Filter::Not(Box::new(Filter::In(n, list()?))),
            "contains_all" => Filter::ContainsAll(n, list()?),
            "lt" => Filter::Lt(n, operand(value)?),
            "lte" => Filter::Lte(n, operand(value)?),
            "gt" => Filter::Gt(n, operand(value)?),
            "gte" => Filter::Gte(n, operand(value)?),
            "glob" => Filter::Matches(n, pattern(Syntax::Glob)?),
            "iglob" => Filter::Matches(n, pattern(Syntax::IGlob)?),
            "regex" => Filter::Matches(n, pattern(Syntax::Regex)?),
            "exists" => match value.as_bool() {
                Some(true) => Filter::Exists(n),
                Some(false) => Filter::Not(Box::new(Filter::Exists(n))),
                None => return Err(invalid(format!("`{name}.exists` takes true or false"))),
            },
            "fuzzy" => Filter::Matches(n, fuzzy(&name, value)?),
            other => return Err(invalid(format!("no filter operator `{other}`"))),
        });
    }
    match all.len() {
        0 => Err(invalid(format!("`{name}` has no operator"))),
        1 => Ok(all.remove(0)),
        _ => Ok(Filter::And(all)),
    }
}

fn fuzzy(name: &str, value: &Json) -> Result<Pattern> {
    let text = value.get("text").and_then(Json::as_str);
    let edits = value.get("edits").map_or(Some(1), Json::as_u64);
    let ignore_case = value.get("ignoreCase").map_or(Some(false), Json::as_bool);
    match (text, edits, ignore_case) {
        (Some(text), Some(edits), Some(ignore_case)) if edits <= u8::MAX as u64 => {
            let syntax = Syntax::Fuzzy {
                edits: edits as u8,
                ignore_case,
            };
            Pattern::new(text, syntax).map_err(invalid)
        }
        _ => Err(invalid(format!(
            "`{name}.fuzzy` takes {{\"text\": string, \"edits\": 0 to 2, \"ignoreCase\": bool}}"
        ))),
    }
}

fn id_condition<V>(ops: &Map<String, Json>) -> Result<Filter<V>> {
    let id = |json: &Json| match json {
        Json::String(text) => id_from(Either::A(text.clone())),
        Json::Number(n) => id_from(Either::B(n.as_f64().unwrap_or(-1.0))),
        _ => Err(invalid("an id is a string or a number")),
    };
    let ids = |op: &str, value: &Json| -> Result<Vec<Id>> {
        match op {
            "eq" | "ne" => Ok(vec![id(value)?]),
            _ => (value.as_array())
                .ok_or_else(|| invalid(format!("`id.{op}` takes a list")))?
                .iter()
                .map(id)
                .collect(),
        }
    };
    let mut all = Vec::new();
    for (op, value) in ops {
        let bound = || id(value);
        all.push(match op.as_str() {
            "eq" | "in" => Filter::ids(ids(op, value)?),
            "ne" | "not_in" => Filter::Not(Box::new(Filter::ids(ids(op, value)?))),
            "lt" => Filter::IdRange(Bound::Unbounded, Bound::Excluded(bound()?)),
            "lte" => Filter::IdRange(Bound::Unbounded, Bound::Included(bound()?)),
            "gt" => Filter::IdRange(Bound::Excluded(bound()?), Bound::Unbounded),
            "gte" => Filter::IdRange(Bound::Included(bound()?), Bound::Unbounded),
            other => {
                return Err(invalid(format!(
                    "`id` takes eq, ne, in, not_in, lt, lte, gt or gte, not `{other}`"
                )));
            }
        });
    }
    match all.len() {
        0 => Err(invalid("`id` has no operator")),
        1 => Ok(all.remove(0)),
        _ => Ok(Filter::And(all)),
    }
}

pub(crate) fn split_matches(json: &Json, matches: &mut Vec<Match>) -> Result<Option<Filter>> {
    let object = json
        .as_object()
        .ok_or_else(|| invalid("a filter is an object"))?;
    let mut rest = Vec::new();
    for (key, inner) in object {
        let kept = match key.as_str() {
            "and" => {
                let list = inner
                    .as_array()
                    .ok_or_else(|| invalid("`and` takes a list of filters"))?;
                let mut all = Vec::new();
                for item in list {
                    all.extend(split_matches(item, matches)?);
                }
                (!all.is_empty()).then_some(Filter::And(all))
            }
            "or" | "not" => Some(filter_from(&Json::Object(Map::from_iter([(
                key.clone(),
                inner.clone(),
            )])))?),
            name => {
                let ops = inner.as_object().ok_or_else(|| {
                    invalid(format!("`{name}` takes an object such as {{\"eq\": ...}}"))
                })?;
                let mut others = Map::new();
                for (op, value) in ops {
                    let text = || {
                        value
                            .as_str()
                            .map(str::to_string)
                            .ok_or_else(|| invalid(format!("`{name}.{op}` takes a string")))
                    };
                    match op.as_str() {
                        "phrase" => matches.push(Match::Phrase(name.to_string(), text()?)),
                        "prefix" => matches.push(Match::Prefix(name.to_string(), text()?)),
                        "contains_all_tokens" => {
                            matches.push(Match::AllTokens(name.to_string(), text()?))
                        }
                        "contains_any_token" => {
                            matches.push(Match::AnyToken(name.to_string(), text()?))
                        }
                        _ => {
                            others.insert(op.clone(), value.clone());
                        }
                    }
                }
                if others.is_empty() {
                    None
                } else {
                    Some(parse_condition(name, &Json::Object(others), &value_from)?)
                }
            }
        };
        rest.extend(kept);
    }
    Ok(match rest.len() {
        0 => None,
        1 => rest.pop(),
        _ => Some(Filter::And(rest)),
    })
}
