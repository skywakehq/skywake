use futures::TryStreamExt;
use serde::Serialize;
use serde::de::DeserializeOwned;

use super::Disk;
use super::changes::clean;
use super::types::{Entry, FileHit, FindKind, Found, Kind, Match};
use crate::shared::awaitable;
use crate::shared::paging::{List, Page, collect, pages};
use crate::{ErrorKind, Result};

pub(crate) fn entries(disk: &Disk, path: &str, recursive: bool, at: Option<&str>) -> List<Entry> {
    let mut params = disk.place.params();
    params.push(("path", clean(path)));
    params.push(("limit", "1000".into()));
    if recursive {
        params.push(("recursive", "true".into()));
    }
    params.extend(at.map(|at| ("at", at.to_string())));
    pages(disk.place.http.clone(), disk.place.route("/files"), params)
}

#[must_use]
pub struct ListFiles<'a> {
    disk: &'a Disk,
    path: String,
    recursive: bool,
    at: Option<String>,
}

impl<'a> ListFiles<'a> {
    pub(crate) fn new(disk: &'a Disk, path: &str) -> Self {
        ListFiles {
            disk,
            path: path.to_string(),
            recursive: false,
            at: None,
        }
    }

    pub fn recursive(mut self, recursive: bool) -> Self {
        self.recursive = recursive;
        self
    }

    pub fn at(mut self, at: impl Into<String>) -> Self {
        self.at = Some(at.into());
        self
    }

    pub fn stream(self) -> List<Entry> {
        entries(self.disk, &self.path, self.recursive, self.at.as_deref())
    }

    pub async fn send(self) -> Result<Vec<Entry>> {
        collect(self.stream()).await
    }
}

awaitable!(ListFiles => Vec<Entry>);

#[must_use]
pub struct Stat<'a, T> {
    disk: &'a Disk,
    path: String,
    at: Option<String>,
    finish: fn(Option<Entry>) -> T,
}

impl<'a, T: Send + 'a> Stat<'a, T> {
    pub(crate) fn new(disk: &'a Disk, path: &str, finish: fn(Option<Entry>) -> T) -> Self {
        Stat {
            disk,
            path: clean(path),
            at: None,
            finish,
        }
    }

    pub fn at(mut self, at: impl Into<String>) -> Self {
        self.at = Some(at.into());
        self
    }

    pub async fn send(self) -> Result<T> {
        Ok((self.finish)(self.find().await?))
    }

    async fn find(&self) -> Result<Option<Entry>> {
        if self.path.is_empty() {
            return Ok(Some(Entry {
                path: String::new(),
                kind: Kind::Folder,
                size: 0,
                modified: None,
                executable: false,
                target: None,
            }));
        }
        let parent = self.path.rsplit_once('/').map_or("", |(parent, _)| parent);
        let mut listed = entries(self.disk, parent, false, self.at.as_deref());
        loop {
            match listed.try_next().await {
                Ok(Some(entry)) if entry.path == self.path => return Ok(Some(entry)),
                Ok(Some(entry)) if entry.path > self.path => return Ok(None),
                Ok(Some(_)) => continue,
                Ok(None) => return Ok(None),
                Err(error) if error.kind() == Some(&ErrorKind::NotFound) => {
                    self.disk.info().await?;
                    return Ok(None);
                }
                Err(error) => return Err(error),
            }
        }
    }
}

impl<'a, T: Send + 'a> std::future::IntoFuture for Stat<'a, T> {
    type Output = Result<T>;
    type IntoFuture = futures::future::BoxFuture<'a, Result<T>>;

    fn into_future(self) -> Self::IntoFuture {
        Box::pin(self.send())
    }
}

async fn post_data<T: DeserializeOwned>(
    disk: &Disk,
    tail: &str,
    body: &impl Serialize,
) -> Result<Vec<T>> {
    let page: Page<T> = disk.place.http.post(&disk.place.route(tail), body).await?;
    Ok(page.data)
}

#[derive(Serialize)]
struct GrepBody {
    pattern: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    glob: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ignore_case: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    limit: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    at: Option<String>,
    branch: String,
}

#[must_use]
pub struct Grep<'a> {
    disk: &'a Disk,
    body: GrepBody,
}

impl<'a> Grep<'a> {
    pub(crate) fn new(disk: &'a Disk, pattern: &str) -> Self {
        let body = GrepBody {
            pattern: pattern.to_string(),
            path: None,
            glob: None,
            ignore_case: None,
            limit: None,
            at: None,
            branch: disk.place.branch.clone(),
        };
        Grep { disk, body }
    }

    pub fn path(mut self, path: impl Into<String>) -> Self {
        self.body.path = Some(path.into());
        self
    }

    pub fn glob(mut self, glob: impl Into<String>) -> Self {
        self.body.glob = Some(glob.into());
        self
    }

    pub fn ignore_case(mut self, ignore_case: bool) -> Self {
        self.body.ignore_case = Some(ignore_case);
        self
    }

    pub fn limit(mut self, limit: u32) -> Self {
        self.body.limit = Some(limit);
        self
    }

    pub fn at(mut self, at: impl Into<String>) -> Self {
        self.body.at = Some(at.into());
        self
    }

    pub async fn send(self) -> Result<Vec<Match>> {
        post_data(self.disk, "/grep", &self.body).await
    }
}

awaitable!(Grep => Vec<Match>);

#[derive(Serialize)]
struct FindBody {
    glob: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    kind: Option<FindKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    limit: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    at: Option<String>,
    branch: String,
}

#[must_use]
pub struct Find<'a> {
    disk: &'a Disk,
    body: FindBody,
}

impl<'a> Find<'a> {
    pub(crate) fn new(disk: &'a Disk, glob: &str) -> Self {
        let body = FindBody {
            glob: glob.to_string(),
            path: None,
            kind: None,
            limit: None,
            at: None,
            branch: disk.place.branch.clone(),
        };
        Find { disk, body }
    }

    pub fn path(mut self, path: impl Into<String>) -> Self {
        self.body.path = Some(path.into());
        self
    }

    pub fn kind(mut self, kind: FindKind) -> Self {
        self.body.kind = Some(kind);
        self
    }

    pub fn limit(mut self, limit: u32) -> Self {
        self.body.limit = Some(limit);
        self
    }

    pub fn at(mut self, at: impl Into<String>) -> Self {
        self.body.at = Some(at.into());
        self
    }

    pub async fn send(self) -> Result<Vec<Found>> {
        post_data(self.disk, "/find", &self.body).await
    }
}

awaitable!(Find => Vec<Found>);

#[derive(Serialize)]
struct QueryBody {
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    limit: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    branch: String,
}

#[must_use]
pub struct FileQuery<'a> {
    disk: &'a Disk,
    body: QueryBody,
}

impl<'a> FileQuery<'a> {
    pub(crate) fn new(disk: &'a Disk, text: &str) -> Self {
        let body = QueryBody {
            text: text.to_string(),
            limit: None,
            path: None,
            branch: disk.place.branch.clone(),
        };
        FileQuery { disk, body }
    }

    pub fn limit(mut self, limit: u32) -> Self {
        self.body.limit = Some(limit);
        self
    }

    pub fn path(mut self, path: impl Into<String>) -> Self {
        self.body.path = Some(path.into());
        self
    }

    pub async fn send(self) -> Result<Vec<FileHit>> {
        post_data(self.disk, "/query", &self.body).await
    }
}

awaitable!(FileQuery => Vec<FileHit>);
