//! The `/heads` route: checks the caller's rights, then asks the slot's owner.

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use skywake_core::heads::{Answer, Ask, FOLDER, OWNER, SLOTS, slot};

use super::Heads;
use super::listings::branch_names;
use super::owned::{Name, Owned, Refused};
use crate::auth::Rights;
use crate::{Node, in_folder};

type Reply = Result<Response, StatusCode>;

pub(crate) async fn route(State(node): State<Arc<Node>>, headers: HeaderMap, body: Bytes) -> Reply {
    let heads = node.heads.clone().ok_or(StatusCode::NOT_FOUND)?;
    let folder = headers
        .get(FOLDER)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .trim_matches('/')
        .to_string();
    if !plain_folder(&folder) {
        return Err(StatusCode::BAD_REQUEST);
    }
    let rights = node.rights(&headers).ok_or(StatusCode::UNAUTHORIZED)?;
    if let Rights::Pass(pass) = &rights
        && pass.folder.trim_matches('/') != folder
    {
        return Err(StatusCode::FORBIDDEN);
    }
    let ask = postcard::from_bytes::<Ask>(&body).map_err(|_| StatusCode::BAD_REQUEST)?;
    let (branch, writes) = match &ask {
        Ask::List => return list(&heads, &folder).await,
        Ask::Head { branch } => (branch.clone(), false),
        Ask::Create { branch, .. } | Ask::Delete { branch, .. } => (branch.clone(), true),
        Ask::Advance {
            branch, objects, ..
        } => {
            if !objects.iter().all(|held| content_path(&held.path)) {
                return Err(StatusCode::BAD_REQUEST);
            }
            (branch.clone(), true)
        }
    };
    if let Rights::Pass(pass) = &rights
        && writes
        && (!pass.writes() || pass.protected.contains(&branch))
    {
        return Err(StatusCode::FORBIDDEN);
    }
    let slot = slot(&folder, &branch);
    let Some(owned) = heads.serving(slot) else {
        return Ok(elsewhere(heads.owner(slot)));
    };
    match owned.answer(&heads, Name { folder, branch }, ask).await {
        Ok(answer) => {
            heads.changed.notify_one();
            reply(&answer)
        }
        Err(Refused::Lost) => {
            heads.lost(slot);
            Ok(elsewhere(None))
        }
        Err(Refused::Failed) => Err(StatusCode::SERVICE_UNAVAILABLE),
    }
}

async fn list(heads: &Heads, folder: &str) -> Reply {
    let root = heads.objects.store();
    let started = std::time::Instant::now();
    let names = branch_names(in_folder(root, folder).as_ref())
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    heads.listings.keep(folder, started, names.clone());
    let mut slots = Vec::new();
    let mut found = Vec::new();
    let mut pending = false;
    let owned: Vec<Arc<Owned>> = (0..SLOTS).filter_map(|slot| heads.serving(slot)).collect();
    for slot in owned {
        if let Ok((some, waiting)) = slot.list(heads, folder, &names).await {
            slots.push(slot.slot);
            found.extend(some);
            pending |= waiting;
        }
    }
    reply(&Answer::List {
        slots,
        heads: found,
        pending,
    })
}

fn plain_folder(folder: &str) -> bool {
    folder.is_empty()
        || folder
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

fn content_path(path: &str) -> bool {
    let Some((kind, hash)) = path.split_once('/') else {
        return false;
    };
    matches!(kind, "objects" | "chunks" | "bundles" | "commits")
        && hash.parse::<skywake_core::Hash>().is_ok()
}

fn reply(answer: &Answer) -> Reply {
    postcard::to_stdvec(answer)
        .map(IntoResponse::into_response)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

fn elsewhere(owner: Option<String>) -> Response {
    match owner {
        Some(owner) => (StatusCode::MISDIRECTED_REQUEST, [(OWNER, owner)]).into_response(),
        None => StatusCode::MISDIRECTED_REQUEST.into_response(),
    }
}
