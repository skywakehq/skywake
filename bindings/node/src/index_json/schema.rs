//! Schemas as plain JavaScript objects, and back, with one name table per enum.

use napi::Result;
use napi_derive::napi;
use serde_json::Value as Json;
use skywake_index::{Column, Element, IdKind, Kind, Language, Metric, Schema, TextOptions};

use super::values::short;
use crate::error::invalid;

#[napi(object)]
pub struct VectorColumn {
    pub name: String,
    pub dims: u32,
    pub metric: String,
    pub element: Option<String>,
}

#[napi(object)]
pub struct AttributeColumn {
    pub name: String,
    #[napi(js_name = "type")]
    pub kind: String,
    pub k1: Option<f64>,
    pub b: Option<f64>,
    pub language: Option<String>,
    pub stopwords: Option<bool>,
    pub stemming: Option<bool>,
    pub filterable: Option<bool>,
    pub case_sensitive: Option<bool>,
    pub ascii_folding: Option<bool>,
    pub max_token_length: Option<u32>,
    pub pre_tokenized: Option<bool>,
    pub filter_index: Option<bool>,
}

#[napi(object)]
pub struct IndexSchema {
    pub vectors: Vec<VectorColumn>,
    pub attributes: Vec<AttributeColumn>,
    pub id: Option<String>,
}

macro_rules! names {
    ($ty:ident, $name:ident, $parse:ident { $($text:literal => $variant:ident),* $(,)? }) => {
        fn $name(value: $ty) -> &'static str {
            match value {
                $($ty::$variant => $text,)*
            }
        }

        fn $parse(text: &str) -> Option<$ty> {
            match text {
                $($text => Some($ty::$variant),)*
                _ => None,
            }
        }
    };
}

names!(Metric, metric_name, metric_from {
    "cosine" => Cosine,
    "euclidean" => Euclidean,
    "dot" => Dot,
});

names!(Element, element_name, element_from {
    "f32" => F32,
    "f16" => F16,
    "i8" => I8,
});

names!(Kind, kind_name, kind_from {
    "string" => String,
    "number" => Number,
    "bool" => Bool,
    "strings" => Strings,
    "int" => Int,
    "uuid" => Uuid,
    "datetime" => Datetime,
    "ints" => Ints,
    "numbers" => Numbers,
    "sparse" => Sparse,
    "vectors" => Vectors,
});

pub(crate) fn schema_from(input: IndexSchema) -> Result<Schema> {
    let mut schema = Schema::new();
    schema.id = match input.id.as_deref() {
        None => IdKind::Any,
        Some("uuid") => IdKind::Uuid,
        Some(other) => return Err(invalid(format!("no id type `{other}`"))),
    };
    for column in input.vectors {
        let metric = metric_from(&column.metric)
            .ok_or_else(|| invalid(format!("no metric `{}`", column.metric)))?;
        let element = match column.element.as_deref() {
            None => Element::F32,
            Some(other) => element_from(other)
                .ok_or_else(|| invalid(format!("no vector element `{other}`")))?,
        };
        schema.vectors.insert(
            column.name,
            Column {
                dims: column.dims as usize,
                metric,
                element,
            },
        );
    }
    for column in input.attributes {
        if column.filter_index == Some(true) {
            schema = schema.filter_index(&column.name);
        }
        if column.kind == "text" {
            let default = TextOptions::default();
            let language = match column.language {
                Some(name) => serde_json::from_value::<Language>(Json::String(name.clone()))
                    .map_err(|_| invalid(format!("no language `{name}`")))?,
                None => default.language,
            };
            let options = TextOptions {
                k1: column.k1.map_or(default.k1, |k1| k1 as f32),
                b: column.b.map_or(default.b, |b| b as f32),
                language,
                stopwords: column.stopwords.unwrap_or(default.stopwords),
                stemming: column.stemming.unwrap_or(default.stemming),
                filterable: column.filterable.unwrap_or(default.filterable),
                case_sensitive: column.case_sensitive.unwrap_or(default.case_sensitive),
                ascii_folding: column.ascii_folding.unwrap_or(default.ascii_folding),
                max_token: match column.max_token_length {
                    Some(n) => u16::try_from(n).map_err(|_| {
                        invalid(format!(
                            "`{}`: max token length is at most 65535",
                            column.name
                        ))
                    })?,
                    None => default.max_token,
                },
                pre_tokenized: column.pre_tokenized.unwrap_or(default.pre_tokenized),
            };
            schema = schema.text(&column.name, options);
            continue;
        }
        let kind = kind_from(&column.kind)
            .ok_or_else(|| invalid(format!("no attribute type `{}`", column.kind)))?;
        if column.k1.is_some() || column.b.is_some() {
            return Err(invalid(format!(
                "`{}`: only text takes k1 and b",
                column.name
            )));
        }
        let options = [
            column.stemming,
            column.filterable,
            column.case_sensitive,
            column.ascii_folding,
            column.pre_tokenized,
        ];
        if options.iter().any(Option::is_some) || column.max_token_length.is_some() {
            return Err(invalid(format!(
                "`{}`: only text takes text options",
                column.name
            )));
        }
        if column.language.is_some() || column.stopwords.is_some() {
            return Err(invalid(format!(
                "`{}`: only text takes a language and stopwords",
                column.name
            )));
        }
        schema.attributes.insert(column.name, kind);
    }
    Ok(schema)
}

pub(crate) fn schema_to(schema: &Schema) -> IndexSchema {
    IndexSchema {
        vectors: schema
            .vectors
            .iter()
            .map(|(name, column)| VectorColumn {
                name: name.clone(),
                dims: column.dims as u32,
                metric: metric_name(column.metric).to_string(),
                element: (column.element != Element::F32)
                    .then(|| element_name(column.element).to_string()),
            })
            .collect(),
        attributes: schema
            .attributes
            .iter()
            .map(|(name, kind)| {
                let text = schema.text.get(name);
                AttributeColumn {
                    name: name.clone(),
                    kind: text.map_or(kind_name(*kind), |_| "text").to_string(),
                    k1: text.map(|t| short(t.k1)),
                    b: text.map(|t| short(t.b)),
                    language: text.map(|t| t.language.name()),
                    stopwords: text.map(|t| t.stopwords),
                    stemming: text.filter(|t| !t.stemming).map(|_| false),
                    filterable: text.filter(|t| t.filterable).map(|_| true),
                    case_sensitive: text.filter(|t| t.case_sensitive).map(|_| true),
                    ascii_folding: text.filter(|t| t.ascii_folding).map(|_| true),
                    max_token_length: (text.map(|t| t.max_token as u32))
                        .filter(|&n| n != TextOptions::default().max_token as u32),
                    pre_tokenized: text.filter(|t| t.pre_tokenized).map(|_| true),
                    filter_index: schema.filter_index.contains(name).then_some(true),
                }
            })
            .collect(),
        id: (schema.id == IdKind::Uuid).then(|| "uuid".to_string()),
    }
}
