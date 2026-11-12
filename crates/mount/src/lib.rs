//! Mounts a Skywake branch as a filesystem.

mod fs;
#[cfg(target_os = "linux")]
mod transport;

pub use fs::{
    Attr, BranchFs, DirEntry, Ino, Kind, Op, Ops, ROOT, Rename, Save, SetAttr, SetXattr, Snapshot,
};
#[cfg(target_os = "linux")]
pub use fuser::BackgroundSession;
pub use skywake_core::cache::{CacheNodes, CacheStats, ChunkCache, Loaded};
#[cfg(target_os = "linux")]
pub use transport::{
    Fsyncs, MountOptions, VmSession, mount, mount_dir, mount_with_options, serve_vm, serve_vm_on,
    sync_kernel,
};
