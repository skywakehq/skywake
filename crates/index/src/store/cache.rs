//! Decoded blobs in memory.

use std::any::Any;
use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex, PoisonError};

use skywake_core::Hash;

use super::reads;

type Value = Arc<dyn Any + Send + Sync>;

pub(crate) struct Cache {
    capacity: usize,
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    used: usize,
    clock: u64,
    entries: HashMap<Hash, Entry>,
    order: BTreeMap<u64, Hash>,
}

struct Entry {
    value: Value,
    bytes: usize,
    used: u64,
}

impl Cache {
    pub(crate) fn new(capacity: usize) -> Self {
        Self {
            capacity,
            inner: Mutex::default(),
        }
    }

    pub(crate) fn get<T: Send + Sync + 'static>(&self, hash: Hash) -> Option<Arc<T>> {
        let mut inner = self.lock();
        let inner = &mut *inner;
        let entry = inner.entries.get_mut(&hash)?;
        reads::count(reads::From::Memory);
        inner.clock += 1;
        inner.order.remove(&entry.used);
        inner.order.insert(inner.clock, hash);
        entry.used = inner.clock;
        entry.value.clone().downcast().ok()
    }

    pub(crate) fn insert<T: Send + Sync + 'static>(&self, hash: Hash, value: Arc<T>, bytes: usize) {
        if bytes > self.capacity {
            return;
        }
        let mut inner = self.lock();
        inner.clock += 1;
        let used = inner.clock;
        if let Some(old) = inner.entries.insert(hash, Entry { value, bytes, used }) {
            inner.order.remove(&old.used);
            inner.used -= old.bytes;
        }
        inner.order.insert(used, hash);
        inner.used += bytes;
        while inner.used > self.capacity {
            let Some((_, oldest)) = inner.order.pop_first() else {
                break;
            };
            if let Some(entry) = inner.entries.remove(&oldest) {
                inner.used -= entry.bytes;
            }
        }
    }

    #[cfg(test)]
    pub fn used(&self) -> usize {
        self.lock().used
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hash(n: u8) -> Hash {
        Hash::of(&[n])
    }

    #[test]
    fn the_least_recently_used_goes_first_and_the_bound_holds() {
        let cache = Cache::new(100);
        for n in 0..3 {
            cache.insert(hash(n), Arc::new(n), 40);
        }
        assert!(cache.get::<u8>(hash(0)).is_none());
        assert_eq!(cache.used(), 80);
        assert_eq!(*cache.get::<u8>(hash(1)).unwrap(), 1);
        cache.insert(hash(3), Arc::new(3u8), 40);
        assert!(cache.get::<u8>(hash(2)).is_none());
        assert!(cache.get::<u8>(hash(1)).is_some());
        assert!(cache.used() <= 100);
    }

    #[test]
    fn a_value_larger_than_the_cache_is_not_kept() {
        let cache = Cache::new(100);
        cache.insert(hash(1), Arc::new(1u8), 60);
        cache.insert(hash(2), Arc::new(2u8), 101);
        assert!(cache.get::<u8>(hash(2)).is_none());
        assert!(cache.get::<u8>(hash(1)).is_some());
        assert_eq!(cache.used(), 60);
    }

    #[test]
    fn inserting_again_does_not_count_twice() {
        let cache = Cache::new(100);
        cache.insert(hash(1), Arc::new(1u8), 30);
        cache.insert(hash(1), Arc::new(1u8), 30);
        assert_eq!(cache.used(), 30);
    }
}
