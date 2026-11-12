//! The collection lock as an owner sees it, so it can check writes in place of the writers.

use std::sync::Mutex;
use std::time::{Duration, Instant, UNIX_EPOCH};

use object_store::ObjectStore;
use skywake_core::lock::{self, VIEW_LIFETIME, View};
use tracing::warn;

use crate::hold;

#[derive(Default)]
pub(super) struct Cleanup {
    seen: Mutex<Option<(View, Instant)>>,
}

impl Cleanup {
    pub(super) async fn refresh(&self, store: &dyn ObjectStore) {
        let started = Instant::now();
        match lock::view(store).await {
            Ok(view) => *hold(&self.seen) = Some((view, started)),
            Err(error) => warn!(%error, "can't read the collection lock"),
        }
    }

    pub(super) fn clear(&self, since: u64) -> bool {
        let Some((view, at)) = *hold(&self.seen) else {
            return false;
        };
        at.elapsed() < VIEW_LIFETIME && view.clear(UNIX_EPOCH + Duration::from_secs(since))
    }
}
