pub type Result<T, E = Error> = std::result::Result<T, E>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// An error answer from the API. `code` says what kind of error it is,
    /// such as "not_found" or "rate_limited". Quote `request_id` when you
    /// report a bug. For an invalid request, `path` is the JSON path of the
    /// field that is wrong.
    #[error("{status}: {message}")]
    Api {
        status: u16,
        message: String,
        code: Option<String>,
        request_id: Option<String>,
        path: Option<String>,
    },
    /// The request did not get an answer.
    #[error(transparent)]
    Network(#[from] reqwest::Error),
    /// An answer, or a document of an export, that is not the JSON expected.
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

impl Error {
    /// The HTTP status of an error answer.
    pub fn status(&self) -> Option<u16> {
        match self {
            Error::Api { status, .. } => Some(*status),
            _ => None,
        }
    }
}
