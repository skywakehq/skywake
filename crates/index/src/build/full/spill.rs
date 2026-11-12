//! A full build's rows split once by cluster group into local files, so groups need not rescan the bucket.

use std::fs::File;
use std::io::{BufReader, BufWriter, Write};

use serde::{Deserialize, Serialize};
use tempfile::TempDir;

use super::runs::{io, read_frame, write_frame};
use crate::{Attributes, Id, Result};

#[derive(Serialize)]
struct RowRef<'a> {
    cluster: u32,
    id: &'a Id,
    seq: u64,
    vector: &'a [f32],
    attributes: &'a Attributes,
}

#[derive(Deserialize)]
pub(super) struct Row {
    pub cluster: u32,
    pub id: Id,
    pub seq: u64,
    pub vector: Vec<f32>,
    pub attributes: Attributes,
}

pub(super) struct Spill {
    folder: TempDir,
    files: Vec<BufWriter<File>>,
    group_of: Vec<u32>,
}

impl Spill {
    pub fn new(groups: &[&[usize]], clusters: usize) -> Result<Self> {
        let folder = tempfile::Builder::new()
            .prefix("skywake-build-")
            .tempdir()
            .map_err(io)?;
        let mut group_of = vec![0; clusters];
        let mut files = Vec::with_capacity(groups.len());
        for (g, group) in groups.iter().enumerate() {
            for &cluster in *group {
                group_of[cluster] = g as u32;
            }
            files.push(BufWriter::new(File::create(path(&folder, g)).map_err(io)?));
        }
        Ok(Self {
            folder,
            files,
            group_of,
        })
    }

    pub fn push(
        &mut self,
        cluster: usize,
        id: &Id,
        seq: u64,
        vector: &[f32],
        attributes: &Attributes,
    ) -> Result<()> {
        let row = RowRef {
            cluster: cluster as u32,
            id,
            seq,
            vector,
            attributes,
        };
        let bytes = postcard::to_stdvec(&row)?;
        write_frame(&mut self.files[self.group_of[cluster] as usize], &bytes)
    }

    pub fn finish(self) -> Result<Spilled> {
        let groups = self.files.len();
        for mut file in self.files {
            file.flush().map_err(io)?;
        }
        Ok(Spilled {
            folder: self.folder,
            groups,
        })
    }
}

pub(super) struct Spilled {
    folder: TempDir,
    groups: usize,
}

impl Spilled {
    pub fn read(&self, g: usize) -> Result<impl Iterator<Item = Result<Row>>> {
        assert!(g < self.groups);
        let mut file = BufReader::new(File::open(path(&self.folder, g)).map_err(io)?);
        let mut bytes = Vec::new();
        Ok(std::iter::from_fn(move || {
            match read_frame(&mut file, &mut bytes) {
                Ok(true) => Some(postcard::from_bytes(&bytes).map_err(Into::into)),
                Ok(false) => None,
                Err(e) => Some(Err(e)),
            }
        }))
    }
}

fn path(folder: &TempDir, group: usize) -> std::path::PathBuf {
    folder.path().join(format!("{group}.rows"))
}
