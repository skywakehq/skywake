//! Requests and answers. Filters, scores and attribute values stay JSON, as
//! the API documents them; unset fields are left out, so the server uses
//! its defaults.

mod answer;
mod document;
mod manage;
mod read;
mod write;

pub use answer::*;
pub use document::*;
pub use manage::*;
pub use read::*;
pub use write::*;
