//! Servers that come and go: who is up, and which of them owns each slot of shared work.

pub mod members;
mod registration;
pub mod slots;

pub use members::{Listing, Members};
pub use registration::Registration;
pub use slots::Slots;
