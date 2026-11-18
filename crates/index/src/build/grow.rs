//! Append builds: new rows go into delta pieces beside each cluster's base.

use std::collections::{BTreeMap, HashMap, HashSet};

use super::Coding;
use super::pieces::{self, Layout, Origin, Source};
use crate::format::cluster::ClusterRef;
use crate::format::pages::Paged;
use crate::format::rows::{self, RowPage};
use crate::format::{Ann, Clusters, Version};
use crate::read::tail::Tail;
use crate::store::{Storage, Written};
use crate::vector::groups::Groups;
use crate::vector::reshape::Plan;
use crate::{Column, Error, Id, Result};

const UNBALANCED: u64 = 4;

const REMOVED: u64 = 5;

const REORGANIZE: u64 = 4;

const LEAST_REORGANIZED: u64 = 64 << 20;

fn still_good(sizes: &[u64], live: u64, removed: u64, full_rows: u64) -> bool {
    let largest = sizes.iter().copied().max().unwrap_or(0);
    largest * sizes.len() as u64 <= UNBALANCED * live && removed * REMOVED <= full_rows.max(live)
}

pub(super) struct Sizes {
    pub budget: usize,
    pub most: u64,
}

pub(super) async fn grow(
    storage: &Storage,
    version: &Version,
    ann: &Ann,
    sizes: Sizes,
    written: &mut Written,
) -> Result<Option<Ann>> {
    let columns: Vec<(&String, Column)> = (version.schema.vectors.iter())
        .map(|(n, c)| (n, *c))
        .collect();
    let width = columns.len();
    let tail = Tail::load(storage, version).await?;
    let newest = tail.newest();
    let live = tail.live(&newest);
    let touched = rows::pages_of(storage, &ann.rows, newest.keys().copied()).await?;
    let page_of = |id: &Id| rows::page_of(id, ann.rows.len());

    let mut leave: Vec<HashMap<u32, HashSet<&Id>>> = vec![HashMap::new(); width];
    let mut removed = 0;
    for &id in newest.keys() {
        let page = &touched[&page_of(id)];
        if let Some(i) = page.find(id) {
            removed += 1;
            for (c, leaving) in leave.iter_mut().enumerate() {
                let cluster = page.clusters[i * width + c];
                leaving.entry(cluster).or_default().insert(id);
            }
        }
    }
    let new_live = ann.live - removed + live.len() as u64;
    let removed = ann.removed + removed;

    let mut layouts = Vec::with_capacity(width);
    for (c, (name, column)) in columns.iter().enumerate() {
        let clusters = &ann.columns[*name];
        let source = Source {
            storage,
            tail: &tail,
            live: &live,
            leave: &leave[c],
            column: c,
            spec: *column,
        };
        let table: Paged<ClusterRef> = clusters.table.open(storage).await?;
        let table = table.iter().cloned().collect();
        let centroids = storage.centroids(clusters.centroids).await?;
        let layout = Layout::new(&source, table, centroids).await?;
        let plan = Plan::new(&layout.sizes, &layout.groups.centroids, column, sizes.most);
        if !still_good(&plan.sizes(&layout.sizes), new_live, removed, ann.full_rows) {
            return Ok(None);
        }
        let new_bytes = (live.len() * column.dims * column.element.bytes()) as u64;
        let budget = (REORGANIZE * new_bytes)
            .max(LEAST_REORGANIZED)
            .min(sizes.budget as u64);
        let cost = |g: usize| -> u64 {
            let members = &layout.groups.members[g];
            members
                .iter()
                .map(|&e| layout.table[e as usize].bytes())
                .sum()
        };
        let (plan, left) = plan.within(cost, budget);
        layouts.push((layout, plan, left));
    }

    let mut placed = vec![u32::MAX; live.len() * width];
    let mut moved: Vec<HashMap<Id, u32>> = vec![HashMap::new(); width];
    let mut built = BTreeMap::new();
    for (c, ((name, column), (layout, plan, left))) in columns.iter().zip(layouts).enumerate() {
        let clusters = &ann.columns[*name];
        let source = Source {
            storage,
            tail: &tail,
            live: &live,
            leave: &leave[c],
            column: c,
            spec: *column,
        };
        let old = layout.centroids.clone();
        let origin = storage.origin(clusters, column.dims).await?;
        let mut coding = Coding::new(version, column, clusters.seed, old.clone().into(), origin);
        let fold_bytes = left;
        let done = pieces::apply(
            &source,
            layout,
            &plan,
            &mut coding,
            (sizes.budget, fold_bytes),
            written,
        )
        .await?;
        for (from, id, dest) in done.placed {
            match from {
                Origin::New(i) => placed[i * width + c] = dest as u32,
                Origin::Piece(_) => {
                    moved[c].insert(id, dest as u32);
                }
            }
        }
        let clusters = store_table(
            storage,
            clusters,
            done.changes,
            &done.centroids,
            &old,
            &coding,
            written,
        )
        .await?;
        built.insert((*name).clone(), clusters);
    }

    if placed.contains(&u32::MAX) {
        return Err(Error::Corrupt(
            "an append build left a row out of every cluster".into(),
        ));
    }
    let mut touched = touched;
    let moved_ids = moved.iter().flat_map(|m| m.keys());
    let more = moved_ids.filter(|id| !touched.contains_key(&page_of(id)));
    touched.extend(rows::pages_of(storage, &ann.rows, more).await?);
    let clusters_of = |id: &Id, old: &[u32]| -> Vec<u32> {
        (old.iter().zip(&moved))
            .map(|(&cluster, moved)| moved.get(id).copied().unwrap_or(cluster))
            .collect()
    };
    let mut pages: BTreeMap<usize, RowPage> = BTreeMap::new();
    let mut old_bytes = 0;
    for (&p, page) in &touched {
        old_bytes += postcard::to_stdvec(&**page)?.len() as u64;
        let kept = pages.entry(p).or_default();
        for (i, id) in page.ids.iter().enumerate() {
            if !newest.contains_key(id) {
                let clusters = clusters_of(id, &page.clusters[i * width..(i + 1) * width]);
                kept.push(id.clone(), page.seqs[i], &clusters);
            }
        }
    }
    for (i, &(id, row)) in live.iter().enumerate() {
        let page = pages.entry(page_of(id)).or_default();
        page.push(id.clone(), row.seq, &placed[i * width..(i + 1) * width]);
    }
    let (numbers, pages): (Vec<usize>, Vec<RowPage>) = pages
        .into_iter()
        .map(|(p, page)| (p, page.sorted(width)))
        .unzip();
    let (hashes, page_sizes) = rows::store(storage, &pages, written).await?;
    let mut row_pages = ann.rows.clone();
    for (p, hash) in numbers.into_iter().zip(hashes) {
        row_pages[p] = hash;
    }
    Ok(Some(Ann {
        columns: built,
        rows: row_pages,
        rows_bytes: (ann.rows_bytes + page_sizes.iter().sum::<u64>()).saturating_sub(old_bytes),
        live: new_live,
        full_rows: ann.full_rows,
        removed,
        filters: ann.filters,
        parts: ann.parts.clone(),
    }))
}

async fn store_table(
    storage: &Storage,
    clusters: &Clusters,
    mut changes: BTreeMap<usize, ClusterRef>,
    centroids: &[f32],
    old: &[f32],
    coding: &Coding,
    written: &mut Written,
) -> Result<Clusters> {
    let added: Vec<ClusterRef> = changes
        .split_off(&(clusters.table.len as usize))
        .into_values()
        .collect();
    let table = (clusters.table.update(storage, changes, written).await?)
        .append(storage, &added, written)
        .await?;
    let mut clusters = Clusters {
        table,
        ..clusters.clone()
    };
    if !same(centroids, old) {
        if clusters.origin.is_none() {
            let origin = storage.put_centroids(&coding.origin).await?;
            written.object(origin);
            clusters.origin = Some(origin);
        }
        clusters.centroids = storage.put_centroids(&centroids.to_vec()).await?;
        written.object(clusters.centroids);
        clusters.groups = Groups::count(centroids, coding.dims);
    }
    Ok(clusters)
}

fn same(a: &[f32], b: &[f32]) -> bool {
    a.len() == b.len() && a.iter().zip(b).all(|(x, y)| x.to_bits() == y.to_bits())
}
