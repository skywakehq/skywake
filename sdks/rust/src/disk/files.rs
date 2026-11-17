use futures::future::try_join_all;
use reqwest::{Method, Response};

use super::Disk;
use super::changes::{FileChange, Source, change_of, clean};
use super::types::{Committed, Content};
use crate::Result;
use crate::shared::awaitable;
use crate::shared::http::{Body, Params, file_path};

#[must_use]
pub struct Read<'a> {
    disk: &'a Disk,
    path: String,
    params: Params,
}

impl<'a> Read<'a> {
    pub(crate) fn new(disk: &'a Disk, path: &str) -> Self {
        Read {
            disk,
            path: file_path(path),
            params: disk.place.params(),
        }
    }

    pub fn at(mut self, at: impl Into<String>) -> Self {
        self.params.push(("at", at.into()));
        self
    }

    pub fn offset(mut self, offset: u64) -> Self {
        self.params.push(("offset", offset.to_string()));
        self
    }

    pub fn length(mut self, length: u64) -> Self {
        self.params.push(("length", length.to_string()));
        self
    }

    pub(crate) async fn response(self) -> Result<Response> {
        let route = self.disk.place.route(&format!("/files/{}", self.path));
        let http = &self.disk.place.http;
        http.send(Method::GET, &route, &self.params, &Body::Empty)
            .await
    }

    pub async fn bytes(self) -> Result<Vec<u8>> {
        Ok(self.response().await?.bytes().await?.to_vec())
    }

    pub async fn send(self) -> Result<String> {
        Ok(self.response().await?.text().await?)
    }
}

awaitable!(Read => String);

enum Changes {
    Files(Vec<(String, Content)>),
    Ready(Vec<FileChange>),
}

#[must_use]
pub struct Edit<'a> {
    disk: &'a Disk,
    changes: Changes,
    message: Option<String>,
    executable: Option<bool>,
}

impl<'a> Edit<'a> {
    pub(crate) fn files(disk: &'a Disk, files: Vec<(String, Content)>) -> Self {
        Edit {
            disk,
            changes: Changes::Files(files),
            message: None,
            executable: None,
        }
    }

    pub(crate) fn deleting(disk: &'a Disk, paths: Vec<String>) -> Self {
        let changes = paths.iter().map(|path| deletion(path)).collect();
        Edit::ready(disk, changes, None)
    }

    pub(crate) fn moving(disk: &'a Disk, from: &str, to: &str) -> Self {
        let (from, to) = (clean(from), clean(to));
        let message = format!("Move {from} to {to}");
        let moved = FileChange {
            path: to,
            from: Some(Source { path: from.clone() }),
            ..FileChange::default()
        };
        Edit::ready(disk, vec![moved, deletion(&from)], Some(message))
    }

    fn ready(disk: &'a Disk, changes: Vec<FileChange>, message: Option<String>) -> Self {
        Edit {
            disk,
            changes: Changes::Ready(changes),
            message,
            executable: None,
        }
    }

    pub fn message(mut self, message: impl Into<String>) -> Self {
        self.message = Some(message.into());
        self
    }

    pub fn executable(mut self, executable: bool) -> Self {
        self.executable = Some(executable);
        self
    }

    pub async fn send(self) -> Result<Committed> {
        let changes = match self.changes {
            Changes::Ready(changes) => changes,
            Changes::Files(files) => {
                try_join_all(files.into_iter().map(|(path, content)| {
                    change_of(self.disk, clean(&path), content, self.executable)
                }))
                .await?
            }
        };
        self.disk.commit(changes, self.message).await
    }
}

awaitable!(Edit => Committed);

fn deletion(path: &str) -> FileChange {
    FileChange {
        path: clean(path),
        delete: Some(true),
        ..FileChange::default()
    }
}
