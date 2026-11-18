use std::collections::HashMap;

use futures::TryStreamExt;

use super::dead::Dead;
use super::filter::{Page, Partial, Proof, ones, prove, rows_of, uses_ids};
use super::resolve::{Column, Resolved};
use crate::format::Version;
use crate::format::columns::chunk::Layout;
use crate::format::columns::select::Bits;
use crate::format::columns::writer::covers;
use crate::layout::scalar;
use crate::read::snapshot::{Aggregate, Measure, Tallied, Tally, keys_of};
use crate::read::tail::{Row as TailRow, Tail};
use crate::store::Storage;
use crate::{Filter, Result, Value};

pub(crate) async fn aggregate(
    storage: &Storage,
    version: &Version,
    aggregate: &Aggregate,
    filter: Option<&Filter>,
) -> Result<Option<Vec<Tallied>>> {
    let Some(columns) = &version.columns else {
        return Ok(None);
    };
    let names = names(aggregate, filter);
    let usable = covers(columns, &version.schema)
        && aggregate.each.is_empty()
        && !columns.columns.is_empty()
        && names.iter().all(|name| columns.columns.contains_key(*name));
    if !usable {
        return Ok(None);
    }
    let resolved = Resolved::of(storage, columns).await?;
    let tail = Tail::load(storage, version).await?;
    let newest = tail.newest();
    let dead = Dead::find(storage, version, &resolved, newest.keys().copied()).await?;
    let mut groups = Groups::new(aggregate, &resolved);
    if let Some(count) = projected_count(storage, &resolved, aggregate, filter, &dead).await? {
        if count > 0 {
            groups.count(0, count);
        }
        add_tail(&mut groups, &tail, &newest, filter)?;
        return Ok(Some(groups.finish()?));
    }
    let counting = aggregate
        .measures
        .values()
        .all(|m| *m == Measure::Count(None));
    let totals = counting && filter.is_none() && groups.start_from_totals(&resolved);
    let mut scans = Vec::new();
    for page in 0..resolved.pages() {
        let dead_rows = dead.pages.get(&page);
        if totals && dead_rows.is_none() {
            continue;
        }
        if totals {
            groups.uncount_page(&resolved, page);
        }
        let proof = filter.map_or(Proof::All, |f| prove(f, &resolved, page));
        if proof == Proof::None {
            continue;
        }
        if counting
            && dead_rows.is_none()
            && groups.count_from_stats(&resolved, page, proof, filter)
        {
            continue;
        }
        scans.push(page);
    }
    let ids = filter.is_some_and(uses_ids);
    let partial = Partial::of(storage, filter);
    let mut loads = Page::stream(storage, &resolved, &scans, &names, ids);
    while let Some(batch) = loads.try_next().await? {
        for loaded in batch {
            let mut selected = match filter {
                Some(filter) => loaded.select_with(filter, partial.as_ref()),
                None => ones(loaded.rows),
            };
            dead.mask(loaded.page, &mut selected);
            groups.scan(&loaded, &selected)?;
        }
    }
    add_tail(&mut groups, &tail, &newest, filter)?;
    Ok(Some(groups.finish()?))
}

fn add_tail(
    groups: &mut Groups<'_>,
    tail: &Tail,
    newest: &HashMap<&crate::Id, Option<TailRow>>,
    filter: Option<&Filter>,
) -> Result<()> {
    for (id, row) in tail.live(newest) {
        let attributes = &tail.segment(row).attributes[row.row];
        if filter.is_none_or(|f| f.matches(id, attributes)) {
            groups.add_row(attributes)?;
        }
    }
    Ok(())
}

async fn projected_count(
    storage: &Storage,
    resolved: &Resolved,
    aggregate: &Aggregate,
    filter: Option<&Filter>,
    dead: &Dead,
) -> Result<Option<u64>> {
    let counting = (aggregate.measures.values()).all(|m| *m == Measure::Count(None));
    let Some(Filter::And(all)) = filter.filter(|_| counting && aggregate.group_by.is_empty())
    else {
        return Ok(None);
    };
    let mut equal = None;
    let mut bounds = Vec::new();
    for leaf in all {
        match leaf {
            Filter::Eq(name, value) if equal.is_none() => equal = Some((name, value)),
            Filter::Gt(name, v) => bounds.push((name, v, Bound::Above(false))),
            Filter::Gte(name, v) => bounds.push((name, v, Bound::Above(true))),
            Filter::Lt(name, v) => bounds.push((name, v, Bound::Below(false))),
            Filter::Lte(name, v) => bounds.push((name, v, Bound::Below(true))),
            _ => return Ok(None),
        }
    }
    let (Some((by, value)), Some(&(sort, ..))) = (equal, bounds.first()) else {
        return Ok(None);
    };
    if bounds.iter().any(|(name, ..)| *name != sort) {
        return Ok(None);
    }
    let found = (resolved.projections.iter()).find(|p| p.by == *by && p.sort == *sort);
    let Some(projection) = found else {
        return Ok(None);
    };
    let Some(code) = resolved.columns[by.as_str()].code(value) else {
        return Ok(Some(0));
    };
    let mut keyed = Vec::new();
    for &(_, value, bound) in &bounds {
        let Some(key) = scalar(value) else {
            return Ok(None);
        };
        keyed.push((key, bound));
    }
    let directory = &projection.directory;
    let positions = keyed.iter().map(|&(key, bound)| {
        directory.position(storage, move |c, k| match bound {
            Bound::Above(true) | Bound::Below(false) => (c, k) < (code, key),
            Bound::Above(false) | Bound::Below(true) => (c, k) <= (code, key),
        })
    });
    let (floor, ceiling, found) = futures::try_join!(
        directory.position(storage, |c, _| c < code),
        directory.position(storage, |c, _| c <= code),
        futures::future::try_join_all(positions),
    )?;
    let (mut start, mut end) = (floor, ceiling);
    for (&(_, bound), at) in keyed.iter().zip(found) {
        match bound {
            Bound::Above(_) => start = start.max(at),
            Bound::Below(_) => end = end.min(at),
        }
    }
    let mut count = end.saturating_sub(start);
    if dead.rows > 0 {
        let pages: Vec<usize> = dead.pages.keys().copied().collect();
        let names = [by.as_str(), sort.as_str()];
        for page in Page::load(storage, resolved, &pages, &names, false).await? {
            let selected = page.select(filter.expect("a projected count has a filter"));
            let gone = &dead.pages[&page.page];
            let hits: u32 = (selected.iter().zip(gone))
                .map(|(s, g)| (s & g).count_ones())
                .sum();
            count -= u64::from(hits);
        }
    }
    Ok(Some(count))
}

#[derive(Clone, Copy)]
enum Bound {
    Above(bool),
    Below(bool),
}

fn names<'a>(aggregate: &'a Aggregate, filter: Option<&'a Filter>) -> Vec<&'a str> {
    let measured = aggregate.measures.values().filter_map(Measure::attribute);
    let mut names: Vec<&str> = (aggregate.group_by.iter().chain(measured))
        .map(String::as_str)
        .collect();
    if let Some(filter) = filter {
        filter.names(&mut names);
    }
    names.sort_unstable();
    names.dedup();
    names
}

struct Groups<'a> {
    aggregate: &'a Aggregate,
    measures: Vec<&'a Measure>,
    dense: Option<Dense<'a>>,
    keyed: HashMap<Vec<u8>, Tallied>,
}

struct Dense<'a> {
    column: Option<(&'a str, &'a Column)>,
    rows: Vec<u64>,
    tallies: Vec<Tally>,
}

impl<'a> Dense<'a> {
    fn missing(&self) -> usize {
        self.rows.len() - 1
    }

    fn key(&self, slot: usize) -> Vec<Option<Value>> {
        match self.column {
            None => Vec::new(),
            Some(_) if slot == self.missing() => vec![None],
            Some((_, column)) => vec![Some(column.dictionary.values[slot].clone().canonical())],
        }
    }
}

impl<'a> Groups<'a> {
    fn new(aggregate: &'a Aggregate, resolved: &'a Resolved) -> Self {
        let measures: Vec<&Measure> = aggregate.measures.values().collect();
        let column = match aggregate.group_by.as_slice() {
            [] => Some(None),
            [name] => (resolved.columns.get_key_value(name))
                .filter(|(_, column)| column.layout == Layout::Dictionary)
                .map(|(name, column)| Some((name.as_str(), column))),
            _ => None,
        };
        let dense = column.map(|column| {
            let slots = column.map_or(1, |(_, c)| c.dictionary.values.len() + 1);
            Dense {
                column,
                rows: vec![0; slots],
                tallies: Tally::many(slots * measures.len()),
            }
        });
        Self {
            aggregate,
            measures,
            dense,
            keyed: HashMap::new(),
        }
    }

    fn count(&mut self, slot: usize, rows: u64) {
        self.change_counts(slot, |n| *n += rows);
    }

    fn uncount(&mut self, slot: usize, rows: u64) {
        self.change_counts(slot, |n| *n -= rows);
    }

    fn change_counts(&mut self, slot: usize, change: impl Fn(&mut u64)) {
        let m = self.measures.len();
        let dense = self.dense.as_mut().expect("counting into dense groups");
        change(&mut dense.rows[slot]);
        for tally in &mut dense.tallies[slot * m..(slot + 1) * m] {
            change(&mut tally.count);
        }
    }

    fn histogram_of(&self, resolved: &Resolved, page: usize) -> Option<Vec<(usize, u64)>> {
        let dense = self.dense.as_ref()?;
        let rows = resolved.rows[page] as u64;
        let Some((_, column)) = dense.column else {
            return Some(vec![(0, rows)]);
        };
        let stats = &column.pages[page].stats;
        let missing = (dense.missing(), stats.missing as u64);
        if stats.missing == stats.rows {
            return Some(vec![missing]);
        }
        let histogram = stats.histogram.as_ref()?;
        let counts = histogram.iter().map(|&(code, n)| (code as usize, n as u64));
        Some(counts.chain(std::iter::once(missing)).collect())
    }

    fn start_from_totals(&mut self, resolved: &Resolved) -> bool {
        let Some(dense) = &self.dense else {
            return false;
        };
        let Some((_, column)) = dense.column else {
            self.count(0, resolved.live);
            return true;
        };
        let complete = (column.pages.iter())
            .all(|page| page.stats.histogram.is_some() || page.stats.missing == page.stats.rows);
        if !complete {
            return false;
        }
        let missing = (dense.missing(), column.totals.missing);
        let counts: Vec<(usize, u64)> = (column.totals.histogram.iter().enumerate())
            .map(|(code, &n)| (code, n))
            .chain(std::iter::once(missing))
            .collect();
        for (slot, n) in counts {
            if n > 0 {
                self.count(slot, n);
            }
        }
        true
    }

    fn uncount_page(&mut self, resolved: &Resolved, page: usize) {
        let histogram = self.histogram_of(resolved, page);
        for (slot, n) in histogram.expect("totals were complete") {
            if n > 0 {
                self.uncount(slot, n);
            }
        }
    }

    fn count_from_stats(
        &mut self,
        resolved: &Resolved,
        page: usize,
        proof: Proof,
        filter: Option<&Filter>,
    ) -> bool {
        let Some(histogram) = self.histogram_of(resolved, page) else {
            return false;
        };
        if proof == Proof::All {
            for (slot, n) in histogram {
                if n > 0 {
                    self.count(slot, n);
                }
            }
            return true;
        }
        let dense = self.dense.as_ref().expect("a histogram has dense groups");
        let Some(leaf) = filter.filter(|f| is_leaf(f)) else {
            return false;
        };
        let mut names = Vec::new();
        leaf.names(&mut names);
        let Some(column) = resolved.columns.get(names[0]) else {
            return false;
        };
        let Some(stats) = column.pages[page].stats.histogram.as_ref() else {
            return false;
        };
        let values = &column.dictionary.values;
        let passing = stats
            .iter()
            .filter(|(code, _)| leaf.test(Some(&values[*code as usize])));
        match dense.column {
            None => {
                let n = passing.map(|&(_, n)| n as u64).sum();
                if n > 0 {
                    self.count(0, n);
                }
                true
            }
            Some((name, _)) if name == names[0] => {
                let passed: Vec<(usize, u64)> = passing
                    .map(|&(code, n)| (code as usize, n as u64))
                    .collect();
                for (slot, n) in passed {
                    self.count(slot, n);
                }
                true
            }
            Some(_) => false,
        }
    }

    fn scan(&mut self, page: &Page<'_>, selected: &Bits) -> Result<()> {
        let measured: Vec<Option<Vec<Option<Value>>>> = (self.measures.iter())
            .map(|measure| match measure {
                Measure::Count(None) => None,
                measure => measure.attribute().map(|name| {
                    let column = &page.resolved.columns[name];
                    page.chunks[name].values(column.layout, &column.dictionary)
                }),
            })
            .collect();
        let rows = rows_of(selected, page.rows);
        let coded = self.dense.as_ref().and_then(|dense| match dense.column {
            None => Some(None),
            Some((name, _)) => page.chunks[name].codes().map(|codes| Some((name, codes))),
        });
        match coded {
            Some(column) => {
                let missing = self.dense.as_ref().map_or(0, Dense::missing);
                for row in rows {
                    let slot = match &column {
                        None => 0,
                        Some((name, _)) if page.chunks[*name].is_missing(row) => missing,
                        Some((_, codes)) => codes[row] as usize,
                    };
                    self.tally_dense(slot, row, &measured);
                }
            }
            None => {
                let keys: Vec<Vec<Option<Value>>> = (self.aggregate.group_by.iter())
                    .map(|name| {
                        let column = &page.resolved.columns[name];
                        page.chunks[name].values(column.layout, &column.dictionary)
                    })
                    .collect();
                for row in rows {
                    let key: Vec<Option<Value>> = (keys.iter())
                        .map(|k| k[row].clone().map(Value::canonical))
                        .collect();
                    let values: Vec<Option<&Value>> = (measured.iter())
                        .map(|m| m.as_ref().and_then(|v| v[row].as_ref()))
                        .collect();
                    self.tally_keyed(key, &values)?;
                }
            }
        }
        Ok(())
    }

    fn tally_dense(&mut self, slot: usize, row: usize, measured: &[Option<Vec<Option<Value>>>]) {
        let m = self.measures.len();
        let dense = self.dense.as_mut().expect("dense groups");
        dense.rows[slot] += 1;
        let tallies = &mut dense.tallies[slot * m..(slot + 1) * m];
        for ((tally, measure), values) in tallies.iter_mut().zip(&self.measures).zip(measured) {
            match values {
                None => tally.count += 1,
                Some(values) => tally.add_value(measure, values[row].as_ref()),
            }
        }
    }

    fn tally_keyed(&mut self, key: Vec<Option<Value>>, values: &[Option<&Value>]) -> Result<()> {
        let encoded = postcard::to_stdvec(&key)?;
        let count = self.measures.len();
        let (_, tallies) = (self.keyed.entry(encoded)).or_insert_with(|| (key, Tally::many(count)));
        for ((tally, measure), value) in tallies.iter_mut().zip(&self.measures).zip(values) {
            match measure {
                Measure::Count(None) => tally.count += 1,
                measure => tally.add_value(measure, *value),
            }
        }
        Ok(())
    }

    fn add_row(&mut self, attributes: &crate::Attributes) -> Result<()> {
        for key in keys_of(self.aggregate, attributes) {
            let values: Vec<Option<&Value>> = (self.measures.iter())
                .map(|m| m.attribute().and_then(|name| attributes.get(name)))
                .collect();
            self.tally_keyed(key, &values)?;
        }
        Ok(())
    }

    fn finish(mut self) -> Result<Vec<Tallied>> {
        if let Some(dense) = self.dense.take() {
            let m = self.measures.len();
            let keys: Vec<Option<Vec<Option<Value>>>> = (0..dense.rows.len())
                .map(|slot| (dense.rows[slot] > 0).then(|| dense.key(slot)))
                .collect();
            let mut tallies = dense.tallies.into_iter();
            for key in keys {
                let group: Vec<Tally> = tallies.by_ref().take(m).collect();
                let Some(key) = key else { continue };
                let encoded = postcard::to_stdvec(&key)?;
                match self.keyed.get_mut(&encoded) {
                    Some((_, existing)) => {
                        for ((tally, other), measure) in
                            existing.iter_mut().zip(group).zip(&self.measures)
                        {
                            tally.merge(other, measure);
                        }
                    }
                    None => {
                        self.keyed.insert(encoded, (key, group));
                    }
                }
            }
        }
        Ok(self.keyed.into_values().collect())
    }
}

fn is_leaf(filter: &Filter) -> bool {
    !matches!(
        filter,
        Filter::And(_) | Filter::Or(_) | Filter::Not(_) | Filter::Ids(_) | Filter::IdRange(..)
    )
}
