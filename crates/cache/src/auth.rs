//! Who may ask: holders of the shared token, or of a pass the API signed with it.

use axum::http::{HeaderMap, header};
use skywake_core::store::refs::Pass;

use crate::Node;

pub(crate) enum Rights {
    Full,
    Pass(Pass),
}

impl Node {
    pub(crate) fn authorized(&self, headers: &HeaderMap) -> bool {
        let Some(token) = &self.token else {
            return true;
        };
        bearer(headers).is_some_and(|given| same(given.as_bytes(), token.as_bytes()))
    }

    pub(crate) fn rights(&self, headers: &HeaderMap) -> Option<Rights> {
        if self.authorized(headers) {
            return Some(Rights::Full);
        }
        Pass::check(bearer(headers)?, self.token.as_ref()?).map(Rights::Pass)
    }
}

fn bearer(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
}

fn same(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0, |diff, (x, y)| diff | (x ^ y)) == 0
}
