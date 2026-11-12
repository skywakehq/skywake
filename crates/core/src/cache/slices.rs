//! Byte ranges of a chunk that prove themselves against its hash (BLAKE3 verified streaming).

use std::io::{self, Cursor, Read};

use crate::Hash;

pub fn outboard(data: &[u8]) -> Vec<u8> {
    bao::encode::outboard(data).0
}

pub fn extract(
    data: impl Read + io::Seek,
    outboard: &[u8],
    start: u64,
    len: u64,
) -> io::Result<Vec<u8>> {
    let mut slice = Vec::new();
    bao::encode::SliceExtractor::new_outboard(data, Cursor::new(outboard), start, len)
        .read_to_end(&mut slice)?;
    Ok(slice)
}

pub fn verify(slice: &[u8], hash: Hash, start: u64, len: u64) -> io::Result<Vec<u8>> {
    let hash = blake3::Hash::from_bytes(*hash.as_bytes());
    let mut data = Vec::with_capacity(len as usize);
    bao::decode::SliceDecoder::new(slice, &hash, start, len).read_to_end(&mut data)?;
    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_range_proves_itself_and_a_changed_one_does_not() {
        let data: Vec<u8> = (0..1_000_000u32).map(|i| (i * 31 % 251) as u8).collect();
        let hash = Hash::of(&data);
        let tree = outboard(&data);
        let mut slice = extract(Cursor::new(&data), &tree, 300_000, 4096).unwrap();
        assert!(slice.len() < 8192);
        assert_eq!(
            verify(&slice, hash, 300_000, 4096).unwrap(),
            data[300_000..304_096]
        );
        let last = slice.len() - 1;
        slice[last] ^= 1;
        assert!(verify(&slice, hash, 300_000, 4096).is_err());
    }
}
