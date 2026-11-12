//! Splitting and merging clusters in an incremental build.

use std::collections::HashSet;

use super::ivf;
use crate::format::cluster::Cluster;
use crate::{Column, Metric};

const SPLIT: u64 = 2;

const MERGE: u64 = 4;

const MAX_SPLITS: usize = 8;

#[derive(Debug, Default, PartialEq)]
pub(crate) struct Plan {
    pub merges: Vec<(usize, usize)>,
    pub splits: Vec<(usize, usize)>,
}

impl Plan {
    pub(crate) fn new(sizes: &[u64], centroids: &[f32], column: &Column) -> Self {
        let (k, live) = (sizes.len(), sizes.iter().sum::<u64>());
        let mut big: Vec<usize> = (0..k)
            .filter(|&c| sizes[c] >= 2 && sizes[c] * k as u64 > SPLIT * live)
            .collect();
        big.sort_by_key(|&c| std::cmp::Reverse(sizes[c]));
        big.truncate(MAX_SPLITS);
        let mut small: Vec<usize> = (0..k)
            .filter(|&c| sizes[c] * MERGE * (k as u64) < live)
            .collect();
        small.sort_by_key(|&c| sizes[c]);

        let mut taken: HashSet<usize> = big.iter().copied().collect();
        let mut merges = Vec::new();
        for from in small {
            if merges.len() == big.len() {
                break;
            }
            if taken.contains(&from) {
                continue;
            }
            let centroid = |c: usize| &centroids[c * column.dims..(c + 1) * column.dims];
            let into = (0..k)
                .filter(|&c| c != from && !taken.contains(&c))
                .min_by(|&a, &b| {
                    let distance = |c| ivf::distance(column.metric, centroid(from), centroid(c));
                    distance(a).total_cmp(&distance(b))
                });
            if let Some(into) = into {
                taken.extend([from, into]);
                merges.push((from, into));
            }
        }
        let mut free: Vec<usize> = merges.iter().map(|&(from, _)| from).collect();
        let mut next = k;
        let splits = (big.into_iter())
            .map(|from| {
                let to = free.pop().unwrap_or_else(|| {
                    next += 1;
                    next - 1
                });
                (from, to)
            })
            .collect();
        Self { merges, splits }
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.splits.is_empty()
    }

    pub(crate) fn sizes(&self, sizes: &[u64]) -> Vec<u64> {
        let mut after = sizes.to_vec();
        for &(from, into) in &self.merges {
            after[into] += after[from];
            after[from] = 0;
        }
        for &(from, to) in &self.splits {
            let half = after[from] / 2;
            after[from] -= half;
            match to == after.len() {
                true => after.push(half),
                false => after[to] = half,
            }
        }
        after
    }
}

pub(crate) fn split(cluster: Cluster, column: &Column) -> (Cluster, Cluster) {
    let dims = column.dims;
    let centroids = ivf::train(&cluster.vectors, dims, 2, column.metric);
    let mut sides = ivf::assign(&cluster.vectors, dims, &centroids, column.metric);
    let first = sides.iter().filter(|&&side| side == 0).count();
    if first == 0 || first == sides.len() {
        let half = sides.len() / 2;
        sides
            .iter_mut()
            .enumerate()
            .for_each(|(i, side)| *side = (i >= half) as u32);
    }
    let mut halves = (Cluster::default(), Cluster::default());
    let rows = cluster
        .ids
        .into_iter()
        .zip(cluster.seqs)
        .zip(cluster.attributes);
    for (row, ((id, seq), attributes)) in rows.enumerate() {
        let half = if sides[row] == 0 {
            &mut halves.0
        } else {
            &mut halves.1
        };
        half.ids.push(id);
        half.seqs.push(seq);
        half.vectors
            .extend(&cluster.vectors[row * dims..(row + 1) * dims]);
        half.attributes.push(attributes);
    }
    halves
}

pub(crate) fn merge(into: &mut Cluster, from: Cluster) {
    into.ids.extend(from.ids);
    into.seqs.extend(from.seqs);
    into.vectors.extend(from.vectors);
    into.attributes.extend(from.attributes);
}

pub(crate) fn centroid(cluster: &Cluster, column: &Column) -> Vec<f32> {
    let mut centroid = ivf::mean(&cluster.vectors, column.dims);
    if column.metric == Metric::Cosine {
        ivf::normalize(&mut centroid);
    }
    centroid
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Element, Id};

    fn column() -> Column {
        Column {
            dims: 1,
            metric: Metric::Euclidean,
            element: Element::F32,
        }
    }

    #[test]
    fn a_big_cluster_splits_into_the_place_a_small_one_frees() {
        let sizes = [300, 50, 40, 10];
        let centroids = [0.0, 10.0, 20.0, 21.0];
        let plan = Plan::new(&sizes, &centroids, &column());
        assert_eq!(plan.merges, vec![(3, 2)]);
        assert_eq!(plan.splits, vec![(0, 3)]);
        assert_eq!(plan.sizes(&sizes), vec![150, 50, 50, 150]);
    }

    #[test]
    fn a_split_without_a_small_cluster_takes_a_new_place() {
        let plan = Plan::new(&[300, 50, 50], &[0.0, 1.0, 2.0], &column());
        assert_eq!((plan.merges, plan.splits), (vec![], vec![(0, 3)]));
    }

    #[test]
    fn small_clusters_stay_when_nothing_splits() {
        assert!(Plan::new(&[100, 100, 5], &[0.0, 1.0, 2.0], &column()).is_empty());
    }

    #[test]
    fn rows_all_alike_still_split_in_two() {
        let cluster = Cluster {
            ids: (0..6u64).map(Id::from).collect(),
            seqs: (0..6).collect(),
            vectors: vec![1.0; 6],
            attributes: vec![Default::default(); 6],
        };
        let (a, b) = split(cluster, &column());
        assert_eq!((a.ids.len(), b.ids.len()), (3, 3));
    }
}
