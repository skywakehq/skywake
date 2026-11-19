//! `Store`: a bucket folder, measured for billing and checked before use.

use std::sync::Arc;

use futures::TryStreamExt;
use napi::Result;
use napi_derive::napi;
use object_store::path::Path;
use object_store::{ObjectStore, ObjectStoreExt, PutMode, PutOptions};

use crate::error::{fail, failure};

#[napi(object)]
pub struct Stored {
    pub objects: i64,
    pub bytes: i64,
}

#[napi(object)]
pub struct StoreOpenOptions {
    pub keys: Option<crate::StoreKeys>,
}

#[napi]
pub struct Store {
    store: Arc<dyn ObjectStore>,
}

#[napi]
impl Store {
    #[napi(factory)]
    pub fn open(location: String, options: Option<StoreOpenOptions>) -> Result<Self> {
        let keys = options.and_then(|options| options.keys);
        let keys = keys.map(skywake_core::StoreKeys::from);
        let store = skywake_core::open_store_keyed(&location, None, keys.as_ref()).map_err(fail)?;
        Ok(Self { store })
    }

    /// Every object in the folder and their bytes, as the bucket bills them.
    /// Stops after about `budget_ms` and returns null; the next call carries on.
    #[napi]
    pub async fn stored(&self, budget_ms: u32) -> Result<Option<Stored>> {
        let budget = std::time::Duration::from_millis(budget_ms.into());
        let found = skywake_core::store::measure::measure(self.store.as_ref(), budget).await;
        Ok(found.map_err(fail)?.map(|found| Stored {
            objects: found.objects as i64,
            bytes: found.bytes as i64,
        }))
    }

    /// Proves the folder takes conditional writes and lets this process list
    /// and delete, leaving nothing behind.
    #[napi]
    pub async fn check(&self) -> Result<()> {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let seed = format!("{nanos}-{}", std::process::id());
        let path = Path::from(format!(
            ".checks/{}",
            blake3::hash(seed.as_bytes()).to_hex()
        ));
        let create = || PutOptions {
            mode: PutMode::Create,
            ..PutOptions::default()
        };
        let store = self.store.as_ref();
        let wrote = store.put_opts(&path, "x".into(), create()).await;
        wrote.map_err(|error| fail(error.into()))?;
        let again = store.put_opts(&path, "y".into(), create()).await;
        let checked = match again {
            Err(object_store::Error::AlreadyExists { .. }) => Ok(()),
            Ok(_) => Err(failure("invalid", "the bucket ignores conditional writes")),
            Err(error) => Err(fail(error.into())),
        };
        let listed: Vec<_> = store
            .list(Some(&Path::from(".checks")))
            .try_collect()
            .await
            .map_err(|e| fail(e.into()))?;
        let seen = listed.iter().any(|meta| meta.location == path);
        store
            .delete(&path)
            .await
            .map_err(|error| fail(error.into()))?;
        checked?;
        if !seen {
            return Err(failure("invalid", "an object written could not be listed"));
        }
        Ok(())
    }
}
