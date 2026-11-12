//! Ways to serve a [`BranchFs`](crate::BranchFs): FUSE or virtio-fs.

mod fuse;
mod virtiofs;

use std::future::Future;
use std::io;
use std::time::{Duration, Instant};

use tokio::sync::{mpsc, oneshot};

use crate::{Rename, SetXattr};
pub use fuse::{mount, mount_dir, mount_with_options, sync_kernel};
pub use virtiofs::{VmSession, serve_vm, serve_vm_on};

pub type Fsyncs = mpsc::UnboundedSender<oneshot::Sender<io::Result<()>>>;

#[derive(Debug, Clone, Default)]
pub struct MountOptions {
    pub owner: Option<(u32, u32)>,
    pub allow_other: bool,
}

const TTL: Duration = Duration::from_secs(60);

const STATFS_BLOCKS: u64 = 1 << 40;
const STATFS_FILES: u64 = 1 << 32;

const READDIR_BATCH: usize = 128;

fn os_error(error: &io::Error) -> i32 {
    error.raw_os_error().unwrap_or(libc::EIO)
}

fn request_save(fsyncs: &Fsyncs) -> impl Future<Output = io::Result<()>> + use<> {
    let started = Instant::now();
    let (done, saved) = oneshot::channel();
    let sent = fsyncs.send(done).is_ok();
    async move {
        if !sent {
            return Err(io::Error::from_raw_os_error(libc::EIO));
        }
        let result = saved
            .await
            .unwrap_or_else(|_| Err(io::Error::from_raw_os_error(libc::EIO)));
        metrics::histogram!("skywake_fsync_wait_seconds").record(started.elapsed().as_secs_f64());
        result
    }
}

fn rename_how(flags: u32) -> io::Result<Rename> {
    match flags {
        0 => Ok(Rename::Replace),
        libc::RENAME_NOREPLACE => Ok(Rename::NoReplace),
        libc::RENAME_EXCHANGE => Ok(Rename::Exchange),
        _ => Err(io::Error::from_raw_os_error(libc::EINVAL)),
    }
}

fn setxattr_when(flags: i32) -> io::Result<SetXattr> {
    match flags {
        0 => Ok(SetXattr::Always),
        libc::XATTR_CREATE => Ok(SetXattr::Create),
        libc::XATTR_REPLACE => Ok(SetXattr::Replace),
        _ => Err(io::Error::from_raw_os_error(libc::EINVAL)),
    }
}
