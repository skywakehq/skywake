//! Where an index lives: its store, its shards' stores, encryption and the disk cache.

use std::sync::{Arc, OnceLock};

use napi::Result;
use napi_derive::napi;
use object_store::ObjectStore;
use object_store::prefix::PrefixStore;
use skywake_core::Encryption;
use skywake_core::cache::{CacheNodes, ChunkCache};

use crate::error::{fail, failure, invalid};

#[napi(object)]
pub struct IndexOpenOptions {
    pub shards: Option<u32>,
    pub kms_key_id: Option<String>,
    pub customer_key: Option<String>,
    pub cache_folder: Option<String>,
    pub builders: Option<bool>,
}

pub(crate) type Stores = (Arc<dyn ObjectStore>, Vec<Arc<dyn ObjectStore>>);

pub(crate) fn stores_of(location: &str, options: Option<IndexOpenOptions>) -> Result<Stores> {
    let options = options.unwrap_or(IndexOpenOptions {
        shards: None,
        kms_key_id: None,
        customer_key: None,
        cache_folder: None,
        builders: None,
    });
    let encryption = match (options.kms_key_id, options.customer_key) {
        (Some(_), Some(_)) => {
            return Err(invalid("give a KMS key or a customer key, not both"));
        }
        (Some(id), None) => Some(Encryption::Kms(id)),
        (None, Some(key)) => Some(Encryption::Customer(key)),
        (None, None) => None,
    };
    if encryption.is_some() && !location.starts_with("s3://") {
        return Err(invalid("only an s3:// store takes an encryption key"));
    }
    let store = skywake_core::open_store_with(location, encryption.as_ref()).map_err(fail)?;
    let count = options.shards.unwrap_or(1) as usize;
    if !(1..=skywake_index::MAX_SHARDS).contains(&count) {
        let message = format!("an index has 1 to {} shards", skywake_index::MAX_SHARDS);
        return Err(invalid(message));
    }
    let stores = match count {
        1 => vec![store.clone()],
        _ => (0..count)
            .map(|n| {
                let shard = PrefixStore::new(store.clone(), skywake_index::shard_folder(n));
                Arc::new(shard) as Arc<dyn ObjectStore>
            })
            .collect(),
    };
    Ok((store, stores))
}

pub(crate) fn disk() -> Result<Option<Arc<ChunkCache>>> {
    static DISK: OnceLock<std::result::Result<Option<Arc<ChunkCache>>, String>> = OnceLock::new();
    let disk = DISK.get_or_init(open_disk);
    disk.clone().map_err(|message| failure("internal", message))
}

fn open_disk() -> std::result::Result<Option<Arc<ChunkCache>>, String> {
    let Some(dir) = std::env::var_os("SKYWAKE_INDEX_CACHE_DIR") else {
        return Ok(None);
    };
    let gb: u64 = match std::env::var("SKYWAKE_INDEX_CACHE_GB") {
        Ok(gb) => (gb.parse())
            .map_err(|_| format!("SKYWAKE_INDEX_CACHE_GB: `{gb}` is not a whole number"))?,
        Err(_) => 10,
    };
    let cache = ChunkCache::new(dir.into(), gb << 30).map_err(|e| format!("index cache: {e}"))?;
    let nodes = std::env::var("SKYWAKE_CACHE_NODES").unwrap_or_default();
    let nodes = nodes
        .split(',')
        .map(str::trim)
        .filter(|url| !url.is_empty());
    let token = std::env::var("SKYWAKE_CACHE_TOKEN")
        .ok()
        .filter(|t| !t.is_empty());
    let nodes = CacheNodes::new(nodes.map(String::from).collect(), token);
    Ok(Some(Arc::new(cache.with_nodes(nodes))))
}
