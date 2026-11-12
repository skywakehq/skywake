//! The write log: each branch's records on disk, served over HTTP and handed off on leaving.

mod files;
mod hand_off;
mod owners;
mod records;
mod route;

pub(crate) use files::Logs;
pub(crate) use hand_off::hand_off;
pub(crate) use route::route;

pub(crate) const RECORD_MAX: usize = 80 << 20;
