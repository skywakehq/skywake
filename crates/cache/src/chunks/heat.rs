//! How often each chunk is asked for, so a server can tell clients a chunk is hot.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use skywake_core::Hash;

use crate::hold;

const HOT_PER_SECOND: u32 = 50;
const TRACKED_MAX: usize = 100_000;

#[derive(Default)]
pub(crate) struct Heat {
    counts: Mutex<HashMap<Hash, (u64, u32)>>,
}

impl Heat {
    pub(crate) fn hit(&self, route: Hash) -> bool {
        let second = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let mut counts = hold(&self.counts);
        if counts.len() >= TRACKED_MAX {
            counts.retain(|_, (at, _)| *at == second);
            if counts.len() >= TRACKED_MAX {
                counts.clear();
            }
        }
        let count = counts.entry(route).or_insert((second, 0));
        if count.0 != second {
            *count = (second, 0);
        }
        count.1 += 1;
        count.1 >= HOT_PER_SECOND
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_chunk_asked_for_often_is_hot() {
        let heat = Heat::default();
        let hash = Hash::of(b"weights");
        let hot = (0..2 * HOT_PER_SECOND).any(|_| heat.hit(hash));
        assert!(hot);
        assert!(!heat.hit(Hash::of(b"cold")));
    }
}
