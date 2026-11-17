use std::collections::BTreeMap;
use std::sync::Arc;

use skywake_core::Hash;

use crate::format::columns::chunk::Layout;
use crate::format::columns::dictionary::Dictionary;
use crate::format::columns::stats::Totals;
use crate::format::columns::{self, Columns, PageRef, Span};
use crate::store::Storage;
use crate::{Id, Result};

pub(crate) struct Resolved {
    pub live: u64,
    pub ids: Vec<Span>,
    pub rows: Vec<usize>,
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
        let loads = columns.columns.iter().map(|(name, column)| async move {
            let (dictionary, totals, pages) = futures::try_join!(
                columns::dictionary(storage, column),
                columns::totals(storage, column),
                columns::pages(storage, column),
            )?;
            Ok::<_, crate::Error>((name, column, dictionary, totals, pages))
        });
        let (ids, loaded) = futures::try_join!(
            columns::directory::<Span>(storage, &columns.ids),
            futures::future::try_join_all(loads),
        )?;
        let mut resolved = BTreeMap::new();
        let mut weight = 64 * ids.len();
        for (name, column, dictionary, totals, pages) in loaded {
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
        let rows = (resolved.values().next())
            .map(|column| {
                (column.pages.iter())
                    .map(|page| page.stats.rows as usize)
                    .collect()
            })
            .unwrap_or_default();
        let resolved = Arc::new(Resolved {
            live: columns.live,
            ids,
            rows,
            columns: resolved,
        });
        storage.cache().insert(key, Arc::clone(&resolved), weight);
        Ok(resolved)
    }

    pub(crate) fn pages(&self) -> usize {
        self.ids.len()
    }

    pub(crate) async fn ids(&self, storage: &Storage, page: usize) -> Result<Arc<Vec<Id>>> {
        columns::ids(storage, &self.ids[page]).await
    }
}
