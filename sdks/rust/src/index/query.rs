use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::Index;
use super::types::{Group, Mode, Names, Order, Row};
use crate::Result;
use crate::shared::awaitable;
use crate::shared::paging::Page;

#[derive(Default, Serialize)]
struct QueryBody {
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    vector: Option<Vec<f64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    filter: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    limit: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mode: Option<Mode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sort: Option<Row>,
    #[serde(skip_serializing_if = "Option::is_none")]
    fields: Option<Vec<String>>,
    branch: String,
}

#[must_use]
pub struct Query<'a> {
    index: &'a Index,
    body: QueryBody,
}

impl<'a> Query<'a> {
    pub(crate) fn new(index: &'a Index, text: Option<&str>) -> Self {
        let body = QueryBody {
            text: text.map(String::from),
            branch: index.place.branch.clone(),
            ..QueryBody::default()
        };
        Query { index, body }
    }

    pub fn vector(mut self, vector: impl Into<Vec<f64>>) -> Self {
        self.body.vector = Some(vector.into());
        self
    }

    pub fn filter(mut self, filter: Value) -> Self {
        self.body.filter = Some(filter);
        self
    }

    pub fn limit(mut self, limit: u32) -> Self {
        self.body.limit = Some(limit);
        self
    }

    pub fn mode(mut self, mode: Mode) -> Self {
        self.body.mode = Some(mode);
        self
    }

    pub fn sort(mut self, field: impl Into<String>, order: Order) -> Self {
        let order = serde_json::to_value(order).unwrap_or_default();
        self.body
            .sort
            .get_or_insert_default()
            .insert(field.into(), order);
        self
    }

    pub fn fields(mut self, fields: impl Into<Names>) -> Self {
        self.body.fields = Some(fields.into().into_vec());
        self
    }

    pub async fn send(self) -> Result<Vec<Row>> {
        let route = self.index.place.route("/query");
        let page: Page<Row> = self.index.place.http.post(&route, &self.body).await?;
        Ok(page.data)
    }
}

awaitable!(Query => Vec<Row>);

#[derive(Serialize)]
struct CountBody {
    #[serde(skip_serializing_if = "Option::is_none")]
    filter: Option<Value>,
    branch: String,
}

#[derive(Deserialize)]
pub(crate) struct Counted {
    pub count: u64,
}

#[must_use]
pub struct Count<'a> {
    index: &'a Index,
    body: CountBody,
}

impl<'a> Count<'a> {
    pub(crate) fn new(index: &'a Index) -> Self {
        let body = CountBody {
            filter: None,
            branch: index.place.branch.clone(),
        };
        Count { index, body }
    }

    pub fn filter(mut self, filter: Value) -> Self {
        self.body.filter = Some(filter);
        self
    }

    pub async fn send(self) -> Result<u64> {
        let route = self.index.place.route("/count");
        let counted: Counted = self.index.place.http.post(&route, &self.body).await?;
        Ok(counted.count)
    }
}

awaitable!(Count => u64);

#[derive(Default, Serialize)]
struct AggregateBody {
    #[serde(skip_serializing_if = "Option::is_none")]
    group_by: Option<Names>,
    #[serde(skip_serializing_if = "Option::is_none")]
    count: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sum: Option<Names>,
    #[serde(skip_serializing_if = "Option::is_none")]
    avg: Option<Names>,
    #[serde(skip_serializing_if = "Option::is_none")]
    min: Option<Names>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max: Option<Names>,
    #[serde(skip_serializing_if = "Option::is_none")]
    filter: Option<Value>,
    branch: String,
}

#[must_use]
pub struct Aggregate<'a> {
    index: &'a Index,
    body: AggregateBody,
}

impl<'a> Aggregate<'a> {
    pub(crate) fn new(index: &'a Index) -> Self {
        let body = AggregateBody {
            branch: index.place.branch.clone(),
            ..AggregateBody::default()
        };
        Aggregate { index, body }
    }

    pub fn group_by(mut self, fields: impl Into<Names>) -> Self {
        self.body.group_by = Some(fields.into());
        self
    }

    pub fn count(mut self, count: bool) -> Self {
        self.body.count = Some(count);
        self
    }

    pub fn sum(mut self, fields: impl Into<Names>) -> Self {
        self.body.sum = Some(fields.into());
        self
    }

    pub fn avg(mut self, fields: impl Into<Names>) -> Self {
        self.body.avg = Some(fields.into());
        self
    }

    pub fn min(mut self, fields: impl Into<Names>) -> Self {
        self.body.min = Some(fields.into());
        self
    }

    pub fn max(mut self, fields: impl Into<Names>) -> Self {
        self.body.max = Some(fields.into());
        self
    }

    pub fn filter(mut self, filter: Value) -> Self {
        self.body.filter = Some(filter);
        self
    }

    pub async fn send(self) -> Result<Vec<Group>> {
        let route = self.index.place.route("/aggregate");
        let page: Page<Group> = self.index.place.http.post(&route, &self.body).await?;
        Ok(page.data)
    }
}

awaitable!(Aggregate => Vec<Group>);
