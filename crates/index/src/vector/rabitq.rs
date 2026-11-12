//! RaBitQ (Gao and Long, SIGMOD 2024).

use super::ivf::{Random, dot};
use crate::Metric;

const EPSILON: f32 = 1.9;

const ROUNDS: usize = 3;

const QUERY_BITS: usize = 8;

pub(crate) type Factors = [f32; 4];

pub(crate) fn words(dims: usize) -> usize {
    dims.div_ceil(64)
}

pub(crate) struct Rotation {
    dims: usize,
    block: usize,
    signs: Vec<f32>,
}

impl Rotation {
    pub(crate) fn new(dims: usize, seed: u64) -> Self {
        let mut random = Random(seed);
        let signs = (0..ROUNDS * 2 * dims)
            .map(|_| if random.next() & 1 == 0 { 1.0 } else { -1.0 })
            .collect();
        Self {
            dims,
            block: if dims == 0 { 0 } else { 1 << dims.ilog2() },
            signs,
        }
    }

    pub(crate) fn apply(&self, v: &mut [f32]) {
        let (dims, block) = (self.dims, self.block);
        for round in self.signs.chunks_exact(2 * dims) {
            let (first, second) = round.split_at(dims);
            v.iter_mut().zip(first).for_each(|(x, s)| *x *= s);
            hadamard(&mut v[..block]);
            v.iter_mut().zip(second).for_each(|(x, s)| *x *= s);
            hadamard(&mut v[dims - block..]);
        }
    }

    pub(crate) fn difference(&self, a: &[f32], b: &[f32]) -> Vec<f32> {
        let mut v: Vec<f32> = a.iter().zip(b).map(|(x, y)| x - y).collect();
        self.apply(&mut v);
        v
    }
}

fn hadamard(v: &mut [f32]) {
    let n = v.len();
    let mut half = 1;
    while half < n {
        for pair in v.chunks_exact_mut(2 * half) {
            let (a, b) = pair.split_at_mut(half);
            for (x, y) in a.iter_mut().zip(b) {
                (*x, *y) = (*x + *y, *x - *y);
            }
        }
        half *= 2;
    }
    let scale = 1.0 / (n as f32).sqrt();
    v.iter_mut().for_each(|x| *x *= scale);
}

pub(crate) fn encode(
    rotation: &Rotation,
    anchor: &[f32],
    lift: &[f32],
    vector: &[f32],
    bits: &mut [u64],
) -> Factors {
    let mut residual: Vec<f32> = vector.iter().zip(anchor).map(|(x, c)| x - c).collect();
    let norm = dot(&residual, &residual).sqrt();
    let to_anchor = dot(&residual, anchor);
    bits.fill(0);
    if norm == 0.0 {
        return [0.0, 1.0, to_anchor, 0.0];
    }
    rotation.apply(&mut residual);
    let (mut sum, mut on_lift) = (0.0, 0.0);
    for (i, (x, l)) in residual.iter().zip(lift).enumerate() {
        if *x > 0.0 {
            bits[i / 64] |= 1 << (i % 64);
            on_lift += l;
        } else {
            on_lift -= l;
        }
        sum += x.abs();
    }
    let root = (vector.len() as f32).sqrt();
    [norm, sum / norm / root, to_anchor, on_lift / root]
}

pub(crate) struct Prepared {
    planes: Vec<u64>,
    low: f32,
    step: f32,
    sum: f32,
    rounding: f32,
}

pub(crate) struct Anchor {
    pub norm: f32,
    pub to_anchor: f32,
}

pub(crate) struct Estimator {
    metric: Metric,
    dims: usize,
    root: f32,
    bound: f32,
}

impl Estimator {
    pub(crate) fn new(metric: Metric, dims: usize) -> Self {
        let bound = match dims {
            0 | 1 => 1e30,
            _ => EPSILON / ((dims - 1) as f32).sqrt(),
        };
        Self {
            metric,
            dims,
            root: (dims as f32).sqrt(),
            bound,
        }
    }

    pub(crate) fn prepare(&self, query: &[f32]) -> Prepared {
        let words = words(self.dims);
        let mut prepared = Prepared {
            planes: vec![0; QUERY_BITS * words],
            low: 0.0,
            step: 0.0,
            sum: query.iter().sum(),
            rounding: 0.0,
        };
        let low = query.iter().copied().fold(f32::INFINITY, f32::min);
        let high = query.iter().copied().fold(f32::NEG_INFINITY, f32::max);
        let step = (high - low) / ((1 << QUERY_BITS) - 1) as f32;
        let (mut over, mut under) = (0.0f32, 0.0f32);
        for (i, x) in query.iter().enumerate() {
            let level = match step > 0.0 {
                true => ((x - low) / step).round() as u32,
                false => 0,
            };
            let error = x - (low + step * level as f32);
            match error > 0.0 {
                true => over += error,
                false => under -= error,
            }
            for j in 0..QUERY_BITS {
                if level >> j & 1 == 1 {
                    prepared.planes[j * words + i / 64] |= 1 << (i % 64);
                }
            }
        }
        prepared.low = low;
        prepared.step = step;
        prepared.rounding = 2.0 * over.max(under) / self.root;
        prepared
    }

    pub(crate) fn estimate(
        &self,
        query: &Prepared,
        anchor: &Anchor,
        bits: &[u64],
        factors: &Factors,
    ) -> (f32, f32) {
        let [norm, aligned, to_anchor, on_lift] = *factors;
        let ones: u32 = bits.iter().map(|w| w.count_ones()).sum();
        let picked = query.low * ones as f32 + query.step * levels(bits, &query.planes) as f32;
        let (along, rounding) = match anchor.norm > 0.0 {
            true => (
                ((2.0 * picked - query.sum) / self.root - on_lift) / anchor.norm,
                query.rounding / anchor.norm,
            ),
            false => (0.0, 0.0),
        };
        let cosine = along / aligned;
        let spread = (1.0 - aligned * aligned).max(0.0).sqrt() * self.bound;
        let error = (spread + rounding) / aligned;
        let scale = norm * anchor.norm;
        let (distance, bound) = match self.metric {
            Metric::Euclidean => (
                norm * norm + anchor.norm * anchor.norm - 2.0 * scale * cosine,
                2.0 * scale * error,
            ),
            Metric::Dot => (
                -(scale * cosine + to_anchor + anchor.to_anchor),
                scale * error,
            ),
            Metric::Cosine => (
                1.0 - (scale * cosine + to_anchor + anchor.to_anchor),
                scale * error,
            ),
        };
        (distance, bound + 1e-4 * (1.0 + distance.abs()))
    }
}

fn levels(bits: &[u64], planes: &[u64]) -> u32 {
    let mut total = 0;
    for (j, plane) in planes.chunks_exact(bits.len()).enumerate() {
        let count: u32 = bits
            .iter()
            .zip(plane)
            .map(|(a, b)| (a & b).count_ones())
            .sum();
        total += count << j;
    }
    total
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vector::ivf;

    fn normal(random: &mut Random) -> f32 {
        let unit = |r: &mut Random| (r.next() >> 40) as f32 / (1u64 << 24) as f32;
        let u = unit(random).max(1e-7);
        (-2.0 * u.ln()).sqrt() * (std::f32::consts::TAU * unit(random)).cos()
    }

    fn vector(random: &mut Random, dims: usize) -> Vec<f32> {
        (0..dims).map(|_| normal(random)).collect()
    }

    #[test]
    fn the_rotation_keeps_lengths_and_angles() {
        let mut random = Random(1);
        for dims in [1, 2, 7, 64, 100, 768] {
            let rotation = Rotation::new(dims, 9);
            let (a, b) = (vector(&mut random, dims), vector(&mut random, dims));
            let (mut ra, mut rb) = (a.clone(), b.clone());
            rotation.apply(&mut ra);
            rotation.apply(&mut rb);
            let close = |x: f32, y: f32| (x - y).abs() <= 1e-3 * (1.0 + x.abs());
            assert!(close(dot(&a, &a), dot(&ra, &ra)), "{dims}");
            assert!(close(dot(&a, &b), dot(&ra, &rb)), "{dims}");
        }
    }

    fn held(metric: Metric, dims: usize) -> f64 {
        let mut random = Random(7);
        let rotation = Rotation::new(dims, 3);
        let estimator = Estimator::new(metric, dims);
        let unit = |mut v: Vec<f32>| {
            if metric == Metric::Cosine {
                ivf::normalize(&mut v);
            }
            v
        };
        let centroid = unit(vector(&mut random, dims));
        let origin: Vec<f32> = (0..dims).map(|_| 0.3 * normal(&mut random)).collect();
        let lift = rotation.difference(&centroid, &origin);
        let rows: Vec<Vec<f32>> = (0..500)
            .map(|_| {
                let noise = vector(&mut random, dims);
                unit(
                    centroid
                        .iter()
                        .zip(noise)
                        .map(|(c, n)| c + 0.5 * n)
                        .collect(),
                )
            })
            .collect();
        let mut bits = vec![0; words(dims)];
        let codes: Vec<(Vec<u64>, Factors)> = rows
            .iter()
            .map(|row| {
                let factors = encode(&rotation, &centroid, &lift, row, &mut bits);
                (bits.clone(), factors)
            })
            .collect();
        let (mut ok, mut all) = (0, 0);
        for _ in 0..20 {
            let query = unit(vector(&mut random, dims));
            let prepared = estimator.prepare(&rotation.difference(&query, &origin));
            let anchor = Anchor {
                norm: ivf::distance(Metric::Euclidean, &query, &centroid).sqrt(),
                to_anchor: dot(&query, &centroid),
            };
            for (row, (bits, factors)) in rows.iter().zip(&codes) {
                let (estimate, bound) = estimator.estimate(&prepared, &anchor, bits, factors);
                let exact = ivf::distance(metric, &query, row);
                ok += usize::from((estimate - exact).abs() <= bound);
                all += 1;
            }
        }
        ok as f64 / all as f64
    }

    #[test]
    fn the_error_bound_holds_for_at_least_94_percent_of_rows() {
        for metric in [Metric::Euclidean, Metric::Dot, Metric::Cosine] {
            for dims in [16, 128, 768] {
                let rate = held(metric, dims);
                assert!(rate >= 0.94, "{metric:?} {dims}: {rate}");
            }
        }
    }

    #[test]
    fn a_row_at_its_centroid_is_exact() {
        let dims = 32;
        let rotation = Rotation::new(dims, 1);
        let estimator = Estimator::new(Metric::Euclidean, dims);
        let centroid = vec![0.5; dims];
        let origin = vec![0.0; dims];
        let lift = rotation.difference(&centroid, &origin);
        let mut bits = vec![0; words(dims)];
        let factors = encode(&rotation, &centroid, &lift, &centroid, &mut bits);
        let mut query = vec![0.0; dims];
        query[3] = 2.0;
        let exact = ivf::distance(Metric::Euclidean, &query, &centroid);
        let prepared = estimator.prepare(&rotation.difference(&query, &origin));
        let anchor = Anchor {
            norm: exact.sqrt(),
            to_anchor: dot(&query, &centroid),
        };
        let (estimate, bound) = estimator.estimate(&prepared, &anchor, &bits, &factors);
        assert!((estimate - exact).abs() < 1e-3 && bound < 1e-2);
    }
}
