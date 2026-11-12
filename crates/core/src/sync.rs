//! Locking a mutex even when a thread panicked while holding it.

use std::sync::{Mutex, MutexGuard, PoisonError};

pub(crate) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}
