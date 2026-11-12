//! Versions, retention and garbage collection options as plain JavaScript objects.

use std::time::Duration;

use napi::Result;
use napi_derive::napi;
use skywake_index::Moment;

use crate::error::failure;

pub(crate) const GRACE: Duration = Duration::from_secs(8 * 24 * 3600);

#[napi(object)]
pub struct IndexVersion {
    pub version: String,
    pub time: f64,
    pub rows: f64,
}

#[napi(object)]
#[derive(Default)]
pub struct IndexCollectOptions {
    pub retention_days: Option<f64>,
    pub grace_seconds: Option<f64>,
    pub dry_run: Option<bool>,
}

#[napi(object)]
#[derive(Default)]
pub struct IndexCollected {
    pub kept: f64,
    pub deleted: f64,
    pub deleted_bytes: f64,
    pub missing: f64,
}

pub(crate) fn version(text: &str) -> Result<skywake_core::Hash> {
    (text.parse()).map_err(|_| failure("invalid", format!("`{text}` is not an index version")))
}

pub(crate) fn version_to(moment: Moment) -> IndexVersion {
    IndexVersion {
        version: moment.version.to_string(),
        time: moment.time.timestamp_millis() as f64,
        rows: moment.rows as f64,
    }
}

pub(crate) fn days(days: Option<f64>) -> Result<Option<Duration>> {
    match days {
        Some(days) if !(days >= 0.0 && days.is_finite()) => Err(failure(
            "invalid",
            "the retention period is a number of days, 0 or more",
        )),
        days => Ok(days.map(|days| Duration::from_secs_f64(days * 86_400.0))),
    }
}
