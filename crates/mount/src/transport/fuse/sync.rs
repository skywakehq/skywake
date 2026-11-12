//! Makes sure the mount has every write the kernel still holds before a save.

use std::fs::File;
use std::io;
use std::os::fd::AsRawFd;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Condvar, Mutex, PoisonError};
use std::time::Duration;

use super::THREADS;

pub(super) const BARRIER: &std::ffi::CStr = c"user.skywake.barrier";

const BARRIER_WAIT: Duration = Duration::from_secs(2);

const BARRIER_ROUNDS: usize = 8;

pub fn sync_kernel(root: &File) -> io::Result<()> {
    // SAFETY: `root` stays open during the call.
    if unsafe { libc::syncfs(root.as_raw_fd()) } != 0 {
        return Err(io::Error::last_os_error());
    }
    let mut last = None;
    for _ in 0..BARRIER_ROUNDS {
        let writes = match barrier(root) {
            Ok(writes) => writes,
            Err(error) if error.raw_os_error() == Some(libc::ETIMEDOUT) => {
                tracing::warn!("a mount thread is busy; some writes may wait for the next save");
                return Ok(());
            }
            Err(error) => return Err(error),
        };
        if last == Some(writes) {
            break;
        }
        last = Some(writes);
    }
    Ok(())
}

pub(super) fn parent_of(pid: u32) -> Option<u32> {
    let status = std::fs::read_to_string(format!("/proc/{pid}/status")).ok()?;
    let parent = status.lines().find_map(|line| line.strip_prefix("PPid:"))?;
    parent.trim().parse().ok()
}

fn barrier(root: &File) -> io::Result<u64> {
    let fd = root.as_raw_fd();
    let ask = move || {
        let mut value = [0u8; 8];
        // SAFETY: `fd` stays open and `value` holds 8 bytes.
        let len = unsafe { libc::fgetxattr(fd, BARRIER.as_ptr(), value.as_mut_ptr().cast(), 8) };
        match len {
            8 => Ok(u64::from_le_bytes(value)),
            _ => Err(io::Error::last_os_error()),
        }
    };
    std::thread::scope(|scope| {
        let callers: Vec<_> = (0..THREADS).map(|_| scope.spawn(ask)).collect();
        let answers: Vec<io::Result<u64>> = callers
            .into_iter()
            .map(|caller| {
                caller
                    .join()
                    .unwrap_or_else(|panic| std::panic::resume_unwind(panic))
            })
            .collect();
        answers
            .into_iter()
            .try_fold(0, |most, writes| Ok(most.max(writes?)))
    })
}

#[derive(Default)]
pub(super) struct Rendezvous {
    state: Mutex<(usize, u64, u64)>,
    met: Condvar,
}

impl Rendezvous {
    pub(super) fn wait(&self, writes: &AtomicU64) -> Option<u64> {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        let round = state.1;
        state.0 += 1;
        if state.0 == THREADS {
            *state = (0, round + 1, writes.load(Ordering::SeqCst));
            self.met.notify_all();
            return Some(state.2);
        }
        let (mut state, _) = self
            .met
            .wait_timeout_while(state, BARRIER_WAIT, |state| state.1 == round)
            .unwrap_or_else(PoisonError::into_inner);
        if state.1 == round {
            state.0 -= 1;
            return None;
        }
        Some(state.2)
    }
}
