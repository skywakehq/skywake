//! Branch names per folder, listed from the bucket once per server and shared by its slots.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use futures::TryStreamExt;
use object_store::ObjectStore;
use object_store::path::Path;
use skywake_core::valid_name;

use crate::{hold, in_folder};

type Names = Arc<HashSet<String>>;

#[derive(Default)]
pub(super) struct Listings(Mutex<HashMap<String, (Instant, Names)>>);

impl Listings {
    pub(super) async fn names(
        &self,
        root: &Arc<dyn ObjectStore>,
        folder: &str,
        since: Instant,
    ) -> Result<Names, object_store::Error> {
        if let Some((at, names)) = hold(&self.0).get(folder)
            && *at >= since
        {
            return Ok(names.clone());
        }
        self.list(root, folder).await
    }

    pub(super) async fn list(
        &self,
        root: &Arc<dyn ObjectStore>,
        folder: &str,
    ) -> Result<Names, object_store::Error> {
        let started = Instant::now();
        let names = branch_names(in_folder(root, folder).as_ref()).await?;
        Ok(self.keep(folder, started, names))
    }

    pub(super) fn folders(&self) -> Vec<String> {
        let mut folders: Vec<String> = hold(&self.0).keys().cloned().collect();
        if !folders.iter().any(String::is_empty) {
            folders.push(String::new());
        }
        folders
    }

    pub(super) fn keep(&self, folder: &str, started: Instant, names: Vec<String>) -> Names {
        let names = Arc::new(names.into_iter().collect::<HashSet<_>>());
        let mut listings = hold(&self.0);
        match listings.get(folder) {
            Some((at, kept)) if *at >= started => kept.clone(),
            _ => {
                listings.insert(folder.to_string(), (started, names.clone()));
                names
            }
        }
    }
}

pub(super) async fn branch_names(
    store: &dyn ObjectStore,
) -> Result<Vec<String>, object_store::Error> {
    store
        .list(Some(&Path::from("refs")))
        .try_filter_map(|meta| async move {
            let name = meta
                .location
                .as_ref()
                .strip_prefix("refs/")
                .map(str::to_string);
            Ok(name.filter(|name| valid_name(name)))
        })
        .try_collect()
        .await
}
