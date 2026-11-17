mod browse;
mod changes;
mod files;
mod folders;
mod history;
mod types;

use std::path::Path;

use reqwest::Method;
use serde::{Deserialize, Serialize};

pub use browse::{FileQuery, Find, Grep, ListFiles, Stat};
pub use files::{Edit, Read};
pub use folders::{Download, Upload};
pub use history::{Log, Merge, Revert};
pub use types::{
    Change, Commit, Committed, Content, DiskInfo, DiskSummary, Entry, FileHit, FindKind, Found,
    Kind, Match, Merged, Prefer, Visibility,
};

use crate::Result;
use crate::index::Names;
use crate::place::{At, Branch, Fork, Place};
use crate::shared::awaitable;
use crate::shared::http::{Body, segment};
use crate::shared::paging::{collect, pages};
use changes::FileChange;

#[derive(Clone)]
pub struct Disk {
    place: Place,
}

impl From<Place> for Disk {
    fn from(place: Place) -> Self {
        Disk { place }
    }
}

#[derive(Serialize)]
struct NewCommit<'a> {
    changes: Vec<FileChange>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    branch: &'a str,
}

#[derive(Serialize)]
struct Restore<'a> {
    to: String,
    branch: &'a str,
}

#[derive(Deserialize)]
struct Uploaded {
    part: String,
}

#[derive(Deserialize)]
struct Head {
    head: Option<String>,
}

impl Disk {
    pub fn name(&self) -> &str {
        &self.place.name
    }

    pub fn branch(&self) -> &str {
        &self.place.branch
    }

    pub fn on(&self, branch: &str) -> Disk {
        Disk::from(self.place.on(branch))
    }

    pub fn read(&self, path: &str) -> Read<'_> {
        Read::new(self, path)
    }

    pub fn write(&self, path: &str, content: impl Into<Content>) -> Edit<'_> {
        Edit::files(self, vec![(path.to_string(), content.into())])
    }

    pub fn write_files<K, V>(&self, files: impl IntoIterator<Item = (K, V)>) -> Edit<'_>
    where
        K: Into<String>,
        V: Into<Content>,
    {
        let files = files
            .into_iter()
            .map(|(path, content)| (path.into(), content.into()))
            .collect();
        Edit::files(self, files)
    }

    pub fn delete(&self, paths: impl Into<Names>) -> Edit<'_> {
        Edit::deleting(self, paths.into().into_vec())
    }

    pub fn move_file(&self, from: &str, to: &str) -> Edit<'_> {
        Edit::moving(self, from, to)
    }

    pub fn list(&self, path: &str) -> ListFiles<'_> {
        ListFiles::new(self, path)
    }

    pub fn stat(&self, path: &str) -> Stat<'_, Option<Entry>> {
        Stat::new(self, path, |entry| entry)
    }

    pub fn exists(&self, path: &str) -> Stat<'_, bool> {
        Stat::new(self, path, |entry| entry.is_some())
    }

    pub fn grep(&self, pattern: &str) -> Grep<'_> {
        Grep::new(self, pattern)
    }

    pub fn find(&self, glob: &str) -> Find<'_> {
        Find::new(self, glob)
    }

    pub fn query(&self, text: &str) -> FileQuery<'_> {
        FileQuery::new(self, text)
    }

    pub fn fork(&self, name: &str) -> Fork<'_, Disk> {
        Fork::new(&self.place, name, Disk::from)
    }

    pub fn merge_into(&self, into: &str) -> Merge<'_> {
        Merge::new(self, into)
    }

    pub async fn destroy(&self) -> Result<()> {
        self.place.destroy().await
    }

    pub async fn branches(&self) -> Result<Vec<Branch>> {
        self.place.branches().await
    }

    pub async fn head(&self) -> Result<Option<String>> {
        let route = self
            .place
            .route(&format!("/branches/{}", segment(&self.place.branch)));
        let branch: Head = self.place.http.get(&route, Vec::new()).await?;
        Ok(branch.head)
    }

    pub fn log(&self) -> Log<'_> {
        Log::new(self)
    }

    pub async fn diff(&self, against: &str) -> Result<Vec<Change>> {
        let mut params = self.place.params();
        params.push(("against", against.to_string()));
        collect(pages(
            self.place.http.clone(),
            self.place.route("/diff"),
            params,
        ))
        .await
    }

    pub fn revert(&self, commit: &str) -> Revert<'_> {
        Revert::new(self, commit)
    }

    pub async fn restore(&self, to: impl Into<At>) -> Result<Committed> {
        let to = match to.into() {
            At::Id(commit) => commit,
            At::Time(when) => history::commit_at(self, when).await?,
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

    pub fn download(&self, dir: impl AsRef<Path>) -> Download<'_> {
        Download::new(self, dir)
    }

    pub fn upload(&self, dir: impl AsRef<Path>) -> Upload<'_> {
        Upload::new(self, dir)
    }

    pub async fn info(&self) -> Result<DiskInfo> {
        self.place.http.get(&self.place.path, Vec::new()).await
    }

    pub fn configure(&self) -> DiskConfigure<'_> {
        DiskConfigure::new(self)
    }

    pub(crate) async fn commit(
        &self,
        changes: Vec<FileChange>,
        message: Option<String>,
    ) -> Result<Committed> {
        let body = NewCommit {
            changes,
            message,
            branch: &self.place.branch,
        };
        self.place
            .http
            .post(&self.place.route("/commits"), &body)
            .await
    }

    pub(crate) async fn part(&self, bytes: Vec<u8>) -> Result<String> {
        let route = self.place.route("/uploads");
        let body = Body::Bytes(bytes);
        let response = self
            .place
            .http
            .send(Method::POST, &route, &Vec::new(), &body)
            .await?;
        let uploaded: Uploaded = serde_json::from_slice(&response.bytes().await?)?;
        Ok(uploaded.part)
    }
}

#[derive(Default, Serialize)]
struct Settings {
    #[serde(skip_serializing_if = "Option::is_none")]
    search: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    visibility: Option<Visibility>,
}

#[must_use]
pub struct DiskConfigure<'a> {
    disk: &'a Disk,
    body: Settings,
}

impl<'a> DiskConfigure<'a> {
    fn new(disk: &'a Disk) -> Self {
        DiskConfigure {
            disk,
            body: Settings::default(),
        }
    }

    pub fn search(mut self, search: bool) -> Self {
        self.body.search = Some(search);
        self
    }

    pub fn visibility(mut self, visibility: Visibility) -> Self {
        self.body.visibility = Some(visibility);
        self
    }

    pub async fn send(self) -> Result<DiskInfo> {
        let place = &self.disk.place;
        place
            .http
            .call(Method::PATCH, &place.path, &Vec::new(), &self.body)
            .await
    }
}

awaitable!(DiskConfigure => DiskInfo);
