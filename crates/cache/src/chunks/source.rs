//! Where a requested chunk or blob is read from in the bucket.

use std::io;
use std::sync::Arc;

use async_trait::async_trait;
use object_store::path::Path;
use object_store::prefix::PrefixStore;
use object_store::{ObjectStore, ObjectStoreExt};
use serde::Deserialize;
use skywake_core::cache::{InBundle, Source};
use skywake_core::{Bundled, Chunk, Hash, Objects};

use crate::Node;

#[derive(Clone, Copy, Debug)]
pub(super) enum Kind {
    Chunks,
    Blobs,
}

#[derive(Deserialize)]
pub(crate) struct At {
    #[serde(rename = "in", default)]
    pub(super) folder: String,
    pub(super) start: Option<u64>,
    pub(super) len: Option<u64>,
    pub(super) bundle: Option<String>,
    #[serde(rename = "at")]
    offset: Option<u32>,
    stored: Option<u32>,
    size: Option<u32>,
}

impl At {
    pub(super) fn bundled(&self, hash: Hash) -> Option<Bundled> {
        Some(Bundled {
            chunk: Chunk {
                hash,
                size: self.size?,
            },
            bundle: self.bundle.as_deref()?.parse().ok()?,
            offset: self.offset?,
            len: self.stored?,
        })
    }
}

impl Node {
    pub(super) fn store_in(&self, folder: &str) -> Option<Arc<dyn ObjectStore>> {
        Some(match folder {
            "" => self.objects.store().clone(),
            _ => {
                let prefix = Path::parse(folder).ok()?;
                Arc::new(PrefixStore::new(self.objects.store().clone(), prefix))
            }
        })
    }

    pub(super) fn source(
        &self,
        kind: Kind,
        folder: &str,
        bundled: Option<Bundled>,
    ) -> Option<Box<dyn Source>> {
        let store = self.store_in(folder)?;
        Some(match (kind, bundled) {
            (Kind::Chunks, Some(at)) => Box::new(InBundle {
                objects: Objects::new(store),
                at,
            }),
            (Kind::Chunks, None) => Box::new(Objects::new(store)),
            (Kind::Blobs, _) => Box::new(Blobs(store)),
        })
    }
}

struct Blobs(Arc<dyn ObjectStore>);

#[async_trait]
impl Source for Blobs {
    async fn fetch(&self, hash: Hash) -> io::Result<Vec<u8>> {
        let path = Path::from(format!("blobs/{hash}"));
        let store_error = |error| io::Error::other(skywake_core::Error::Store(error));
        let got = self.0.get(&path).await.map_err(store_error)?;
        let bytes = got.bytes().await.map_err(store_error)?;
        if Hash::of(&bytes) != hash {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "blob does not match its hash",
            ));
        }
        Ok(bytes.into())
    }
}
