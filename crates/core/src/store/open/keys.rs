//! Keys for a store that is not the process's own, such as a customer's
//! bucket. The caller renews them by handing in new keys under the same id;
//! every store opened with that id picks them up on its next request.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};

use async_trait::async_trait;
use object_store::aws::AwsCredential;
use object_store::{CredentialProvider, Result};

/// Where a bucket is and how to sign for it.
#[derive(Clone)]
pub struct StoreKeys {
    /// Names these keys. Stores opened with the same id share them, and
    /// [`renew_keys`] replaces them for all of those stores at once.
    pub id: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    pub session_token: Option<String>,
    /// An S3 compatible endpoint, such as R2's or MinIO's. AWS when absent.
    pub endpoint: Option<String>,
    pub region: Option<String>,
}

impl std::fmt::Debug for StoreKeys {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StoreKeys")
            .field("id", &self.id)
            .field("endpoint", &self.endpoint)
            .field("region", &self.region)
            .finish_non_exhaustive()
    }
}

type Slot = Arc<RwLock<Arc<AwsCredential>>>;

static RING: Mutex<Option<HashMap<String, Slot>>> = Mutex::new(None);

fn credential(keys: &StoreKeys) -> Arc<AwsCredential> {
    Arc::new(AwsCredential {
        key_id: keys.access_key_id.clone(),
        secret_key: keys.secret_access_key.clone(),
        token: keys.session_token.clone(),
    })
}

/// The shared slot for these keys, holding them from now on.
pub(super) fn slot(keys: &StoreKeys) -> Slot {
    let mut ring = crate::sync::lock(&RING);
    let ring = ring.get_or_insert_default();
    let slot = ring
        .entry(keys.id.clone())
        .or_insert_with(|| Arc::new(RwLock::new(credential(keys))))
        .clone();
    *slot
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = credential(keys);
    slot
}

/// Replaces the keys every store opened with `keys.id` signs with.
pub fn renew_keys(keys: &StoreKeys) {
    slot(keys);
}

/// Forgets keys no store should use any more.
pub fn forget_keys(id: &str) {
    if let Some(ring) = crate::sync::lock(&RING).as_mut() {
        ring.remove(id);
    }
}

#[derive(Debug)]
pub(super) struct Ringed(pub(super) Slot);

#[async_trait]
impl CredentialProvider for Ringed {
    type Credential = AwsCredential;

    async fn get_credential(&self) -> Result<Arc<AwsCredential>> {
        Ok(self
            .0
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys(secret: &str) -> StoreKeys {
        StoreKeys {
            id: "test-ring".into(),
            access_key_id: "AKIA".into(),
            secret_access_key: secret.into(),
            session_token: None,
            endpoint: None,
            region: None,
        }
    }

    #[tokio::test]
    async fn renewed_keys_reach_stores_already_open() {
        let ringed = Ringed(slot(&keys("one")));
        assert_eq!(ringed.get_credential().await.unwrap().secret_key, "one");
        renew_keys(&keys("two"));
        assert_eq!(ringed.get_credential().await.unwrap().secret_key, "two");
        forget_keys("test-ring");
    }

    #[test]
    fn debug_never_shows_secrets() {
        let shown = format!("{:?}", keys("hidden-secret"));
        assert!(!shown.contains("hidden-secret"));
        assert!(!shown.contains("AKIA"));
    }
}
