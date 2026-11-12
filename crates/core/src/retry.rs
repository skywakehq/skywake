//! Waiting before a retry, and the random numbers it needs.

use std::hash::{BuildHasher, RandomState};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

pub(crate) const SAVE_ATTEMPTS: u32 = 10;

const FIRST_WAIT: Duration = Duration::from_millis(20);
const LONGEST_WAIT: Duration = Duration::from_secs(1);

pub(crate) fn random() -> u64 {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    RandomState::new().hash_one(NEXT.fetch_add(1, Ordering::Relaxed))
}

pub(crate) async fn backoff(attempt: u32) {
    let longest = FIRST_WAIT
        .saturating_mul(1 << attempt.min(16))
        .min(LONGEST_WAIT);
    let half = longest / 2;
    let extra = random() % (half.as_micros() as u64 + 1);
    tokio::time::sleep(half + Duration::from_micros(extra)).await;
}
