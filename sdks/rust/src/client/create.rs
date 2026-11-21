use serde::Serialize;
use serde_json::Value;

use super::Skywake;
use super::types::{CreatedKey, Role};
use crate::shared::awaitable;
use crate::{Disk, Names, Result, Visibility};

#[derive(Serialize)]
struct NewDisk {
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    region: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    search: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    visibility: Option<Visibility>,
}

#[must_use]
pub struct CreateDisk<'a> {
    sky: &'a Skywake,
    body: NewDisk,
}

impl<'a> CreateDisk<'a> {
    pub(crate) fn new(sky: &'a Skywake, name: &str) -> Self {
        let body = NewDisk {
            name: name.to_string(),
            region: None,
            search: None,
            visibility: None,
        };
        CreateDisk { sky, body }
    }

    pub fn region(mut self, region: impl Into<String>) -> Self {
        self.body.region = Some(region.into());
        self
    }

    pub fn search(mut self, search: bool) -> Self {
        self.body.search = Some(search);
        self
    }

    pub fn visibility(mut self, visibility: Visibility) -> Self {
        self.body.visibility = Some(visibility);
        self
    }

    pub async fn send(self) -> Result<Disk> {
        let _: Value = self.sky.http.post("/disks", &self.body).await?;
        Ok(self.sky.disk(&self.body.name))
    }
}

awaitable!(CreateDisk => Disk);

#[derive(Serialize)]
struct NewKey {
    name: String,
    role: Role,
    environment: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    only: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    expires_in_days: Option<u32>,
}

#[must_use]
pub struct CreateKey<'a> {
    sky: &'a Skywake,
    body: NewKey,
}

impl<'a> CreateKey<'a> {
    pub(crate) fn new(sky: &'a Skywake, name: &str, role: Role) -> Self {
        let body = NewKey {
            name: name.to_string(),
            role,
            environment: None,
            only: None,
            expires_in_days: None,
        };
        CreateKey { sky, body }
    }

    pub fn environment(mut self, environment: impl Into<String>) -> Self {
        self.body.environment = Some(environment.into());
        self
    }

    pub fn only(mut self, names: impl Into<Names>) -> Self {
        self.body.only = Some(names.into().into_vec());
        self
    }

    pub fn expires_in_days(mut self, days: u32) -> Self {
        self.body.expires_in_days = Some(days);
        self
    }

    pub async fn send(self) -> Result<CreatedKey> {
        self.sky.http.post("/keys", &self.body).await
    }
}

awaitable!(CreateKey => CreatedKey);
