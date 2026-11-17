pub(super) const PAD: usize = 8;

pub(super) fn width(max: u32) -> u8 {
    (32 - max.leading_zeros()) as u8
}

pub(super) fn packed_len(count: usize, bits: u8) -> usize {
    (count * bits as usize).div_ceil(8)
}

pub(super) fn pack(values: &[u32], bits: u8, out: &mut Vec<u8>) {
    let (mut held, mut filled) = (0u64, 0u32);
    for &value in values {
        held |= (value as u64) << filled;
        filled += bits as u32;
        while filled >= 8 {
            out.push(held as u8);
            held >>= 8;
            filled -= 8;
        }
    }
    if filled > 0 {
        out.push(held as u8);
    }
}

pub(super) fn unpack(bytes: &[u8], bits: u8, out: &mut [u32]) {
    if bits == 0 {
        out.fill(0);
        return;
    }
    let mask = (1u64 << bits) - 1;
    for (i, value) in out.iter_mut().enumerate() {
        let bit = i * bits as usize;
        let word: [u8; 8] = (bytes.get(bit / 8..bit / 8 + 8))
            .and_then(|eight| eight.try_into().ok())
            .unwrap_or_default();
        *value = ((u64::from_le_bytes(word) >> (bit % 8)) & mask) as u32;
    }
}
