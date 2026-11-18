use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, OnceLock};

use skywake_core::Hash;

use crate::format::columns::chunk::Layout;
use crate::format::columns::dictionary::{Dictionary, Word};
use crate::format::columns::leaders::Leaders;
use crate::format::columns::projection::{self, Projected};
use crate::format::columns::stats::Totals;
use crate::format::columns::{self, Columns, PageRef, Span};
use crate::store::Storage;
use crate::{Result, Value};

pub(crate) struct Resolved {
    pub live: u64,
    pub ids: Vec<Span>,
    pub rows: Vec<usize>,
    pub columns: BTreeMap<String, Column>,
    pub projections: Vec<Projected>,
}

pub(crate) struct Column {
    pub layout: Layout,
    pub dictionary: Arc<Dictionary>,
    pub source: Hash,
    pub totals: Arc<Totals>,
    pub pages: Vec<PageRef>,
    pub leaders: Option<Arc<Leaders>>,
    lookup: OnceLock<HashMap<Word, u32>>,
}

impl Column {
    pub(crate) fn code(&self, value: &Value) -> Option<u32> {
        let lookup = self.lookup.get_or_init(|| {
            (self.dictionary.values.iter().enumerate())
                .filter_map(|(code, value)| Some((Word::of(value)?, code as u32)))
                .collect()
        });
        lookup.get(&Word::of(value)?).copied()
    }
}

impl Resolved {
    pub(crate) async fn of(storage: &Storage, columns: &Columns) -> Result<Arc<Resolved>> {
        let key = Hash::of(&postcard::to_stdvec(columns)?);
        if let Some(found) = storage.cache().get(key) {
            return Ok(found);
        }
        let loads = columns.columns.iter().map(|(name, column)| async move {
            let (dictionary, totals, pages, leaders) = futures::try_join!(
                columns::dictionary(storage, column),
                columns::totals(storage, column),
                columns::pages(storage, column),
                columns::leaders(storage, column),
            )?;
            Ok::<_, crate::Error>((name, column, dictionary, totals, pages, leaders))
        });
        let projected = (columns.projections.iter()).map(|p| projection::directory(storage, p));
        let (ids, loaded, projections) = futures::try_join!(
            columns::directory::<Span>(storage, &columns.ids),
            futures::future::try_join_all(loads),
            futures::future::try_join_all(projected),
        )?;
        let mut resolved = BTreeMap::new();
        let mut weight = 64 * ids.len();
        weight += (projections.iter())
            .flat_map(|p| &p.runs)
            .map(|run| {
                let removed = run.removed.as_ref().map_or(0, |r| r.blocks.len());
                48 * (run.added.blocks.len() + removed) + run.added.owners.len()
            })
            .sum::<usize>();
        for (name, column, dictionary, totals, pages, leaders) in loaded {
            weight += 64 * pages.len() + 16 * dictionary.values.len() + 8 * totals.histogram.len();
            weight += leaders
                .as_ref()
                .map_or(0, |l| 48 * (l.high.rows.len() + l.low.rows.len()));
            weight += (pages.iter())
                .map(|page| 8 * page.stats.histogram.as_ref().map_or(0, Vec::len))
                .sum::<usize>();
            let column = Column {
                layout: column.layout,
                dictionary,
                source: column.dictionary,
                totals,
                pages,
                leaders,
                lookup: OnceLock::new(),
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
            projections,
        });
        storage.cache().insert(key, Arc::clone(&resolved), weight);
        Ok(resolved)
    }

    pub(crate) fn pages(&self) -> usize {
        self.ids.len()
    }
}
