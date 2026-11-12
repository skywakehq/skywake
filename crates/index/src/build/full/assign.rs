//! Pass two: each live row's clusters, as one run per column and a row map sorted by page.

use std::sync::Arc;

use futures::TryStreamExt;
use skywake_core::Hash;

use super::REPLACED;
use super::runs::{Run, Runs, Sorter, Writer};
use crate::build::{blocking, segments};
use crate::format::SegmentRef;
use crate::format::rows::{self, RowPage};
use crate::store::{PARALLELISM, Storage, Written};
use crate::vector::calibrate::Calibrator;
use crate::vector::ivf;
use crate::{Column, Id, Result};

const ASSIGN_BATCH: usize = 16_384;

type RowKey = (u32, Id, u64, Vec<u32>);

type Models<'a> = (&'a [Column], &'a [Vec<f32>], &'a mut [Calibrator]);

pub(super) struct Assignment<'r> {
    pub slots: Vec<Run<'r>>,
    pub counts: Vec<Vec<u64>>,
    pub rows: Sorter<'r, RowKey>,
    pub pages: usize,
}

struct Assigned<'r> {
    slots: Vec<Writer<'r, u32>>,
    counts: Vec<Vec<u64>>,
    rows: Sorter<'r, RowKey>,
    pages: usize,
}

pub(super) async fn assign<'r>(
    storage: &Storage,
    refs: &[SegmentRef],
    (columns, centroids, calibrators): Models<'_>,
    places: Sorter<'r, u64>,
    (runs, limit, live, k): (&'r Runs<'r>, usize, usize, usize),
) -> Result<Assignment<'r>> {
    let mut out = Assigned {
        slots: (0..columns.len())
            .map(|_| runs.writer())
            .collect::<Result<_>>()?,
        counts: vec![vec![0; k]; columns.len()],
        rows: Sorter::new(runs, limit),
        pages: rows::pages_for(live),
    };
    let mut batch = Batch::new(columns.len());
    let mut places = places.finish().await?;
    let mut wanted = places.next().await?;
    let mut place = 0;
    let mut pass = segments(storage, refs);
    while let Some((first_seq, segment)) = pass.try_next().await? {
        for (seq, id, row) in segment.writes(first_seq) {
            let Some(row) = row else { continue };
            if wanted == Some(place) {
                wanted = places.next().await?;
                for (c, column) in columns.iter().enumerate() {
                    batch.vectors[c].extend(segment.vector(c, column.dims, row));
                }
                batch.rows.push(Some((id.clone(), seq)));
            } else {
                batch.rows.push(None);
            }
            place += 1;
        }
        if batch.rows.len() >= ASSIGN_BATCH {
            let models = (columns, centroids, &mut *calibrators);
            batch.assign(models, &mut out).await?;
        }
    }
    batch
        .assign((columns, centroids, calibrators), &mut out)
        .await?;
    drop(pass);
    drop(places);
    let mut slots = Vec::with_capacity(out.slots.len());
    for slot in out.slots {
        slots.push(slot.finish().await?);
    }
    Ok(Assignment {
        slots,
        counts: out.counts,
        rows: out.rows,
        pages: out.pages,
    })
}

struct Batch {
    vectors: Vec<Vec<f32>>,
    rows: Vec<Option<(Id, u64)>>,
}

impl Batch {
    fn new(columns: usize) -> Self {
        Self {
            vectors: vec![Vec::new(); columns],
            rows: Vec::new(),
        }
    }

    async fn assign(
        &mut self,
        (columns, centroids, calibrators): Models<'_>,
        out: &mut Assigned<'_>,
    ) -> Result<()> {
        let seqs: Vec<u64> = self.rows.iter().flatten().map(|(_, seq)| *seq).collect();
        let mut found = Vec::with_capacity(columns.len());
        if !seqs.is_empty() {
            let seqs = Arc::new(seqs);
            for (c, column) in columns.iter().enumerate() {
                let data = std::mem::take(&mut self.vectors[c]);
                let (dims, metric) = (column.dims, column.metric);
                let centroids = centroids[c].clone();
                let mut calibrator = std::mem::take(&mut calibrators[c]);
                let seqs = seqs.clone();
                let (clusters, calibrator) = blocking(move || {
                    let clusters = ivf::assign(&data, dims, &centroids, metric);
                    calibrator.add(&data, &seqs, &clusters);
                    (clusters, calibrator)
                })
                .await?;
                calibrators[c] = calibrator;
                found.push(clusters.into_iter());
            }
        }
        for row in self.rows.drain(..) {
            let Some((id, seq)) = row else {
                for slot in &mut out.slots {
                    slot.push(&REPLACED).await?;
                }
                continue;
            };
            let clusters: Vec<u32> = (found.iter_mut())
                .map(|column| column.next().unwrap_or(REPLACED))
                .collect();
            for (c, &cluster) in clusters.iter().enumerate() {
                out.slots[c].push(&cluster).await?;
                out.counts[c][cluster as usize] += 1;
            }
            let page = rows::page_of(&id, out.pages) as u32;
            out.rows.push((page, id, seq, clusters)).await?;
        }
        Ok(())
    }
}

pub(super) async fn store_rows(
    storage: &Storage,
    row_map: Sorter<'_, RowKey>,
    pages: usize,
    written: &mut Written,
) -> Result<(Vec<Hash>, u64)> {
    let mut sorted = row_map.finish().await?;
    let mut next = sorted.next().await?;
    let (mut hashes, mut bytes) = (Vec::with_capacity(pages), 0);
    let mut ready = Vec::new();
    for p in 0..pages {
        let mut page = RowPage::default();
        while let Some((_, id, seq, clusters)) = next.take_if(|row| row.0 as usize == p) {
            page.push(id, seq, &clusters);
            next = sorted.next().await?;
        }
        ready.push(page);
        if ready.len() == PARALLELISM || p + 1 == pages {
            let (stored, sizes) = rows::store(storage, &ready, written).await?;
            hashes.extend(stored);
            bytes += sizes.iter().sum::<u64>();
            ready.clear();
        }
    }
    Ok((hashes, bytes))
}
