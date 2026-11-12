//! Engine and index errors as N-API errors whose message starts with `[kind]`.

use std::fmt::Display;

use napi::{Error, Status};
use skywake_index::Error as IndexError;

pub(crate) fn failure(kind: &str, message: impl Display) -> Error {
    Error::new(Status::GenericFailure, format!("[{kind}] {message}"))
}

pub(crate) fn invalid(message: impl Display) -> Error {
    failure("invalid", message)
}

pub(crate) fn fail(error: skywake_core::Error) -> Error {
    use skywake_core::Error::*;
    let kind = match &error {
        NotFound(_) | BranchNotFound(_) | Store(object_store::Error::NotFound { .. }) => {
            "not_found"
        }
        BranchExists(_) | Conflict(_) | EditConflict(_) => "conflict",
        InvalidBranchName(_) | InvalidPath(_) | NotAFolder(_) | BadPattern(_)
        | MissingSource(_) | NotEmpty(_) | NonUtf8Path(_) => "invalid",
        CollectionRunning | Unsettled(_) | HeadsUnavailable => "unavailable",
        Collection(_) | Corrupt(_) | Store(_) | Io(_) | Encoding(_) => "internal",
    };
    failure(kind, error)
}

pub(crate) fn fail_index(error: IndexError) -> Error {
    use IndexError::*;
    let kind = match error {
        Core(core) => return fail(core),
        BranchNotFound(_) | VersionNotFound(_) | Store(object_store::Error::NotFound { .. }) => {
            "not_found"
        }
        BranchExists(_) | Conflict(_) => "conflict",
        InvalidBranchName(_) | Invalid(_) => "invalid",
        Busy(_) => "busy",
        Corrupt(_) | Store(_) | Encoding(_) | Parquet(_) => "internal",
    };
    failure(kind, error)
}
