//! Exports read a batch at a time from JavaScript; `next` gives `null` at the end.

use futures::lock::Mutex as AsyncMutex;
use napi::Result;
use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use skywake_index::{ParquetExport, ShardsExport};

use crate::error::fail_index;
use crate::index_json::documents::{IndexDoc, doc_to};

#[napi]
pub struct IndexExport {
    pub(super) export: AsyncMutex<ShardsExport>,
}

#[napi]
impl IndexExport {
    #[napi]
    pub async fn next(&self) -> Result<Option<Vec<IndexDoc>>> {
        let docs = self.export.lock().await.next().await.map_err(fail_index)?;
        Ok(docs.map(|docs| docs.into_iter().map(doc_to).collect()))
    }
}

#[napi]
pub struct IndexParquetExport {
    pub(super) export: AsyncMutex<ParquetExport>,
}

#[napi]
impl IndexParquetExport {
    #[napi]
    pub async fn next(&self) -> Result<Option<Buffer>> {
        let bytes = self.export.lock().await.next().await.map_err(fail_index)?;
        Ok(bytes.map(Buffer::from))
    }
}
