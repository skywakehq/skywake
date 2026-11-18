use std::collections::HashMap;

use napi::Either;
use napi_derive::napi;
use serde_json::Value as Json;
use serde_json::value::RawValue;
use skywake_index::{Doc, Id};

use super::values::value_from;

const MAX_ROWS: usize = 10_000;
const MAX_ID_BYTES: usize = 256;
const MAX_SAFE: u64 = 9_007_199_254_740_991;

#[napi(object)]
pub struct IndexRowsPlan {
    pub vectors: HashMap<String, u32>,
    pub attributes: HashMap<String, String>,
}

#[napi(object)]
pub struct IndexRowsWritten {
    pub ids: Vec<Either<String, f64>>,
    pub bytes: f64,
}

pub(crate) struct Rows {
    pub docs: Vec<Doc>,
    pub bytes: usize,
}

pub(crate) fn rows_from(body: &[u8], plan: &IndexRowsPlan) -> Option<Rows> {
    let text = std::str::from_utf8(body).ok()?;
    let rows: Vec<HashMap<&str, &RawValue>> = match text.trim_start().as_bytes().first()? {
        b'[' => serde_json::from_str(text).ok()?,
        b'{' => vec![serde_json::from_str(text).ok()?],
        _ => return None,
    };
    if rows.is_empty() || rows.len() > MAX_ROWS {
        return None;
    }
    let mut bytes = 0;
    let docs = (rows.into_iter())
        .map(|row| row_from(row, plan, &mut bytes))
        .collect::<Option<_>>()?;
    Some(Rows { docs, bytes })
}

fn row_from(row: HashMap<&str, &RawValue>, plan: &IndexRowsPlan, bytes: &mut usize) -> Option<Doc> {
    let id = row.get("id")?;
    let mut doc = Doc::new(id_from(id)?);
    *bytes += id.get().len();
    for (name, raw) in row {
        let text = raw.get();
        if name == "id" || text == "null" {
            continue;
        }
        if let Some(&dims) = plan.vectors.get(name) {
            let vector: Vec<f32> = serde_json::from_str(text).ok()?;
            if vector.len() != dims as usize {
                return None;
            }
            *bytes += vector.len() * 4;
            doc.vectors.insert(name.to_string(), vector);
            continue;
        }
        let json: Json = serde_json::from_str(text).ok()?;
        if !fits(plan.attributes.get(name)?, &json) {
            return None;
        }
        *bytes += name.len() + text.len();
        doc.attributes
            .insert(name.to_string(), value_from(&json).ok()?);
    }
    (doc.vectors.len() == plan.vectors.len()).then_some(doc)
}

fn id_from(raw: &RawValue) -> Option<Id> {
    match serde_json::from_str(raw.get()).ok()? {
        Json::String(text) if !text.is_empty() && text.len() <= MAX_ID_BYTES => Some(Id::Str(text)),
        Json::Number(n) => n.as_u64().filter(|&n| n <= MAX_SAFE).map(Id::Num),
        _ => None,
    }
}

fn fits(kind: &str, json: &Json) -> bool {
    let safe = |json: &Json| json.as_i64().is_some_and(|n| n.unsigned_abs() <= MAX_SAFE);
    let all =
        |test: &dyn Fn(&Json) -> bool| json.as_array().is_some_and(|items| items.iter().all(test));
    match kind {
        "string" | "text" => json.is_string(),
        "number" => json.is_number(),
        "int" => safe(json),
        "bool" => json.is_boolean(),
        "strings" => all(&Json::is_string),
        "numbers" => all(&Json::is_number),
        "ints" => all(&safe),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan() -> IndexRowsPlan {
        IndexRowsPlan {
            vectors: HashMap::from([("v".to_string(), 2)]),
            attributes: HashMap::from([
                ("tag".to_string(), "string".to_string()),
                ("n".to_string(), "int".to_string()),
            ]),
        }
    }

    fn rows(body: &str) -> Option<Rows> {
        rows_from(body.as_bytes(), &plan())
    }

    #[test]
    fn reads_plain_rows() {
        let read = rows(r#"[{"id": 1, "v": [0.5, 1], "tag": "a", "n": 3}, {"id": "b", "v": [0, 0], "tag": null}]"#)
            .unwrap();
        assert_eq!(read.docs.len(), 2);
        assert_eq!(read.docs[0].id, Id::Num(1));
        assert_eq!(read.docs[0].vectors["v"], vec![0.5, 1.0]);
        assert_eq!(read.docs[0].attributes.len(), 2);
        assert!(read.docs[1].attributes.is_empty());
        assert_eq!(rows(r#"{"id": 2, "v": [1, 2]}"#).unwrap().docs.len(), 1);
    }

    #[test]
    fn leaves_the_rest_to_the_api() {
        for body in [
            r#"[{"v": [1, 2]}]"#,
            r#"[{"id": 1, "v": [1, 2, 3]}]"#,
            r#"[{"id": 1}]"#,
            r#"[{"id": 1, "v": [1, 2], "new": 1}]"#,
            r#"[{"id": 1, "v": [1, 2], "n": 1.5}]"#,
            r#"[{"id": 1, "v": [1, 2], "tag": {"a": 1}}]"#,
            r#"[{"id": -1, "v": [1, 2]}]"#,
            r#"[{"id": "", "v": [1, 2]}]"#,
            r#"[]"#,
            r#"not json"#,
        ] {
            assert!(rows(body).is_none(), "{body}");
        }
    }
}
