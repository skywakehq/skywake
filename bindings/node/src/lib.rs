//! The Skywake engine for Node.js through N-API: a repo of files, and search indexes.

mod engine;
mod error;
mod index;
mod index_json;

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;

#[napi]
pub fn blake3(data: Buffer) -> Buffer {
    blake3::hash(&data).as_bytes().to_vec().into()
}

#[napi]
pub fn valid_name(name: String) -> bool {
    skywake_core::valid_name(&name)
}
