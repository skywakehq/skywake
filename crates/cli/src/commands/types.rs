use std::path::Path;

use anyhow::{Context, Result};
use futures::TryStreamExt;
use serde_json::{Value, json};

use crate::output;
use crate::session::Session;

pub(crate) async fn run(session: &Session, out: &Path) -> Result<()> {
    let summaries: Vec<_> = session.sky.list_indexes().try_collect().await?;
    let mut indexes = Vec::new();
    for summary in summaries {
        let info = session.sky.index(&summary.name).info().await?;
        indexes.push((summary.name, info.schema));
    }
    let text = render(&indexes);
    std::fs::write(out, &text).with_context(|| format!("can't write {}", out.display()))?;
    output::report(
        session.json,
        json!({ "file": out, "indexes": indexes.len() }),
        format!(
            "Wrote types for {} indexes to {}. Include it in your tsconfig, and `sky.index(name)` knows its rows.",
            indexes.len(),
            out.display()
        ),
    )
}

fn render(indexes: &[(String, Value)]) -> String {
    let entries: Vec<String> = indexes
        .iter()
        .map(|(name, schema)| format!("    {}: {};", quote(name), fields(schema)))
        .collect();
    format!(
        "import \"skywake\";\n\ndeclare module \"skywake\" {{\n  interface IndexRows {{\n{}\n  }}\n}}\n",
        entries.join("\n")
    )
}

fn fields(schema: &Value) -> String {
    let vectors = schema["vectors"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|vector| Some((vector["name"].as_str()?, "number[]")));
    let attributes = schema["attributes"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|attribute| {
            Some((
                attribute["name"].as_str()?,
                kind(attribute["type"].as_str()?),
            ))
        });
    let fields: Vec<String> = vectors
        .chain(attributes)
        .map(|(name, kind)| format!("{}?: {kind}", quote(name)))
        .collect();
    match fields.is_empty() {
        true => "Record<string, any>".to_string(),
        false => format!("{{ {} }}", fields.join("; ")),
    }
}

fn kind(attribute: &str) -> &'static str {
    match attribute {
        "number" | "int" => "number",
        "bool" => "boolean",
        "strings" => "string[]",
        "numbers" | "ints" => "number[]",
        "vectors" => "number[][]",
        "sparse" => "{ indices: number[]; values: number[] }",
        _ => "string",
    }
}

fn quote(name: &str) -> String {
    let plain = name
        .chars()
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic() || first == '_')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    match plain {
        true => name.to_string(),
        false => Value::String(name.to_string()).to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_index_gets_its_fields() {
        let schema = json!({
            "vectors": [{"name": "embedding", "dims": 3}],
            "attributes": [
                {"name": "title", "type": "text"},
                {"name": "price", "type": "number"},
                {"name": "tags", "type": "strings"},
            ],
        });
        let text = render(&[
            ("products".to_string(), schema),
            ("my-notes".to_string(), Value::Null),
        ]);
        assert_eq!(
            text,
            "import \"skywake\";\n\ndeclare module \"skywake\" {\n  interface IndexRows {\n    products: { embedding?: number[]; title?: string; price?: number; tags?: string[] };\n    \"my-notes\": Record<string, any>;\n  }\n}\n"
        );
    }
}
