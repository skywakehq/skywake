//! The API calls the load test makes: an org, an index with its rows and build, pinning, queries.

use std::time::{Duration, Instant};

use anyhow::{Result, bail};
use reqwest::{Client, Method};
use serde_json::{Value, json};

const BATCH: usize = 1000;
const BUILD_POLL: Duration = Duration::from_millis(500);
const WARM_POLL: Duration = Duration::from_millis(250);

#[derive(Clone)]
pub(super) struct Api {
    client: Client,
    key: String,
    pub index: String,
}

pub(super) struct Placed {
    pub replicas: Vec<String>,
    pub warm_ms: u64,
}

pub(super) struct Answer {
    pub server: Option<String>,
    pub temperature: String,
}

impl Api {
    pub(super) fn new(admin: String, index: String) -> Self {
        Self {
            client: Client::new(),
            key: admin,
            index,
        }
    }

    async fn call(
        &self,
        server: &str,
        method: Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<(Value, Option<String>)> {
        let mut request = (self.client)
            .request(method.clone(), format!("{server}/v1{path}"))
            .bearer_auth(&self.key)
            .header("content-type", "application/json");
        if let Some(body) = body {
            request = request.body(serde_json::to_vec(&body)?);
        }
        let response = request.send().await?;
        let status = response.status();
        let answered = (response.headers().get("x-skywake-server"))
            .and_then(|value| value.to_str().ok())
            .map(String::from);
        let text = response.text().await?;
        if !status.is_success() {
            bail!("{method} {path}: {status} {text}");
        }
        let body = match text.is_empty() {
            true => Value::Null,
            false => serde_json::from_str(&text)?,
        };
        Ok((body, answered))
    }

    pub(super) async fn load(
        &mut self,
        server: &str,
        rows: usize,
        dims: usize,
        vector: impl Fn(usize) -> Vec<f32>,
    ) -> Result<()> {
        let name = json!({ "name": format!("pinning-{}", self.index) });
        let (org, _) = self.call(server, Method::POST, "/orgs", Some(name)).await?;
        self.key = org["key"].as_str().unwrap_or_default().to_string();
        let schema = json!({
            "name": self.index,
            "schema": { "vectors": [{ "name": "v", "dims": dims, "metric": "euclidean" }] },
        });
        self.call(server, Method::POST, "/indexes", Some(schema))
            .await?;
        let documents = format!("/indexes/{}/branches/main/documents", self.index);
        for start in (0..rows).step_by(BATCH) {
            let batch: Vec<Value> = (start..rows.min(start + BATCH))
                .map(|id| json!({ "id": id, "vectors": { "v": vector(id) } }))
                .collect();
            let body = json!({ "documents": batch });
            self.call(server, Method::POST, &documents, Some(body))
                .await?;
        }
        let build = format!("/indexes/{}/branches/main/build", self.index);
        let (started, _) = self.call(server, Method::POST, &build, None).await?;
        let operation = format!(
            "/indexes/{}/operations/{}",
            self.index,
            started["id"].as_str().unwrap_or_default()
        );
        loop {
            let (body, _) = self.call(server, Method::GET, &operation, None).await?;
            match body["status"].as_str() {
                Some("done") => return Ok(()),
                Some("failed") => bail!("build failed: {}", body["error"]),
                _ => tokio::time::sleep(BUILD_POLL).await,
            }
        }
    }

    pub(super) async fn pin(&self, server: &str, replicas: Option<usize>) -> Result<Placed> {
        let path = format!("/indexes/{}", self.index);
        let pinned = json!({ "pinned": replicas.map(|replicas| json!({ "replicas": replicas })) });
        self.call(server, Method::PATCH, &path, Some(pinned))
            .await?;
        let Some(replicas) = replicas else {
            return Ok(Placed {
                replicas: Vec::new(),
                warm_ms: 0,
            });
        };
        let started = Instant::now();
        loop {
            let (body, _) = self.call(server, Method::GET, &path, None).await?;
            let placed = body["pinning"]["replicas"]
                .as_array()
                .cloned()
                .unwrap_or_default();
            if placed.len() == replicas && placed.iter().all(|r| r["warm"] == true) {
                return Ok(Placed {
                    replicas: (placed.iter())
                        .map(|r| r["server"].as_str().unwrap_or_default().to_string())
                        .collect(),
                    warm_ms: started.elapsed().as_millis() as u64,
                });
            }
            tokio::time::sleep(WARM_POLL).await;
        }
    }

    pub(super) async fn query(&self, server: &str, vector: Vec<f32>) -> Result<Answer> {
        let path = format!("/indexes/{}/branches/main/query", self.index);
        let body = json!({
            "vector": { "column": "v", "value": vector },
            "topK": 10,
            "consistency": "eventual",
        });
        let (body, server) = self.call(server, Method::POST, &path, Some(body)).await?;
        let temperature = &body["performance"]["cache_temperature"];
        Ok(Answer {
            server,
            temperature: temperature.as_str().unwrap_or("unknown").to_string(),
        })
    }

    pub(super) async fn delete(&self, server: &str) -> Result<()> {
        let path = format!("/indexes/{}", self.index);
        self.call(server, Method::DELETE, &path, None).await?;
        Ok(())
    }
}
