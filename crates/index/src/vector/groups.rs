//! Pieces of the cluster table that share a centroid, and assigning new rows to them.

use std::collections::HashMap;

use super::ivf;
use crate::{Column, Metric};

const FLAT: usize = 256;

const LEAST_TOPS: usize = 4;

const TOP_SHARE: usize = 8;

pub(crate) struct Groups {
    dims: usize,
    pub of: Vec<u32>,
    pub members: Vec<Vec<u32>>,
    pub centroids: Vec<f32>,
}

impl Groups {
    pub(crate) fn new(centroids: &[f32], dims: usize) -> Self {
        let mut groups = Self {
            dims,
            of: Vec::new(),
            members: Vec::new(),
            centroids: Vec::new(),
        };
        let mut known: HashMap<u64, Vec<u32>> = HashMap::new();
        for (c, centroid) in centroids.chunks_exact(dims.max(1)).enumerate() {
            let candidates = known.entry(key(centroid)).or_default();
            let found =
                (candidates.iter().copied()).find(|&g| same(groups.centroid(g as usize), centroid));
            let g = found.unwrap_or_else(|| {
                let g = groups.members.len() as u32;
                candidates.push(g);
                groups.members.push(Vec::new());
                groups.centroids.extend_from_slice(centroid);
                g
            });
            groups.members[g as usize].push(c as u32);
            groups.of.push(g);
        }
        groups
    }

    pub(crate) fn count(centroids: &[f32], dims: usize) -> u64 {
        Self::new(centroids, dims).len() as u64
    }

    pub(crate) fn len(&self) -> usize {
        self.members.len()
    }

    pub(crate) fn centroid(&self, g: usize) -> &[f32] {
        &self.centroids[g * self.dims..(g + 1) * self.dims]
    }
}

fn key(centroid: &[f32]) -> u64 {
    centroid.iter().fold(0xcbf2_9ce4_8422_2325u64, |h, x| {
        (h ^ x.to_bits() as u64).wrapping_mul(0x0000_0100_0000_01b3)
    })
}

fn same(a: &[f32], b: &[f32]) -> bool {
    a.iter().zip(b).all(|(x, y)| x.to_bits() == y.to_bits())
}

pub(crate) fn assign(data: &[f32], centroids: &[f32], column: &Column) -> Vec<u32> {
    let (dims, metric) = (column.dims, column.metric);
    let count = centroids.len() / dims.max(1);
    if count <= FLAT || data.is_empty() {
        return ivf::assign(data, dims, centroids, metric);
    }
    let tops = ivf::train(
        centroids,
        dims,
        (count as f64).sqrt().ceil() as usize,
        Metric::Euclidean,
    );
    let k = tops.len() / dims;
    let mut under: Vec<Vec<u32>> = vec![Vec::new(); k];
    for (c, top) in ivf::assign(centroids, dims, &tops, Metric::Euclidean)
        .into_iter()
        .enumerate()
    {
        under[top as usize].push(c as u32);
    }
    let probes = (k / TOP_SHARE).max(LEAST_TOPS).min(k);
    let rows = data.len() / dims;
    ivf::parallel(rows, |range| {
        let mut near: Vec<(f32, usize)> = Vec::with_capacity(k);
        range
            .map(|row| {
                let point = &data[row * dims..(row + 1) * dims];
                near.clear();
                near.extend(
                    (tops.chunks_exact(dims))
                        .map(|top| ivf::squared_distance(point, top))
                        .zip(0..),
                );
                near.select_nth_unstable_by(probes - 1, |a, b| a.0.total_cmp(&b.0));
                let candidates = near[..probes].iter().flat_map(|&(_, t)| &under[t]);
                let mut best = (u32::MAX, f32::INFINITY);
                for &c in candidates {
                    let c = c as usize;
                    let d = ivf::distance(metric, point, &centroids[c * dims..(c + 1) * dims]);
                    if d < best.1 || (d == best.1 && (c as u32) < best.0) {
                        best = (c as u32, d);
                    }
                }
                best.0
            })
            .collect::<Vec<u32>>()
    })
    .concat()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Element;

    #[test]
    fn equal_centroids_make_one_group() {
        let centroids = [0.0, 1.0, 5.0, 5.0, 0.0, 1.0, 2.0, 2.0];
        let groups = Groups::new(&centroids, 2);
        assert_eq!(groups.of, vec![0, 1, 0, 2]);
        assert_eq!(groups.members, vec![vec![0, 2], vec![1], vec![3]]);
        assert_eq!(groups.centroid(2), &[2.0, 2.0]);
    }

    #[test]
    fn many_centroids_still_find_the_nearest_for_rows_near_them() {
        let dims = 8;
        let mut random = ivf::Random(3);
        let centroids: Vec<f32> = (0..1000 * dims)
            .map(|_| (random.next() % 10_000) as f32 / 100.0)
            .collect();
        let data: Vec<f32> = (centroids.chunks_exact(dims).step_by(7))
            .flat_map(|c| c.iter().map(|x| x + 0.01))
            .collect();
        let column = Column {
            dims,
            metric: Metric::Euclidean,
            element: Element::F32,
        };
        let found = assign(&data, &centroids, &column);
        let exact = ivf::assign(&data, dims, &centroids, Metric::Euclidean);
        assert_eq!(found, exact);
    }
}
