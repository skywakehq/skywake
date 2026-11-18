//! Measures calibration again once splits have added enough clusters, off the build path.

use std::sync::Arc;

use futures::{StreamExt, TryStreamExt, stream};

use super::{blocking, groups};
use crate::format::cluster::{self, ClusterRef};
use crate::format::pages::Paged;
use crate::format::{Clusters, Version};
use crate::store::{PARALLELISM, Storage, Written};
use crate::vector::calibrate::{Calibration, Calibrator, QUERIES};
use crate::vector::groups::Groups;
use crate::{Column, Result};

const STALE: u64 = 3;

pub(crate) fn stale(clusters: &Clusters) -> bool {
    let (now, then) = (clusters.groups, clusters.calibrated.max(1));
    2 * now >= STALE * then || STALE * now <= 2 * then
}

pub(crate) fn wanted(version: &Version) -> bool {
    (version.ann.iter().flat_map(|ann| ann.columns.values())).any(stale)
}

pub(crate) async fn recalibrate(storage: &Storage, branch: &str, budget: usize) -> Result<bool> {
    let version = storage.current(branch).await?;
    let Some(ann) = &version.ann else {
        return Ok(false);
    };
    let mut measured = Vec::new();
    for (name, clusters) in &ann.columns {
        if !stale(clusters) {
            continue;
        }
        let column = version.schema.vectors[name];
        let found = measure(storage, clusters, column, budget).await?;
        measured.push((name.clone(), found));
    }
    if measured.is_empty() {
        return Ok(false);
    }
    storage
        .save(branch, &Written::new(), |current| {
            let mut ann = current.ann.clone()?;
            for (name, (calibration, groups)) in &measured {
                let clusters = ann.columns.get_mut(name)?;
                clusters.calibration = calibration.clone();
                clusters.calibrated = *groups;
            }
            Some(Version {
                ann: Some(ann),
                ..current.clone()
            })
        })
        .await
}

async fn measure(
    storage: &Storage,
    clusters: &Clusters,
    column: Column,
    budget: usize,
) -> Result<(Calibration, u64)> {
    let dims = column.dims;
    let table: Paged<ClusterRef> = clusters.table.open(storage).await?;
    let table: Vec<ClusterRef> = table.iter().cloned().collect();
    let centroids = storage.centroids(clusters.centroids).await?;
    let found = Groups::new(&centroids, dims);
    let rows: u64 = table.iter().map(|piece| piece.rows).sum();
    let (queries, seqs) = sample(storage, &table, rows, dims).await?;
    let mut calibrator = Calibrator::new(column, queries, seqs, rows as usize);
    let pieces: Vec<usize> = (0..table.len()).filter(|&e| table[e].rows > 0).collect();
    let size = |&e: &usize| table[e].bytes() as usize;
    for part in groups(&pieces, budget, size) {
        let read: Vec<(usize, cluster::Cluster)> =
            stream::iter(part.iter().copied())
                .map(|e| {
                    let hash = table[e].hash;
                    async move {
                        Ok::<_, crate::Error>((e, cluster::decode(&storage.blob(hash).await?)?))
                    }
                })
                .buffered(PARALLELISM)
                .try_collect()
                .await?;
        let (mut vectors, mut seqs, mut owners) = (Vec::new(), Vec::new(), Vec::new());
        for (e, piece) in read {
            owners.extend(std::iter::repeat_n(found.of[e], piece.ids.len()));
            vectors.extend(piece.vectors);
            seqs.extend(piece.seqs);
        }
        calibrator = blocking(move || {
            calibrator.add(&vectors, &seqs, &owners);
            calibrator
        })
        .await?;
    }
    let group_centroids = Arc::new(found.centroids);
    let count = found.members.len() as u64;
    let calibration = blocking(move || calibrator.finish(&group_centroids)).await?;
    Ok((calibration, count))
}

async fn sample(
    storage: &Storage,
    table: &[ClusterRef],
    rows: u64,
    dims: usize,
) -> Result<(Vec<f32>, Vec<u64>)> {
    let want = (QUERIES as u64).min(rows);
    let mut picks: Vec<(usize, usize)> = Vec::new();
    let (mut seen, mut next) = (0u64, 0u64);
    for (e, piece) in table.iter().enumerate() {
        while next < want && (next * rows / want) < seen + piece.rows {
            picks.push((e, (next * rows / want - seen) as usize));
            next += 1;
        }
        seen += piece.rows;
    }
    let mut queries = Vec::with_capacity(picks.len() * dims);
    let mut seqs = Vec::with_capacity(picks.len());
    for chunk in picks.chunk_by(|a, b| a.0 == b.0) {
        let piece = cluster::decode(&storage.blob(table[chunk[0].0].hash).await?)?;
        for &(_, row) in chunk {
            queries.extend_from_slice(&piece.vectors[row * dims..(row + 1) * dims]);
            seqs.push(piece.seqs[row]);
        }
    }
    Ok((queries, seqs))
}
