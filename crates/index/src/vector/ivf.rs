//! k-means clustering (IVF).

use std::ops::Range;
use std::thread;

use crate::Metric;

const SAMPLE_PER_CLUSTER: usize = 64;

const ITERATIONS: usize = 10;

pub(crate) const SEED: u64 = 0x5eed_1dea;

pub(crate) fn clusters_for(rows: usize, per_cluster: usize) -> usize {
    rows.div_ceil(per_cluster.max(1))
}

pub(crate) fn gather(
    vectors: &[f32],
    dims: usize,
    rows: impl IntoIterator<Item = usize>,
) -> Vec<f32> {
    (rows.into_iter())
        .flat_map(|row| &vectors[row * dims..(row + 1) * dims])
        .copied()
        .collect()
}

pub(crate) fn distance(metric: Metric, a: &[f32], b: &[f32]) -> f32 {
    match metric {
        Metric::Cosine => 1.0 - dot(a, b),
        Metric::Euclidean => squared_distance(a, b),
        Metric::Dot => -dot(a, b),
    }
}

pub(crate) fn dot(a: &[f32], b: &[f32]) -> f32 {
    let ((a8, a_rest), (b8, b_rest)) = (a.as_chunks::<8>(), b.as_chunks::<8>());
    let mut sums = [0.0f32; 8];
    for (x, y) in a8.iter().zip(b8) {
        for i in 0..8 {
            sums[i] += x[i] * y[i];
        }
    }
    let tail: f32 = a_rest.iter().zip(b_rest).map(|(x, y)| x * y).sum();
    sums.iter().sum::<f32>() + tail
}

pub(crate) fn squared_distance(a: &[f32], b: &[f32]) -> f32 {
    let ((a8, a_rest), (b8, b_rest)) = (a.as_chunks::<8>(), b.as_chunks::<8>());
    let mut sums = [0.0f32; 8];
    for (x, y) in a8.iter().zip(b8) {
        for i in 0..8 {
            let d = x[i] - y[i];
            sums[i] += d * d;
        }
    }
    let tail: f32 = a_rest
        .iter()
        .zip(b_rest)
        .map(|(x, y)| (x - y) * (x - y))
        .sum();
    sums.iter().sum::<f32>() + tail
}

pub(crate) fn normalize(vector: &mut [f32]) {
    let norm = dot(vector, vector).sqrt();
    if norm > 0.0 {
        vector.iter_mut().for_each(|x| *x /= norm);
    }
}

pub(crate) fn mean(vectors: &[f32], dims: usize) -> Vec<f32> {
    let mut sum = vec![0.0f64; dims];
    let count = vectors.len() / dims.max(1);
    for vector in vectors.chunks_exact(dims.max(1)) {
        sum.iter_mut()
            .zip(vector)
            .for_each(|(s, x)| *s += *x as f64);
    }
    (sum.into_iter())
        .map(|s| (s / count.max(1) as f64) as f32)
        .collect()
}

pub(crate) fn sample_size(clusters: usize) -> usize {
    clusters * SAMPLE_PER_CLUSTER
}

pub(crate) fn sampled(seq: u64, want: usize, total: u64) -> bool {
    let mut random = Random(SEED ^ seq);
    (want as u64) >= total || random.next() % total.max(1) < want as u64
}

pub(crate) fn train(sample: &[f32], dims: usize, k: usize, metric: Metric) -> Vec<f32> {
    let rows = sample.len() / dims;
    let k = k.min(rows);
    if k == 0 {
        return Vec::new();
    }
    let mut random = Random(SEED);
    let picked = random.pick(rows, sample_size(k).min(rows));
    let sample = gather(sample, dims, picked.iter().copied());
    let n = sample.len() / dims;
    let mut centroids = sample[..k * dims].to_vec();
    for _ in 0..ITERATIONS {
        let parts = parallel(n, |range| {
            let mut sums = vec![0.0f32; k * dims];
            let mut counts = vec![0usize; k];
            for row in range {
                let point = &sample[row * dims..(row + 1) * dims];
                let (c, _) = nearest(Metric::Euclidean, point, &centroids, dims);
                counts[c] += 1;
                for (sum, x) in sums[c * dims..(c + 1) * dims].iter_mut().zip(point) {
                    *sum += x;
                }
            }
            (sums, counts)
        });
        let mut sums = vec![0.0f32; k * dims];
        let mut counts = vec![0usize; k];
        for (part_sums, part_counts) in parts {
            sums.iter_mut().zip(part_sums).for_each(|(a, b)| *a += b);
            counts
                .iter_mut()
                .zip(part_counts)
                .for_each(|(a, b)| *a += b);
        }
        for c in 0..k {
            let centroid = &mut centroids[c * dims..(c + 1) * dims];
            if counts[c] == 0 {
                let row = random.below(n);
                centroid.copy_from_slice(&sample[row * dims..(row + 1) * dims]);
                continue;
            }
            let sum = &sums[c * dims..(c + 1) * dims];
            for (x, s) in centroid.iter_mut().zip(sum) {
                *x = s / counts[c] as f32;
            }
            if metric == Metric::Cosine {
                normalize(centroid);
            }
        }
    }
    centroids
}

pub(crate) fn assign(data: &[f32], dims: usize, centroids: &[f32], metric: Metric) -> Vec<u32> {
    parallel(data.len() / dims, |range| {
        range
            .map(|row| {
                nearest(metric, &data[row * dims..(row + 1) * dims], centroids, dims).0 as u32
            })
            .collect::<Vec<_>>()
    })
    .concat()
}

fn nearest(metric: Metric, point: &[f32], centroids: &[f32], dims: usize) -> (usize, f32) {
    centroids
        .chunks_exact(dims)
        .map(|centroid| distance(metric, point, centroid))
        .enumerate()
        .min_by(|a, b| a.1.total_cmp(&b.1))
        .unwrap_or((0, 0.0))
}

pub(crate) fn parallel<T: Send>(n: usize, work: impl Fn(Range<usize>) -> T + Sync) -> Vec<T> {
    let threads = thread::available_parallelism().map_or(1, |n| n.get());
    let size = n.div_ceil(threads).max(1);
    thread::scope(|scope| {
        let work = &work;
        let running: Vec<_> = (0..n)
            .step_by(size)
            .map(|start| scope.spawn(move || work(start..(start + size).min(n))))
            .collect();
        running
            .into_iter()
            .map(|thread| thread.join().expect("an index thread panicked"))
            .collect()
    })
}

pub(crate) struct Random(pub u64);

impl Random {
    pub(crate) fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    pub(crate) fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }

    fn pick(&mut self, n: usize, count: usize) -> Vec<usize> {
        let mut all: Vec<usize> = (0..n).collect();
        for i in 0..count {
            let j = i + self.below(n - i);
            all.swap(i, j);
        }
        all.truncate(count);
        all
    }
}
