//! Internals wrapped for the crate's microbenchmarks, behind the `bench` feature.

use crate::filter::{BlockRef, Directory};
use crate::vector::ivf::{dot, squared_distance};
use crate::vector::rabitq::{self, Anchor, Estimator, Prepared, Rotation};
use crate::{Filter, Metric, Value};

pub struct Coder {
    rotation: Rotation,
    anchor: Vec<f32>,
    origin: Vec<f32>,
    lift: Vec<f32>,
}

impl Coder {
    pub fn new(seed: u64, anchor: Vec<f32>, origin: Vec<f32>) -> Self {
        let rotation = Rotation::new(anchor.len(), seed);
        let lift = rotation.difference(&anchor, &origin);
        Self {
            rotation,
            anchor,
            origin,
            lift,
        }
    }

    pub fn words(&self) -> usize {
        rabitq::words(self.anchor.len())
    }

    pub fn encode(&self, vector: &[f32], bits: &mut [u64]) -> [f32; 4] {
        rabitq::encode(&self.rotation, &self.anchor, &self.lift, vector, bits)
    }

    pub fn scorer(&self, metric: Metric, query: &[f32]) -> Scorer {
        let estimator = Estimator::new(metric, self.anchor.len());
        let prepared = estimator.prepare(&self.rotation.difference(query, &self.origin));
        let anchor = Anchor {
            norm: squared_distance(query, &self.anchor).sqrt(),
            to_anchor: dot(query, &self.anchor),
        };
        Scorer {
            estimator,
            prepared,
            anchor,
        }
    }
}

pub struct Scorer {
    estimator: Estimator,
    prepared: Prepared,
    anchor: Anchor,
}

impl Scorer {
    pub fn estimate(&self, bits: &[u64], factors: &[f32; 4]) -> (f32, f32) {
        (self.estimator).estimate(&self.prepared, &self.anchor, bits, factors)
    }
}

pub struct Blocks(Directory);

impl Blocks {
    pub fn numbers(firsts: impl IntoIterator<Item = f64>) -> Self {
        let block = |first| BlockRef {
            first: Value::Number(first),
            rows: 0,
            blob: 0,
            start: 0,
            end: 0,
            check: 0,
        };
        Self(Directory {
            blocks: firsts.into_iter().map(block).collect(),
        })
    }

    pub fn find(&self, clause: &Filter) -> Option<Vec<usize>> {
        self.0.blocks(clause)
    }
}
