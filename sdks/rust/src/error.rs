use std::time::Duration;

use reqwest::header::HeaderMap;
use serde_json::Value;

pub type Result<T, E = Error> = std::result::Result<T, E>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Api(Box<ApiError>),
    #[error(transparent)]
    Network(#[from] reqwest::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Usage(String),
}

impl From<ApiError> for Error {
    fn from(error: ApiError) -> Self {
        Error::Api(Box::new(error))
    }
}

impl Error {
    pub fn api(&self) -> Option<&ApiError> {
        match self {
            Error::Api(error) => Some(error),
            _ => None,
        }
    }

    pub fn kind(&self) -> Option<&ErrorKind> {
        self.api().map(|error| &error.kind)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum ErrorKind {
    Auth,
    Permission,
    NotFound,
    Conflict,
    MergeConflict { conflicts: Vec<String> },
    InvalidRequest,
    RateLimited { retry_after: Option<Duration> },
    Server,
}

#[derive(Clone, Debug, thiserror::Error)]
#[error("{message}")]
pub struct ApiError {
    pub kind: ErrorKind,
    pub status: u16,
    pub code: Option<String>,
    pub message: String,
    pub hint: Option<String>,
    pub request_id: Option<String>,
    pub path: Option<String>,
}

pub(crate) fn retry_after(headers: &HeaderMap) -> Option<Duration> {
    let seconds: f64 = headers.get("retry-after")?.to_str().ok()?.parse().ok()?;
    (seconds.is_finite() && seconds > 0.0).then(|| Duration::from_secs_f64(seconds))
}

impl ApiError {
    pub(crate) fn from_answer(status: u16, headers: &HeaderMap, text: &str) -> Self {
        let body: Value = serde_json::from_str(text).unwrap_or(Value::Null);
        let error = if body["error"].is_object() {
            &body["error"]
        } else {
            &body
        };
        let field = |name: &str| error[name].as_str().map(String::from);
        let message = field("message")
            .or_else(|| body["error"].as_str().map(String::from))
            .unwrap_or_else(|| format!("HTTP {status}"));
        let hint = field("hint");
        let header = headers.get("x-request-id").and_then(|v| v.to_str().ok());
        ApiError {
            kind: kind_of(status, error, headers),
            status,
            code: field("code"),
            message: match &hint {
                Some(hint) => format!("{message}; {hint}"),
                None => message,
            },
            hint,
            request_id: field("request_id").or_else(|| header.map(String::from)),
            path: field("path"),
        }
    }
}

fn kind_of(status: u16, error: &Value, headers: &HeaderMap) -> ErrorKind {
    let conflicts: Vec<String> = error["conflicts"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    match status {
        401 => ErrorKind::Auth,
        403 => ErrorKind::Permission,
        404 => ErrorKind::NotFound,
        409 if !conflicts.is_empty() => ErrorKind::MergeConflict { conflicts },
        409 => ErrorKind::Conflict,
        429 => ErrorKind::RateLimited {
            retry_after: retry_after(headers),
        },
        500.. => ErrorKind::Server,
        _ => ErrorKind::InvalidRequest,
    }
}
