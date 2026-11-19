use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Packed {
    pub width: u8,
    pub len: u32,
    pub words: Vec<u64>,
}

impl Packed {
    pub(crate) fn new(values: &[u64]) -> Self {
        let max = values.iter().copied().max().unwrap_or(0);
        let width = (u64::BITS - max.leading_zeros()) as u8;
        let mut words = vec![0u64; (values.len() * width as usize).div_ceil(64)];
        if width > 0 {
            for (i, &value) in values.iter().enumerate() {
                let bit = i * width as usize;
                let (word, shift) = (bit / 64, bit % 64);
                words[word] |= value << shift;
                if shift + width as usize > 64 {
                    words[word + 1] |= value >> (64 - shift);
                }
            }
        }
        Self {
            width,
            len: values.len() as u32,
            words,
        }
    }

    pub(crate) fn get(&self, i: usize) -> u64 {
        let width = self.width as usize;
        if width == 0 {
            return 0;
        }
        let bit = i * width;
        let (word, shift) = (bit / 64, bit % 64);
        let mut value = self.words[word] >> shift;
        if shift + width > 64 {
            value |= self.words[word + 1] << (64 - shift);
        }
        value & mask(width)
    }

    pub(crate) fn unpack(&self) -> Vec<u64> {
        (0..self.len as usize).map(|i| self.get(i)).collect()
    }
}

fn mask(width: usize) -> u64 {
    match width {
        64 => u64::MAX,
        width => (1 << width) - 1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_width_round_trips() {
        for width in 0..=64u32 {
            let top = match width {
                0 => 0,
                64 => u64::MAX,
                w => (1u64 << w) - 1,
            };
            let values: Vec<u64> = (0..300u64)
                .map(|i| i.wrapping_mul(0x9e37_79b9_7f4a_7c15) & top)
                .collect();
            let packed = Packed::new(&values);
            assert!(packed.width as u32 <= width);
            assert_eq!(packed.unpack(), values, "width {width}");
        }
    }
}
