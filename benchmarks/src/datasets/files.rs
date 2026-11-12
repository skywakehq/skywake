//! The big-ann files: `.fbin` holds f32 vectors and `.ibin` u32 ids, each as `u32 rows, u32 dims`, then the values.

use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::Path;

use anyhow::{Context, Result, ensure};

pub(crate) struct Vectors {
    file: BufReader<File>,
    pub rows: usize,
    pub dims: usize,
    read: usize,
}

impl Vectors {
    pub(crate) fn open(path: &Path, limit: Option<usize>) -> Result<Self> {
        let file = File::open(path).with_context(|| format!("open {}", path.display()))?;
        let mut file = BufReader::with_capacity(1 << 20, file);
        let (rows, dims) = header(&mut file)?;
        Ok(Self {
            file,
            rows: limit.map_or(rows, |limit| limit.min(rows)),
            dims,
            read: 0,
        })
    }

    pub(crate) fn next_block(&mut self, max: usize) -> Result<Vec<f32>> {
        let rows = max.min(self.rows - self.read);
        self.read += rows;
        let mut bytes = vec![0; rows * self.dims * 4];
        self.file.read_exact(&mut bytes)?;
        Ok(bytes
            .as_chunks::<4>()
            .0
            .iter()
            .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
            .collect())
    }
}

pub(crate) fn read_vectors(path: &Path, limit: Option<usize>) -> Result<Vec<Vec<f32>>> {
    let mut vectors = Vectors::open(path, limit)?;
    let flat = vectors.next_block(vectors.rows)?;
    Ok(flat
        .chunks_exact(vectors.dims)
        .map(<[f32]>::to_vec)
        .collect())
}

pub(crate) fn read_ids(path: &Path, limit: Option<usize>) -> Result<Vec<Vec<u32>>> {
    let file = File::open(path).with_context(|| format!("open {}", path.display()))?;
    let mut file = BufReader::new(file);
    let (rows, dims) = header(&mut file)?;
    let rows = limit.map_or(rows, |limit| limit.min(rows));
    let mut bytes = vec![0; rows * dims * 4];
    file.read_exact(&mut bytes)?;
    let ids: Vec<u32> = bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect();
    Ok(ids.chunks_exact(dims.max(1)).map(<[u32]>::to_vec).collect())
}

fn header(file: &mut impl Read) -> Result<(usize, usize)> {
    let mut header = [0; 8];
    file.read_exact(&mut header)?;
    let rows = u32::from_le_bytes(header[..4].try_into()?) as usize;
    let dims = u32::from_le_bytes(header[4..].try_into()?) as usize;
    ensure!(dims > 0, "a file with zero dimensions");
    Ok((rows, dims))
}

pub(crate) struct Writer {
    file: BufWriter<File>,
}

impl Writer {
    pub(crate) fn create(path: &Path, rows: usize, dims: usize) -> Result<Self> {
        let file = File::create(path).with_context(|| format!("create {}", path.display()))?;
        let mut file = BufWriter::with_capacity(1 << 20, file);
        file.write_all(&(rows as u32).to_le_bytes())?;
        file.write_all(&(dims as u32).to_le_bytes())?;
        Ok(Self { file })
    }

    pub(crate) fn f32s(&mut self, values: &[f32]) -> Result<()> {
        values
            .iter()
            .try_for_each(|v| self.file.write_all(&v.to_le_bytes()))?;
        Ok(())
    }

    pub(crate) fn u32s(&mut self, values: &[u32]) -> Result<()> {
        values
            .iter()
            .try_for_each(|v| self.file.write_all(&v.to_le_bytes()))?;
        Ok(())
    }

    pub(crate) fn finish(mut self) -> Result<()> {
        Ok(self.file.flush()?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("v.fbin");
        let mut writer = Writer::create(&path, 3, 2).unwrap();
        writer.f32s(&[1.0, 2.0, 3.0, 4.0, 5.0, 6.0]).unwrap();
        writer.finish().unwrap();
        let rows = read_vectors(&path, Some(2)).unwrap();
        assert_eq!(rows, vec![vec![1.0, 2.0], vec![3.0, 4.0]]);

        let path = dir.path().join("i.ibin");
        let mut writer = Writer::create(&path, 2, 2).unwrap();
        writer.u32s(&[7, 8, 9, 10]).unwrap();
        writer.finish().unwrap();
        assert_eq!(
            read_ids(&path, None).unwrap(),
            vec![vec![7, 8], vec![9, 10]]
        );
    }
}
