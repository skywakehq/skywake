//! Wall-clock times as plain numbers since 1970.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub(crate) fn millis(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub(crate) fn secs(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub(crate) fn from_secs(secs: u64) -> SystemTime {
    UNIX_EPOCH + Duration::from_secs(secs.min(1 << 40))
}
