//! Records kept on local disk in 4,096 slices by the first 12 bits of a hash, so a collection holds one slice in memory at a time.

use std::fs::OpenOptions;
use std::io::{self, Write};

use tempfile::TempDir;

use crate::{Bundled, Chunk, Hash};

pub(super) const SLICES: usize = 4096;

const BUFFER: usize = 2 * 1024;

pub(super) const HASH: usize = 32;
pub(super) const FILE: usize = 32 + 32 + 4 + 4 + 4;

pub(super) fn slice_of(hash: Hash) -> usize {
    let bytes = hash.as_bytes();
    (usize::from(bytes[0]) << 4) | usize::from(bytes[1] >> 4)
}

pub(super) struct Spill {
    dir: TempDir,
    buffers: Vec<Vec<u8>>,
    pub(super) count: u64,
}

impl Spill {
    pub(super) fn new() -> io::Result<Self> {
        Ok(Self {
            dir: tempfile::Builder::new().prefix("skywake-gc-").tempdir()?,
            buffers: vec![Vec::new(); SLICES],
            count: 0,
        })
    }

    pub(super) fn push(&mut self, key: Hash, record: &[u8]) -> io::Result<()> {
        let slice = slice_of(key);
        self.count += 1;
        self.buffers[slice].extend_from_slice(record);
        if self.buffers[slice].len() >= BUFFER {
            self.flush(slice)?;
        }
        Ok(())
    }

    pub(super) fn hash(&mut self, hash: Hash) -> io::Result<()> {
        self.push(hash, hash.as_bytes())
    }

    pub(super) fn file(&mut self, file: &Bundled) -> io::Result<()> {
        self.push(file.bundle, &encode_file(file))
    }

    fn flush(&mut self, slice: usize) -> io::Result<()> {
        let buffer = std::mem::take(&mut self.buffers[slice]);
        if buffer.is_empty() {
            return Ok(());
        }
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.dir.path().join(slice.to_string()))?
            .write_all(&buffer)
    }

    pub(super) fn take(&mut self, slice: usize) -> io::Result<Vec<u8>> {
        let bytes = self.read(slice)?;
        match std::fs::remove_file(self.dir.path().join(slice.to_string())) {
            Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
            _ => Ok(bytes),
        }
    }

    pub(super) fn read(&mut self, slice: usize) -> io::Result<Vec<u8>> {
        self.flush(slice)?;
        match std::fs::read(self.dir.path().join(slice.to_string())) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Vec::new()),
            read => read,
        }
    }
}

pub(super) fn hashes(bytes: &[u8]) -> Vec<Hash> {
    let (records, _) = bytes.as_chunks::<HASH>();
    let mut hashes: Vec<Hash> = records
        .iter()
        .map(|record| Hash::from_bytes(*record))
        .collect();
    hashes.sort_unstable_by_key(|hash| *hash.as_bytes());
    hashes.dedup();
    hashes
}

pub(super) fn files(bytes: &[u8]) -> Vec<Bundled> {
    let (records, _) = bytes.as_chunks::<FILE>();
    let mut files: Vec<Bundled> = records.iter().map(decode_file).collect();
    files.sort_unstable_by_key(|file| (*file.bundle.as_bytes(), file.offset));
    files.dedup_by_key(|file| (file.bundle, file.offset));
    files
}

pub(super) fn contains(hashes: &[Hash], hash: Hash) -> bool {
    hashes
        .binary_search_by_key(hash.as_bytes(), |hash| *hash.as_bytes())
        .is_ok()
}

pub(super) fn encode_file(file: &Bundled) -> [u8; FILE] {
    let mut record = [0; FILE];
    record[..32].copy_from_slice(file.bundle.as_bytes());
    record[32..64].copy_from_slice(file.chunk.hash.as_bytes());
    record[64..68].copy_from_slice(&file.chunk.size.to_le_bytes());
    record[68..72].copy_from_slice(&file.offset.to_le_bytes());
    record[72..].copy_from_slice(&file.len.to_le_bytes());
    record
}

fn decode_file(record: &[u8; FILE]) -> Bundled {
    let hash = |at: usize| Hash::from_bytes(record[at..at + 32].try_into().expect("32 bytes"));
    let int = |at: usize| u32::from_le_bytes(record[at..at + 4].try_into().expect("4 bytes"));
    Bundled {
        bundle: hash(0),
        chunk: Chunk {
            hash: hash(32),
            size: int(64),
        },
        offset: int(68),
        len: int(72),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hash(first: u8, rest: u8) -> Hash {
        let mut bytes = [rest; 32];
        bytes[0] = first;
        bytes[1] = 0;
        Hash::from_bytes(bytes)
    }

    #[test]
    fn hashes_come_back_by_slice_sorted_and_once() {
        let mut spill = Spill::new().unwrap();
        for _ in 0..2000 {
            spill.hash(hash(3, 9)).unwrap();
        }
        spill.hash(hash(3, 1)).unwrap();
        spill.hash(hash(4, 4)).unwrap();

        assert_eq!(
            hashes(&spill.read(3 << 4).unwrap()),
            [hash(3, 1), hash(3, 9)]
        );
        assert_eq!(hashes(&spill.take(3 << 4).unwrap()).len(), 2);
        assert!(
            spill.take(3 << 4).unwrap().is_empty(),
            "a slice is taken once"
        );
        assert_eq!(hashes(&spill.take(4 << 4).unwrap()), [hash(4, 4)]);
    }

    #[test]
    fn small_files_go_by_their_bundle() {
        let mut spill = Spill::new().unwrap();
        let file = |offset| Bundled {
            bundle: hash(5, 5),
            chunk: Chunk {
                hash: hash(9, 9),
                size: 7,
            },
            offset,
            len: 11,
        };
        for offset in [30, 10, 30, 20] {
            spill.file(&file(offset)).unwrap();
        }
        let back = files(&spill.take(5 << 4).unwrap());
        assert_eq!(back, [file(10), file(20), file(30)]);
    }
}
