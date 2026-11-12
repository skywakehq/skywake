//! Fetching small files in the background when a folder is first listed, with those of the folders below it.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use futures::{StreamExt, stream};
use skywake_core::{Data, Entry, Hash};

use super::{BranchFs, lock};

const FILE_MAX: u64 = 1 << 20;
const FOLDER_MAX: u64 = 32 << 20;
const WALK_MAX: u64 = 256 << 20;
const FOLDERS_MAX: usize = 20_000;

pub(super) type Walked = Arc<Mutex<HashSet<Hash>>>;

impl BranchFs {
    pub(super) fn prefetch(&self, tree: Hash) {
        if lock(&self.walked).contains(&tree) {
            return;
        }
        let (trees, cache, objects, slots, walked) = (
            self.trees.clone(),
            self.cache.clone(),
            self.objects.clone(),
            self.prefetching.clone(),
            self.walked.clone(),
        );
        tokio::spawn(async move {
            let mut chunks = Vec::new();
            let mut bundled = Vec::new();
            let mut budget = WALK_MAX;
            let mut todo = vec![tree];
            let mut folders = 0;
            while let Some(hash) = todo.pop() {
                if folders == FOLDERS_MAX || budget == 0 {
                    break;
                }
                if !lock(&walked).insert(hash) {
                    continue;
                }
                let Ok(tree) = trees.get(hash).await else {
                    continue;
                };
                folders += 1;
                let mut left = FOLDER_MAX.min(budget);
                let mut below = Vec::new();
                for entry in tree.values() {
                    match entry {
                        Entry::File { size, data, .. }
                            if !matches!(data, Data::Inline(_))
                                && *size <= FILE_MAX
                                && *size <= left =>
                        {
                            left -= size;
                            budget -= size;
                            match data {
                                Data::Bundled(one) => bundled.push(*one),
                                _ => chunks.extend(data.chunks().iter().map(|chunk| chunk.hash)),
                            }
                        }
                        Entry::Dir { tree } => below.push(*tree),
                        _ => {}
                    }
                }
                todo.extend(below.into_iter().rev());
            }
            let (bundle_cache, bundle_objects) = (cache.clone(), objects.clone());
            tokio::spawn(async move {
                bundle_cache.fetch_bundled(&bundle_objects, bundled).await;
            });
            stream::iter(chunks)
                .for_each_concurrent(64, |hash| {
                    let (cache, objects, slots) = (&cache, &objects, &slots);
                    async move {
                        if cache.has(hash) {
                            return;
                        }
                        let Ok(_slot) = slots.acquire().await else {
                            return;
                        };
                        let _ = cache.fetch(objects, hash).await;
                    }
                })
                .await;
        });
    }
}
