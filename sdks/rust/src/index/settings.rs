use reqwest::Method;
use serde::Serialize;
use serde_json::{Value, json};

use super::Index;
use super::types::{IndexInfo, IndexSummary};
use crate::Result;
use crate::place::{MAIN, Place};
use crate::shared::awaitable;

#[derive(Serialize)]
struct CopyBody {
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    environment: Option<String>,
}

#[must_use]
pub struct CopyIndex<'a> {
    index: &'a Index,
    body: CopyBody,
}

impl<'a> CopyIndex<'a> {
    pub(crate) fn new(index: &'a Index, name: &str) -> Self {
        let body = CopyBody {
            name: name.to_string(),
            environment: None,
        };
        CopyIndex { index, body }
    }

    pub fn environment(mut self, environment: impl Into<String>) -> Self {
        self.body.environment = Some(environment.into());
        self
    }

    pub async fn send(self) -> Result<Index> {
        let place = &self.index.place;
        let _: IndexSummary = place.http.post(&place.route("/copy"), &self.body).await?;
        let http = match &self.body.environment {
            Some(environment) => place.http.within(environment),
            None => place.http.clone(),
        };
        Ok(Index::from(Place::new(
            http,
            "indexes",
            &self.body.name,
            MAIN,
        )))
    }
}

awaitable!(CopyIndex => Index);

#[derive(Default, Serialize)]
struct Settings {
    #[serde(skip_serializing_if = "Option::is_none")]
    read_only: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    retention_days: Option<Option<u32>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pinned: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    attributes: Option<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    drop_attributes: Option<Vec<String>>,
}

#[must_use]
pub struct IndexConfigure<'a> {
    index: &'a Index,
    body: Settings,
}

impl<'a> IndexConfigure<'a> {
    pub(crate) fn new(index: &'a Index) -> Self {
        IndexConfigure {
            index,
            body: Settings::default(),
        }
    }

    pub fn read_only(mut self, read_only: bool) -> Self {
        self.body.read_only = Some(read_only);
        self
    }

    pub fn retention_days(mut self, days: Option<u32>) -> Self {
        self.body.retention_days = Some(days);
        self
    }

    pub fn pinned(mut self, replicas: Option<u32>) -> Self {
        self.body.pinned = Some(replicas.map_or(Value::Null, |n| json!({ "replicas": n })));
        self
    }

    pub fn attributes(mut self, attributes: Vec<Value>) -> Self {
        self.body.attributes = Some(attributes);
        self
    }

    pub fn drop_attributes(mut self, names: impl Into<crate::Names>) -> Self {
        self.body.drop_attributes = Some(names.into().into_vec());
        self
    }

    pub async fn send(self) -> Result<IndexInfo> {
        let place = &self.index.place;
        place
            .http
            .call(Method::PATCH, &place.path, &Vec::new(), &self.body)
            .await
    }
}

awaitable!(IndexConfigure => IndexInfo);
