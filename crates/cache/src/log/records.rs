//! Log files on disk: framed, checksummed records, and files replaced whole and synced.

use std::fs::File;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

use skywake_core::cache::LogRecord;

pub(super) fn log_files(dir: &Path) -> io::Result<Vec<(u64, PathBuf)>> {
    let mut files = Vec::new();
    for item in std::fs::read_dir(dir)? {
        let path = item?.path();
        let claim = path
            .extension()
            .filter(|extension| *extension == "log")
            .and_then(|_| path.file_stem()?.to_str()?.parse().ok());
        if let Some(claim) = claim {
            files.push((claim, path));
        }
    }
    files.sort_unstable();
    Ok(files)
}

pub(super) fn read_all(dir: &Path) -> io::Result<Vec<LogRecord>> {
    let mut records = Vec::new();
    for (_, path) in log_files(dir)? {
        records.extend(read_file(&path)?);
    }
    Ok(records)
}

pub(super) fn frame(record: &LogRecord) -> io::Result<Vec<u8>> {
    let body = postcard::to_stdvec(record).map_err(io::Error::other)?;
    let mut bytes = Vec::with_capacity(body.len() + 12);
    bytes.extend((body.len() as u32).to_le_bytes());
    bytes.extend(&blake3::hash(&body).as_bytes()[..8]);
    bytes.extend(body);
    Ok(bytes)
}

pub(super) fn read_file(path: &Path) -> io::Result<Vec<LogRecord>> {
    let mut bytes = Vec::new();
    File::open(path)?.read_to_end(&mut bytes)?;
    let mut records = Vec::new();
    let mut at = 0;
    while at + 12 <= bytes.len() {
        let size = u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap()) as usize;
        let Some(body) = bytes.get(at + 12..at + 12 + size) else {
            break;
        };
        if blake3::hash(body).as_bytes()[..8] != bytes[at + 4..at + 12] {
            break;
        }
        let Ok(record) = postcard::from_bytes(body) else {
            break;
        };
        records.push(record);
        at += 12 + size;
    }
    Ok(records)
}

pub(super) fn replace(temporary: &Path, path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut file = File::create(temporary)?;
    file.write_all(bytes)?;
    file.sync_data()?;
    std::fs::rename(temporary, path)
}

pub(super) fn sync_dir(dir: &Path) -> io::Result<()> {
    File::open(dir)?.sync_all()
}
