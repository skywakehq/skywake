use std::collections::{BTreeMap, HashSet};

use super::resolve::Resolved;
use crate::format::Version;
use crate::format::rows;
use crate::store::Storage;
use crate::{Error, Id, Result};

pub(crate) type Bits = Vec<u64>;

#[derive(Default)]
pub(crate) struct Dead {
    pub pages: BTreeMap<usize, Bits>,
    pub rows: u64,
}

impl Dead {
    pub(crate) async fn find<'a>(
        storage: &Storage,
        version: &Version,
        resolved: &Resolved,
        touched: impl Iterator<Item = &'a Id> + Clone,
    ) -> Result<Self> {
        let mut dead = Dead::default();
        if touched.clone().next().is_none() {
            return Ok(dead);
        }
        let columns = version.columns.as_ref().expect("an index with columns");
        let (map, stride) = match &version.ann {
            Some(ann) if columns.rows.is_empty() => (&ann.rows, version.schema.vectors.len()),
            _ => (&columns.rows, 1),
        };
        let found = rows::pages_of(storage, map, touched.clone()).await?;
        let mut by_page: BTreeMap<usize, HashSet<&Id>> = BTreeMap::new();
        for id in touched {
            let row_page = &found[&rows::page_of(id, map.len())];
            if let Some(i) = row_page.find(id) {
                let page = row_page.clusters[i * stride] as usize;
                by_page.entry(page).or_default().insert(id);
            }
        }
        for (page, gone) in by_page {
            let ids = resolved.ids(storage, page).await?;
            let mut bits = vec![0u64; ids.len().div_ceil(64)];
            let mut hits = 0;
            for (row, id) in ids.iter().enumerate() {
                if gone.contains(id) {
                    bits[row / 64] |= 1 << (row % 64);
                    hits += 1;
                }
            }
            if hits != gone.len() {
                return Err(Error::Corrupt(format!(
                    "page {page} is missing ids its row map places there"
                )));
            }
            dead.rows += hits as u64;
            dead.pages.insert(page, bits);
        }
        Ok(dead)
    }
}
