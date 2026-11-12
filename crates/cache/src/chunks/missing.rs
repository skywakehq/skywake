//! Chunks the bucket lately did not have, so they are not asked for again at once.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::hold;

const MISSING_FOR: Duration = Duration::from_secs(60);
const MISSING_MAX: usize = 100_000;

#[derive(Default)]
pub(crate) struct Missing(Mutex<HashMap<String, Instant>>);

impl Missing {
    pub(super) fn known(&self, at: &str) -> bool {
        hold(&self.0)
            .get(at)
            .is_some_and(|found| found.elapsed() < MISSING_FOR)
    }

    pub(super) fn remember(&self, at: String) {
        let mut missing = hold(&self.0);
        if missing.len() >= MISSING_MAX {
            missing.retain(|_, found| found.elapsed() < MISSING_FOR);
            if missing.len() >= MISSING_MAX {
                missing.clear();
            }
        }
        missing.insert(at, Instant::now());
    }
}
