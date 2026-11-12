use futures::stream::{self, Stream, StreamExt, TryStreamExt};
use reqwest::Method;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use serde_with::skip_serializing_none;

use super::request::{BATCH, encryption, escaped, page, params, take};
use super::stream::{every, lines, pages};
use crate::client::Params;
use crate::{
    Aggregate, Branch, Client, Consistency, DocId, Document, DocumentPage, FusedHit, Group, Hit,
    Hybrid, IndexOptions, IndexVersion, Measured, MultiResult, Operation, Order, Patch, Query,
    Rank, Ranked, Recall, RecallCheck, Request, Result, Row, Search, SearchHit, Stats, Write,
    WriteCounts,
};

#[derive(Deserialize)]
struct Written {
    count: u64,
}

/// One branch of a search index: `main` unless `at` picked another.
#[derive(Clone)]
pub struct SearchIndex {
    sky: Client,
    pub name: String,
    pub branch: String,
    path: String,
    branch_path: String,
}

impl SearchIndex {
    pub(crate) fn new(sky: Client, name: &str, branch: &str) -> Self {
        let path = format!("/indexes/{}", escaped(name));
        let branch_path = format!("{path}/branches/{}", escaped(branch));
        let (name, branch) = (name.to_string(), branch.to_string());
        SearchIndex {
            sky,
            name,
            branch,
            path,
            branch_path,
        }
    }

    /// The same index on another branch.
    pub fn at(&self, branch: &str) -> SearchIndex {
        SearchIndex::new(self.sky.clone(), &self.name, branch)
    }

    fn on_branch(&self, route: &str) -> String {
        format!("{}{route}", self.branch_path)
    }

    /// A read whose answer holds its items in `field`.
    async fn measured<T: DeserializeOwned>(
        &self,
        route: &str,
        body: &impl Serialize,
        field: &str,
    ) -> Result<Measured<T>> {
        let mut answer: Map<String, Value> = self.sky.post(&self.on_branch(route), body).await?;
        Ok(Measured {
            items: take(&mut answer, field)?.unwrap_or_default(),
            performance: take(&mut answer, "performance")?,
            billing: take(&mut answer, "billing")?,
        })
    }

    async fn in_batches<T: Serialize>(&self, route: &str, field: &str, items: &[T]) -> Result<u64> {
        let mut count = 0;
        for batch in items.chunks(BATCH) {
            let body = Map::from_iter([(field.to_string(), serde_json::to_value(batch)?)]);
            count += self
                .sky
                .post::<Written>(&self.on_branch(route), &body)
                .await?
                .count;
        }
        Ok(count)
    }

    /// Writes documents, 1000 to a request. Each replaces any earlier one
    /// with its id.
    pub async fn upsert(&self, documents: &[Document]) -> Result<u64> {
        self.in_batches("/documents", "documents", documents).await
    }

    /// Deletes documents by id. Ids that are not there are ignored.
    pub async fn delete(&self, ids: &[DocId]) -> Result<u64> {
        self.in_batches("/documents/delete", "ids", ids).await
    }

    /// Upserts, patches and deletes as one change.
    pub async fn write(&self, write: &Write) -> Result<WriteCounts> {
        self.sky.post(&self.on_branch("/write"), write).await
    }

    /// Sets attributes of documents, 1000 to a request. Missing documents
    /// are skipped. Returns how many were patched.
    pub async fn patch(&self, patches: &[Patch]) -> Result<u64> {
        let mut count = 0;
        for batch in patches.chunks(BATCH) {
            let write = Write {
                patches: Some(batch.to_vec()),
                ..Default::default()
            };
            count += self.write(&write).await?.patched;
        }
        Ok(count)
    }

    /// Deletes every document that passes `filter`; returns how many.
    pub async fn delete_by(&self, filter: Value) -> Result<u64> {
        let write = Write {
            delete_by: Some(filter),
            ..Default::default()
        };
        Ok(self.write(&write).await?.deleted)
    }

    pub async fn query(&self, query: &Query) -> Result<Measured<Hit>> {
        self.measured("/query", query, "hits").await
    }

    pub async fn search(&self, search: &Search) -> Result<Measured<SearchHit>> {
        self.measured("/search", search, "hits").await
    }

    pub async fn hybrid(&self, hybrid: &Hybrid) -> Result<Measured<FusedHit>> {
        self.measured("/hybrid", hybrid, "hits").await
    }

    pub async fn order(&self, order: &Order) -> Result<Measured<Row>> {
        self.measured("/order", order, "rows").await
    }

    pub async fn rank(&self, rank: &Rank) -> Result<Measured<Ranked>> {
        self.measured("/rank", rank, "hits").await
    }

    pub async fn aggregate(&self, aggregate: &Aggregate) -> Result<Measured<Group>> {
        self.measured("/aggregate", aggregate, "groups").await
    }

    /// Several requests that all see one snapshot of the branch.
    pub async fn multi(
        &self,
        requests: &[Request],
        consistency: Option<Consistency>,
    ) -> Result<Measured<MultiResult>> {
        #[skip_serializing_none]
        #[derive(Serialize)]
        struct Multi<'a> {
            requests: &'a [Request],
            consistency: Option<Consistency>,
        }
        self.measured(
            "/multi",
            &Multi {
                requests,
                consistency,
            },
            "results",
        )
        .await
    }

    /// Every document as it is now, streamed, in no set order.
    pub fn export(&self) -> impl Stream<Item = Result<Document>> + '_ {
        let path = self.on_branch("/export");
        stream::once(async move { self.sky.send(Method::GET, &path, Params::new(), None).await })
            .map_ok(|response| lines(response.bytes_stream()))
            .try_flatten()
    }

    /// Every document as it is now, as the bytes of a Parquet file,
    /// streamed.
    pub fn export_parquet(&self) -> impl Stream<Item = Result<Vec<u8>>> + '_ {
        let path = self.on_branch("/export");
        let params = vec![("format", "parquet".to_string())];
        stream::once(async move { self.sky.send(Method::GET, &path, params, None).await })
            .map_ok(|response| response.bytes_stream().map(|chunk| Ok(chunk?.to_vec())))
            .try_flatten()
    }

    /// Copies this branch to a new index `name`, as its `main`.
    pub async fn copy(&self, name: &str, options: &IndexOptions) -> Result<SearchIndex> {
        #[skip_serializing_none]
        #[derive(Serialize)]
        struct Copy<'a> {
            name: &'a str,
            branch: &'a str,
            region: Option<&'a str>,
            encryption: Option<Value>,
        }
        let body = Copy {
            name,
            branch: &self.branch,
            region: options.region.as_deref(),
            encryption: encryption(options.kms_key_id.as_deref()),
        };
        self.sky
            .post::<Value>(&format!("{}/copy", self.path), &body)
            .await?;
        Ok(SearchIndex::new(self.sky.clone(), name, "main"))
    }

    /// The document with `id`. A missing one is a 404, as a missing index
    /// or branch is.
    pub async fn get(&self, id: impl Into<DocId>) -> Result<Document> {
        let path = self.on_branch(&format!("/documents/{}", escaped(&id.into().to_string())));
        self.sky.get(&path, Params::new()).await
    }

    /// One page of documents by id, number ids first. It reads every
    /// segment, so it is for browsing.
    pub async fn documents(
        &self,
        limit: Option<u32>,
        cursor: Option<&str>,
    ) -> Result<DocumentPage> {
        let params = params([
            ("limit", limit.map(|n| n.to_string())),
            ("cursor", cursor.map(String::from)),
        ]);
        self.sky.get(&self.on_branch("/documents"), params).await
    }

    /// Every document, a page at a time.
    pub fn all_documents(&self) -> impl Stream<Item = Result<Document>> + '_ {
        pages(move |cursor: Option<String>| async move {
            let page = self
                .documents(Some(BATCH as u32), cursor.as_deref())
                .await?;
            Ok((page.documents, page.next))
        })
    }

    /// Forks this branch as `branch`. Nothing is copied.
    pub async fn fork(&self, branch: &str) -> Result<SearchIndex> {
        self.fork_from(branch, None).await
    }

    /// Forks this branch as `branch` at an older `version` of it. Nothing
    /// is copied.
    pub async fn fork_at(&self, branch: &str, version: &str) -> Result<SearchIndex> {
        self.fork_from(branch, Some(version)).await
    }

    async fn fork_from(&self, branch: &str, version: Option<&str>) -> Result<SearchIndex> {
        let mut body = json!({ "name": branch, "from": self.branch });
        if let Some(version) = version {
            body["at"] = json!(version);
        }
        self.sky
            .post::<Value>(&format!("{}/branches", self.path), &body)
            .await?;
        Ok(self.at(branch))
    }

    /// One page of this branch's versions, newest first: one for every
    /// change.
    pub async fn versions(
        &self,
        limit: Option<u32>,
        after: Option<&str>,
    ) -> Result<Vec<IndexVersion>> {
        self.sky
            .get(&self.on_branch("/versions"), page(limit, after))
            .await
    }

    /// Moves this branch back to an older version, as a new version, which
    /// it returns. The history stays.
    pub async fn restore(&self, version: &str) -> Result<IndexVersion> {
        let body = json!({ "version": version });
        self.sky.post(&self.on_branch("/restore"), &body).await
    }

    /// Starts deleting the data of the whole index that no branch uses,
    /// nor any version within its `retention_days`. Returns the operation.
    pub async fn collect(&self) -> Result<Operation> {
        self.sky.post_empty(&format!("{}/collect", self.path)).await
    }

    /// This branch's counts, or None while the server cannot count them.
    pub async fn stats(&self) -> Result<Option<Stats>> {
        Ok(self
            .sky
            .get::<Branch>(&self.branch_path, Params::new())
            .await?
            .stats)
    }

    /// Starts clustering this branch's rows. It answers before the build
    /// ends, with an operation `operation` follows.
    pub async fn build(&self) -> Result<Operation> {
        self.sky.post_empty(&self.on_branch("/build")).await
    }

    /// Starts reading this branch into the cache, so the next queries are fast.
    pub async fn warm(&self) -> Result<Operation> {
        self.sky.post_empty(&self.on_branch("/warm")).await
    }

    /// A build or warming of this index, and how it went.
    pub async fn operation(&self, id: &str) -> Result<Operation> {
        let path = format!("{}/operations/{}", self.path, escaped(id));
        self.sky.get(&path, Params::new()).await
    }

    /// Adds the writes of `branch` since it forked, or was last merged here,
    /// to this branch, and returns how many it added. Where both wrote one
    /// document, `branch`'s write wins.
    pub async fn merge(&self, branch: &str) -> Result<u64> {
        let mut answer: Map<String, Value> = self
            .sky
            .post(&self.on_branch("/merge"), &json!({ "from": branch }))
            .await?;
        Ok(take(&mut answer, "rows")?.unwrap_or_default())
    }

    /// How many of the true nearest documents queries find.
    pub async fn recall(&self, check: &RecallCheck) -> Result<Recall> {
        self.sky.post(&self.on_branch("/recall"), check).await
    }

    /// One page of the index's branches, in name order.
    pub async fn branches(&self, limit: Option<u32>, after: Option<&str>) -> Result<Vec<Branch>> {
        self.sky
            .get(&format!("{}/branches", self.path), page(limit, after))
            .await
    }

    /// Every branch, a page at a time.
    pub fn all_branches(&self) -> impl Stream<Item = Result<Branch>> + '_ {
        let get_page = move |after: Option<String>| async move {
            self.branches(Some(BATCH as u32), after.as_deref()).await
        };
        every(get_page, |branch: &Branch| branch.name.clone())
    }

    /// Deletes this branch. `main` stays while the index does.
    pub async fn delete_branch(&self) -> Result<()> {
        self.sky.delete(&self.branch_path).await
    }
}
