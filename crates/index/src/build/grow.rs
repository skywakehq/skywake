//! Incremental builds.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::sync::Arc;

use futures::{StreamExt, TryStreamExt, stream};

use super::{Coding, assign, blocking, groups, store_clusters};
use crate::format::cluster::{self, Cluster, ClusterRef};
use crate::format::pages::Paged;
use crate::format::rows::{self, RowPage};
use crate::format::{Ann, Clusters, Version};
use crate::read::tail::{Row, Tail};
use crate::store::{PARALLELISM, Storage, Written};
use crate::vector::reshape::{self, Plan};
use crate::{Column, Id, Result};

type Placed = Vec<(usize, Cluster)>;

const UNBALANCED: u64 = 4;

const REMOVED: u64 = 5;

const GROWN: u64 = 2;

fn still_good(sizes: &[u64], live: u64, removed: u64, full_rows: u64) -> bool {
    let largest = sizes.iter().copied().max().unwrap_or(0);
    largest * sizes.len() as u64 <= UNBALANCED * live
        && live <= GROWN * full_rows
        && removed * REMOVED <= full_rows
}

pub(super) async fn grow(
    storage: &Storage,
    version: &Version,
    ann: &Ann,
    budget: usize,
    written: &mut Written,
) -> Result<Option<Ann>> {
    let columns: Vec<(&String, Column)> = version
        .schema
        .vectors
        .iter()
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

    let mut join: Vec<BTreeMap<u32, Vec<usize>>> = vec![BTreeMap::new(); width];
    let mut placed = vec![0u32; live.len() * width];
    for (c, (name, column)) in columns.iter().enumerate() {
        let data: Vec<f32> = live
            .iter()
            .flat_map(|&(_, row)| tail.segment(row).vector(c, column.dims, row.row))
            .copied()
            .collect();
        let centroids = storage.centroids(ann.columns[*name].centroids).await?;
        for (i, cluster) in assign(data, column, centroids)
            .await?
            .into_iter()
            .enumerate()
        {
            join[c].entry(cluster).or_default().push(i);
            placed[i * width + c] = cluster;
        }
    }

    let new_live = ann.live - removed + live.len() as u64;
    let mut tables: Vec<Paged<ClusterRef>> = Vec::new();
    let mut plans = Vec::new();
    for (c, (name, column)) in columns.iter().enumerate() {
        let clusters = &ann.columns[*name];
        let table: Paged<ClusterRef> = clusters.table.open(storage).await?;
        let mut sizes: Vec<u64> = table.iter().map(|c| c.rows).collect();
        for (&cluster, leaving) in &leave[c] {
            sizes[cluster as usize] -= leaving.len() as u64;
        }
        for (&cluster, joining) in &join[c] {
            sizes[cluster as usize] += joining.len() as u64;
        }
        let plan = Plan::new(
            &sizes,
            &storage.centroids(clusters.centroids).await?,
            column,
        );
        let sizes = plan.sizes(&sizes);
        if !still_good(&sizes, new_live, ann.removed + removed, ann.full_rows) {
            return Ok(None);
        }
        tables.push(table);
        plans.push(plan);
    }

    let mut columns_built = BTreeMap::new();
    let mut moved: Vec<HashMap<Id, u32>> = vec![HashMap::new(); width];
    for (c, ((name, column), table)) in columns.iter().zip(&tables).enumerate() {
        let (clusters, plan) = (&ann.columns[*name], &plans[c]);
        let centroids = storage.centroids(clusters.centroids).await?;
        let origin = storage.origin(clusters, column.dims).await?;
        let mut coding = Coding::new(version, column, clusters.seed, centroids, origin);
        let rewrite = Rewrite {
            storage,
            tail: &tail,
            live: &live,
            leave: &leave[c],
            join: &join[c],
            column: c,
            dims: column.dims,
        };
        let mut changes = BTreeMap::new();
        for &(from, into) in &plan.merges {
            let merged = rewrite.merge(from, into, table, &mut moved[c]).await?;
            changes.extend(store_reshaped(storage, merged, &mut coding, column, written).await?);
        }
        for &(from, to) in &plan.splits {
            let split = rewrite
                .split(from, to, table, column, &mut moved[c])
                .await?;
            changes.extend(store_reshaped(storage, split, &mut coding, column, written).await?);
        }
        let touched: Vec<usize> = (leave[c].keys().chain(join[c].keys()))
            .map(|&c| c as usize)
            .filter(|c| !changes.contains_key(c))
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        for group in groups(&touched, budget, |&c| table.get(c).bytes() as usize) {
            let filled: Vec<(usize, Cluster)> = stream::iter(group.iter().copied())
                .map(|cluster| rewrite.cluster(cluster, table.get(cluster)))
                .buffered(PARALLELISM)
                .try_collect()
                .await?;
            let stored = store_clusters(storage, filled, &coding, written).await?;
            changes.extend(group.iter().copied().zip(stored));
        }
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
        if !plan.is_empty() {
            if clusters.origin.is_none() {
                let origin = storage.put_centroids(&coding.origin).await?;
                written.object(origin);
                clusters.origin = Some(origin);
            }
            clusters.centroids = storage.put_centroids(&coding.centroids).await?;
            written.object(clusters.centroids);
        }
        columns_built.insert((*name).clone(), clusters);
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
        let clusters = clusters_of(id, &placed[i * width..(i + 1) * width]);
        page.push(id.clone(), row.seq, &clusters);
    }
    let (numbers, pages): (Vec<usize>, Vec<RowPage>) = pages
        .into_iter()
        .map(|(p, page)| (p, page.sorted(width)))
        .unzip();
    let (hashes, sizes) = rows::store(storage, &pages, written).await?;
    let mut row_pages = ann.rows.clone();
    for (p, hash) in numbers.into_iter().zip(hashes) {
        row_pages[p] = hash;
    }
    Ok(Some(Ann {
        columns: columns_built,
        rows: row_pages,
        rows_bytes: (ann.rows_bytes + sizes.iter().sum::<u64>()).saturating_sub(old_bytes),
        live: new_live,
        full_rows: ann.full_rows,
        removed: ann.removed + removed,
        filters: ann.filters,
        parts: ann.parts.clone(),
    }))
}

async fn store_reshaped(
    storage: &Storage,
    reshaped: Placed,
    coding: &mut Coding,
    column: &Column,
    written: &mut Written,
) -> Result<Vec<(usize, ClusterRef)>> {
    let dims = column.dims;
    let centroids = Arc::make_mut(&mut coding.centroids);
    for (place, cluster) in &reshaped {
        let centroid = reshape::centroid(cluster, column);
        match place * dims == centroids.len() {
            true => centroids.extend(centroid),
            false => centroids[place * dims..(place + 1) * dims].copy_from_slice(&centroid),
        }
    }
    let places: Vec<usize> = reshaped.iter().map(|(place, _)| *place).collect();
    let stored = store_clusters(storage, reshaped, coding, written).await?;
    Ok(places.into_iter().zip(stored).collect())
}

struct Rewrite<'a> {
    storage: &'a Storage,
    tail: &'a Tail,
    live: &'a [(&'a Id, Row)],
    leave: &'a HashMap<u32, HashSet<&'a Id>>,
    join: &'a BTreeMap<u32, Vec<usize>>,
    column: usize,
    dims: usize,
}

impl Rewrite<'_> {
    async fn merge(
        &self,
        from: usize,
        into: usize,
        table: &Paged<ClusterRef>,
        moved: &mut HashMap<Id, u32>,
    ) -> Result<Placed> {
        let (_, mut merged) = self.cluster(into, table.get(into)).await?;
        let (_, source) = self.cluster(from, table.get(from)).await?;
        moved.extend(source.ids.iter().map(|id| (id.clone(), into as u32)));
        reshape::merge(&mut merged, source);
        Ok(vec![(into, merged)])
    }

    async fn split(
        &self,
        from: usize,
        to: usize,
        table: &Paged<ClusterRef>,
        column: &Column,
        moved: &mut HashMap<Id, u32>,
    ) -> Result<Placed> {
        let (_, whole) = self.cluster(from, table.get(from)).await?;
        let column = *column;
        let (stay, go) = blocking(move || reshape::split(whole, &column)).await?;
        moved.extend(go.ids.iter().map(|id| (id.clone(), to as u32)));
        Ok(vec![(from, stay), (to, go)])
    }

    async fn cluster(&self, cluster: usize, old: &ClusterRef) -> Result<(usize, Cluster)> {
        let dims = self.dims;
        let mut fill = Cluster::default();
        let leaving = self.leave.get(&(cluster as u32));
        let old = cluster::decode(&self.storage.blob(old.hash).await?)?;
        for (i, id) in old.ids.into_iter().enumerate() {
            if leaving.is_some_and(|leaving| leaving.contains(&id)) {
                continue;
            }
            fill.seqs.push(old.seqs[i]);
            fill.vectors.extend(&old.vectors[i * dims..(i + 1) * dims]);
            fill.attributes.push(old.attributes[i].clone());
            fill.ids.push(id);
        }
        for &i in self.join.get(&(cluster as u32)).into_iter().flatten() {
            let (id, row) = self.live[i];
            let segment = self.tail.segment(row);
            fill.ids.push(id.clone());
            fill.seqs.push(row.seq);
            fill.vectors
                .extend(segment.vector(self.column, dims, row.row));
            fill.attributes.push(segment.attributes[row.row].clone());
        }
        Ok((cluster, fill))
    }
}
