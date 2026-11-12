//! Full builds: two passes over every segment, in fixed memory.

mod assign;
mod fill;
mod live;
pub(crate) mod runs;
mod spill;
mod train;

use std::collections::BTreeMap;
use std::sync::Arc;

use super::{Coding, seed};
use crate::format::pages::Pages;
use crate::format::{Ann, Clusters, SegmentRef, Version};
use crate::store::{Storage, Written};
use crate::vector::ivf;
use crate::{Column, Result};
use assign::Assignment;
use live::Live;
use runs::Runs;

const ROW_BYTES: usize = 64;

const MIN_RUN: usize = 16;

const REPLACED: u32 = u32::MAX;

pub(super) async fn full_build(
    storage: &Storage,
    version: &Version,
    (budget, cluster_rows, spill): (usize, usize, bool),
    written: &mut Written,
) -> Result<Ann> {
    let columns: Vec<Column> = version.schema.vectors.values().copied().collect();
    let mut refs: Vec<SegmentRef> = (version.built.open::<SegmentRef>(storage).await?)
        .iter()
        .cloned()
        .collect();
    refs.extend_from_slice(&version.tail);
    let refs = &refs;
    let writes: u64 = refs.iter().map(|r| r.rows).sum();
    let want = ivf::sample_size(ivf::clusters_for(writes as usize, cluster_rows));

    let runs = Runs::new(storage, spill)?;
    let limit = (budget / 4 / ROW_BYTES).max(MIN_RUN);

    let Live {
        sample,
        current,
        live,
        doc_rows,
        places,
    } = live::find(storage, refs, &columns, (want, writes), (&runs, limit)).await?;
    let mut calibrators = train::calibrators(&columns, &sample, &current, live);
    let filters = train::store_filter_sample(storage, version, &sample, &current, written).await?;
    let wanted = ivf::clusters_for(live, cluster_rows);
    let centroids = train::train(&columns, sample, &current, wanted).await?;
    let k = centroids[0].len() / columns[0].dims;

    let models = (&columns[..], &centroids[..], &mut calibrators[..]);
    let Assignment {
        slots,
        counts,
        rows,
        pages,
    } = assign::assign(storage, refs, models, places, (&runs, limit, live, k)).await?;

    let doc_rows = doc_rows.max(1) as usize;
    let row_bytes = (refs.iter().map(|r| r.bytes).sum::<u64>() as usize / doc_rows).max(1);
    let mut built = BTreeMap::new();
    let parts = (version.schema.vectors.iter())
        .zip(centroids)
        .zip(calibrators);
    for (c, (((name, column), centroids), calibrator)) in parts.enumerate() {
        let origin = Arc::new(ivf::mean(&centroids, column.dims));
        let coding = Coding::new(version, column, seed(name), Arc::new(centroids), origin);
        let column_slots = (&slots[c], c, &counts[c][..]);
        let sizes = (budget, row_bytes, spill);
        let stored = fill::fill(storage, refs, column_slots, sizes, &coding, written).await?;
        let calibration = calibrator.finish(&coding.centroids);
        let centroids = storage.put_centroids(&coding.centroids).await?;
        written.object(centroids);
        let clusters = Clusters {
            centroids,
            origin: None,
            table: Pages::write(storage, &stored, written).await?,
            seed: seed(name),
            calibration,
            directory: None,
        };
        built.insert(name.clone(), clusters);
    }
    let (hashes, rows_bytes) = assign::store_rows(storage, rows, pages, written).await?;
    Ok(Ann {
        columns: built,
        rows: hashes,
        rows_bytes,
        live: live as u64,
        full_rows: live as u64,
        removed: 0,
        filters,
        parts: BTreeMap::new(),
    })
}
