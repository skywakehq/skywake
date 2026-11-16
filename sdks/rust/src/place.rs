use std::future::IntoFuture;
use std::time::SystemTime;

use futures::future::BoxFuture;
use serde::{Deserialize, Serialize};

use crate::Result;
use crate::shared::http::{Http, Params, segment};
use crate::shared::paging::{collect, pages};

pub(crate) const MAIN: &str = "main";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Branch {
    pub name: String,
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default)]
    pub created: String,
}

#[derive(Clone, Debug)]
pub enum At {
    Id(String),
    Time(SystemTime),
}

impl From<&str> for At {
    fn from(id: &str) -> Self {
        At::Id(id.to_string())
    }
}

impl From<String> for At {
    fn from(id: String) -> Self {
        At::Id(id)
    }
}

impl From<SystemTime> for At {
    fn from(time: SystemTime) -> Self {
        At::Time(time)
    }
}

#[derive(Clone)]
pub(crate) struct Place {
    pub http: Http,
    pub name: String,
    pub path: String,
    pub branch: String,
}

impl Place {
    pub fn new(http: Http, kind: &str, name: &str, branch: &str) -> Self {
        Place {
            path: format!("/{kind}/{}", segment(name)),
            http,
            name: name.to_string(),
            branch: branch.to_string(),
        }
    }

    pub fn on(&self, branch: &str) -> Place {
        Place {
            branch: branch.to_string(),
            ..self.clone()
        }
    }

    pub fn route(&self, tail: &str) -> String {
        format!("{}{tail}", self.path)
    }

    pub fn params(&self) -> Params {
        vec![("branch", self.branch.clone())]
    }

    pub async fn destroy(&self) -> Result<()> {
        if self.branch == MAIN {
            self.http.delete(&self.path).await
        } else {
            let branch = segment(&self.branch);
            self.http
                .delete(&self.route(&format!("/branches/{branch}")))
                .await
        }
    }

    pub async fn branches(&self) -> Result<Vec<Branch>> {
        collect(pages(
            self.http.clone(),
            self.route("/branches"),
            Vec::new(),
        ))
        .await
    }
}

#[derive(Serialize)]
struct NewBranch<'a> {
    name: &'a str,
    from: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    at: Option<String>,
}

#[must_use]
pub struct Fork<'a, H> {
    place: &'a Place,
    name: String,
    at: Option<String>,
    made: fn(Place) -> H,
}

impl<'a, H: Send + 'a> Fork<'a, H> {
    pub(crate) fn new(place: &'a Place, name: &str, made: fn(Place) -> H) -> Self {
        Fork {
            place,
            name: name.to_string(),
            at: None,
            made,
        }
    }

    pub fn at(mut self, at: impl Into<String>) -> Self {
        self.at = Some(at.into());
        self
    }

    pub async fn send(self) -> Result<H> {
        let body = NewBranch {
            name: &self.name,
            from: &self.place.branch,
            at: self.at,
        };
        let _: serde_json::Value = self
            .place
            .http
            .post(&self.place.route("/branches"), &body)
            .await?;
        Ok((self.made)(self.place.on(&self.name)))
    }
}

impl<'a, H: Send + 'a> IntoFuture for Fork<'a, H> {
    type Output = Result<H>;
    type IntoFuture = BoxFuture<'a, Result<H>>;

    fn into_future(self) -> Self::IntoFuture {
        Box::pin(self.send())
    }
}
