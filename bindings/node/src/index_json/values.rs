//! Ids, attribute values and vectors as JSON, and back.

use napi::{Either, Result};
use serde_json::{Map, Value as Json};
use skywake_index::{Attributes, Id, Value, datetime_text, uuid_text};

use crate::error::invalid;

pub(crate) fn short(x: f32) -> f64 {
    x.to_string().parse().unwrap_or(x as f64)
}

pub(crate) fn id_from(id: Either<String, f64>) -> Result<Id> {
    match id {
        Either::A(text) => Ok(Id::Str(text)),
        Either::B(n) if n >= 0.0 && n.fract() == 0.0 && n <= 9_007_199_254_740_991.0 => {
            Ok(Id::Num(n as u64))
        }
        Either::B(n) => Err(invalid(format!(
            "id {n} must be a string or a whole number from 0"
        ))),
    }
}

pub(crate) fn id_to(id: Id) -> Either<String, f64> {
    match id {
        Id::Num(n) => Either::B(n as f64),
        Id::Str(text) => Either::A(text),
        uuid @ Id::Uuid(_) => Either::A(uuid.to_string()),
    }
}

pub(crate) fn value_from(json: &Json) -> Result<Value> {
    let number = |json: &Json| {
        json.as_f64()
            .ok_or_else(|| invalid("a list holds only strings or only numbers"))
    };
    match json {
        Json::String(text) => Ok(Value::String(text.clone())),
        Json::Number(n) => Ok(Value::Number(n.as_f64().unwrap_or(f64::NAN))),
        Json::Bool(b) => Ok(Value::Bool(*b)),
        Json::Object(_) => sparse_from(json).map(Value::Sparse),
        Json::Array(items) if items.first().is_some_and(Json::is_array) => items
            .iter()
            .map(floats)
            .collect::<Result<_>>()
            .map(Value::Vectors),
        Json::Array(items) if items.first().is_some_and(Json::is_number) => items
            .iter()
            .map(number)
            .collect::<Result<_>>()
            .map(Value::Numbers),
        Json::Array(items) => items
            .iter()
            .map(|item| match item {
                Json::String(text) => Ok(text.clone()),
                _ => Err(invalid("a list holds only strings or only numbers")),
            })
            .collect::<Result<_>>()
            .map(Value::Strings),
        _ => Err(invalid(format!(
            "`{json}` is not a string, number, bool or list"
        ))),
    }
}

pub(crate) fn floats(json: &Json) -> Result<Vec<f32>> {
    let numbers = json
        .as_array()
        .ok_or_else(|| invalid("a vector is a list of numbers"))?;
    (numbers.iter())
        .map(|n| n.as_f64().map(|n| n as f32))
        .collect::<Option<_>>()
        .ok_or_else(|| invalid("a vector is a list of numbers"))
}

pub(crate) fn sparse_from(json: &Json) -> Result<Vec<(u32, f32)>> {
    let bad = || invalid("a sparse vector is {indices, values} of one length");
    let indices = (json.get("indices").and_then(Json::as_array)).ok_or_else(bad)?;
    let values = floats(json.get("values").ok_or_else(bad)?)?;
    if indices.len() != values.len() {
        return Err(bad());
    }
    let index = |n: &Json| n.as_u64().and_then(|n| u32::try_from(n).ok());
    let indices = indices
        .iter()
        .map(index)
        .collect::<Option<Vec<u32>>>()
        .ok_or_else(bad)?;
    Ok(indices.into_iter().zip(values).collect())
}

fn number_to(n: f64) -> Json {
    serde_json::Number::from_f64(n).map_or(Json::Null, Json::Number)
}

pub(crate) fn value_to(value: Value) -> Json {
    match value {
        Value::String(text) => Json::String(text),
        Value::Number(n) => number_to(n),
        Value::Int(n) => Json::from(n),
        Value::Bool(b) => Json::Bool(b),
        Value::Uuid(uuid) => Json::String(uuid_text(uuid)),
        Value::Datetime(millis) => Json::String(datetime_text(millis)),
        Value::Strings(list) => Json::Array(list.into_iter().map(Json::String).collect()),
        Value::Ints(list) => Json::Array(list.into_iter().map(Json::from).collect()),
        Value::Numbers(list) => Json::Array(list.into_iter().map(number_to).collect()),
        Value::Sparse(pairs) => {
            let (indices, values): (Vec<u32>, Vec<f32>) = pairs.into_iter().unzip();
            let values = values.into_iter().map(|x| number_to(short(x)));
            serde_json::json!({ "indices": indices, "values": values.collect::<Vec<_>>() })
        }
        Value::Vectors(list) => Json::Array(
            (list.into_iter())
                .map(|v| Json::Array(v.into_iter().map(|x| number_to(short(x))).collect()))
                .collect(),
        ),
    }
}

pub(crate) fn attributes_to(attributes: Attributes) -> Map<String, Json> {
    attributes
        .into_iter()
        .map(|(name, value)| (name, value_to(value)))
        .collect()
}
