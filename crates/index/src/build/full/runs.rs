//! Sorted runs on local disk or in the bucket, so a full build works in fixed memory.

use std::cmp::Reverse;
use std::collections::BinaryHeap;
use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Write};
use std::marker::PhantomData;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

use serde::Serialize;
use serde::de::DeserializeOwned;
use skywake_core::Hash;
use tempfile::TempDir;

use crate::store::Storage;
use crate::{Error, Result};

const BLOCK: usize = 1 << 20;

const FAN_IN: usize = 16;

pub(crate) struct Runs<'r> {
    storage: &'r Storage,
    folder: Option<TempDir>,
    made: AtomicUsize,
}

impl<'r> Runs<'r> {
    pub fn new(storage: &'r Storage, local: bool) -> Result<Self> {
        let folder = match local {
            true => Some((tempfile::Builder::new().prefix("skywake-sort-").tempdir()).map_err(io)?),
            false => None,
        };
        Ok(Self {
            storage,
            folder,
            made: AtomicUsize::new(0),
        })
    }

    pub fn writer<T: Serialize>(&self) -> Result<Writer<'_, T>> {
        let sink = match &self.folder {
            Some(folder) => {
                let n = self.made.fetch_add(1, Ordering::Relaxed);
                let path = folder.path().join(format!("{n}.run"));
                Sink::Disk(BufWriter::new(File::create(&path).map_err(io)?), path)
            }
            None => Sink::Bucket(Vec::new()),
        };
        Ok(Writer {
            storage: self.storage,
            sink,
            block: Vec::new(),
            items: PhantomData,
        })
    }
}

enum Sink {
    Disk(BufWriter<File>, PathBuf),
    Bucket(Vec<Hash>),
}

pub(crate) struct Writer<'r, T> {
    storage: &'r Storage,
    sink: Sink,
    block: Vec<u8>,
    items: PhantomData<fn(T)>,
}

impl<'r, T: Serialize> Writer<'r, T> {
    pub async fn push(&mut self, item: &T) -> Result<()> {
        self.block = postcard::to_extend(item, std::mem::take(&mut self.block))?;
        if self.block.len() >= BLOCK {
            self.flush().await?;
        }
        Ok(())
    }

    async fn flush(&mut self) -> Result<()> {
        if self.block.is_empty() {
            return Ok(());
        }
        let block = std::mem::take(&mut self.block);
        match &mut self.sink {
            Sink::Disk(file, _) => write_frame(file, &block)?,
            Sink::Bucket(hashes) => {
                let hash = self.storage.put(postcard::to_stdvec(&block)?).await?;
                hashes.push(hash);
            }
        }
        Ok(())
    }

    pub async fn finish(mut self) -> Result<Run<'r>> {
        self.flush().await?;
        let blocks = match self.sink {
            Sink::Disk(mut file, path) => {
                file.flush().map_err(io)?;
                Blocks::Disk(path)
            }
            Sink::Bucket(hashes) => Blocks::Bucket(hashes),
        };
        Ok(Run {
            storage: self.storage,
            blocks,
        })
    }
}

pub(crate) struct Run<'r> {
    storage: &'r Storage,
    blocks: Blocks,
}

enum Blocks {
    Disk(PathBuf),
    Bucket(Vec<Hash>),
}

impl<'r> Run<'r> {
    pub fn read<T: DeserializeOwned>(&self) -> Result<Reader<'r, T>> {
        let source = match &self.blocks {
            Blocks::Disk(path) => Source::Disk(BufReader::new(File::open(path).map_err(io)?)),
            Blocks::Bucket(hashes) => Source::Bucket(hashes.clone().into_iter()),
        };
        Ok(Reader {
            storage: self.storage,
            source,
            block: Vec::new(),
            at: 0,
            items: PhantomData,
        })
    }
}

impl Drop for Run<'_> {
    fn drop(&mut self) {
        if let Blocks::Disk(path) = &self.blocks {
            let _ = std::fs::remove_file(path);
        }
    }
}

enum Source {
    Disk(BufReader<File>),
    Bucket(std::vec::IntoIter<Hash>),
}

pub(crate) struct Reader<'r, T> {
    storage: &'r Storage,
    source: Source,
    block: Vec<u8>,
    at: usize,
    items: PhantomData<fn() -> T>,
}

impl<T: DeserializeOwned> Reader<'_, T> {
    pub async fn next(&mut self) -> Result<Option<T>> {
        while self.at == self.block.len() {
            if !self.load().await? {
                return Ok(None);
            }
        }
        let (item, rest) = postcard::take_from_bytes(&self.block[self.at..])?;
        self.at = self.block.len() - rest.len();
        Ok(Some(item))
    }

    async fn load(&mut self) -> Result<bool> {
        self.at = 0;
        self.block.clear();
        match &mut self.source {
            Source::Disk(file) => return read_frame(file, &mut self.block),
            Source::Bucket(hashes) => {
                let Some(hash) = hashes.next() else {
                    return Ok(false);
                };
                self.block = self.storage.fetch::<Vec<u8>>(hash).await?;
            }
        }
        Ok(true)
    }
}

pub(crate) struct Sorter<'r, T> {
    runs: &'r Runs<'r>,
    limit: usize,
    items: Vec<T>,
    sorted: Vec<Run<'r>>,
}

impl<'r, T: Ord + Serialize + DeserializeOwned> Sorter<'r, T> {
    pub fn new(runs: &'r Runs<'r>, limit: usize) -> Self {
        Self {
            runs,
            limit: limit.max(1),
            items: Vec::new(),
            sorted: Vec::new(),
        }
    }

    pub async fn push(&mut self, item: T) -> Result<()> {
        self.items.push(item);
        if self.items.len() >= self.limit {
            self.spill().await?;
        }
        Ok(())
    }

    async fn spill(&mut self) -> Result<()> {
        self.items.sort_unstable();
        let mut run = self.runs.writer()?;
        for item in self.items.drain(..) {
            run.push(&item).await?;
        }
        self.sorted.push(run.finish().await?);
        Ok(())
    }

    pub async fn finish(mut self) -> Result<Merged<'r, T>> {
        if self.sorted.is_empty() {
            self.items.sort_unstable();
            return Ok(Merged {
                memory: std::mem::take(&mut self.items).into_iter(),
                heap: BinaryHeap::new(),
                readers: Vec::new(),
                _runs: Vec::new(),
            });
        }
        if !self.items.is_empty() {
            self.spill().await?;
        }
        self.items = Vec::new();
        while self.sorted.len() > FAN_IN {
            let some: Vec<Run> = self.sorted.drain(..FAN_IN).collect();
            let mut merged = Merged::<T>::of(some).await?;
            let mut run = self.runs.writer()?;
            while let Some(item) = merged.next().await? {
                run.push(&item).await?;
            }
            drop(merged);
            self.sorted.push(run.finish().await?);
        }
        Merged::of(std::mem::take(&mut self.sorted)).await
    }
}

pub(crate) struct Merged<'r, T> {
    memory: std::vec::IntoIter<T>,
    heap: BinaryHeap<Reverse<(T, usize)>>,
    readers: Vec<Reader<'r, T>>,
    _runs: Vec<Run<'r>>,
}

impl<'r, T: Ord + DeserializeOwned> Merged<'r, T> {
    async fn of(runs: Vec<Run<'r>>) -> Result<Self> {
        let mut readers = Vec::with_capacity(runs.len());
        let mut heap = BinaryHeap::with_capacity(runs.len());
        for (i, run) in runs.iter().enumerate() {
            let mut reader = run.read()?;
            if let Some(item) = reader.next().await? {
                heap.push(Reverse((item, i)));
            }
            readers.push(reader);
        }
        Ok(Self {
            memory: Vec::new().into_iter(),
            heap,
            readers,
            _runs: runs,
        })
    }

    pub async fn next(&mut self) -> Result<Option<T>> {
        if let Some(item) = self.memory.next() {
            return Ok(Some(item));
        }
        let Some(Reverse((item, i))) = self.heap.pop() else {
            return Ok(None);
        };
        if let Some(next) = self.readers[i].next().await? {
            self.heap.push(Reverse((next, i)));
        }
        Ok(Some(item))
    }
}

pub(super) fn write_frame(file: &mut impl Write, bytes: &[u8]) -> Result<()> {
    (file.write_all(&(bytes.len() as u32).to_le_bytes()))
        .and_then(|()| file.write_all(bytes))
        .map_err(io)
}

pub(super) fn read_frame(file: &mut impl Read, bytes: &mut Vec<u8>) -> Result<bool> {
    let mut size = [0; 4];
    match file.read_exact(&mut size) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(false),
        Err(e) => return Err(io(e)),
    }
    bytes.resize(u32::from_le_bytes(size) as usize, 0);
    file.read_exact(bytes).map_err(io)?;
    Ok(true)
}

pub(super) fn io(error: std::io::Error) -> Error {
    skywake_core::Error::from(error).into()
}
