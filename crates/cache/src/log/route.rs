//! The `/log/{key}/{action}` route: seal, append or trim a branch's log.

use std::io;
use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use skywake_core::cache::{LogRecord, ZONE};
use tracing::warn;

use super::files::Refused;
use crate::Node;

#[derive(Deserialize)]
pub(crate) struct Params {
    claim: u64,
    #[serde(default)]
    n: u64,
    #[serde(default)]
    max_tag: u64,
    #[serde(default)]
    below: u64,
    #[serde(default)]
    through: u64,
}

pub(crate) async fn route(
    State(node): State<Arc<Node>>,
    Path((key, action)): Path<(String, String)>,
    Query(params): Query<Params>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !node.authorized(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let (Some(logs), Some(zone)) = (node.logs.clone(), node.zone.clone()) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if action == "append" && node.leaving() {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    let done = tokio::task::spawn_blocking(move || match action.as_str() {
        "seal" => logs.seal(&key, params.claim).and_then(|records| {
            postcard::to_stdvec(&records).map_err(|error| Refused::Io(io::Error::other(error)))
        }),
        "append" => {
            let record = LogRecord {
                claim: params.claim,
                n: params.n,
                max_tag: params.max_tag,
                data: body.to_vec(),
            };
            logs.append(&key, &record).map(|()| Vec::new())
        }
        "trim" => logs
            .trim(&key, params.claim, params.below, params.through)
            .map(|()| Vec::new()),
        _ => Err(Refused::Io(io::ErrorKind::NotFound.into())),
    })
    .await;
    match done {
        Ok(Ok(bytes)) => ([(ZONE, zone)], bytes).into_response(),
        Ok(Err(Refused::Older)) => StatusCode::CONFLICT.into_response(),
        Ok(Err(Refused::Io(error))) if error.kind() == io::ErrorKind::NotFound => {
            StatusCode::NOT_FOUND.into_response()
        }
        Ok(Err(Refused::Io(error))) => {
            warn!(%error, "can't write the log");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}
