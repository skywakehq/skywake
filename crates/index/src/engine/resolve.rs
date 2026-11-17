use std::collections::BTreeMap;
use std::sync::Arc;

use skywake_core::Hash;

use crate::format::columns::chunk::{Chunk, Layout};
use crate::format::columns::dictionary::Dictionary;
use crate::format::columns::stats::Totals;
use crate::format::columns::{self, Columns, PageRef, Span};
use crate::store::Storage;
use crate::{Id, Result};

pub(crate) struct Resolved {
    pub live: u64,
    pub ids: Vec<Span>,
    pub columns: BTreeMap<String, Column>,
}

pub(crate) struct Column {
    pub layout: Layout,
    pub dictionary: Arc<Dictionary>,
    pub totals: Arc<Totals>,
    pub pages: Vec<PageRef>,
}

impl Resolved {
    pub(crate) async fn of(storage: &Storage, columns: &Columns) -> Result<Arc<Resolved>> {
        let key = Hash::of(&postcard::to_stdvec(columns)?);
        if let Some(found) = storage.cache().get(key) {
            return Ok(found);
        }
        let ids: Vec<Span> = columns::directory(storage, &columns.ids).await?;
        let mut resolved = BTreeMap::new();
        let mut weight = 64 * ids.len();
        for (name, column) in &columns.columns {
            let (dictionary, totals, pages) = futures::try_join!(
                columns::dictionary(storage, column),
                columns::totals(storage, column),
                columns::pages(storage, column),
            )?;
            weight += 64 * pages.len() + 16 * dictionary.values.len() + 8 * totals.histogram.len();
            weight += (pages.iter())
                .map(|page| 8 * page.stats.histogram.as_ref().map_or(0, Vec::len))
                .sum::<usize>();
            let column = Column {
                layout: column.layout,
                dictionary,
                totals,
                pages,
            };
            resolved.insert(name.clone(), column);
        }
        let resolved = Arc::new(Resolved {
            live: columns.live,
            ids,
            columns: resolved,
        });
        storage.cache().insert(key, Arc::clone(&resolved), weight);
        Ok(resolved)
    }

    pub(crate) fn pages(&self) -> usize {
        self.ids.len()
    }

    pub(crate) async fn chunk(
        &self,
        storage: &Storage,
        name: &str,
        page: usize,
    ) -> Result<Arc<Chunk>> {
        columns::chunk(storage, &self.columns[name].pages[page].span).await
    }

    pub(crate) async fn ids(&self, storage: &Storage, page: usize) -> Result<Arc<Vec<Id>>> {
        columns::ids(storage, &self.ids[page]).await
    }
}
