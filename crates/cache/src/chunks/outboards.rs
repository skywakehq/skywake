//! Each chunk's hash tree, kept on disk beside the chunk so ranges go out with their proof.

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::os::unix::fs::FileExt;
use std::path::PathBuf;

use skywake_core::Hash;
use skywake_core::cache::{ChunkCache, slices};

pub(crate) struct Outboards {
    dir: PathBuf,
}

impl Outboards {
    pub(crate) fn new(dir: PathBuf, cache: &ChunkCache) -> io::Result<Self> {
        std::fs::create_dir_all(&dir)?;
        for item in std::fs::read_dir(&dir)? {
            let path = item?.path();
            let held = path
                .file_name()
                .and_then(|name| name.to_str()?.parse::<Hash>().ok())
                .is_some_and(|hash| cache.has(hash));
            if !held {
                let _ = std::fs::remove_file(path);
            }
        }
        Ok(Self { dir })
    }

    pub(crate) fn slice(
        &self,
        hash: Hash,
        mut chunk: Chunk,
        start: u64,
        len: u64,
    ) -> io::Result<Vec<u8>> {
        let tree = self.tree(hash, &mut chunk)?;
        chunk.rewind()?;
        slices::extract(chunk, &tree, start, len)
    }

    pub(crate) fn prepare(&self, hash: Hash, mut chunk: Chunk) -> io::Result<()> {
        self.tree(hash, &mut chunk).map(drop)
    }

    fn tree(&self, hash: Hash, chunk: &mut Chunk) -> io::Result<Vec<u8>> {
        let path = self.dir.join(hash.to_string());
        if let Ok(tree) = std::fs::read(&path) {
            return Ok(tree);
        }
        let mut data = Vec::new();
        chunk.read_to_end(&mut data)?;
        let tree = slices::outboard(&data);
        let partial = skywake_core::cache::unfinished(&path);
        std::fs::write(&partial, &tree)?;
        std::fs::rename(&partial, &path)?;
        Ok(tree)
    }
}

pub(crate) enum Chunk {
    // A clone of a file being sent shares its position, so read at our own offset instead.
    File(File, u64),
    Memory(io::Cursor<Vec<u8>>),
}

impl Read for Chunk {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        match self {
            Chunk::File(file, at) => {
                let read = file.read_at(buffer, *at)?;
                *at += read as u64;
                Ok(read)
            }
            Chunk::Memory(cursor) => cursor.read(buffer),
        }
    }
}

impl Seek for Chunk {
    fn seek(&mut self, to: io::SeekFrom) -> io::Result<u64> {
        match self {
            Chunk::File(file, at) => {
                let moved = match to {
                    SeekFrom::Start(to) => Some(to),
                    SeekFrom::Current(by) => at.checked_add_signed(by),
                    SeekFrom::End(by) => file.metadata()?.len().checked_add_signed(by),
                };
                *at = moved.ok_or_else(|| io::Error::from(io::ErrorKind::InvalidInput))?;
                Ok(*at)
            }
            Chunk::Memory(cursor) => cursor.seek(to),
        }
    }
}
