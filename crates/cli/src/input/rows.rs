use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;

use anyhow::{Context, Result, anyhow, bail};
use parquet::file::reader::{FileReader, SerializedFileReader};
use parquet::record::reader::RowIter;
use serde_json::{Map, Value, json};

use crate::cli::Format;

pub(crate) type Row = Map<String, Value>;
pub(crate) type Rows = Box<dyn Iterator<Item = Result<Row>>>;

pub(crate) fn guess(path: Option<&Path>) -> Format {
    let extension = path
        .and_then(|path| path.extension())
        .and_then(|extension| extension.to_str())
        .map(str::to_lowercase);
    match extension.as_deref() {
        Some("csv") => Format::Csv,
        Some("parquet" | "pq") => Format::Parquet,
        _ => Format::Jsonl,
    }
}

pub(crate) fn read(path: Option<&Path>, format: Format) -> Result<Rows> {
    let path = path.filter(|path| path.as_os_str() != "-");
    let file = match path {
        Some(path) => {
            Some(File::open(path).with_context(|| format!("can't open {}", path.display()))?)
        }
        None => None,
    };
    if format == Format::Parquet {
        let reader: Box<dyn FileReader> = match file {
            Some(file) => Box::new(SerializedFileReader::new(file)?),
            None => {
                let mut bytes = Vec::new();
                std::io::stdin().read_to_end(&mut bytes)?;
                Box::new(SerializedFileReader::new(bytes::Bytes::from(bytes))?)
            }
        };
        return Ok(Box::new(parquet(reader)));
    }
    let input: Box<dyn Read> = match file {
        Some(file) => Box::new(file),
        None => Box::new(std::io::stdin()),
    };
    Ok(match format {
        Format::Csv => Box::new(csv(input)?),
        _ => Box::new(jsonl(BufReader::new(input))),
    })
}

fn jsonl(input: impl BufRead + 'static) -> impl Iterator<Item = Result<Row>> {
    input
        .lines()
        .enumerate()
        .filter(|(_, line)| line.as_ref().map_or(true, |line| !line.trim().is_empty()))
        .map(|(n, line)| match serde_json::from_str(&line?) {
            Ok(Value::Object(row)) => Ok(row),
            Ok(_) => bail!("line {}: expected a JSON object", n + 1),
            Err(error) => bail!("line {}: {error}", n + 1),
        })
}

fn csv(input: impl Read + 'static) -> Result<impl Iterator<Item = Result<Row>>> {
    let mut reader = csv::Reader::from_reader(input);
    let headers: Vec<String> = reader.headers()?.iter().map(str::to_string).collect();
    Ok(reader.into_records().map(move |record| {
        let record = record?;
        let row = headers
            .iter()
            .zip(record.iter())
            .filter(|(_, cell)| !cell.is_empty())
            .map(|(name, cell)| (name.clone(), Value::String(cell.to_string())))
            .collect();
        Ok(row)
    }))
}

fn parquet(reader: Box<dyn FileReader>) -> impl Iterator<Item = Result<Row>> {
    RowIter::from_file_into(reader).map(|row| match row?.to_json_value() {
        Value::Object(row) => Ok(row
            .into_iter()
            .filter(|(_, value)| !value.is_null())
            .collect()),
        _ => bail!("a Parquet row is not a record"),
    })
}

pub(crate) struct Fields(HashMap<String, String>);

impl Fields {
    pub(crate) fn of(schema: &Value) -> Fields {
        let mut types = HashMap::new();
        for vector in schema["vectors"].as_array().into_iter().flatten() {
            if let Some(name) = vector["name"].as_str() {
                types.insert(name.to_string(), "vector".to_string());
            }
        }
        for attribute in schema["attributes"].as_array().into_iter().flatten() {
            if let (Some(name), Some(kind)) =
                (attribute["name"].as_str(), attribute["type"].as_str())
            {
                types.insert(name.to_string(), kind.to_string());
            }
        }
        Fields(types)
    }

    pub(crate) fn typed(&self, row: Row) -> Result<Row> {
        row.into_iter()
            .map(|(name, value)| {
                let value = match (name.as_str(), value) {
                    ("id", Value::String(text)) => id(text),
                    (_, Value::String(text)) => match self.0.get(&name) {
                        Some(kind) => cell(&name, kind, text)?,
                        None => Value::String(text),
                    },
                    (_, value) => value,
                };
                Ok((name, value))
            })
            .collect()
    }
}

fn id(text: String) -> Value {
    match !text.is_empty() && text.bytes().all(|byte| byte.is_ascii_digit()) {
        true => text
            .parse::<u64>()
            .map(Value::from)
            .unwrap_or(Value::String(text)),
        false => Value::String(text),
    }
}

fn cell(name: &str, kind: &str, text: String) -> Result<Value> {
    let wrong = || anyhow!("`{name}` is a {kind} field; can't use {text:?}");
    let trimmed = text.trim();
    Ok(match kind {
        "number" | "int" => {
            let number: f64 = trimmed.parse().map_err(|_| wrong())?;
            json!(number)
        }
        "bool" => match trimmed.to_lowercase().as_str() {
            "true" | "1" | "yes" => Value::Bool(true),
            "false" | "0" | "no" => Value::Bool(false),
            _ => return Err(wrong()),
        },
        "vector" | "vectors" | "sparse" | "numbers" | "ints" => {
            serde_json::from_str(trimmed).map_err(|_| wrong())?
        }
        "strings" if trimmed.starts_with('[') => {
            serde_json::from_str(trimmed).map_err(|_| wrong())?
        }
        "strings" => trimmed.split('|').map(str::trim).collect(),
        _ => Value::String(text),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fields() -> Fields {
        Fields::of(&json!({
            "vectors": [{"name": "embedding", "dims": 2}],
            "attributes": [
                {"name": "tag", "type": "string"},
                {"name": "price", "type": "number"},
                {"name": "live", "type": "bool"},
                {"name": "labels", "type": "strings"},
            ],
        }))
    }

    fn row(value: Value) -> Row {
        value.as_object().unwrap().clone()
    }

    #[test]
    fn csv_text_becomes_the_field_type() {
        let typed = fields().typed(row(json!({
            "id": "7", "embedding": "[0.5, 1]", "tag": "x", "price": "9.5",
            "live": "true", "labels": "a|b", "note": "kept",
        })));
        assert_eq!(
            typed.unwrap(),
            row(json!({
                "id": 7, "embedding": [0.5, 1], "tag": "x", "price": 9.5,
                "live": true, "labels": ["a", "b"], "note": "kept",
            }))
        );
    }

    #[test]
    fn json_values_pass_through() {
        let given = row(json!({"id": 1, "embedding": [1, 2], "price": 3}));
        assert_eq!(fields().typed(given.clone()).unwrap(), given);
    }

    #[test]
    fn a_wrong_cell_names_its_field() {
        let error = fields()
            .typed(row(json!({"id": 1, "price": "cheap"})))
            .unwrap_err();
        assert_eq!(
            error.to_string(),
            "`price` is a number field; can't use \"cheap\""
        );
    }

    #[test]
    fn csv_rows_are_read_with_their_headers() {
        let text = "id,embedding,tag\n1,\"[1,2]\",x\n2,\"[3,4]\",\n";
        let rows: Vec<Row> = csv(std::io::Cursor::new(text))
            .unwrap()
            .collect::<Result<_>>()
            .unwrap();
        assert_eq!(
            rows[0],
            row(json!({"id": "1", "embedding": "[1,2]", "tag": "x"}))
        );
        assert_eq!(rows[1], row(json!({"id": "2", "embedding": "[3,4]"})));
    }

    #[test]
    fn json_lines_skip_blank_lines_and_name_bad_ones() {
        let text = "{\"id\": 1}\n\n[1]\n";
        let rows: Vec<Result<Row>> = jsonl(std::io::Cursor::new(text)).collect();
        assert_eq!(rows.len(), 2);
        assert_eq!(
            rows[1].as_ref().unwrap_err().to_string(),
            "line 3: expected a JSON object"
        );
    }
}
