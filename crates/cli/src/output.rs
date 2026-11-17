use anyhow::Result;
use serde::Serialize;
use serde_json::Value;

pub(crate) fn json(value: &impl Serialize) -> Result<()> {
    println!("{}", serde_json::to_string_pretty(value)?);
    Ok(())
}

pub(crate) fn report(as_json: bool, value: Value, text: impl std::fmt::Display) -> Result<()> {
    match as_json {
        true => json(&value),
        false => {
            println!("{text}");
            Ok(())
        }
    }
}

pub(crate) fn either<T: Serialize>(as_json: bool, value: &T, text: impl FnOnce(&T)) -> Result<()> {
    match as_json {
        true => json(value),
        false => {
            text(value);
            Ok(())
        }
    }
}

pub(crate) fn table(header: &[&str], rows: &[Vec<String>]) {
    let mut widths: Vec<usize> = header.iter().map(|title| title.chars().count()).collect();
    for row in rows {
        for (width, cell) in widths.iter_mut().zip(row) {
            *width = (*width).max(cell.chars().count());
        }
    }
    let line = |cells: Vec<&str>| {
        let padded: Vec<String> = cells
            .iter()
            .zip(&widths)
            .map(|(cell, width)| format!("{cell:width$}"))
            .collect();
        println!("{}", padded.join("  ").trim_end());
    };
    line(header.to_vec());
    for row in rows {
        line(row.iter().map(String::as_str).collect());
    }
}

pub(crate) fn cell(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(text) => text.clone(),
        Value::Array(items) => items.iter().map(cell).collect::<Vec<_>>().join(", "),
        other => other.to_string(),
    }
}

pub(crate) fn time(text: &str) -> String {
    text.get(..16).unwrap_or(text).replace('T', " ")
}

pub(crate) fn short(id: &str) -> &str {
    id.get(..12).unwrap_or(id)
}
