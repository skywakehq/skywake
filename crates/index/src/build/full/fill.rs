//! Fills and stores one column's clusters, a group at a time so each group fits the budget.

use futures::TryStreamExt;

use super::REPLACED;
use super::runs::Run;
use super::spill::Spill;
use crate::build::{Coding, groups, segments, store_clusters};
use crate::format::SegmentRef;
use crate::format::cluster::{Cluster, ClusterRef};
use crate::store::{Storage, Written};
use crate::{Attributes, Error, Id, Result};

pub(super) async fn fill(
    storage: &Storage,
    refs: &[SegmentRef],
    (slots, c, counts): (&Run<'_>, usize, &[u64]),
    (budget, row_bytes, spill): (usize, usize, bool),
    coding: &Coding,
    written: &mut Written,
) -> Result<Vec<ClusterRef>> {
    let (dims, k) = (coding.dims, counts.len());
    let all: Vec<usize> = (0..k).collect();
    let grouped = groups(&all, budget, |&cluster| {
        counts[cluster] as usize * row_bytes
    });
    let mut stored = Vec::with_capacity(k);
    if grouped.len() > 1 && spill {
        let mut spilling = Spill::new(&grouped, k)?;
        scan(
            storage,
            refs,
            slots,
            c,
            dims,
            |cluster, id, seq, vector, attrs| spilling.push(cluster, id, seq, vector, attrs),
        )
        .await?;
        let spilled = spilling.finish()?;
        for (g, group) in grouped.iter().enumerate() {
            let mut fill = empty(group, counts, dims);
            for row in spilled.read(g)? {
                let row = row?;
                let cluster = &mut fill[row.cluster as usize - group[0]].1;
                push(cluster, row.id, row.seq, &row.vector, row.attributes);
            }
            stored.extend(store_clusters(storage, fill, coding, written).await?);
        }
    } else {
        for group in &grouped {
            let range = group[0]..group[0] + group.len();
            let mut fill = empty(group, counts, dims);
            scan(
                storage,
                refs,
                slots,
                c,
                dims,
                |cluster, id, seq, vector, attrs| {
                    if range.contains(&cluster) {
                        let cluster = &mut fill[cluster - range.start].1;
                        push(cluster, id.clone(), seq, vector, attrs.clone());
                    }
                    Ok(())
                },
            )
            .await?;
            stored.extend(store_clusters(storage, fill, coding, written).await?);
        }
    }
    Ok(stored)
}

fn empty(group: &[usize], counts: &[u64], dims: usize) -> Vec<(usize, Cluster)> {
    (group.iter())
        .map(|&cluster| {
            let rows = counts[cluster] as usize;
            let fill = Cluster {
                ids: Vec::with_capacity(rows),
                seqs: Vec::with_capacity(rows),
                vectors: Vec::with_capacity(rows * dims),
                attributes: Vec::with_capacity(rows),
            };
            (cluster, fill)
        })
        .collect()
}

fn push(cluster: &mut Cluster, id: Id, seq: u64, vector: &[f32], attributes: Attributes) {
    cluster.ids.push(id);
    cluster.seqs.push(seq);
    cluster.vectors.extend_from_slice(vector);
    cluster.attributes.push(attributes);
}

async fn scan(
    storage: &Storage,
    refs: &[SegmentRef],
    slots: &Run<'_>,
    c: usize,
    dims: usize,
    mut each: impl FnMut(usize, &Id, u64, &[f32], &Attributes) -> Result<()>,
) -> Result<()> {
    let mut slots = slots.read::<u32>()?;
    let mut pass = segments(storage, refs);
    while let Some((first_seq, segment)) = pass.try_next().await? {
        for (seq, id, row) in segment.writes(first_seq) {
            let Some(row) = row else { continue };
            let Some(cluster) = slots.next().await? else {
                return Err(Error::Corrupt("a build's cluster list ended early".into()));
            };
            if cluster != REPLACED {
                let vector = segment.vector(c, dims, row);
                each(cluster as usize, id, seq, vector, &segment.attributes[row])?;
            }
        }
    }
    Ok(())
}
