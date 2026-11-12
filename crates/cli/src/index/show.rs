//! Printing an index's stats and schema.

use serde_json::Value;

use super::table;

pub(super) fn print_stats(branch: &str, stats: &Value) {
    if stats.is_null() {
        println!("{branch}: the server can't count its rows right now");
        return;
    }
    let number = |key: &str| stats[key].as_u64().unwrap_or(0);
    let rows = vec![
        vec!["rows".to_string(), number("rows").to_string()],
        vec![
            "deleted rows".to_string(),
            number("deleted_rows").to_string(),
        ],
        vec![
            "indexed rows".to_string(),
            number("indexed_rows").to_string(),
        ],
        vec![
            "unindexed rows".to_string(),
            number("unindexed_rows").to_string(),
        ],
        vec!["clusters".to_string(), number("clusters").to_string()],
        vec!["segments".to_string(), number("segments").to_string()],
        vec!["size".to_string(), size(number("bytes"))],
    ];
    table::print(&[&format!("BRANCH {branch}"), ""], &rows);
}

fn size(bytes: u64) -> String {
    match bytes {
        0..1_000 => format!("{bytes} B"),
        1_000..1_000_000 => format!("{:.1} kB", bytes as f64 / 1e3),
        1_000_000..1_000_000_000 => format!("{:.1} MB", bytes as f64 / 1e6),
        _ => format!("{:.2} GB", bytes as f64 / 1e9),
    }
}

pub(super) fn vector_summary(schema: &Value) -> String {
    let columns = schema["vectors"].as_array().cloned().unwrap_or_default();
    let shown: Vec<String> = columns
        .iter()
        .map(|c| {
            format!(
                "{}[{}] {}",
                table::cell(&c["name"]),
                c["dims"],
                table::cell(&c["metric"])
            )
        })
        .collect();
    shown.join(", ")
}

pub(super) fn attribute_summary(schema: &Value) -> String {
    let columns = schema["attributes"].as_array().cloned().unwrap_or_default();
    let shown: Vec<String> = columns
        .iter()
        .map(|c| format!("{}:{}", table::cell(&c["name"]), table::cell(&c["type"])))
        .collect();
    shown.join(", ")
}
