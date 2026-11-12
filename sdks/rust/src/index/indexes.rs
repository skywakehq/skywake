use futures::stream::Stream;
use reqwest::Method;
use serde::Serialize;
use serde_json::{Map, Value};
use serde_with::skip_serializing_none;

use super::request::{BATCH, encryption, escaped, page, params, take};
use super::stream::every;
use crate::client::Params;
use crate::{Client, Index, IndexOptions, Pinned, Result, SearchIndex, UpdateIndex};

/// The organization's indexes.
pub struct Indexes {
    sky: Client,
}

impl Indexes {
    pub(crate) fn new(sky: Client) -> Self {
        Indexes { sky }
    }

    /// Makes an index with an empty `main` branch. `schema` is `{"vectors":
    /// [{"name", "dims", "metric", "element"}], "attributes": [{"name",
    /// "type"}]}`; a vector column with `"embed": {"model": ...}` takes text.
    /// `"id": "uuid"` makes every id a UUID, returned lowercase with dashes.
    pub async fn create(
        &self,
        name: &str,
        schema: Value,
        options: &IndexOptions,
    ) -> Result<SearchIndex> {
        #[skip_serializing_none]
        #[derive(Serialize)]
        struct NewIndex<'a> {
            name: &'a str,
            schema: Value,
            region: Option<&'a str>,
            shards: Option<u32>,
            encryption: Option<Value>,
            pinned: Option<Pinned>,
        }
        let body = NewIndex {
            name,
            schema,
            region: options.region.as_deref(),
            shards: options.shards,
            encryption: encryption(options.kms_key_id.as_deref()),
            pinned: options.pinned,
        };
        self.sky.post::<Value>("/indexes", &body).await?;
        Ok(SearchIndex::new(self.sky.clone(), name, "main"))
    }

    /// One page of indexes, in name order.
    pub async fn list(&self, limit: Option<u32>, after: Option<&str>) -> Result<Vec<Index>> {
        self.sky.get("/indexes", page(limit, after)).await
    }

    /// Every index, a page at a time.
    pub fn all(&self) -> impl Stream<Item = Result<Index>> + '_ {
        let get_page = move |after: Option<String>| async move {
            self.list(Some(BATCH as u32), after.as_deref()).await
        };
        every(get_page, |index: &Index| index.name.clone())
    }

    /// The schema, and the counts of `main`.
    pub async fn get(&self, name: &str) -> Result<Index> {
        self.sky
            .get(&format!("/indexes/{}", escaped(name)), Params::new())
            .await
    }

    /// Queries, writes and size per day over the last `days` days (14 by
    /// default), oldest first.
    pub async fn usage(&self, name: &str, days: Option<u32>) -> Result<Vec<Value>> {
        let params = params([("days", days.map(|n| n.to_string()))]);
        let mut answer: Map<String, Value> = self
            .sky
            .get(&format!("/indexes/{}/usage", escaped(name)), params)
            .await?;
        Ok(take(&mut answer, "days")?.unwrap_or_default())
    }

    /// Adds attributes, makes the index read-only or writable again, or pins
    /// or unpins it, on every branch.
    pub async fn update(&self, name: &str, update: &UpdateIndex) -> Result<Index> {
        let path = format!("/indexes/{}", escaped(name));
        self.sky.with_body(Method::PATCH, &path, update).await
    }

    /// Deletes the index, every branch and all its data.
    pub async fn delete(&self, name: &str) -> Result<()> {
        self.sky
            .delete(&format!("/indexes/{}", escaped(name)))
            .await
    }
}
