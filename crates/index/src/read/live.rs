//! Every current document of a snapshot.

use std::collections::{BTreeMap, HashMap};

use futures::{StreamExt, TryStreamExt, stream};

use super::tail::Tail;
use crate::export::doc;
use crate::filter::attrs::has;
use crate::format::cluster::{self, ClusterRef};
use crate::format::pages::Paged;
use crate::format::rows;
use crate::format::{Segment, SegmentRef, Version};
use crate::store::{PARALLELISM, Storage};
use crate::{Attributes, Doc, Error, Filter, Id, Result};

pub(crate) async fn each(
    storage: &Storage,
    version: &Version,
    filter: Option<&Filter>,
    mut each: impl FnMut(&Id, Attributes),
) -> Result<()> {
    let tail = Tail::load(storage, version).await?;
    let newest = tail.newest();
    match first_column(version) {
        Some((name, dims)) => {
            let table = table(storage, version, name).await?;
            let clusters: Vec<ClusterRef> = table.iter().cloned().collect();
            let mut read = stream::iter(clusters)
                .map(|cluster| async move { storage.codes_and_attrs(&cluster, dims).await })
                .buffered(PARALLELISM);
            while let Some((codes, attrs)) = read.try_next().await? {
                let pass = filter.map(|f| attrs.eval(f, Some(&codes.ids), codes.ids.len()));
                for (row, id) in codes.ids.iter().enumerate() {
                    if !newest.contains_key(id) && pass.as_ref().is_none_or(|p| has(p, row)) {
                        each(id, attrs.row(row, None));
                    }
                }
            }
        }
        None => {
            let built: Paged<SegmentRef> = version.built.open(storage).await?;
            let latest = latest_writes(storage, &built, |id| !newest.contains_key(id)).await?;
            for segment in built.iter() {
                let blob: std::sync::Arc<Segment> = storage.get(segment.hash).await?;
                for (seq, id, row) in blob.writes(segment.first_seq) {
                    let Some(row) = row else { continue };
                    let attributes = &blob.attributes[row];
                    if latest.get(id) == Some(&seq)
                        && filter.is_none_or(|f| f.matches(id, attributes))
                    {
                        each(id, attributes.clone());
                    }
                }
            }
        }
    }
    for (id, row) in tail.live(&newest) {
        let attributes = &tail.segment(row).attributes[row.row];
        if filter.is_none_or(|f| f.matches(id, attributes)) {
            each(id, attributes.clone());
        }
    }
    Ok(())
}

pub(crate) async fn fetch(
    storage: &Storage,
    version: &Version,
    ids: &[Id],
) -> Result<HashMap<Id, Doc>> {
    let tail = Tail::load(storage, version).await?;
    let newest = tail.newest();
    let mut found = HashMap::new();
    let mut built = Vec::new();
    for id in ids {
        match newest.get(id) {
            Some(Some(row)) => {
                found.insert(id.clone(), doc(version, tail.segment(*row), row.row));
            }
            Some(None) => {}
            None => built.push(id.clone()),
        }
    }
    if built.is_empty() {
        return Ok(found);
    }
    match (&version.ann, first_column(version)) {
        (Some(ann), Some(_)) => {
            let pages = rows::pages_of(storage, &ann.rows, built.iter()).await?;
            let columns: Vec<_> = version.schema.vectors.iter().collect();
            let mut wanted: BTreeMap<(usize, u32), Vec<Id>> = BTreeMap::new();
            for id in built {
                let page = &pages[&rows::page_of(&id, ann.rows.len())];
                if let Some(i) = page.find(&id) {
                    for column in 0..columns.len() {
                        let cluster = page.clusters[i * columns.len() + column];
                        wanted
                            .entry((column, cluster))
                            .or_default()
                            .push(id.clone());
                    }
                }
            }
            let mut tables = Vec::new();
            for (name, _) in &columns {
                tables.push(table(storage, version, name).await?);
            }
            let reads = wanted.into_iter().map(|((column, c), ids)| {
                let (name, spec) = columns[column];
                let cluster = tables[column].get(c as usize).clone();
                async move {
                    let rows = read_rows(storage, &cluster, spec.dims, spec.element, &ids).await?;
                    Ok::<_, Error>((name.clone(), column, rows))
                }
            });
            let read: Vec<_> = stream::iter(reads)
                .buffer_unordered(PARALLELISM)
                .try_collect()
                .await?;
            for (name, column, rows) in read {
                for (id, vector, attributes) in rows {
                    let doc = found.entry(id.clone()).or_insert_with(|| Doc::new(id));
                    doc.vectors.insert(name.clone(), vector);
                    if column == 0 {
                        doc.attributes = attributes;
                    }
                }
            }
        }
        _ => {
            let wanted: std::collections::HashSet<&Id> = built.iter().collect();
            let segments: Paged<SegmentRef> = version.built.open(storage).await?;
            let latest = latest_writes(storage, &segments, |id| wanted.contains(id)).await?;
            for segment in segments.iter() {
                let blob: std::sync::Arc<Segment> = storage.get(segment.hash).await?;
                for (seq, id, row) in blob.writes(segment.first_seq) {
                    if let Some(row) = row
                        && latest.get(id) == Some(&seq)
                    {
                        found.insert(id.clone(), doc(version, &blob, row));
                    }
                }
            }
        }
    }
    Ok(found)
}

pub(crate) async fn current(storage: &Storage, version: &Version) -> Result<HashMap<Id, u64>> {
    let mut current = HashMap::new();
    match &version.ann {
        Some(ann) => {
            let pages: Vec<std::sync::Arc<rows::RowPage>> =
                storage.get_all(ann.rows.clone()).await?;
            for page in &pages {
                current.extend(page.ids.iter().cloned().zip(page.seqs.iter().copied()));
            }
        }
        None => {
            let built: Paged<SegmentRef> = version.built.open(storage).await?;
            current = latest_writes(storage, &built, |_| true).await?;
        }
    }
    let tail = Tail::load(storage, version).await?;
    for (id, row) in tail.newest() {
        match row {
            Some(row) => current.insert(id.clone(), row.seq),
            None => current.remove(id),
        };
    }
    Ok(current)
}

async fn read_rows(
    storage: &Storage,
    cluster: &ClusterRef,
    dims: usize,
    element: crate::Element,
    ids: &[Id],
) -> Result<Vec<(Id, Vec<f32>, Attributes)>> {
    let (codes, attrs) = storage.codes_and_attrs(cluster, dims).await?;
    let mut rows = Vec::new();
    for id in ids {
        let row = (codes.ids.iter().position(|other| other == id)).ok_or_else(|| {
            Error::Corrupt(format!("{id} is not in the cluster its row map names"))
        })?;
        let bytes = storage
            .range(cluster.hash, cluster.vectors(row..row + 1))
            .await?;
        if cluster::checksum(&bytes) != codes.checks[row] {
            return Err(Error::Corrupt(format!(
                "a vector of blob {} does not match its checksum",
                cluster.hash
            )));
        }
        let vector = cluster::from_bytes(&bytes, element);
        rows.push((id.clone(), vector, attrs.row(row, None)));
    }
    Ok(rows)
}

async fn latest_writes(
    storage: &Storage,
    segments: &Paged<SegmentRef>,
    wanted: impl Fn(&Id) -> bool,
) -> Result<HashMap<Id, u64>> {
    let mut latest = HashMap::new();
    for segment in segments.iter() {
        let blob: std::sync::Arc<Segment> = storage.get(segment.hash).await?;
        for (seq, id, _) in blob.writes(segment.first_seq) {
            if wanted(id) {
                latest.insert(id.clone(), seq);
            }
        }
    }
    Ok(latest)
}

fn first_column(version: &Version) -> Option<(&String, usize)> {
    version.ann.as_ref()?;
    let (name, column) = version.schema.vectors.iter().next()?;
    Some((name, column.dims))
}

async fn table(storage: &Storage, version: &Version, name: &str) -> Result<Paged<ClusterRef>> {
    let ann = (version.ann.as_ref()).ok_or_else(|| Error::Corrupt("no clusters".into()))?;
    let clusters = (ann.columns.get(name))
        .ok_or_else(|| Error::Corrupt(format!("no clusters for `{name}`")))?;
    clusters.table.open(storage).await
}
