//! Sending requests: the base URL and key, retries, and turning error
//! answers into `Error::Api`.

use std::time::Duration;

use reqwest::header::CONTENT_TYPE;
use reqwest::{Method, Response, StatusCode};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::Value;

use super::Client;
use crate::{Error, Result};

/// The server asks for at most 60 seconds; waiting less would only be refused again.
const MAX_WAIT: Duration = Duration::from_secs(60);

pub(crate) type Params = Vec<(&'static str, String)>;

impl Client {
    pub(crate) async fn get<T: DeserializeOwned>(&self, path: &str, params: Params) -> Result<T> {
        decode(self.send(Method::GET, path, params, None).await?).await
    }

    pub(crate) async fn post<T: DeserializeOwned>(
        &self,
        path: &str,
        body: &impl Serialize,
    ) -> Result<T> {
        self.with_body(Method::POST, path, body).await
    }

    pub(crate) async fn with_body<T: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        body: &impl Serialize,
    ) -> Result<T> {
        let body = serde_json::to_vec(body)?;
        decode(self.send(method, path, Vec::new(), Some(body)).await?).await
    }

    /// A POST that sends nothing, such as starting a build.
    pub(crate) async fn post_empty<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
        decode(self.send(Method::POST, path, Vec::new(), None).await?).await
    }

    pub(crate) async fn delete(&self, path: &str) -> Result<()> {
        self.send(Method::DELETE, path, Vec::new(), None).await?;
        Ok(())
    }

    /// Sends a request, again after network errors and 5xx answers when that
    /// is safe, and after 429 always: the server refuses those before doing
    /// anything. A DELETE that failed that way may still have landed, so if
    /// a retry of it then finds nothing (404), it answers 204: what it
    /// deleted is gone either way.
    pub(crate) async fn send(
        &self,
        method: Method,
        path: &str,
        params: Params,
        body: Option<Vec<u8>>,
    ) -> Result<Response> {
        let idempotent = matches!(
            method,
            Method::GET | Method::HEAD | Method::PUT | Method::DELETE | Method::OPTIONS
        );
        let mut may_have_landed = false;
        let mut attempt = 0;
        loop {
            let last = attempt == self.options.retries;
            let mut request = (self
                .http
                .request(method.clone(), format!("{}{path}", self.base)))
            .bearer_auth(&self.key)
            .query(&params);
            if let Some(body) = &body {
                request = request
                    .header(CONTENT_TYPE, "application/json")
                    .body(body.clone());
            }
            let response = match request.send().await {
                Ok(response) => response,
                Err(error) if last || !idempotent => return Err(error.into()),
                Err(_) => {
                    may_have_landed = true;
                    tokio::time::sleep(self.backoff(attempt)).await;
                    attempt += 1;
                    continue;
                }
            };
            let status = response.status();
            if may_have_landed && method == Method::DELETE && status == StatusCode::NOT_FOUND {
                return Ok(http::Response::new(Vec::new()).into());
            }
            let again =
                status == StatusCode::TOO_MANY_REQUESTS || (idempotent && status.is_server_error());
            if last || !again {
                return check(response).await;
            }
            may_have_landed |= status.is_server_error();
            let wait = retry_after(&response).unwrap_or_else(|| self.backoff(attempt));
            tokio::time::sleep(wait.min(MAX_WAIT)).await;
            attempt += 1;
        }
    }

    /// Full jitter, so many clients that failed together do not retry together.
    fn backoff(&self, attempt: u32) -> Duration {
        let most = self.options.backoff.as_secs_f64() * 2f64.powi(attempt as i32);
        Duration::from_secs_f64(fastrand::f64() * most.min(MAX_WAIT.as_secs_f64()))
    }
}

fn retry_after(response: &Response) -> Option<Duration> {
    let seconds: f64 = response
        .headers()
        .get("retry-after")?
        .to_str()
        .ok()?
        .parse()
        .ok()?;
    (seconds > 0.0).then(|| Duration::from_secs_f64(seconds.min(MAX_WAIT.as_secs_f64())))
}

/// The response, or its error.
async fn check(response: Response) -> Result<Response> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    let header = |name| {
        response
            .headers()
            .get(name)?
            .to_str()
            .ok()
            .map(String::from)
    };
    let request_id = header("x-request-id");
    let text = response.text().await?;
    let body: Value = serde_json::from_str(&text).unwrap_or_default();
    let field = |name| body.get(name).and_then(Value::as_str).map(String::from);
    Err(Error::Api {
        status: status.as_u16(),
        message: field("error").unwrap_or(text.clone()),
        code: field("code"),
        request_id: field("request_id").or(request_id),
        path: field("path"),
    })
}

async fn decode<T: DeserializeOwned>(response: Response) -> Result<T> {
    Ok(serde_json::from_slice(&response.bytes().await?)?)
}
