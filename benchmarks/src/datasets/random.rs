//! SplitMix64, so generated data is the same on every run.

pub(crate) const GOLDEN: u64 = 0x9e37_79b9_7f4a_7c15;

pub(crate) fn mix(mut z: u64) -> u64 {
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^ (z >> 31)
}

pub(crate) struct Random(pub u64);

impl Random {
    pub(crate) fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(GOLDEN);
        mix(self.0)
    }

    pub(crate) fn unit(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }

    pub(crate) fn normal(&mut self) -> f32 {
        let unit = |r: &mut Self| (r.next() >> 40) as f32 / (1u64 << 24) as f32;
        let u = unit(self).max(1e-7);
        (-2.0 * u.ln()).sqrt() * (std::f32::consts::TAU * unit(self)).cos()
    }
}
