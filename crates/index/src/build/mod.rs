//! Building the cluster index.

mod builder;
pub(crate) mod directory;
mod full;
mod grow;

use std::collections::BTreeMap;
use std::sync::Arc;

use futures::{Stream, StreamExt, TryStreamExt, stream};

pub(crate) use builder::spawn;
pub use builder::{BuildPolicy, Builder};
use full::full_build;
use grow::grow;

use crate::filter;
use crate::format::cluster::{self, Cluster, ClusterRef, Coder};
use crate::format::{Ann, Segment, SegmentRef, Version};
use crate::store::{PARALLELISM, Storage, Written};
use crate::vector::ivf;
use crate::vector::rabitq::Rotation;
use crate::{Column, Element, Error, Kind, Result};

const READ_AHEAD: usize = 16;

pub(crate) async fn build(
    storage: &Storage,
    branch: &str,
    budget: usize,
    cluster_rows: usize,
    spill: bool,
    full: bool,
) -> Result<bool> {
    let version = storage.current(branch).await?;
    let covers = version.covers() + version.tail.len();
    let vectors = !version.schema.vectors.is_empty();
    let built_before = version.ann.is_some() || version.text.is_some() || !vectors;
    let parts_missing = (version.ann.as_ref())
        .is_some_and(|ann| !ann.parts.keys().eq(&version.schema.filter_index));
    let nothing_new = version.tail.is_empty() && built_before && !parts_missing;
    if covers == 0 || (nothing_new && !full) {
        return Ok(false);
    }
    let mut written = Written::new();
    let base = version.ann.clone();
    let mut grown = None;
    if let Some(ann) = &base
        && !full
    {
        if version.tail.is_empty() {
            grown = Some(ann.clone());
        } else if small_tail(ann, &version) {
            grown = grow(storage, &version, ann, budget, &mut written).await?;
        }
    }
    let incremental = grown.is_some();
    let mut ann = match (grown, vectors) {
        (Some(ann), _) => Some(ann),
        (None, true) => {
            let sizes = (budget, cluster_rows, spill);
            Some(full_build(storage, &version, sizes, &mut written).await?)
        }
        (None, false) => None,
    };
    if let Some(ann) = &mut ann {
        let schema = &version.schema;
        for (name, clusters) in &mut ann.columns {
            let old = (base.as_ref())
                .filter(|_| incremental)
                .and_then(|base| base.columns.get(name));
            let column = &schema.vectors[name];
            let new = clusters.clone();
            *clusters = directory::refresh(storage, column, old, new, &mut written).await?;
        }
        ann.parts =
            filter::build(storage, schema, ann, base.as_ref(), budget, &mut written).await?;
    }
    let text = crate::text::build::build(storage, &version, budget, full, &mut written).await?;
    let built = (version.built)
        .append(storage, &version.tail, &mut written)
        .await?;
    storage
        .save(branch, &written, |current| {
            let apply = match incremental {
                true => current.ann == base,
                false => current.covers() < covers || (full && current.ann == base),
            };
            let text_applies = current.text == version.text;
            let skip = covers.checked_sub(current.covers())?;
            (apply && text_applies && skip <= current.tail.len()).then(|| Version {
                built: built.clone(),
                tail: current.tail[skip..].to_vec(),
                ann: ann.clone(),
                text: text.clone(),
                ..current.clone()
            })
        })
        .await
}

fn small_tail(ann: &Ann, version: &Version) -> bool {
    let tail: u64 = version.tail.iter().map(|segment| segment.rows).sum();
    ann.live > 0 && tail * 2 <= ann.live
}

pub(crate) fn segments<'a>(
    storage: &'a Storage,
    refs: &'a [SegmentRef],
) -> impl Stream<Item = Result<(u64, Segment)>> + 'a {
    stream::iter(refs)
        .map(move |r| async move { Ok((r.first_seq, storage.fetch::<Segment>(r.hash).await?)) })
        .buffered(READ_AHEAD)
}

#[derive(Clone)]
struct Coding {
    dims: usize,
    element: Element,
    rotation: Arc<Rotation>,
    centroids: Arc<Vec<f32>>,
    origin: Arc<Vec<f32>>,
    kinds: Arc<BTreeMap<String, Kind>>,
}

impl Coding {
    fn new(
        version: &Version,
        column: &Column,
        seed: u64,
        centroids: Arc<Vec<f32>>,
        origin: Arc<Vec<f32>>,
    ) -> Self {
        Self {
            dims: column.dims,
            element: column.element,
            rotation: Arc::new(Rotation::new(column.dims, seed)),
            origin,
            centroids,
            kinds: Arc::new(version.schema.attributes.clone()),
        }
    }
}

fn seed(name: &str) -> u64 {
    (name.bytes()).fold(ivf::SEED, |h, b| {
        (h ^ b as u64).wrapping_mul(0x0000_0100_0000_01b3)
    })
}

async fn blocking<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> Result<T> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|_| Error::Corrupt("the index build panicked".into()))
}

async fn assign(data: Vec<f32>, column: &Column, centroids: Arc<Vec<f32>>) -> Result<Vec<u32>> {
    let (dims, metric) = (column.dims, column.metric);
    blocking(move || ivf::assign(&data, dims, &centroids, metric)).await
}

async fn store_clusters(
    storage: &Storage,
    clusters: Vec<(usize, Cluster)>,
    coding: &Coding,
    written: &mut Written,
) -> Result<Vec<ClusterRef>> {
    let stored: Vec<ClusterRef> = stream::iter(clusters)
        .map(|(place, cluster)| {
            let coding = coding.clone();
            async move {
                let (blob, stored) = blocking(move || {
                    let dims = coding.dims;
                    let coder = Coder {
                        dims,
                        element: coding.element,
                        rotation: &coding.rotation,
                        centroid: &coding.centroids[place * dims..(place + 1) * dims],
                        origin: &coding.origin,
                        kinds: &coding.kinds,
                    };
                    cluster::encode(&cluster, &coder)
                })
                .await??;
                storage.put_blob(blob).await?;
                Ok::<_, Error>(stored)
            }
        })
        .buffered(PARALLELISM)
        .try_collect()
        .await?;
    written.blobs(stored.iter().map(|c| c.hash));
    Ok(stored)
}

fn groups<T>(items: &[T], budget: usize, size: impl Fn(&T) -> usize) -> Vec<&[T]> {
    let mut groups = Vec::new();
    let mut start = 0;
    while start < items.len() {
        let mut end = start + 1;
        let mut bytes = size(&items[start]);
        while end < items.len() && bytes + size(&items[end]) <= budget {
            bytes += size(&items[end]);
            end += 1;
        }
        groups.push(&items[start..end]);
        start = end;
    }
    groups
}

#[cfg(test)]
mod tests;
