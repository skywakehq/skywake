use std::sync::Arc;

use percent_encoding::{AsciiSet, NON_ALPHANUMERIC, utf8_percent_encode};
use reqwest::header::CONTENT_TYPE;
use reqwest::{Method, RequestBuilder, Response, StatusCode};
use serde::Serialize;
use serde::de::DeserializeOwned;

use super::retry::{MAX_WAIT, Retry, idempotent};
use crate::Result;
use crate::error::{ApiError, retry_after};

const COMPONENT: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'_')
    .remove(b'.')
    .remove(b'!')
    .remove(b'~')
    .remove(b'*')
    .remove(b'\'')
    .remove(b'(')
    .remove(b')');

pub(crate) type Params = Vec<(&'static str, String)>;

pub(crate) fn segment(name: &str) -> String {
    utf8_percent_encode(name, COMPONENT).to_string()
}

pub(crate) fn file_path(path: &str) -> String {
    path.trim_start_matches('/')
        .split('/')
        .map(segment)
        .collect::<Vec<_>>()
        .join("/")
}

pub(crate) enum Body {
    Empty,
    Json(Vec<u8>),
    Bytes(Vec<u8>),
}

#[derive(Clone)]
pub(crate) struct Http {
    client: reqwest::Client,
    base: Arc<str>,
    key: Arc<str>,
    environment: Option<Arc<str>>,
    retry: Retry,
}

impl Http {
    pub fn new(
        client: reqwest::Client,
        base: &str,
        key: &str,
        environment: Option<&str>,
        retry: Retry,
    ) -> Self {
        Http {
            client,
            base: base.into(),
            key: key.into(),
            environment: environment.map(Into::into),
            retry,
        }
    }

    pub async fn get<T: DeserializeOwned>(&self, path: &str, params: Params) -> Result<T> {
        decode(self.send(Method::GET, path, &params, &Body::Empty).await?).await
    }

    pub async fn post<T: DeserializeOwned>(&self, path: &str, body: &impl Serialize) -> Result<T> {
        self.call(Method::POST, path, &Vec::new(), body).await
    }

    pub async fn call<T: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        params: &Params,
        body: &impl Serialize,
    ) -> Result<T> {
        let body = Body::Json(serde_json::to_vec(body)?);
        decode(self.send(method, path, params, &body).await?).await
    }

    pub async fn delete(&self, path: &str) -> Result<()> {
        self.send(Method::DELETE, path, &Vec::new(), &Body::Empty)
            .await?;
        Ok(())
    }

    pub async fn send(
        &self,
        method: Method,
        path: &str,
        params: &Params,
        body: &Body,
    ) -> Result<Response> {
        let idempotent = idempotent(&method);
        let mut may_have_landed = false;
        let mut attempt = 0;
        loop {
            let last = attempt >= self.retry.retries;
            let response = match self
                .request(method.clone(), path, params, body)
                .send()
                .await
            {
                Ok(response) => response,
                Err(error) if last || !idempotent => return Err(error.into()),
                Err(_) => {
                    may_have_landed = true;
                    tokio::time::sleep(self.retry.wait(attempt)).await;
                    attempt += 1;
                    continue;
                }
            };
            let status = response.status();
            if may_have_landed && method == Method::DELETE && status == StatusCode::NOT_FOUND {
                return Ok(http::Response::new(Vec::<u8>::new()).into());
            }
            let again =
                status == StatusCode::TOO_MANY_REQUESTS || (idempotent && status.is_server_error());
            if last || !again {
                return check(response).await;
            }
            may_have_landed |= status.is_server_error();
            let wait = retry_after(response.headers()).unwrap_or_else(|| self.retry.wait(attempt));
            tokio::time::sleep(wait.min(MAX_WAIT)).await;
            attempt += 1;
        }
    }

    fn request(&self, method: Method, path: &str, params: &Params, body: &Body) -> RequestBuilder {
        let mut request = self
            .client
            .request(method, format!("{}{path}", self.base))
            .bearer_auth(&*self.key)
            .query(params);
        if let Some(environment) = &self.environment {
            request = request.header("skywake-environment", &**environment);
        }
        match body {
            Body::Empty => request,
            Body::Json(bytes) => request
                .header(CONTENT_TYPE, "application/json")
                .body(bytes.clone()),
            Body::Bytes(bytes) => request
                .header(CONTENT_TYPE, "application/octet-stream")
                .body(bytes.clone()),
        }
    }
}

async fn check(response: Response) -> Result<Response> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    let headers = response.headers().clone();
    let text = response.text().await?;
    Err(ApiError::from_answer(status.as_u16(), &headers, &text).into())
}

async fn decode<T: DeserializeOwned>(response: Response) -> Result<T> {
    let bytes = response.bytes().await?;
    let bytes: &[u8] = if bytes.is_empty() { b"null" } else { &bytes };
    Ok(serde_json::from_slice(bytes)?)
}
