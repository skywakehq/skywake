//! A text part: one Tantivy index of one segment, stored as blobs.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Arc;

use futures::future::try_join_all;
use object_store::{ObjectStore, ObjectStoreExt};
use serde::{Deserialize, Serialize};
use skywake_core::Hash;
use tantivy::directory::MmapDirectory;
use tantivy::indexer::NoMergePolicy;
use tantivy::schema::Value as _;
use tantivy::{Index as Tantivy, IndexWriter, ReloadPolicy, Searcher, TantivyDocument};

use super::dir::{self, BlobDir, Files};
use super::engine;
use super::fields::{Fields, key, register};
use crate::store::{Storage, Written, blob_path};
use crate::{Attributes, Error, Id, Kind, Result, Value, uuid_text};

const ID_BLOCK: usize = 4096;

const ID_ENTRY: usize = 12;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct PartRef {
    pub hot: Hash,
    pub hot_bytes: u64,
    pub blobs: Vec<Hash>,
    pub docs: u32,
    pub dead: Option<Hash>,
    pub dead_docs: u32,
    pub bytes: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub(crate) struct TextIndex {
    pub parts: Vec<PartRef>,
}

#[derive(Serialize, Deserialize)]
pub(crate) struct Hot {
    pub files: Vec<(String, Hash, u64)>,
    pub atomic: Vec<(String, Vec<u8>)>,
    pub ranges: Vec<(Hash, u64, Vec<u8>)>,
    pub ids: IdMap,
}

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct IdMap {
    pub blob: Hash,
    pub len: u64,
    pub firsts: Vec<u64>,
}

impl Hot {
    fn encode(&self) -> Result<Vec<u8>> {
        let raw = postcard::to_stdvec(self)?;
        zstd::encode_all(&raw[..], 3).map_err(engine)
    }

    fn decode(bytes: &[u8]) -> Result<Self> {
        Ok(postcard::from_bytes(
            &zstd::decode_all(bytes).map_err(engine)?,
        )?)
    }
}

pub(crate) struct Opened {
    pub searcher: Searcher,
    pub ids: IdMap,
    hot_bytes: usize,
}

impl Opened {
    pub(crate) fn weight(&self) -> usize {
        4096 + self.hot_bytes + 8 * self.ids.firsts.len()
    }
}

pub(crate) async fn read_blob(store: &dyn ObjectStore, hash: Hash, len: u64) -> Result<Vec<u8>> {
    let path = blob_path(hash);
    let pieces = (0..len).step_by(dir::SPLIT).map(|start| {
        let end = (start + dir::SPLIT as u64).min(len);
        store.get_range(&path, start..end)
    });
    let bytes = try_join_all(pieces).await?.concat();
    if Hash::of(&bytes) != hash {
        return Err(Error::Corrupt(format!(
            "blob {hash} does not match its hash"
        )));
    }
    Ok(bytes)
}

pub(crate) async fn open(storage: &Storage, hot: Hash, hot_bytes: u64) -> Result<Arc<Opened>> {
    let key = Hash::of(format!("{hot}/opened").as_bytes());
    if let Some(found) = storage.cache().get(key) {
        return Ok(found);
    }
    let bytes = read_blob(storage.store.as_ref(), hot, hot_bytes).await?;
    let hot = Hot::decode(&bytes)?;
    let store = storage.store.clone();
    let cache = Arc::downgrade(storage.cache());
    let opened = Arc::new(
        blocking(move || -> Result<Opened> {
            let files = Files {
                files: &hot.files,
                atomic: &hot.atomic,
                ranges: &hot.ranges,
            };
            let dir = BlobDir::open(store, files, cache);
            let hot_bytes = dir.hot_bytes();
            let searcher = searcher(dir)?;
            Ok(Opened {
                searcher,
                ids: hot.ids.clone(),
                hot_bytes,
            })
        })
        .await??,
    );
    storage.cache().insert(key, opened.clone(), opened.weight());
    Ok(opened)
}

pub(crate) fn widest(opened: &[Arc<Opened>]) -> Option<&tantivy::schema::Schema> {
    (opened.iter())
        .map(|opened| opened.searcher.schema())
        .max_by_key(|schema| schema.num_fields())
}

fn searcher(dir: impl tantivy::Directory) -> Result<Searcher> {
    let index = Tantivy::open(dir).map_err(engine)?;
    register(&index);
    let reader = index
        .reader_builder()
        .reload_policy(ReloadPolicy::Manual)
        .try_into()
        .map_err(engine)?;
    let searcher = reader.searcher();
    let schema = index.schema();
    for segment in searcher.segment_readers() {
        for (field, entry) in schema.fields() {
            if entry.is_indexed() {
                segment.inverted_index(field).map_err(engine)?;
            }
        }
    }
    Ok(searcher)
}

pub(crate) struct PartWriter {
    folder: tempfile::TempDir,
    index: Tantivy,
    writer: IndexWriter,
    fields: Arc<Fields>,
    docs: u32,
}

impl PartWriter {
    pub(crate) fn new(fields: Arc<Fields>, memory: usize) -> Result<Self> {
        let folder = tempfile::tempdir().map_err(engine)?;
        let dir = MmapDirectory::open(folder.path()).map_err(engine)?;
        let index =
            Tantivy::create(dir, fields.schema.clone(), Default::default()).map_err(engine)?;
        register(&index);
        let threads = std::thread::available_parallelism()
            .map_or(1, |n| n.get())
            .clamp(1, 4);
        let memory = memory.clamp(threads * (32 << 20), threads * (1 << 30));
        let writer = index
            .writer_with_num_threads(threads, memory)
            .map_err(engine)?;
        writer.set_merge_policy(Box::new(NoMergePolicy));
        Ok(Self {
            folder,
            index,
            writer,
            fields,
            docs: 0,
        })
    }

    pub(crate) fn add(&mut self, id: &Id, attributes: &Attributes) -> Result<()> {
        let fields = &self.fields;
        let mut doc = TantivyDocument::default();
        doc.add_bytes(fields.doc, &postcard::to_stdvec(&(id, attributes))?);
        doc.add_u64(fields.key, key(id));
        for (name, value) in attributes {
            if let Some(&field) = fields.text.get(name) {
                match value {
                    Value::String(text) => doc.add_text(field, text),
                    Value::Strings(list) => list.iter().for_each(|text| doc.add_text(field, text)),
                    _ => {}
                }
            }
            let Some(&(field, kind)) = fields.attributes.get(name) else {
                continue;
            };
            match (kind, value) {
                (Kind::String, Value::String(text)) => doc.add_text(field, text),
                (Kind::Strings, Value::Strings(list)) => {
                    for text in list {
                        doc.add_text(field, text);
                    }
                }
                (Kind::Number, Value::Number(n)) => doc.add_f64(field, *n),
                (Kind::Bool, Value::Bool(b)) => doc.add_bool(field, *b),
                (Kind::Int, Value::Int(n)) | (Kind::Datetime, Value::Datetime(n)) => {
                    doc.add_i64(field, *n)
                }
                (Kind::Uuid, Value::Uuid(u)) => doc.add_text(field, uuid_text(*u)),
                (Kind::Ints, Value::Ints(list)) => list.iter().for_each(|&n| doc.add_i64(field, n)),
                (Kind::Numbers, Value::Numbers(list)) => {
                    list.iter().for_each(|&n| doc.add_f64(field, n))
                }
                _ => {}
            }
        }
        self.writer.add_document(doc).map_err(engine)?;
        self.docs += 1;
        Ok(())
    }

    pub(crate) fn docs(&self) -> u32 {
        self.docs
    }

    pub(crate) fn finish(self) -> Result<Built> {
        let mut writer = self.writer;
        writer.commit().map_err(engine)?;
        let segments = self.index.searchable_segment_ids().map_err(engine)?;
        if segments.len() > 1 {
            writer.merge(&segments).wait().map_err(engine)?;
        }
        writer.wait_merging_threads().map_err(engine)?;
        let writer: IndexWriter = self
            .index
            .writer_with_num_threads(1, 32 << 20)
            .map_err(engine)?;
        writer.garbage_collect_files().wait().map_err(engine)?;
        drop(writer);
        let ids = id_entries(&self.index, self.docs)?;
        Ok(Built {
            folder: self.folder,
            ids,
            docs: self.docs,
        })
    }
}

fn id_entries(index: &Tantivy, docs: u32) -> Result<Vec<u8>> {
    let reader = index.reader().map_err(engine)?;
    let searcher = reader.searcher();
    let mut pairs = Vec::with_capacity(docs as usize);
    for segment in searcher.segment_readers() {
        let column = segment.fast_fields().u64("key").map_err(engine)?;
        for doc in 0..segment.max_doc() {
            if let Some(key) = column.first(doc) {
                pairs.push((key, doc));
            }
        }
    }
    pairs.sort_unstable();
    let mut bytes = Vec::with_capacity(pairs.len() * ID_ENTRY);
    for (key, doc) in pairs {
        bytes.extend_from_slice(&key.to_le_bytes());
        bytes.extend_from_slice(&doc.to_le_bytes());
    }
    Ok(bytes)
}

pub(crate) struct Built {
    folder: tempfile::TempDir,
    ids: Vec<u8>,
    docs: u32,
}

impl Built {
    pub(crate) async fn store(self, storage: &Storage, written: &mut Written) -> Result<PartRef> {
        store_part(storage, self.folder.path(), self.ids, self.docs, written).await
    }
}

async fn store_part(
    storage: &Storage,
    folder: &Path,
    ids: Vec<u8>,
    docs: u32,
    written: &mut Written,
) -> Result<PartRef> {
    let mut files = Vec::new();
    let mut atomic = Vec::new();
    let mut blobs = Vec::new();
    let mut bytes = 0;
    for entry in std::fs::read_dir(folder).map_err(engine)? {
        let entry = entry.map_err(engine)?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".lock") || !entry.file_type().map_err(engine)?.is_file() {
            continue;
        }
        let content = std::fs::read(entry.path()).map_err(engine)?;
        if name == "meta.json" || name == ".managed.json" {
            atomic.push((name, content));
            continue;
        }
        let len = content.len() as u64;
        bytes += len;
        let hash = storage.put_blob(content).await?;
        files.push((name, hash, len));
        blobs.push(hash);
    }
    files.sort_by(|a, b| a.0.cmp(&b.0));
    let firsts = (ids.chunks(ID_BLOCK * ID_ENTRY))
        .map(|block| u64::from_le_bytes(block[..8].try_into().unwrap_or_default()))
        .collect();
    let id_len = ids.len() as u64;
    bytes += id_len;
    let id_blob = storage.put_blob(ids).await?;
    blobs.push(id_blob);

    let store = storage.store.clone();
    let listed = files.clone();
    let opened = atomic.clone();
    let mut ranges = blocking(move || -> Result<Vec<(Hash, std::ops::Range<usize>)>> {
        let files = Files {
            files: &listed,
            atomic: &opened,
            ranges: &[],
        };
        let recorder = BlobDir::recorder(store, files);
        searcher(recorder.clone())?;
        Ok(recorder.recorded())
    })
    .await??;
    for (name, hash, len) in &files {
        if name.ends_with(".term") {
            ranges.push((*hash, 0..*len as usize));
        }
    }
    let mut hot = Hot {
        files,
        atomic,
        ranges: Vec::new(),
        ids: IdMap {
            blob: id_blob,
            len: id_len,
            firsts,
        },
    };
    let store = storage.store.as_ref();
    for (hash, range) in dir::merge_ranges(ranges, 4096) {
        let piece = range.start as u64..range.end as u64;
        let got = store.get_range(&blob_path(hash), piece).await?;
        hot.ranges.push((hash, range.start as u64, got.to_vec()));
    }
    let encoded = hot.encode()?;
    let hot_bytes = encoded.len() as u64;
    let hot_hash = storage.put_blob(encoded).await?;
    written.blobs(blobs.iter().copied().chain([hot_hash]));
    Ok(PartRef {
        hot: hot_hash,
        hot_bytes,
        blobs,
        docs,
        dead: None,
        dead_docs: 0,
        bytes: bytes + hot_bytes,
    })
}

pub(crate) async fn find(
    storage: &Storage,
    ids: &IdMap,
    keys: &[u64],
) -> Result<BTreeMap<u64, u32>> {
    let mut wanted: BTreeMap<usize, Vec<u64>> = BTreeMap::new();
    for &key in keys {
        let block = ids.firsts.partition_point(|&first| first <= key);
        if block > 0 {
            wanted.entry(block - 1).or_default().push(key);
        }
    }
    let reads = wanted.into_iter().map(|(block, keys)| async move {
        let entries = block_of(storage, ids, block).await?;
        let mut found = Vec::new();
        for key in keys {
            let at = entries.partition_point(|entry| entry.0 < key);
            if let Some(&(k, doc)) = entries.get(at)
                && k == key
            {
                found.push((key, doc));
            }
        }
        Ok::<_, Error>(found)
    });
    Ok(try_join_all(reads).await?.into_iter().flatten().collect())
}

async fn block_of(storage: &Storage, ids: &IdMap, block: usize) -> Result<Arc<Vec<(u64, u32)>>> {
    let key = Hash::of(format!("{}/ids/{block}", ids.blob).as_bytes());
    if let Some(found) = storage.cache().get(key) {
        return Ok(found);
    }
    let start = (block * ID_BLOCK * ID_ENTRY) as u64;
    let end = (start + (ID_BLOCK * ID_ENTRY) as u64).min(ids.len);
    let bytes = storage.range(ids.blob, start..end).await?;
    let entries: Vec<(u64, u32)> = (bytes.as_chunks::<ID_ENTRY>().0.iter())
        .map(|entry| {
            let (key, doc) = entry.split_at(8);
            let key = u64::from_le_bytes(key.try_into().unwrap_or_default());
            let doc = u32::from_le_bytes(doc.try_into().unwrap_or_default());
            (key, doc)
        })
        .collect();
    let entries = Arc::new(entries);
    storage
        .cache()
        .insert(key, entries.clone(), bytes.len() + 64);
    Ok(entries)
}

pub(crate) async fn dead(storage: &Storage, part: &PartRef) -> Result<Option<Arc<Vec<u8>>>> {
    match part.dead {
        Some(hash) => Ok(Some(storage.get::<Vec<u8>>(hash).await?)),
        None => Ok(None),
    }
}

pub(crate) fn is_set(bits: &[u8], doc: u32) -> bool {
    bits.get(doc as usize / 8)
        .is_some_and(|byte| byte & (1 << (doc % 8)) != 0)
}

pub(crate) fn set(bits: &mut Vec<u8>, doc: u32) -> bool {
    let at = doc as usize / 8;
    if bits.len() <= at {
        bits.resize(at + 1, 0);
    }
    let was = bits[at] & (1 << (doc % 8)) != 0;
    bits[at] |= 1 << (doc % 8);
    !was
}

pub(crate) fn stored(doc: &TantivyDocument, fields: &Fields) -> Result<(Id, Attributes)> {
    let bytes = (doc.get_first(fields.doc))
        .and_then(|value| value.as_bytes())
        .ok_or_else(|| Error::Corrupt("a text part doc has no stored fields".into()))?;
    Ok(postcard::from_bytes(bytes)?)
}

pub(crate) async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|_| Error::Corrupt("a text task panicked".into()))
}
