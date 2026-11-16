mod query;
mod rows;
mod settings;
mod types;

use reqwest::Method;
use serde::Serialize;
use serde_json::Value;

pub use query::{Aggregate, Count, Query};
pub use rows::RowList;
pub use settings::{CopyIndex, IndexConfigure};
pub use types::{
    Group, IndexInfo, IndexMerged, IndexSummary, Mode, Names, Order, Row, Rows, Target, Upserted,
    Version,
};

use crate::place::{At, Branch, Fork, Place};
use crate::shared::http::segment;
use crate::shared::paging::{collect, pages};
use crate::shared::time;
use crate::{ErrorKind, Result};
use query::Counted;

#[derive(Clone)]
pub struct Index {
    place: Place,
}

impl From<Place> for Index {
    fn from(place: Place) -> Self {
        Index { place }
    }
}

#[derive(Serialize)]
struct Merge<'a> {
    from: &'a str,
    into: &'a str,
}

#[derive(Serialize)]
struct Restore<'a> {
    to: String,
    branch: &'a str,
}

impl Index {
    pub fn name(&self) -> &str {
        &self.place.name
    }

    pub fn branch(&self) -> &str {
        &self.place.branch
    }

    pub fn on(&self, branch: &str) -> Index {
        Index::from(self.place.on(branch))
    }

    pub async fn upsert(&self, rows: impl Into<Rows>) -> Result<Upserted> {
        rows::upsert(self, rows.into()).await
    }

    pub async fn update(&self, target: impl Into<Target>, fields: impl Into<Value>) -> Result<u64> {
        let mut body = target.into().into_body();
        body.insert("fields".into(), fields.into());
        self.counted(Method::PATCH, "/rows", body).await
    }

    pub async fn delete(&self, target: impl Into<Target>) -> Result<u64> {
        let body = target.into().into_body();
        self.counted(Method::POST, "/rows/delete", body).await
    }

    async fn counted(&self, method: Method, tail: &str, body: Row) -> Result<u64> {
        let route = self.place.route(tail);
        let params = self.place.params();
        let counted: Counted = self.place.http.call(method, &route, &params, &body).await?;
        Ok(counted.count)
    }

    pub async fn get(&self, id: impl Into<Value>) -> Result<Option<Row>> {
        let id = match id.into() {
            Value::String(id) => id,
            id => id.to_string(),
        };
        let route = self.place.route(&format!("/rows/{}", segment(&id)));
        match self.place.http.get(&route, self.place.params()).await {
            Ok(row) => Ok(Some(row)),
            Err(error)
                if error.kind() == Some(&ErrorKind::NotFound)
                    && error.api().and_then(|api| api.path.as_deref()) == Some("id") =>
            {
                Ok(None)
            }
            Err(error) => Err(error),
        }
    }

    pub fn query<'t>(&self, text: impl Into<Option<&'t str>>) -> Query<'_> {
        Query::new(self, text.into())
    }

    pub fn count(&self) -> Count<'_> {
        Count::new(self)
    }

    pub fn aggregate(&self) -> Aggregate<'_> {
        Aggregate::new(self)
    }

    pub fn rows(&self) -> RowList<'_> {
        RowList::new(self)
    }

    pub fn fork(&self, name: &str) -> Fork<'_, Index> {
        Fork::new(&self.place, name, Index::from)
    }

    pub async fn merge_into(&self, into: &str) -> Result<IndexMerged> {
        let body = Merge {
            from: &self.place.branch,
            into,
        };
        self.place
            .http
            .post(&self.place.route("/merges"), &body)
            .await
    }

    pub async fn destroy(&self) -> Result<()> {
        self.place.destroy().await
    }

    pub async fn branches(&self) -> Result<Vec<Branch>> {
        self.place.branches().await
    }

    pub async fn versions(&self) -> Result<Vec<Version>> {
        let route = self.place.route("/versions");
        collect(pages(self.place.http.clone(), route, self.place.params())).await
    }

    pub async fn restore(&self, to: impl Into<At>) -> Result<Version> {
        let to = match to.into() {
            At::Id(id) => id,
            At::Time(when) => time::format(when),
        };
        let body = Restore {
            to,
            branch: &self.place.branch,
        };
        self.place
            .http
            .post(&self.place.route("/restore"), &body)
            .await
    }

    pub fn copy(&self, name: &str) -> CopyIndex<'_> {
        CopyIndex::new(self, name)
    }

    pub async fn info(&self) -> Result<IndexInfo> {
        self.place.http.get(&self.place.path, Vec::new()).await
    }

    pub fn configure(&self) -> IndexConfigure<'_> {
        IndexConfigure::new(self)
    }
}
