//! The errors the storage engine returns.

use std::path::PathBuf;

pub type Result<T, E = Error> = std::result::Result<T, E>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("branch `{0}` does not exist")]
    BranchNotFound(String),

    #[error("branch `{0}` already exists")]
    BranchExists(String),

    #[error("branch `{0}` moved while committing; pull its new head and retry")]
    Conflict(String),

    #[error(
        "invalid branch name `{0}`: use parts of letters, digits, `.`, `_` and `-`, split by `/`"
    )]
    InvalidBranchName(String),

    #[error("`{0}` is not a valid path")]
    InvalidPath(String),

    #[error(
        "`{0}` changed on the branch while this commit was being made; read it again and retry"
    )]
    EditConflict(String),

    #[error("`{0}` does not exist")]
    NotFound(String),

    #[error("copy source `{0}` does not exist")]
    MissingSource(String),

    #[error("bad search pattern: {0}")]
    BadPattern(String),

    #[error("`{0}` is not a folder")]
    NotAFolder(String),

    #[error("`{0}` is not valid UTF-8")]
    NonUtf8Path(PathBuf),

    #[error("checkout target `{0}` is not empty")]
    NotEmpty(PathBuf),

    #[error("the write to branch `{0}` may or may not have landed; read the branch to see")]
    Unsettled(String),

    #[error("the cache servers that keep branch heads did not answer")]
    HeadsUnavailable,

    #[error("another garbage collection is deleting; try again when it is done")]
    CollectionRunning,

    #[error("garbage collection stopped: {0}")]
    Collection(String),

    #[error("{0}")]
    WrongKind(String),

    #[error("corrupt store: {0}")]
    Corrupt(String),

    #[error(transparent)]
    Store(#[from] object_store::Error),

    #[error(transparent)]
    Io(#[from] std::io::Error),

    #[error(transparent)]
    Encoding(#[from] postcard::Error),
}

pub(crate) fn missing<T>(result: Result<T>) -> Result<Option<T>> {
    match result {
        Ok(value) => Ok(Some(value)),
        Err(Error::Store(object_store::Error::NotFound { .. })) => Ok(None),
        Err(error) => Err(error),
    }
}
