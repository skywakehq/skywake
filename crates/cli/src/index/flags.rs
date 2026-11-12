//! Parsing column and id flags.

use anyhow::{Result, anyhow, bail};
use serde_json::{Value, json};

pub(super) fn vector_column(text: &str) -> Result<Value> {
    let parts: Vec<&str> = text.split(':').collect();
    let wrong = || {
        anyhow!(
            "--vector {text}: write NAME:DIMS or NAME:DIMS:METRIC, such as embedding:768:cosine"
        )
    };
    let (name, dims, metric) = match parts.as_slice() {
        [name, dims] => (name, dims, "cosine"),
        [name, dims, metric] => (name, dims, *metric),
        _ => return Err(wrong()),
    };
    let dims: u32 = dims.parse().map_err(|_| wrong())?;
    Ok(json!({ "name": name, "dims": dims, "metric": metric }))
}

pub(super) fn attribute_column(text: &str) -> Result<Value> {
    match text.split_once(':') {
        Some((name, kind)) => Ok(json!({ "name": name, "type": kind })),
        None => {
            bail!("--attr {text}: write NAME:TYPE, where TYPE is string, number, bool or strings")
        }
    }
}

pub(super) fn doc_id(text: String) -> Value {
    match text.parse::<u64>() {
        Ok(number) if !text.starts_with('+') => Value::from(number),
        _ => Value::String(text),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn columns_come_from_flags() {
        assert_eq!(
            vector_column("embedding:768").unwrap(),
            json!({"name": "embedding", "dims": 768, "metric": "cosine"})
        );
        assert_eq!(
            vector_column("v:3:dot").unwrap(),
            json!({"name": "v", "dims": 3, "metric": "dot"})
        );
        assert!(vector_column("v").is_err());
        assert_eq!(
            attribute_column("tag:string").unwrap(),
            json!({"name": "tag", "type": "string"})
        );
        assert!(attribute_column("tag").is_err());
    }

    #[test]
    fn digit_ids_are_numbers() {
        assert_eq!(doc_id("12".into()), json!(12));
        assert_eq!(doc_id("a1".into()), json!("a1"));
        assert_eq!(doc_id("+1".into()), json!("+1"));
    }
}
