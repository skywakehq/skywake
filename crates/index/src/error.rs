pub type Result<T, E = Error> = std::result::Result<T, E>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("index branch `{0}` does not exist")]
    BranchNotFound(String),

    #[error("index branch `{0}` already exists")]
    BranchExists(String),

    #[error(
        "invalid branch name `{0}`: use parts of letters, digits, `.`, `_` and `-`, split by `/`"
    )]
    InvalidBranchName(String),

    #[error("index branch `{0}` kept moving; try again")]
    Conflict(String),

    #[error("{0}")]
    Invalid(String),

    #[error("{0}")]
    Busy(String),

    #[error("corrupt index: {0}")]
    Corrupt(String),

    #[error(transparent)]
    Core(#[from] skywake_core::Error),

    #[error(transparent)]
    Store(#[from] object_store::Error),

    #[error(transparent)]
    Encoding(#[from] postcard::Error),

    #[error("index version `{0}` is not in the history of the branch")]
    VersionNotFound(String),

    #[error(transparent)]
    Parquet(#[from] parquet::errors::ParquetError),
}

impl Error {
    pub(crate) fn copy(&self) -> Error {
        match self {
            Error::BranchNotFound(name) => Error::BranchNotFound(name.clone()),
            Error::BranchExists(name) => Error::BranchExists(name.clone()),
            Error::InvalidBranchName(name) => Error::InvalidBranchName(name.clone()),
            Error::Conflict(name) => Error::Conflict(name.clone()),
            Error::Invalid(message) => Error::Invalid(message.clone()),
            Error::Busy(message) => Error::Busy(message.clone()),
            Error::Corrupt(message) => Error::Corrupt(message.clone()),
            Error::VersionNotFound(version) => Error::VersionNotFound(version.clone()),
            other => Error::Store(object_store::Error::Generic {
                store: "skywake-index",
                source: other.to_string().into(),
            }),
        }
    }
}
