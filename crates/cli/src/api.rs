//! A client for the HTTP API, with the key from SKYWAKE_KEY.

use std::time::Duration;

use anyhow::{Context, Result, anyhow, bail};
use bytes::Bytes;
use reqwest::{Method, StatusCode};
use serde_json::Value;

const RETRIES: u32 = 3;

#[derive(Clone)]
pub(crate) struct Api {
    http: reqwest::Client,
    url: String,
    key: Option<String>,
}

impl Api {
    pub(crate) fn new(url: &str, key: Option<String>) -> Result<Self> {
        let http = reqwest::Client::builder()
            .user_agent(concat!("skywake-cli/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(300))
            .build()?;
        let url = url
            .trim_end_matches('/')
            .trim_end_matches("/v1")
            .to_string();
        Ok(Self { http, url, key })
    }

    pub(crate) async fn get(&self, path: &str) -> Result<Value> {
        self.call(Method::GET, path, None, true).await
    }

    pub(crate) async fn call(
        &self,
        method: Method,
        path: &str,
        body: Option<&Value>,
        again: bool,
    ) -> Result<Value> {
        self.send(method, path, body.map(Value::to_string), again)
            .await
    }

    pub(crate) async fn send(
        &self,
        method: Method,
        path: &str,
        body: Option<String>,
        again: bool,
    ) -> Result<Value> {
        let body = body.map(|body| ("application/json", Bytes::from(body)));
        let text = self.raw(method, path, body, again).await?.text().await?;
        Ok(match text.is_empty() {
            true => Value::Null,
            false => serde_json::from_str(&text)?,
        })
    }

    /// Sends bytes as they are, such as a part of a file.
    pub(crate) async fn upload(&self, path: &str, bytes: Bytes) -> Result<Value> {
        let body = Some(("application/octet-stream", bytes));
        let text = self
            .raw(Method::POST, path, body, true)
            .await?
            .text()
            .await?;
        Ok(serde_json::from_str(&text)?)
    }

    /// A successful answer, with its body not read yet, so it can be streamed.
    pub(crate) async fn raw(
        &self,
        method: Method,
        path: &str,
        body: Option<(&str, Bytes)>,
        again: bool,
    ) -> Result<reqwest::Response> {
        let key = self.key.as_deref().ok_or_else(|| {
            anyhow!("no API key: set SKYWAKE_KEY, or pass --key (make one in the console under Settings → API keys)")
        })?;
        let url = format!("{}/v1{path}", self.url);
        let mut attempt = 0;
        loop {
            let mut request = self.http.request(method.clone(), &url).bearer_auth(key);
            if let Some((kind, body)) = &body {
                request = request
                    .header(reqwest::header::CONTENT_TYPE, *kind)
                    .body(body.clone());
            }
            let wait = Duration::from_millis(200 << attempt);
            let response = match request.send().await {
                Ok(response) => response,
                Err(error) if again && attempt < RETRIES && !error.is_builder() => {
                    attempt += 1;
                    tokio::time::sleep(wait).await;
                    continue;
                }
                Err(error) if error.is_connect() => bail!(
                    "can't reach the API at {} ({error}); is it running? Set SKYWAKE_URL or --url",
                    self.url
                ),
                Err(error) => return Err(error).context(format!("{method} {url}")),
            };
            let status = response.status();
            let busy = status == StatusCode::TOO_MANY_REQUESTS;
            if attempt < RETRIES && (busy || (again && status.is_server_error())) {
                let asked = response
                    .headers()
                    .get("retry-after")
                    .and_then(|value| value.to_str().ok()?.parse::<f64>().ok())
                    .map(|seconds| Duration::from_secs_f64(seconds.clamp(0.0, 60.0)));
                attempt += 1;
                tokio::time::sleep(asked.unwrap_or(wait)).await;
                continue;
            }
            if status.is_success() {
                return Ok(response);
            }
            return Err(refused(status, &response.text().await?));
        }
    }
}

fn refused(status: StatusCode, text: &str) -> anyhow::Error {
    let body: Value = serde_json::from_str(text).unwrap_or(Value::Null);
    let message = body["error"].as_str().unwrap_or(text).trim();
    let hint = match status {
        StatusCode::UNAUTHORIZED => "; check SKYWAKE_KEY",
        StatusCode::FORBIDDEN => "; the key's role does not allow this",
        _ => "",
    };
    anyhow!("{message} ({}){hint}", status.as_u16())
}

pub(crate) fn segment(name: &str) -> String {
    let mut out = String::new();
    for byte in name.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_slash_is_encoded_in_a_name() {
        assert_eq!(segment("prod/products"), "prod%2Fproducts");
        assert_eq!(segment("a b"), "a%20b");
    }

    #[test]
    fn an_error_keeps_the_message_and_status() {
        let error = refused(
            StatusCode::BAD_REQUEST,
            r#"{"error":"filter.price.lt: must be a number","path":"filter.price.lt"}"#,
        );
        assert_eq!(error.to_string(), "filter.price.lt: must be a number (400)");
        let error = refused(StatusCode::UNAUTHORIZED, "nope");
        assert_eq!(error.to_string(), "nope (401); check SKYWAKE_KEY");
    }
}
