//! Pass one: which writes are live, found by sorting every write by id, plus a training sample.

use std::collections::HashMap;

use futures::TryStreamExt;

use super::runs::{Runs, Sorter};
use crate::build::segments;
use crate::format::SegmentRef;
use crate::store::Storage;
use crate::vector::ivf;
use crate::{Attributes, Column, Id, Result};

pub(super) struct Sample {
    pub keys: Vec<(Id, u64)>,
    pub vectors: Vec<Vec<f32>>,
    pub attributes: Vec<Attributes>,
}

pub(super) struct Live<'r> {
    pub sample: Sample,
    pub current: Vec<usize>,
    pub live: usize,
    pub doc_rows: u64,
    pub places: Sorter<'r, u64>,
}

pub(super) async fn find<'r>(
    storage: &Storage,
    refs: &[SegmentRef],
    columns: &[Column],
    (want, writes): (usize, u64),
    (runs, limit): (&'r Runs<'r>, usize),
) -> Result<Live<'r>> {
    let mut by_id = Sorter::new(runs, limit);
    let mut sample = Sample {
        keys: Vec::new(),
        vectors: vec![Vec::new(); columns.len()],
        attributes: Vec::new(),
    };
    let mut place = 0;
    let mut pass = segments(storage, refs);
    while let Some((first_seq, segment)) = pass.try_next().await? {
        for (seq, id, row) in segment.writes(first_seq) {
            let at = match row {
                Some(_) => place,
                None => u64::MAX,
            };
            place += row.is_some() as u64;
            by_id.push((id.clone(), seq, at, row.is_some())).await?;
            if let Some(row) = row
                && (row == 0 || ivf::sampled(seq, want, writes))
            {
                sample.keys.push((id.clone(), seq));
                sample.attributes.push(segment.attributes[row].clone());
                for (c, column) in columns.iter().enumerate() {
                    sample.vectors[c].extend(segment.vector(c, column.dims, row));
                }
            }
        }
    }
    drop(pass);
    let doc_rows = place;

    let mut sampled: HashMap<Id, u64> = (sample.keys.iter())
        .map(|(id, _)| (id.clone(), u64::MAX))
        .collect();
    let mut live = 0;
    let mut places = Sorter::new(runs, limit);
    let mut merged = by_id.finish().await?;
    let mut next = merged.next().await?;
    while let Some((id, seq, place, doc)) = next {
        next = merged.next().await?;
        if next.as_ref().is_some_and(|(newer, ..)| *newer == id) {
            continue;
        }
        if let Some(newest) = sampled.get_mut(&id) {
            *newest = seq;
        }
        if doc {
            live += 1;
            places.push(place).await?;
        }
    }
    drop(merged);
    let current: Vec<usize> = (sample.keys.iter().enumerate())
        .filter(|(_, (id, seq))| sampled.get(id) == Some(seq))
        .map(|(i, _)| i)
        .collect();
    Ok(Live {
        sample,
        current,
        live,
        doc_rows,
        places,
    })
}
