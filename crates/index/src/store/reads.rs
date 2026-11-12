//! What a query read, by where it came from.

use std::cell::Cell;

tokio::task_local! {
    static READS: Cell<Reads>;
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Reads {
    pub memory: u64,
    pub disk: u64,
    pub store: u64,
}

#[derive(Clone, Copy)]
pub(crate) enum From {
    Memory,
    Disk,
    Store,
}

impl Reads {
    pub fn temperature(&self) -> &'static str {
        match (self.store, self.disk) {
            (0, 0) => "hot",
            (0, _) => "warm",
            _ => "cold",
        }
    }

    pub fn hit_ratio(&self) -> f64 {
        let total = self.memory + self.disk + self.store;
        match total {
            0 => 1.0,
            _ => (self.memory + self.disk) as f64 / total as f64,
        }
    }
}

pub(crate) fn count(from: From) {
    let _ = READS.try_with(|reads| {
        let mut now = reads.get();
        match from {
            From::Memory => now.memory += 1,
            From::Disk => now.disk += 1,
            From::Store => now.store += 1,
        }
        reads.set(now);
    });
}

pub async fn counted<T>(work: impl Future<Output = T>) -> (T, Reads) {
    READS
        .scope(Cell::new(Reads::default()), async {
            let out = work.await;
            (out, READS.with(Cell::get))
        })
        .await
}
