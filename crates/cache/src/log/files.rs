//! Each branch's log on disk: one append-only file per claim, synced before answering.

use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use skywake_core::cache::{LogRecord, Sealed, Trimmed};

use super::owners::Owners;
use super::records::{frame, log_files, read_all, read_file, replace, sync_dir};
use crate::hold;

const OWNER: &str = "owner";
// A record below the trim is never kept again: it could only bring back an old head.
const TRIMMED: &str = "trimmed";

#[derive(Debug)]
pub(crate) enum Refused {
    Older,
    Io(io::Error),
}

impl From<io::Error> for Refused {
    fn from(error: io::Error) -> Self {
        Refused::Io(error)
    }
}

pub(crate) struct Logs {
    dir: PathBuf,
    owners: Owners,
    locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

impl Logs {
    pub(crate) fn new(dir: PathBuf) -> io::Result<Self> {
        std::fs::create_dir_all(&dir)?;
        Ok(Self {
            owners: Owners::open(&dir)?,
            dir,
            locks: Mutex::default(),
        })
    }

    pub(crate) fn seal(&self, key: &str, claim: u64) -> Result<Sealed, Refused> {
        check(key)?;
        let lock = self.key_lock(key);
        let _held = hold(&lock);
        let dir = self.dir.join(key);
        self.take(key, &dir, claim)?;
        if !dir.exists() {
            return Ok(Sealed::default());
        }
        let trimmed = trimmed(&dir)?;
        let records = read_all(&dir)?
            .into_iter()
            .filter(|record| !trimmed.is_some_and(|trimmed| trimmed.drops(record)))
            .collect();
        Ok(Sealed { records, trimmed })
    }

    pub(crate) fn append(&self, key: &str, record: &LogRecord) -> Result<(), Refused> {
        let dir = self.open(key)?;
        let lock = self.key_lock(key);
        let _held = hold(&lock);
        self.take(key, &dir, record.claim)?;
        if trimmed(&dir)?.is_some_and(|trimmed| trimmed.drops(record)) {
            return Ok(());
        }
        let path = dir.join(format!("{}.log", record.claim));
        let new = !path.exists();
        let mut file = OpenOptions::new().create(true).append(true).open(&path)?;
        file.write_all(&frame(record)?)?;
        file.sync_data()?;
        if new {
            sync_dir(&dir)?;
        }
        Ok(())
    }

    pub(crate) fn trim(
        &self,
        key: &str,
        claim: u64,
        below: u64,
        through: u64,
    ) -> Result<(), Refused> {
        let dir = self.open(key)?;
        let lock = self.key_lock(key);
        let _held = hold(&lock);
        if self.owner(key, &dir)? > claim {
            return Err(Refused::Older);
        }
        let now = Trimmed {
            claim,
            below,
            through,
        };
        if trimmed(&dir)?.is_none_or(|before| (before.claim, before.below) < (claim, below)) {
            let bytes = postcard::to_stdvec(&now).map_err(io::Error::other)?;
            replace(&dir.join("trimmed.new"), &dir.join(TRIMMED), &bytes)?;
        }
        for (file_claim, path) in log_files(&dir)? {
            if file_claim < claim {
                std::fs::remove_file(path)?;
                continue;
            }
            if file_claim != claim {
                continue;
            }
            let records = read_file(&path)?;
            let kept: Vec<&LogRecord> = records
                .iter()
                .filter(|record| record.n >= below || record.max_tag > through)
                .collect();
            if kept.len() == records.len() {
                continue;
            }
            if kept.is_empty() {
                std::fs::remove_file(&path)?;
                continue;
            }
            let mut bytes = Vec::new();
            for record in kept {
                bytes.extend(frame(record)?);
            }
            replace(&path.with_extension("trim"), &path, &bytes)?;
        }
        sync_dir(&dir)?;
        Ok(())
    }

    pub(crate) fn held(&self) -> io::Result<Vec<(String, Vec<LogRecord>)>> {
        let mut held = Vec::new();
        for item in std::fs::read_dir(&self.dir)? {
            let item = item?;
            let Some(key) = item.file_name().to_str().map(str::to_string) else {
                continue;
            };
            if !item.file_type()?.is_dir() {
                continue;
            }
            let lock = self.key_lock(&key);
            let _held = hold(&lock);
            let records = read_all(&item.path())?;
            if !records.is_empty() {
                held.push((key, records));
            }
        }
        Ok(held)
    }

    fn take(&self, key: &str, dir: &Path, claim: u64) -> Result<(), Refused> {
        let current = self.owner(key, dir)?;
        if claim < current {
            return Err(Refused::Older);
        }
        if claim > current {
            self.owners.set(key, claim)?;
        }
        Ok(())
    }

    fn owner(&self, key: &str, dir: &Path) -> io::Result<u64> {
        Ok(self.owners.get(key).max(owner(dir)?))
    }

    fn open(&self, key: &str) -> io::Result<PathBuf> {
        check(key)?;
        let dir = self.dir.join(key);
        if !dir.exists() {
            std::fs::create_dir_all(&dir)?;
            sync_dir(&self.dir)?;
        }
        Ok(dir)
    }

    fn key_lock(&self, key: &str) -> Arc<Mutex<()>> {
        hold(&self.locks)
            .entry(key.to_string())
            .or_default()
            .clone()
    }
}

fn check(key: &str) -> io::Result<()> {
    match key.len() == 64 && key.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        true => Ok(()),
        false => Err(io::Error::new(io::ErrorKind::InvalidInput, "bad log key")),
    }
}

fn owner(dir: &Path) -> io::Result<u64> {
    match std::fs::read_to_string(dir.join(OWNER)) {
        Ok(text) => Ok(text.trim().parse().unwrap_or(0)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(0),
        Err(error) => Err(error),
    }
}

fn trimmed(dir: &Path) -> io::Result<Option<Trimmed>> {
    match std::fs::read(dir.join(TRIMMED)) {
        Ok(bytes) => Ok(postcard::from_bytes(&bytes).ok()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(claim: u64, n: u64) -> LogRecord {
        LogRecord {
            claim,
            n,
            max_tag: n,
            data: vec![n as u8],
        }
    }

    #[test]
    fn a_trimmed_record_handed_back_later_is_not_kept() {
        let dir = tempfile::tempdir().unwrap();
        let logs = Logs::new(dir.path().to_path_buf()).unwrap();
        let key = "a".repeat(64);
        for n in 0..3 {
            logs.append(&key, &record(5, n)).unwrap();
        }
        logs.trim(&key, 5, 2, 1).unwrap();
        logs.append(&key, &record(5, 0)).unwrap();
        logs.append(&key, &record(5, 1)).unwrap();
        assert!(matches!(
            logs.append(&key, &record(4, 9)),
            Err(Refused::Older)
        ));
        let sealed = logs.seal(&key, 6).unwrap();
        let kept: Vec<u64> = sealed.records.iter().map(|record| record.n).collect();
        assert_eq!(kept, [2]);
        let trimmed = sealed.trimmed.unwrap();
        assert!(trimmed.drops(&record(5, 1)) && !trimmed.drops(&record(5, 2)));
        assert!(trimmed.drops(&record(4, 100)));
    }
}
