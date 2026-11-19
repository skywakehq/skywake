use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, OnceLock};

use skywake_core::Hash;
use tokio::sync::OnceCell;

use crate::format::columns::chunk::Layout;
use crate::format::columns::dictionary::{Dictionary, Word};
use crate::format::columns::leaders::Leaders;
use crate::format::columns::projection::{self, Projected};
use crate::format::columns::stats::Totals;
use crate::format::columns::{self, ColumnRef, Columns, PageRef, Span};
use crate::store::Storage;
use crate::{Result, Value};

/// The column metadata one query needs: only the columns it names, and the
/// rows and row ids of each page only once something asks for them.
pub(crate) struct Resolved {
    pub live: u64,
    pub columns: BTreeMap<String, Arc<Column>>,
    pub projections: Vec<Projected>,
    first: Option<ColumnRef>,
    rows: OnceCell<Vec<usize>>,
    ids: Vec<Hash>,
    spans: OnceCell<Arc<Vec<Span>>>,
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

    async fn of(storage: &Storage, column: &ColumnRef) -> Result<Arc<Column>> {
        let key = Hash::of(&postcard::to_stdvec(column)?);
        (storage.cached(key, async {
            let (dictionary, totals, pages, leaders) = futures::try_join!(
                columns::dictionary(storage, column),
                columns::totals(storage, column),
                columns::pages(storage, column),
                columns::leaders(storage, column),
            )?;
            let mut weight =
                64 * pages.len() + 16 * dictionary.values.len() + 8 * totals.histogram.len();
            weight += (leaders.as_ref()).map_or(0, |l| 48 * (l.high.rows.len() + l.low.rows.len()));
            weight += (pages.iter())
                .map(|page| 8 * page.stats.histogram.as_ref().map_or(0, Vec::len))
                .sum::<usize>();
            let resolved = Arc::new(Column {
                layout: column.layout,
                dictionary,
                source: column.dictionary,
                totals,
                pages,
                leaders,
                lookup: OnceLock::new(),
            });
            Ok((resolved, weight))
        }))
        .await
    }
}

impl Resolved {
    pub(crate) async fn of(
        storage: &Storage,
        columns: &Columns,
        names: &[&str],
    ) -> Result<Resolved> {
        let named = (names.iter())
            .filter_map(|&name| Some((name, columns.columns.get(name)?)))
            .map(|(name, column)| async move {
                Ok::<_, crate::Error>((name.to_string(), Column::of(storage, column).await?))
            });
        let projected = (columns.projections.iter())
            .filter(|p| names.contains(&p.by.as_str()) && names.contains(&p.sort.as_str()))
            .map(|p| projection::directory(storage, p));
        let (named, projections) = futures::try_join!(
            futures::future::try_join_all(named),
            futures::future::try_join_all(projected),
        )?;
        let named: BTreeMap<String, Arc<Column>> = named.into_iter().collect();
        let rows = (names.iter())
            .find_map(|&name| named.get(name))
            .map(|column| rows_of(&column.pages));
        Ok(Resolved {
            live: columns.live,
            columns: named,
            projections,
            first: columns.columns.values().next().cloned(),
            rows: OnceCell::new_with(rows),
            ids: columns.ids.clone(),
            spans: OnceCell::new(),
        })
    }

    pub(crate) async fn rows(&self, storage: &Storage) -> Result<&[usize]> {
        let rows = self.rows.get_or_try_init(|| async {
            match &self.first {
                Some(column) => {
                    Ok::<_, crate::Error>(rows_of(&columns::pages(storage, column).await?))
                }
                None => Ok(Vec::new()),
            }
        });
        Ok(rows.await?.as_slice())
    }

    pub(crate) async fn ids(&self, storage: &Storage) -> Result<&[Span]> {
        let spans = self.spans.get_or_try_init(|| async {
            let key = Hash::of(&postcard::to_stdvec(&self.ids)?);
            (storage.cached(key, async {
                let spans = Arc::new(columns::directory::<Span>(storage, &self.ids).await?);
                let weight = 64 * spans.len();
                Ok((spans, weight))
            }))
            .await
        });
        Ok(spans.await?.as_slice())
    }
}

fn rows_of(pages: &[PageRef]) -> Vec<usize> {
    pages.iter().map(|page| page.stats.rows as usize).collect()
}
