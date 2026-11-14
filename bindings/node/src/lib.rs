//! The Skywake engine for Node.js through N-API: a repo of files, and search indexes.

mod engine;
mod error;
mod index;
mod index_json;

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;

/// Keys for a bucket the process has no credentials for, such as a
/// customer's. Stores opened with the same `id` share them.
#[napi(object)]
#[derive(Clone)]
pub struct StoreKeys {
    pub id: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    pub session_token: Option<String>,
    pub endpoint: Option<String>,
    pub region: Option<String>,
}

impl From<StoreKeys> for skywake_core::StoreKeys {
    fn from(keys: StoreKeys) -> Self {
        Self {
            id: keys.id,
            access_key_id: keys.access_key_id,
            secret_access_key: keys.secret_access_key,
            session_token: keys.session_token,
            endpoint: keys.endpoint,
            region: keys.region,
        }
    }
}

/// Replaces the keys every store opened with `keys.id` signs with, so
/// short-lived keys can be renewed without reopening anything.
#[napi]
pub fn renew_store_keys(keys: StoreKeys) {
    skywake_core::renew_keys(&keys.into());
}

/// Forgets keys no store should use any more.
#[napi]
pub fn forget_store_keys(id: String) {
    skywake_core::forget_keys(&id);
}

#[napi]
pub fn blake3(data: Buffer) -> Buffer {
    blake3::hash(&data).as_bytes().to_vec().into()
}

#[napi]
pub fn valid_name(name: String) -> bool {
    skywake_core::valid_name(&name)
}
