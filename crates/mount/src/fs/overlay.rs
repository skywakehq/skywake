//! Writes to a scratch file while a save reads it.

use std::collections::BTreeMap;
use std::fs::File;
use std::io;
use std::os::unix::fs::FileExt;
use std::path::PathBuf;

pub(crate) struct Overlay {
    file: File,
    path: PathBuf,
    end: u64,
    ranges: BTreeMap<u64, (u64, u64)>,
    floor: u64,
}

impl Overlay {
    pub(crate) fn new(path: PathBuf, size: u64) -> io::Result<Self> {
        let file = File::options()
            .read(true)
            .write(true)
            .create(true)
            .truncate(true)
            .open(&path)?;
        Ok(Self {
            file,
            path,
            end: 0,
            ranges: BTreeMap::new(),
            floor: size,
        })
    }

    pub(crate) fn write(&mut self, offset: u64, data: &[u8]) -> io::Result<()> {
        if data.is_empty() {
            return Ok(());
        }
        self.file.write_all_at(data, self.end)?;
        let end = offset + data.len() as u64;
        self.cut(offset, end);
        self.ranges.insert(offset, (data.len() as u64, self.end));
        self.end += data.len() as u64;
        Ok(())
    }

    pub(crate) fn truncate(&mut self, size: u64) {
        self.floor = self.floor.min(size);
        self.cut(size, u64::MAX);
    }

    pub(crate) fn read(
        &self,
        base: &File,
        offset: u64,
        len: u64,
        size: u64,
    ) -> io::Result<Vec<u8>> {
        let end = size.min(offset.saturating_add(len));
        if offset >= end {
            return Ok(Vec::new());
        }
        let mut buffer = vec![0; (end - offset) as usize];
        let base_end = end.min(self.floor);
        if offset < base_end {
            read_up_to(base, &mut buffer[..(base_end - offset) as usize], offset)?;
        }
        for (start, len, position) in self.overlapping(offset, end) {
            let from = start.max(offset);
            let to = (start + len).min(end);
            let target = &mut buffer[(from - offset) as usize..(to - offset) as usize];
            self.file.read_exact_at(target, position + (from - start))?;
        }
        Ok(buffer)
    }

    pub(crate) fn apply(&self, base: &File, size: u64) -> io::Result<()> {
        base.set_len(self.floor)?;
        let mut buffer = Vec::new();
        for (&start, &(len, position)) in &self.ranges {
            buffer.resize(len as usize, 0);
            self.file.read_exact_at(&mut buffer, position)?;
            base.write_all_at(&buffer, start)?;
        }
        base.set_len(size)
    }

    pub(crate) fn remove(self) {
        let _ = std::fs::remove_file(&self.path);
    }

    fn overlapping(&self, start: u64, end: u64) -> Vec<(u64, u64, u64)> {
        let before = self
            .ranges
            .range(..start)
            .next_back()
            .filter(|(from, (len, _))| *from + len > start);
        before
            .into_iter()
            .chain(self.ranges.range(start..end))
            .map(|(&from, &(len, position))| (from, len, position))
            .collect()
    }

    fn cut(&mut self, start: u64, end: u64) {
        for (from, len, position) in self.overlapping(start, end) {
            self.ranges.remove(&from);
            if from < start {
                self.ranges.insert(from, (start - from, position));
            }
            if from + len > end {
                self.ranges
                    .insert(end, (from + len - end, position + (end - from)));
            }
        }
    }
}

pub(crate) fn read_up_to(file: &File, buffer: &mut [u8], offset: u64) -> io::Result<usize> {
    let mut done = 0;
    while done < buffer.len() {
        match file.read_at(&mut buffer[done..], offset + done as u64) {
            Ok(0) => break,
            Ok(read) => done += read,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return Err(error),
        }
    }
    Ok(done)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_a_plain_buffer() {
        let dir = tempfile::tempdir().unwrap();
        let base_path = dir.path().join("base");
        let original: Vec<u8> = (0..10_000u32).map(|i| i as u8).collect();
        std::fs::write(&base_path, &original).unwrap();
        let base = File::options()
            .read(true)
            .write(true)
            .open(&base_path)
            .unwrap();
        let mut overlay = Overlay::new(dir.path().join("overlay"), 10_000).unwrap();
        let mut expected = original.clone();

        let steps: [(&str, u64, usize); 8] = [
            ("write", 100, 50),
            ("write", 120, 10),
            ("write", 90, 40),
            ("truncate", 5000, 0),
            ("write", 6000, 100),
            ("write", 4990, 20),
            ("truncate", 3000, 0),
            ("write", 3500, 10),
        ];
        for (step, (kind, offset, len)) in steps.into_iter().enumerate() {
            if kind == "write" {
                let data = vec![step as u8 + 200; len];
                overlay.write(offset, &data).unwrap();
                let end = offset as usize + len;
                if expected.len() < end {
                    expected.resize(end, 0);
                }
                expected[offset as usize..end].copy_from_slice(&data);
            } else {
                overlay.truncate(offset);
                expected.truncate(offset as usize);
            }
            let size = expected.len() as u64;
            assert_eq!(overlay.read(&base, 0, size + 10, size).unwrap(), expected);
            assert_eq!(
                overlay.read(&base, 95, 40, size).unwrap(),
                expected[95..135.min(expected.len())]
            );
            assert_eq!(std::fs::read(&base_path).unwrap(), original);
        }
        overlay.apply(&base, expected.len() as u64).unwrap();
        assert_eq!(std::fs::read(&base_path).unwrap(), expected);
    }
}
