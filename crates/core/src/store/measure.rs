//! Counting what a store holds, a part at a time across several runs.

use std::time::{Duration, Instant};

use futures::TryStreamExt;
use object_store::path::Path;
use object_store::{ObjectStore, ObjectStoreExt, PutPayload};
use serde::{Deserialize, Serialize};

use super::io::found;
use crate::Result;

const PROGRESS: &str = "usage/measuring";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Stored {
    pub objects: u64,
    pub bytes: u64,
}

#[derive(Serialize, Deserialize, Default)]
struct Progress {
    after: Option<String>,
    counted: Stored,
}

pub async fn measure(store: &dyn ObjectStore, budget: Duration) -> Result<Option<Stored>> {
    let started = Instant::now();
    let progress_path = Path::from(PROGRESS);
    let mut progress: Progress = match found(store.get(&progress_path).await)? {
        Some(object) => serde_json::from_slice(&object.bytes().await?).unwrap_or_default(),
        None => Progress::default(),
    };
    let mut listing = match &progress.after {
        Some(after) => store.list_with_offset(None, &Path::from(after.as_str())),
        None => store.list(None),
    };
    while let Some(meta) = listing.try_next().await? {
        if meta.location != progress_path {
            progress.counted.objects += 1;
            progress.counted.bytes += meta.size;
        }
        progress.after = Some(meta.location.to_string());
        if started.elapsed() >= budget {
            let saved = serde_json::to_vec(&progress).expect("progress is plain data");
            store.put(&progress_path, PutPayload::from(saved)).await?;
            return Ok(None);
        }
    }
    if progress.after.is_some() {
        found(store.delete(&progress_path).await)?;
    }
    Ok(Some(progress.counted))
}

#[cfg(test)]
mod tests {
    use super::*;
    use object_store::memory::InMemory;

    #[tokio::test]
    async fn a_measurement_out_of_time_carries_on_where_it_stopped() {
        let store = InMemory::new();
        for i in 0..500 {
            let path = Path::from(format!("objects/{i:04}"));
            store
                .put(&path, PutPayload::from(vec![0u8; 10]))
                .await
                .unwrap();
        }
        let mut runs = 0;
        let found = loop {
            runs += 1;
            if let Some(found) = measure(&store, Duration::ZERO).await.unwrap() {
                break found;
            }
        };
        assert!(runs > 100, "{runs} runs");
        assert_eq!(
            found,
            Stored {
                objects: 500,
                bytes: 5000
            }
        );
        assert!(
            store.get(&Path::from(PROGRESS)).await.is_err(),
            "progress is cleared"
        );
        let again = measure(&store, Duration::from_secs(60)).await.unwrap();
        assert_eq!(again, Some(found));
    }
}
