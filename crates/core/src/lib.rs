//! Skywake: a filesystem for agents, stored in an object store.

pub mod cache;
mod clock;
pub mod cluster;
mod error;
mod model;
mod net;
mod ops;
mod repo;
mod retry;
pub mod store;
mod sync;

pub use error::{Error, Result};
pub use model::{
    Bundled, Chunk, Commit, Data, EXECUTABLE_MODE, Entry, FILE_MODE, Hash, Pack, Packs, Tree,
    permissions,
};
pub use ops::diff::Change;
pub use ops::files;
pub use ops::ignore::{CACHES, IGNORE_FILE, ignored, is_ignored, parse_ignored};
pub use ops::worktree::{INLINE_BUDGET, INLINE_MAX, store_file, store_file_reusing};
pub use repo::{Claim, Content, Edit, Match, Merged, Repo, Resolution, Take};
pub use store::gc::Collected;
pub use store::gc::lock;
pub use store::refs::wire as heads;
pub use store::{
    Bundler, Encryption, Head, HeadNodes, HeadsAt, Objects, Refs, StoreKeys, Trees, bucket_folder,
    forget_keys, granted_heads, open_store, open_store_keyed, open_store_with, remember_checks,
    renew_keys, valid_name,
};
