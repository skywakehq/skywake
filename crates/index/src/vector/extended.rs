//! Extended RaBitQ (Gao et al., SIGMOD 2025): four bits a dimension, kept beside the one-bit codes
//! and read only for the rows still in contention after them.

use super::ivf::dot;
use super::rabitq::{Anchor, Estimator, Rotation};

pub(crate) const FROM_DIMS: usize = 256;

const LEVELS: usize = 16;

const HALF: f32 = (LEVELS - 1) as f32 / 2.0;

const SPREAD: f32 = 0.335;

const TRIES: usize = 16;

const FACTORS: usize = 3 * 4;

const CHECK: usize = 4;

pub(crate) fn wanted(dims: usize) -> bool {
    dims >= FROM_DIMS
}

pub(crate) fn record(dims: usize) -> usize {
    dims.div_ceil(2) + FACTORS + CHECK
}

pub(crate) fn encode(
    rotation: &Rotation,
    anchor: &[f32],
    lift: &[f32],
    vector: &[f32],
    out: &mut [u8],
) {
    let dims = vector.len();
    let mut residual: Vec<f32> = vector.iter().zip(anchor).map(|(x, c)| x - c).collect();
    let norm = dot(&residual, &residual).sqrt();
    out.fill(0);
    let (nibbles, rest) = out.split_at_mut(dims.div_ceil(2));
    let mut factors = [1.0, 0.0, 0.0];
    if norm > 0.0 {
        rotation.apply(&mut residual);
        residual.iter_mut().for_each(|x| *x /= norm);
        let levels = best_levels(&residual);
        let grid: Vec<f32> = levels.iter().map(|&l| l as f32 - HALF).collect();
        let length = dot(&grid, &grid).sqrt();
        factors = [
            dot(&residual, &grid) / length,
            dot(lift, &grid),
            1.0 / length,
        ];
        for (i, level) in levels.iter().enumerate() {
            nibbles[i / 2] |= level << (4 * (i % 2));
        }
    }
    for (at, factor) in factors.iter().enumerate() {
        rest[4 * at..4 * at + 4].copy_from_slice(&factor.to_le_bytes());
    }
    let sealed = out.len() - CHECK;
    let check = seal(&out[..sealed]);
    out[sealed..].copy_from_slice(&check);
}

fn best_levels(unit: &[f32]) -> Vec<u8> {
    let around = (unit.len() as f32).sqrt() / SPREAD;
    let mut best = (f32::NEG_INFINITY, Vec::new());
    for t in 0..=TRIES {
        let scale = around * (0.5 + t as f32 / TRIES as f32);
        let levels: Vec<u8> = (unit.iter())
            .map(|x| {
                (x * scale + HALF + 0.5)
                    .floor()
                    .clamp(0.0, (LEVELS - 1) as f32) as u8
            })
            .collect();
        let (mut along, mut length) = (0.0, 0.0);
        for (x, &level) in unit.iter().zip(&levels) {
            let y = level as f32 - HALF;
            along += x * y;
            length += y * y;
        }
        let aligned = along / length.sqrt();
        if aligned > best.0 {
            best = (aligned, levels);
        }
    }
    best.1
}

fn seal(bytes: &[u8]) -> [u8; CHECK] {
    blake3::hash(bytes).as_bytes()[..CHECK].try_into().unwrap()
}

pub(crate) fn intact(record: &[u8]) -> bool {
    let sealed = record.len() - CHECK;
    seal(&record[..sealed]) == record[sealed..]
}

pub(crate) struct Prepared {
    dims: usize,
    low: Vec<f32>,
    high: Vec<f32>,
    sum: f32,
}

impl Prepared {
    pub(crate) fn new(rotated: Vec<f32>) -> Self {
        let dims = rotated.len();
        let pairs = dims.div_ceil(2);
        let (mut low, mut high) = (vec![0.0; pairs], vec![0.0; pairs]);
        for (i, x) in rotated.iter().enumerate() {
            match i % 2 {
                0 => low[i / 2] = *x,
                _ => high[i / 2] = *x,
            }
        }
        let sum = rotated.iter().sum();
        Self {
            dims,
            low,
            high,
            sum,
        }
    }

    fn along_grid(&self, nibbles: &[u8]) -> f32 {
        let (bytes, rest) = nibbles.as_chunks::<16>();
        let (lows, low_rest) = self.low.as_chunks::<16>();
        let (highs, high_rest) = self.high.as_chunks::<16>();
        let mut sums = [0.0f32; 16];
        for ((byte, low), high) in bytes.iter().zip(lows).zip(highs) {
            for i in 0..16 {
                sums[i] += low[i] * (byte[i] & 15) as f32 + high[i] * (byte[i] >> 4) as f32;
            }
        }
        let tail: f32 = (rest.iter().zip(low_rest).zip(high_rest))
            .map(|((byte, low), high)| low * (byte & 15) as f32 + high * (byte >> 4) as f32)
            .sum();
        sums.iter().sum::<f32>() + tail - HALF * self.sum
    }
}

pub(crate) fn estimate(
    estimator: &Estimator,
    query: &Prepared,
    anchor: &Anchor,
    record: &[u8],
    norm: f32,
    to_anchor: f32,
) -> (f32, f32) {
    let (nibbles, rest) = record.split_at(query.dims.div_ceil(2));
    let factor = |at: usize| f32::from_le_bytes(rest[4 * at..4 * at + 4].try_into().unwrap());
    let (aligned, lift, inverse) = (factor(0), factor(1), factor(2));
    let along = match anchor.norm > 0.0 {
        true => (query.along_grid(nibbles) - lift) * inverse / anchor.norm,
        false => 0.0,
    };
    estimator.finish(anchor, [norm, aligned, to_anchor], along, 0.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Metric;
    use crate::vector::ivf::{self, Random};
    use crate::vector::rabitq::{self, Factors};

    fn normal(random: &mut Random) -> f32 {
        let unit = |r: &mut Random| (r.next() >> 40) as f32 / (1u64 << 24) as f32;
        let u = unit(random).max(1e-7);
        (-2.0 * u.ln()).sqrt() * (std::f32::consts::TAU * unit(random)).cos()
    }

    struct Case {
        held: f64,
        one_bit_error: f64,
        error: f64,
    }

    fn case(metric: Metric, dims: usize, far: bool) -> Case {
        let mut random = Random(11);
        let rotation = Rotation::new(dims, 5);
        let estimator = Estimator::new(metric, dims);
        let unit = |mut v: Vec<f32>| {
            if metric == Metric::Cosine {
                ivf::normalize(&mut v);
            }
            v
        };
        let centroid = unit((0..dims).map(|_| normal(&mut random)).collect());
        let origin: Vec<f32> = (0..dims).map(|_| 0.3 * normal(&mut random)).collect();
        let lift = rotation.difference(&centroid, &origin);
        let rows: Vec<Vec<f32>> = (0..300)
            .map(|_| {
                let v = centroid.iter().map(|c| c + 0.5 * normal(&mut random));
                unit(v.collect())
            })
            .collect();
        let mut bits = vec![0; rabitq::words(dims)];
        let mut record_bytes = vec![0u8; record(dims)];
        let codes: Vec<(Vec<u64>, Factors, Vec<u8>)> = (rows.iter())
            .map(|row| {
                let factors = rabitq::encode(&rotation, &centroid, &lift, row, &mut bits);
                encode(&rotation, &centroid, &lift, row, &mut record_bytes);
                assert!(intact(&record_bytes));
                (bits.clone(), factors, record_bytes.clone())
            })
            .collect();
        let (mut held, mut all, mut one_bit_error, mut error) = (0, 0, 0.0, 0.0);
        for _ in 0..20 {
            let query = unit(match far {
                true => (0..dims)
                    .map(|_| (random.next() >> 40) as f32 / 1.6e7)
                    .collect(),
                false => (0..dims).map(|_| normal(&mut random)).collect(),
            });
            let rotated = rotation.difference(&query, &origin);
            let one_bit = estimator.prepare(&rotated);
            let prepared = Prepared::new(rotated);
            let anchor = Anchor {
                norm: ivf::distance(Metric::Euclidean, &query, &centroid).sqrt(),
                to_anchor: dot(&query, &centroid),
            };
            for (row, (bits, factors, record)) in rows.iter().zip(&codes) {
                let exact = ivf::distance(metric, &query, row);
                let (rough, _) = estimator.estimate(&one_bit, &anchor, bits, factors);
                let (fine, bound) = estimate(
                    &estimator, &prepared, &anchor, record, factors[0], factors[2],
                );
                held += usize::from((fine - exact).abs() <= bound);
                one_bit_error += (rough - exact).abs() as f64;
                error += (fine - exact).abs() as f64;
                all += 1;
            }
        }
        Case {
            held: held as f64 / all as f64,
            one_bit_error: one_bit_error / all as f64,
            error: error / all as f64,
        }
    }

    #[test]
    fn four_bits_bound_their_error_and_beat_one_bit_by_far() {
        for metric in [Metric::Euclidean, Metric::Dot, Metric::Cosine] {
            for dims in [16, 128, 768, 1024] {
                for far in [false, true] {
                    let found = case(metric, dims, far);
                    let name = format!("{metric:?} {dims} far {far}");
                    assert!(found.held >= 0.92, "{name}: held {}", found.held);
                    assert!(
                        found.error * 5.0 <= found.one_bit_error,
                        "{name}: {} against {}",
                        found.error,
                        found.one_bit_error
                    );
                }
            }
        }
    }

    #[test]
    fn a_damaged_record_is_caught() {
        let dims = 64;
        let rotation = Rotation::new(dims, 1);
        let centroid = vec![0.1; dims];
        let lift = rotation.difference(&centroid, &vec![0.0; dims]);
        let row: Vec<f32> = (0..dims).map(|i| i as f32 / 64.0).collect();
        let mut out = vec![0u8; record(dims)];
        encode(&rotation, &centroid, &lift, &row, &mut out);
        assert!(intact(&out));
        out[3] ^= 1;
        assert!(!intact(&out));
    }
}
