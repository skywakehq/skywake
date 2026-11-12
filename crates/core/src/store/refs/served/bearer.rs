//! What a client shows the cache servers: the cache token, or a pass it renews before expiry.

use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use crate::Result;
use crate::sync::lock;

#[async_trait::async_trait]
pub trait PassSource: Send + Sync {
    async fn pass(&self) -> Result<(String, SystemTime)>;
}

pub(super) struct Bearer {
    token: Mutex<Option<String>>,
    source: Option<(Arc<dyn PassSource>, Mutex<SystemTime>)>,
}

impl Bearer {
    pub(super) fn new(token: Option<String>) -> Self {
        Self {
            token: Mutex::new(token),
            source: None,
        }
    }

    pub(super) fn renewing(mut self, source: Arc<dyn PassSource>, expires: SystemTime) -> Self {
        self.source = Some((source, Mutex::new(renew_at(expires))));
        self
    }

    pub(super) fn renew_now(&self) -> bool {
        let Some((_, at)) = &self.source else {
            return false;
        };
        *lock(at) = SystemTime::UNIX_EPOCH;
        true
    }

    pub(super) async fn get(&self) -> Option<String> {
        if let Some((source, at)) = &self.source
            && SystemTime::now() >= *lock(at)
        {
            match source.pass().await {
                Ok((pass, expires)) => {
                    *lock(&self.token) = Some(pass);
                    *lock(at) = renew_at(expires);
                }
                Err(error) => {
                    tracing::warn!(%error, "can't renew the pass for branch heads");
                    *lock(at) = SystemTime::now() + Duration::from_secs(10);
                }
            }
        }
        lock(&self.token).clone()
    }
}

fn renew_at(expires: SystemTime) -> SystemTime {
    let now = SystemTime::now();
    now + expires.duration_since(now).unwrap_or_default().mul_f64(0.8)
}
