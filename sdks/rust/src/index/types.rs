use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub type Row = Map<String, Value>;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Auto,
    Meaning,
    Keywords,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Order {
    Asc,
    Desc,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct Upserted {
    pub ids: Vec<Value>,
    pub count: u64,
}

#[derive(Clone, Debug, Deserialize)]
pub struct IndexSummary {
    pub name: String,
    #[serde(default)]
    pub region: String,
    #[serde(default)]
    pub created: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct IndexInfo {
    pub name: String,
    pub region: String,
    pub created: String,
    pub schema: Value,
    pub rows: Option<u64>,
    pub bytes: Option<u64>,
    pub read_only: bool,
    pub retention_days: Option<u64>,
    pub branches: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct IndexMerged {
    pub rows: u64,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Version {
    pub id: String,
    pub created: String,
    pub rows: Option<u64>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Group {
    pub group: Row,
    pub count: Option<u64>,
    #[serde(default)]
    pub sum: Row,
    #[serde(default)]
    pub avg: Row,
    #[serde(default)]
    pub min: Row,
    #[serde(default)]
    pub max: Row,
}

#[derive(Clone, Debug)]
pub enum Target {
    Id(Value),
    Ids(Vec<Value>),
    Filter(Value),
}

impl Target {
    pub fn filter(filter: Value) -> Self {
        Target::Filter(filter)
    }

    pub(crate) fn into_body(self) -> Row {
        let (name, value) = match self {
            Target::Id(id) => ("id", id),
            Target::Ids(ids) => ("ids", Value::Array(ids)),
            Target::Filter(filter) => ("filter", filter),
        };
        Row::from_iter([(name.to_string(), value)])
    }
}

impl From<Value> for Target {
    fn from(value: Value) -> Self {
        match value {
            Value::Array(ids) => Target::Ids(ids),
            Value::Object(mut map) if map.len() == 1 && map.contains_key("filter") => {
                Target::Filter(map.remove("filter").unwrap_or_default())
            }
            Value::Object(map) => Target::Filter(Value::Object(map)),
            id => Target::Id(id),
        }
    }
}

impl<T: Into<Value>> From<Vec<T>> for Target {
    fn from(ids: Vec<T>) -> Self {
        Target::Ids(ids.into_iter().map(Into::into).collect())
    }
}

macro_rules! id_target {
    ($($kind:ty),*) => {
        $(impl From<$kind> for Target {
            fn from(id: $kind) -> Self {
                Target::Id(id.into())
            }
        })*
    };
}

id_target!(&str, String, i32, i64, u32, u64);

pub struct Rows(pub(crate) Vec<Value>);

impl From<Value> for Rows {
    fn from(value: Value) -> Self {
        match value {
            Value::Array(rows) => Rows(rows),
            row => Rows(vec![row]),
        }
    }
}

impl From<Row> for Rows {
    fn from(row: Row) -> Self {
        Rows(vec![Value::Object(row)])
    }
}

impl From<Vec<Value>> for Rows {
    fn from(rows: Vec<Value>) -> Self {
        Rows(rows)
    }
}

impl From<Vec<Row>> for Rows {
    fn from(rows: Vec<Row>) -> Self {
        Rows(rows.into_iter().map(Value::Object).collect())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(transparent)]
pub struct Names(Vec<String>);

impl From<&str> for Names {
    fn from(name: &str) -> Self {
        Names(vec![name.to_string()])
    }
}

impl From<String> for Names {
    fn from(name: String) -> Self {
        Names(vec![name])
    }
}

impl<S: Into<String>> From<Vec<S>> for Names {
    fn from(names: Vec<S>) -> Self {
        Names(names.into_iter().map(Into::into).collect())
    }
}

impl<S: Into<String>, const N: usize> From<[S; N]> for Names {
    fn from(names: [S; N]) -> Self {
        Names(names.into_iter().map(Into::into).collect())
    }
}

impl Names {
    pub(crate) fn into_vec(self) -> Vec<String> {
        self.0
    }
}
