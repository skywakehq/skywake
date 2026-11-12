//! What gets stored: hashes, directory trees and commits.

mod commit;
mod hash;
mod tree;

pub use commit::{Commit, Pack, Packs};
pub use hash::Hash;
pub(crate) use tree::valid_entry_name;
pub use tree::{Bundled, Chunk, Data, EXECUTABLE_MODE, Entry, FILE_MODE, Tree, permissions};
