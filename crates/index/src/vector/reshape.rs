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
    pub splits: Vec<(usize, Vec<usize>)>,
}

impl Plan {
    pub(crate) fn new(sizes: &[u64], centroids: &[f32], column: &Column, most: u64) -> Self {
        let (k, live) = (sizes.len(), sizes.iter().sum::<u64>());
        let mut big: Vec<usize> = (0..k)
            .filter(|&c| sizes[c] >= 2 && (sizes[c] * k as u64 > SPLIT * live || sizes[c] > most))
            .collect();
        big.sort_by_key(|&c| std::cmp::Reverse(sizes[c]));
        let over = big.iter().filter(|&&c| sizes[c] > most).count();
        big.truncate(MAX_SPLITS.max(over));
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
        let parts = |c: usize| match sizes[c] > most {
            true => sizes[c].div_ceil((most / 2).max(1)).max(2) as usize,
            false => 2,
        };
        let splits = (big.into_iter())
            .map(|from| {
                let to = (1..parts(from))
                    .map(|_| {
                        free.pop().unwrap_or_else(|| {
                            next += 1;
                            next - 1
                        })
                    })
                    .collect();
                (from, to)
            })
            .collect();
        Self { merges, splits }
    }

    pub(crate) fn within(mut self, cost: impl Fn(usize) -> u64, budget: u64) -> (Self, u64) {
        let mut left = budget;
        let mut kept = 0;
        for (from, _) in &self.splits {
            let spent = cost(*from);
            if kept > 0 && spent > left {
                break;
            }
            left = left.saturating_sub(spent);
            kept += 1;
        }
        self.splits.truncate(kept);
        let used: HashSet<usize> = self.splits.iter().flat_map(|(_, to)| to).copied().collect();
        self.merges.retain(|(from, _)| used.contains(from));
        for &(from, into) in &self.merges {
            left = left.saturating_sub(cost(from) + cost(into));
        }
        (self, left)
    }

    pub(crate) fn sizes(&self, sizes: &[u64]) -> Vec<u64> {
        let mut after = sizes.to_vec();
        for &(from, into) in &self.merges {
            after[into] += after[from];
            after[from] = 0;
        }
        for (from, to) in &self.splits {
            let whole = after[*from];
            let parts = to.len() as u64 + 1;
            after[*from] = whole - whole / parts * (parts - 1);
            for &to in to {
                if to >= after.len() {
                    after.resize(to + 1, 0);
                }
                after[to] = whole / parts;
            }
        }
        after
    }
}

pub(crate) fn sides(cluster: &Cluster, column: &Column, parts: usize) -> Vec<u32> {
    let dims = column.dims;
    let centroids = ivf::train(&cluster.vectors, dims, parts, column.metric);
    let mut sides = ivf::assign(&cluster.vectors, dims, &centroids, column.metric);
    let first = sides.iter().filter(|&&side| side == sides[0]).count();
    if first == sides.len() {
        let size = sides.len().div_ceil(parts.max(1)).max(1);
        (sides.iter_mut().enumerate()).for_each(|(i, side)| *side = (i / size) as u32);
    }
    sides
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
        let plan = Plan::new(&sizes, &centroids, &column(), u64::MAX);
        assert_eq!(plan.merges, vec![(3, 2)]);
        assert_eq!(plan.splits, vec![(0, vec![3])]);
        assert_eq!(plan.sizes(&sizes), vec![150, 50, 50, 150]);
    }

    #[test]
    fn a_split_without_a_small_cluster_takes_a_new_place() {
        let plan = Plan::new(&[300, 50, 50], &[0.0, 1.0, 2.0], &column(), u64::MAX);
        assert_eq!((plan.merges, plan.splits), (vec![], vec![(0, vec![3])]));
    }

    #[test]
    fn a_budget_keeps_the_biggest_splits_and_the_merges_they_need() {
        let sizes = [300, 250, 10, 50, 50];
        let centroids = [0.0, 10.0, 11.0, 20.0, 30.0];
        let plan = Plan::new(&sizes, &centroids, &column(), 200);
        assert_eq!(plan.splits.len(), 2);
        let (kept, left) = plan.within(|c| sizes[c], 400);
        assert_eq!(kept.splits, vec![(0, vec![2, 5])]);
        assert_eq!(kept.merges, vec![(2, 3)]);
        assert_eq!(left, 40);
    }

    #[test]
    fn small_clusters_stay_when_nothing_splits() {
        assert!(
            Plan::new(&[100, 100, 5], &[0.0, 1.0, 2.0], &column(), u64::MAX)
                .splits
                .is_empty()
        );
    }

    #[test]
    fn every_cluster_past_the_most_rows_splits() {
        let sizes = [500; 12];
        let centroids: Vec<f32> = (0..12).map(|c| c as f32).collect();
        let plan = Plan::new(&sizes, &centroids, &column(), 400);
        assert_eq!(plan.splits.len(), 12);
        assert!(plan.splits.iter().all(|(_, to)| to.len() == 2));
        assert_eq!(plan.sizes(&sizes).len(), 36);
        assert!(plan.sizes(&sizes).iter().all(|&size| size <= 200));
        assert!(
            Plan::new(&sizes, &centroids, &column(), 500)
                .splits
                .is_empty()
        );
    }

    fn cluster_of(rows: u64) -> Cluster {
        Cluster {
            ids: (0..rows).map(Id::from).collect(),
            seqs: (0..rows).collect(),
            vectors: vec![1.0; rows as usize],
            attributes: vec![Default::default(); rows as usize],
        }
    }

    #[test]
    fn rows_all_alike_still_split() {
        let cluster = cluster_of(6);
        let sides = sides(&cluster, &column(), 2);
        assert_eq!(sides.iter().filter(|&&side| side == 0).count(), 3);
        let thirds = super::sides(&cluster_of(9), &column(), 3);
        assert_eq!(thirds, vec![0, 0, 0, 1, 1, 1, 2, 2, 2]);
    }
}
