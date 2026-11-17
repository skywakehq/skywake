use std::cmp::Ordering;
use std::collections::BTreeMap;

use super::dead::Dead;
use super::filter::{Page, Proof, ones, prove, rows_of};
use super::resolve::{Column, Resolved};
use crate::format::Version;
use crate::format::columns::writer::covers;
use crate::read::snapshot::{Order, Row};
use crate::read::tail::{self, Tail};
use crate::store::Storage;
use crate::{Attributes, Filter, Id, Result, Value};

const FIRST_BATCH: usize = 8;
const LAST_BATCH: usize = 256;

pub(crate) async fn order(
    storage: &Storage,
    version: &Version,
    order: &Order,
    filter: Option<&Filter>,
) -> Result<Option<Vec<Row>>> {
    let Some(columns) = &version.columns else {
        return Ok(None);
    };
    let keys: Vec<(&str, bool)> = order.keys().collect();
    let attributes = order.attributes();
    let mut loaded: Vec<&str> = attributes.iter().map(String::as_str).collect();
    if let Some(filter) = filter {
        filter.names(&mut loaded);
    }
    loaded.sort_unstable();
    loaded.dedup();
    let usable = keys[0].0 != "id"
        && covers(columns, &version.schema)
        && !columns.columns.is_empty()
        && (loaded
            .iter()
            .copied()
            .chain(order.include.iter().map(String::as_str)))
        .all(|name| columns.columns.contains_key(name));
    if !usable {
        return Ok(None);
    }
    let resolved = Resolved::of(storage, columns).await?;
    if attributes
        .iter()
        .any(|name| has_nan(&resolved.columns[name.as_str()]))
    {
        return Ok(None);
    }
    let tail = Tail::load(storage, version).await?;
    let newest = tail.newest();
    let dead = Dead::find(storage, version, &resolved, newest.keys().copied()).await?;
    let wanted = order.offset + order.top_k;
    let mut best = Best::new(order, wanted);
    for (id, row) in tail.live(&newest) {
        let all = &tail.segment(row).attributes[row.row];
        if filter.is_some_and(|f| !f.matches(id, all)) {
            continue;
        }
        if attributes.iter().any(|name| is_nan(all.get(name))) {
            return Ok(None);
        }
        let keys = pick(&attributes, |name| all.get(name).cloned());
        best.offer(id.clone(), keys, At::Tail(row));
    }
    best.trim();

    let (by, descending) = keys[0];
    let column = &resolved.columns[by];
    let mut pages: Vec<(usize, Option<Value>)> = (0..resolved.pages())
        .filter(|&page| resolved.rows[page] > 0)
        .filter(|&page| filter.is_none_or(|f| prove(f, &resolved, page) != Proof::None))
        .map(|page| (page, bound(order, descending, column, page)))
        .collect();
    pages.sort_by(|(_, a), (_, b)| order.key_order(descending, a.as_ref(), b.as_ref()));

    let (mut next, mut batch) = (0, FIRST_BATCH);
    while next < pages.len() {
        let open = |at: &(usize, Option<Value>)| best.could_take(descending, at.1.as_ref());
        let end = (next..pages.len().min(next + batch))
            .take_while(|&i| open(&pages[i]))
            .last()
            .map_or(next, |i| i + 1);
        if end == next {
            break;
        }
        let chosen: Vec<usize> = pages[next..end].iter().map(|(page, _)| *page).collect();
        for page in Page::load(storage, &resolved, &chosen, &loaded, true).await? {
            let mut selected = match filter {
                Some(filter) => page.select(filter),
                None => ones(page.rows),
            };
            dead.mask(page.page, &mut selected);
            scan(&mut best, &page, &selected, &attributes, descending, by);
        }
        best.trim();
        next = end;
        batch = (batch * 2).min(LAST_BATCH);
    }

    let chosen = best.finish();
    let rows = materialize(storage, &resolved, &tail, order, chosen).await?;
    Ok(Some(rows.into_iter().skip(order.offset).collect()))
}

fn has_nan(column: &Column) -> bool {
    (column.pages.iter()).any(|page| {
        let stats = &page.stats;
        stats.rows > stats.missing && (stats.min.is_none() || stats.max.is_none())
    })
}

fn is_nan(value: Option<&Value>) -> bool {
    matches!(value, Some(Value::Number(n)) if n.is_nan())
}

fn bound(order: &Order, descending: bool, column: &Column, page: usize) -> Option<Value> {
    let stats = &column.pages[page].stats;
    let present = match descending {
        true => stats.max.clone(),
        false => stats.min.clone(),
    };
    match (present, stats.missing > 0) {
        (Some(value), true) => match order.key_order(descending, Some(&value), None) {
            Ordering::Greater => None,
            _ => Some(value),
        },
        (present, _) => present,
    }
}

fn pick(names: &[String], mut get: impl FnMut(&str) -> Option<Value>) -> Attributes {
    (names.iter())
        .filter_map(|name| Some((name.clone(), get(name)?)))
        .collect()
}

fn scan(
    best: &mut Best<'_>,
    page: &Page<'_>,
    selected: &[u64],
    attributes: &[String],
    descending: bool,
    by: &str,
) {
    let ids = page.ids.as_ref().expect("an order loads the page's ids");
    let read = |name: &str, row: usize| {
        let column = &page.resolved.columns[name];
        page.chunks[name].value(row, column.layout, &column.dictionary)
    };
    for row in rows_of(selected, page.rows) {
        let first = read(by, row);
        if !best.could_take(descending, first.as_ref()) {
            continue;
        }
        let keys = pick(attributes, |name| match name == by {
            true => first.clone(),
            false => read(name, row),
        });
        best.offer(ids[row].clone(), keys, At::Page(page.page, row));
    }
}

async fn materialize(
    storage: &Storage,
    resolved: &Resolved,
    tail: &Tail,
    order: &Order,
    chosen: Vec<Candidate>,
) -> Result<Vec<Row>> {
    let names: Vec<&str> = order.include.iter().map(String::as_str).collect();
    let mut pages: Vec<usize> = (chosen.iter())
        .filter_map(|c| match c.at {
            At::Page(page, _) => Some(page),
            At::Tail(_) => None,
        })
        .collect();
    pages.sort_unstable();
    pages.dedup();
    let loaded = match names.is_empty() {
        true => Vec::new(),
        false => Page::load(storage, resolved, &pages, &names, false).await?,
    };
    let by_page: BTreeMap<usize, &Page<'_>> = loaded.iter().map(|p| (p.page, p)).collect();
    Ok(chosen
        .into_iter()
        .map(|candidate| {
            let attributes = match candidate.at {
                At::Tail(row) => {
                    let all = &tail.segment(row).attributes[row.row];
                    pick(&order.include, |name| all.get(name).cloned())
                }
                At::Page(page, row) => pick(&order.include, |name| {
                    let column = &resolved.columns[name];
                    by_page[&page].chunks[name].value(row, column.layout, &column.dictionary)
                }),
            };
            Row {
                id: candidate.id,
                attributes,
            }
        })
        .collect())
}

#[derive(Clone, Copy)]
enum At {
    Page(usize, usize),
    Tail(tail::Row),
}

struct Candidate {
    id: Id,
    keys: Attributes,
    at: At,
}

struct Best<'a> {
    order: &'a Order,
    wanted: usize,
    kept: Vec<Candidate>,
    worst: Option<Option<Value>>,
}

impl<'a> Best<'a> {
    fn new(order: &'a Order, wanted: usize) -> Self {
        Self {
            order,
            wanted,
            kept: Vec::new(),
            worst: None,
        }
    }

    fn could_take(&self, descending: bool, first: Option<&Value>) -> bool {
        match &self.worst {
            None => true,
            Some(worst) => {
                let order = self.order.key_order(descending, first, worst.as_ref());
                order != Ordering::Greater
            }
        }
    }

    fn offer(&mut self, id: Id, keys: Attributes, at: At) {
        self.kept.push(Candidate { id, keys, at });
        if self.kept.len() >= 2 * self.wanted.max(256) {
            self.trim();
        }
    }

    fn trim(&mut self) {
        let order = self.order;
        self.kept
            .sort_by(|a, b| order.compare((&a.id, &a.keys), (&b.id, &b.keys)));
        self.kept.truncate(self.wanted);
        if self.wanted > 0 && self.kept.len() == self.wanted {
            let last = &self.kept[self.wanted - 1];
            self.worst = Some(last.keys.get(&order.by).cloned());
        }
    }

    fn finish(mut self) -> Vec<Candidate> {
        self.trim();
        self.kept
    }
}
