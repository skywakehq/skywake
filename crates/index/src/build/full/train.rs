//! What a full build learns from its sample: centroids, calibration queries and the filter sample.

use skywake_core::Hash;

use super::live::Sample;
use crate::build::blocking;
use crate::filter::attrs::Attrs;
use crate::format::Version;
use crate::store::{Storage, Written};
use crate::vector::calibrate::{Calibrator, QUERIES};
use crate::vector::ivf;
use crate::{Attributes, Column, Result};

const FILTER_SAMPLE: usize = 16_384;

pub(super) async fn store_filter_sample(
    storage: &Storage,
    version: &Version,
    sample: &Sample,
    current: &[usize],
    written: &mut Written,
) -> Result<Hash> {
    let step = current.len().div_ceil(FILTER_SAMPLE).max(1);
    let picked: Vec<usize> = current.iter().copied().step_by(step).collect();
    let rows: Vec<Attributes> = (picked.iter())
        .map(|&i| sample.attributes[i].clone())
        .collect();
    let seqs = picked.iter().map(|&i| sample.keys[i].1).collect();
    let attrs = Attrs::new(seqs, &rows, &version.schema.attributes);
    let hash = storage.put(postcard::to_stdvec(&attrs)?).await?;
    written.chunks([hash]);
    Ok(hash)
}

pub(super) fn calibrators(
    columns: &[Column],
    sample: &Sample,
    current: &[usize],
    live: usize,
) -> Vec<Calibrator> {
    let step = (current.len() / QUERIES).max(1);
    let picked: Vec<usize> = current
        .iter()
        .step_by(step)
        .take(QUERIES)
        .copied()
        .collect();
    (columns.iter().enumerate())
        .map(|(c, column)| {
            let queries = ivf::gather(&sample.vectors[c], column.dims, picked.iter().copied());
            let seqs = picked.iter().map(|&i| sample.keys[i].1).collect();
            Calibrator::new(*column, queries, seqs, live)
        })
        .collect()
}

pub(super) async fn train(
    columns: &[Column],
    sample: Sample,
    current: &[usize],
    k: usize,
) -> Result<Vec<Vec<f32>>> {
    let use_current = current.len() >= k;
    let mut trained = Vec::new();
    for (column, vectors) in columns.iter().zip(sample.vectors) {
        let dims = column.dims;
        let vectors = match use_current {
            true => ivf::gather(&vectors, dims, current.iter().copied()),
            false => vectors,
        };
        let metric = column.metric;
        let centroids = blocking(move || ivf::train(&vectors, dims, k, metric)).await?;
        trained.push(centroids);
    }
    Ok(trained)
}
