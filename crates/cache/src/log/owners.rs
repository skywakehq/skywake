//! The newest claim on each branch's log, in one journal per server synced as a group.

use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{self, BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use super::records::{replace, sync_dir};
use crate::hold;

const JOURNAL: &str = "owners";
const REWRITE_AT: usize = 4;
const REWRITE_MIN: usize = 10_000;

pub(super) struct Owners {
    path: PathBuf,
    state: Mutex<State>,
    // One sync at a time covers every claim written while the last one ran.
    syncing: Mutex<()>,
}

struct State {
    claims: HashMap<String, u64>,
    file: File,
    lines: usize,
    written: u64,
    synced: u64,
}

impl Owners {
    pub(super) fn open(dir: &Path) -> io::Result<Self> {
        let path = dir.join(JOURNAL);
        let mut claims = HashMap::new();
        match File::open(&path) {
            Ok(file) => {
                for line in BufReader::new(file).lines() {
                    let Some((key, claim)) = line?.split_once(' ').and_then(|(key, claim)| {
                        Some((key.to_string(), claim.parse::<u64>().ok()?))
                    }) else {
                        continue;
                    };
                    let known = claims.entry(key).or_insert(0);
                    *known = (*known).max(claim);
                }
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        let file = rewrite(&path, &claims)?;
        Ok(Self {
            path,
            state: Mutex::new(State {
                lines: claims.len(),
                claims,
                file,
                written: 0,
                synced: 0,
            }),
            syncing: Mutex::new(()),
        })
    }

    pub(super) fn get(&self, key: &str) -> u64 {
        hold(&self.state).claims.get(key).copied().unwrap_or(0)
    }

    pub(super) fn set(&self, key: &str, claim: u64) -> io::Result<()> {
        let target = {
            let mut state = hold(&self.state);
            state.claims.insert(key.to_string(), claim);
            state
                .file
                .write_all(format!("{key} {claim}\n").as_bytes())?;
            state.lines += 1;
            state.written += 1;
            if state.lines > (state.claims.len() * REWRITE_AT).max(REWRITE_MIN) {
                state.file = rewrite(&self.path, &state.claims)?;
                state.lines = state.claims.len();
                state.synced = state.written;
            }
            state.written
        };
        let _turn = hold(&self.syncing);
        let file = {
            let state = hold(&self.state);
            if state.synced >= target {
                return Ok(());
            }
            (state.file.try_clone()?, state.written)
        };
        file.0.sync_data()?;
        let mut state = hold(&self.state);
        state.synced = state.synced.max(file.1);
        Ok(())
    }
}

fn rewrite(path: &Path, claims: &HashMap<String, u64>) -> io::Result<File> {
    let mut bytes = Vec::new();
    for (key, claim) in claims {
        bytes.extend(format!("{key} {claim}\n").as_bytes());
    }
    replace(&path.with_extension("new"), path, &bytes)?;
    if let Some(dir) = path.parent() {
        sync_dir(dir)?;
    }
    OpenOptions::new().append(true).open(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claims_survive_a_restart_and_the_journal_stays_small() {
        let dir = tempfile::tempdir().unwrap();
        let owners = Owners::open(dir.path()).unwrap();
        for round in 1..=5u64 {
            for key in 0..500 {
                owners.set(&format!("k{key}"), round).unwrap();
            }
        }
        assert_eq!(owners.get("k7"), 5);
        assert_eq!(owners.get("nobody"), 0);
        drop(owners);
        let again = Owners::open(dir.path()).unwrap();
        assert_eq!(again.get("k499"), 5);
        let lines = std::fs::read_to_string(dir.path().join(JOURNAL))
            .unwrap()
            .lines()
            .count();
        assert_eq!(lines, 500, "rewritten with only the newest claims");
    }
}
