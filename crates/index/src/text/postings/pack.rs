use super::span::BLOCK;

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
    let mut held = [0u8; 4 * BLOCK + PAD];
    let len = packed_len(out.len().min(BLOCK), bits).min(bytes.len());
    held[..len].copy_from_slice(&bytes[..len]);
    let mask = (1u64 << bits) - 1;
    let mut bit = 0usize;
    for value in out.iter_mut().take(BLOCK) {
        let at = bit >> 3;
        let word = u64::from_le_bytes(held[at..at + PAD].try_into().unwrap_or_default());
        *value = ((word >> (bit & 7)) & mask) as u32;
        bit += bits as usize;
    }
}
