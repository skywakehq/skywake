//! Small helpers around object store calls: missing objects, versions and conditional writes.

use object_store::path::Path;
use object_store::{ObjectMeta, ObjectStore, ObjectStoreExt, PutMode, PutResult, UpdateVersion};

use crate::Result;

pub(crate) fn found<T>(result: object_store::Result<T>) -> object_store::Result<Option<T>> {
    match result {
        Ok(value) => Ok(Some(value)),
        Err(object_store::Error::NotFound { .. }) => Ok(None),
        Err(error) => Err(error),
    }
}

pub(crate) async fn exists(store: &dyn ObjectStore, path: &Path) -> Result<bool> {
    Ok(found(store.head(path).await)?.is_some())
}

pub(crate) fn version_of(meta: &ObjectMeta) -> UpdateVersion {
    UpdateVersion {
        e_tag: meta.e_tag.clone(),
        version: meta.version.clone(),
    }
}

pub(crate) fn written(result: PutResult) -> UpdateVersion {
    UpdateVersion {
        e_tag: result.e_tag,
        version: result.version,
    }
}

pub(crate) fn put_mode(version: Option<UpdateVersion>) -> PutMode {
    match version {
        None => PutMode::Create,
        Some(version) => PutMode::Update(version),
    }
}

pub(crate) fn lost_race(error: &object_store::Error) -> bool {
    matches!(
        error,
        object_store::Error::AlreadyExists { .. }
            | object_store::Error::Precondition { .. }
            | object_store::Error::NotFound { .. }
    )
}

pub(crate) fn generic(
    error: impl std::error::Error + Send + Sync + 'static,
) -> object_store::Error {
    object_store::Error::Generic {
        store: "skywake",
        source: Box::new(error),
    }
}
