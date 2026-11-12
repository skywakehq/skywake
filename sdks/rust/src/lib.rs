//! A client for Skywake search indexes.
//!
//! ```no_run
//! # async fn run() -> skywake::Result<()> {
//! use skywake::{Client, Query};
//!
//! let sky = Client::new("https://api.skywake.dev", "sw_...")?;
//! let hits = sky.index("products").query(&Query::new("embedding", [0.1, 0.2])).await?;
//! for hit in hits.iter() {
//!     println!("{} {}", hit.id, hit.distance);
//! }
//! # Ok(())
//! # }
//! ```

mod client;
mod error;
mod index;
mod types;

pub use client::{Client, Options};
pub use error::{Error, Result};
pub use index::{Indexes, SearchIndex};
pub use types::*;
