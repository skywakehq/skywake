//! The chunk routes: one chunk or blob, a range of one with its proof, or many from a bundle.

mod bundled;
mod heat;
mod missing;
mod outboards;
mod source;

pub(crate) use bundled::bundled;
pub(crate) use heat::Heat;
pub(crate) use missing::Missing;
pub(crate) use outboards::Outboards;

use std::io;
use std::sync::Arc;
use std::time::Duration;

use axum::body::{Body, Bytes};
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use futures::stream;
use skywake_core::Hash;
use skywake_core::cache::{HOT, Loaded};
use tokio::io::AsyncReadExt;
use tokio::sync::OwnedSemaphorePermit;
use tracing::warn;

use crate::Node;
use outboards::Chunk;
use source::{At, Kind};

const READY_WITHIN: Duration = Duration::from_secs(30);
const SEND_BLOCK: usize = 256 * 1024;

pub(crate) async fn chunk(
    State(node): State<Arc<Node>>,
    Path(hash): Path<String>,
    Query(at): Query<At>,
    headers: HeaderMap,
) -> Response {
    let bundle = at.bundle.clone();
    let response = serve_one(&node, Kind::Chunks, &hash, at, &headers).await;
    mark_hot(&node, bundle.as_deref().unwrap_or(&hash), response)
}

pub(crate) async fn blob(
    State(node): State<Arc<Node>>,
    Path(hash): Path<String>,
    Query(at): Query<At>,
    headers: HeaderMap,
) -> Response {
    let response = serve_one(&node, Kind::Blobs, &hash, at, &headers).await;
    mark_hot(&node, &hash, response)
}

fn mark_hot(node: &Node, route: &str, mut response: Response) -> Response {
    if let Ok(route) = route.parse::<Hash>()
        && node.heat.hit(route)
        && response.status() == StatusCode::OK
    {
        response
            .headers_mut()
            .insert(HOT, HeaderValue::from_static("1"));
    }
    response
}

async fn serve_one(node: &Node, kind: Kind, hash: &str, at: At, headers: &HeaderMap) -> Response {
    if !node.authorized(headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let Ok(hash) = hash.parse::<Hash>() else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let Some(source) = node.source(kind, &at.folder, at.bundled(hash)) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let Ok(permit) = node.requests.clone().try_acquire_owned() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let missing = format!(
        "{kind:?}/{}/{hash}/{}",
        at.folder,
        at.bundle.as_deref().unwrap_or("")
    );
    if node.missing.known(&missing) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let loaded = tokio::time::timeout(READY_WITHIN, node.cache.open(source.as_ref(), hash)).await;
    if let (Ok(Ok(loaded)), Some(outboards)) = (&loaded, &node.outboards) {
        let chunk = match loaded {
            Loaded::File(file, _) => file.try_clone().map(|file| Chunk::File(file, 0)),
            Loaded::Memory(data) => Ok(Chunk::Memory(io::Cursor::new(data.to_vec()))),
        };
        let (Ok(chunk), outboards) = (chunk, outboards.clone()) else {
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        };
        if let (Some(start), Some(len)) = (at.start, at.len) {
            let sliced =
                tokio::task::spawn_blocking(move || outboards.slice(hash, chunk, start, len));
            return match sliced.await {
                Ok(Ok(proof)) => proof.into_response(),
                _ => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
            };
        }
        tokio::task::spawn_blocking(move || {
            if let Err(error) = outboards.prepare(hash, chunk) {
                warn!(%hash, %error, "can't keep the chunk's hash tree");
            }
        });
    }
    match loaded {
        Err(_) => StatusCode::GATEWAY_TIMEOUT.into_response(),
        Ok(Ok(Loaded::Memory(data))) => Bytes::from_owner(data).into_response(),
        Ok(Ok(Loaded::File(file, size))) => send(tokio::fs::File::from_std(file), size, permit),
        Ok(Err(error)) if is_missing(&error) => {
            node.missing.remember(missing);
            StatusCode::NOT_FOUND.into_response()
        }
        Ok(Err(error)) => {
            warn!(%hash, %error, "can't get chunk");
            StatusCode::BAD_GATEWAY.into_response()
        }
    }
}

fn send(file: tokio::fs::File, size: u64, permit: OwnedSemaphorePermit) -> Response {
    let blocks = stream::unfold(
        (file, size, permit),
        |(mut file, left, permit)| async move {
            if left == 0 {
                return None;
            }
            let mut block = vec![0; SEND_BLOCK.min(left as usize)];
            match file.read_exact(&mut block).await {
                Ok(_) => {
                    let left = left - block.len() as u64;
                    Some((Ok(Bytes::from(block)), (file, left, permit)))
                }
                Err(error) => Some((Err(error), (file, 0, permit))),
            }
        },
    );
    (
        [(header::CONTENT_LENGTH, size.to_string())],
        Body::from_stream(blocks),
    )
        .into_response()
}

fn is_missing(error: &io::Error) -> bool {
    matches!(
        error
            .get_ref()
            .and_then(|inner| inner.downcast_ref::<skywake_core::Error>()),
        Some(skywake_core::Error::Store(
            object_store::Error::NotFound { .. }
        ))
    )
}
