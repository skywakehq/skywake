use futures::stream::{self, StreamExt, TryStreamExt};
use reqwest::Method;
use serde_json::{Value, json};

use super::Index;
use super::types::{Row, Rows, Upserted};
use crate::shared::batches::{Limits, batches};
use crate::shared::http::Body;
use crate::shared::paging::{List, pages};
use crate::{Error, Result};

const UPSERT: Limits = Limits {
    count: 10_000,
    bytes: 24 * 1024 * 1024,
};
const PAGE: u32 = 1000;

pub(crate) async fn upsert(index: &Index, rows: Rows) -> Result<Upserted> {
    let encoded = rows
        .0
        .iter()
        .map(serde_json::to_vec)
        .collect::<serde_json::Result<Vec<_>>>()?;
    let mut done = Upserted::default();
    let route = index.place.route("/rows");
    for batch in batches(encoded, &UPSERT, Vec::len) {
        let body = Body::Json([b"[".as_slice(), &batch.join(&b','), b"]"].concat());
        let response = index
            .place
            .http
            .send(Method::POST, &route, &index.place.params(), &body)
            .await?;
        let Upserted { ids, count } = serde_json::from_slice(&response.bytes().await?)?;
        done.ids.extend(ids);
        done.count += count;
    }
    Ok(done)
}

#[must_use]
pub struct RowList<'a> {
    index: &'a Index,
    filter: Option<Value>,
}

impl<'a> RowList<'a> {
    pub(crate) fn new(index: &'a Index) -> Self {
        RowList {
            index,
            filter: None,
        }
    }

    pub fn filter(mut self, filter: Value) -> Self {
        self.filter = Some(filter);
        self
    }

    pub fn stream(self) -> List<Row> {
        match self.filter {
            Some(filter) => matching(self.index.clone(), filter),
            None => {
                let mut params = self.index.place.params();
                params.push(("limit", PAGE.to_string()));
                let route = self.index.place.route("/rows");
                pages(self.index.place.http.clone(), route, params)
            }
        }
    }
}

fn matching(index: Index, filter: Value) -> List<Row> {
    stream::try_unfold(Some(None), move |after: Option<Option<Value>>| {
        let (index, filter) = (index.clone(), filter.clone());
        async move {
            let Some(after) = after else {
                return Ok::<_, Error>(None);
            };
            let filter = match after {
                Some(id) => json!({ "and": [filter, { "id": { "gt": id } }] }),
                None => filter,
            };
            let hits = index.query(None).filter(filter).limit(PAGE).send().await?;
            let next = (hits.len() == PAGE as usize)
                .then(|| hits.last().map(|hit| hit["id"].clone()))
                .flatten();
            let rows = hits.into_iter().map(|mut hit| {
                hit.remove("score");
                Ok::<Row, Error>(hit)
            });
            Ok(Some((stream::iter(rows), next.map(Some))))
        }
    })
    .try_flatten()
    .boxed()
}
