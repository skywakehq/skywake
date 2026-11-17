use std::cmp::Reverse;
use std::collections::{BTreeMap, BinaryHeap};
use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::PathBuf;

use skywake_core::Hash;
use tantivy::fieldnorm::FieldNormReader;
use tantivy::postings::Postings;
use tantivy::schema::{Field, IndexRecordOption};
use tantivy::{DocSet, Index as Tantivy, SegmentReader, TERMINATED};

use super::span::{BEST, BLOCK, Best, Posting, encode};
use super::{Directory, ID_BLOCK, Place, PostingsRef, sum, term_key};
use crate::store::{Storage, Written};
use crate::text::engine;
use crate::text::part::{IdMap, blocking};
use crate::{Error, Id, Result};

const CHUNK: usize = 32 << 20;

const PER_BUCKET: u64 = 64;

const RUN: usize = 128 << 20;

const ID_ENTRY: usize = 12;

#[derive(Default)]
pub(crate) struct Known {
    keys: Vec<(u64, u64)>,
    bytes: Vec<u8>,
}

impl Known {
    pub(crate) fn add(&mut self, key: u64, id: &Id) -> Result<()> {
        self.keys.push((key, self.bytes.len() as u64));
        self.bytes.extend(postcard::to_stdvec(id)?);
        Ok(())
    }

    pub(crate) fn by_doc(mut self, entries: &[u8], docs: u32) -> Result<DocIds> {
        self.keys.sort_unstable();
        let mut starts = vec![u64::MAX; docs as usize];
        for entry in entries.as_chunks::<ID_ENTRY>().0 {
            let (key, doc) = entry.split_at(8);
            let key = u64::from_le_bytes(key.try_into().unwrap_or_default());
            let doc = u32::from_le_bytes(doc.try_into().unwrap_or_default());
            let at = self.keys.partition_point(|known| known.0 < key);
            let found = self.keys.get(at).filter(|known| known.0 == key);
            match (found, starts.get_mut(doc as usize)) {
                (Some(known), Some(start)) => *start = known.1,
                _ => return Err(Error::Corrupt(format!("text document {doc} has no id"))),
            }
        }
        Ok(DocIds {
            starts,
            bytes: self.bytes,
        })
    }
}

pub(crate) struct DocIds {
    starts: Vec<u64>,
    bytes: Vec<u8>,
}

impl DocIds {
    fn get(&self, doc: u32) -> Result<Id> {
        let bytes = (self.starts.get(doc as usize))
            .and_then(|&start| self.bytes.get(usize::try_from(start).ok()?..))
            .ok_or_else(|| Error::Corrupt(format!("text document {doc} has no id")))?;
        Ok(postcard::take_from_bytes(bytes)?.0)
    }
}

struct Chunks {
    folder: PathBuf,
    current: Vec<u8>,
    lens: Vec<u64>,
}

impl Chunks {
    fn new(folder: PathBuf) -> Self {
        Self {
            folder,
            current: Vec::new(),
            lens: Vec::new(),
        }
    }

    fn append(&mut self, bytes: &[u8]) -> Result<Place> {
        let len = bytes.len() + size_of::<u64>();
        if !self.current.is_empty() && self.current.len() + len > CHUNK {
            self.flush()?;
        }
        let place = Place {
            blob: u32::try_from(self.lens.len()).map_err(engine)?,
            start: self.current.len() as u64,
            len: len as u64,
        };
        self.current.extend_from_slice(&sum(bytes).to_le_bytes());
        self.current.extend_from_slice(bytes);
        Ok(place)
    }

    fn flush(&mut self) -> Result<()> {
        if !self.current.is_empty() {
            let path = self.folder.join(self.lens.len().to_string());
            std::fs::write(path, &self.current).map_err(engine)?;
            self.lens.push(self.current.len() as u64);
            self.current.clear();
        }
        Ok(())
    }
}

pub(crate) struct Draft {
    folder: tempfile::TempDir,
    lens: Vec<u64>,
    docs: u32,
    fields: Vec<(String, u64)>,
    buckets: Vec<Place>,
    long: Vec<(u64, Place)>,
    id_blocks: Vec<Place>,
}

struct Short {
    folder: PathBuf,
    buckets: u64,
    limit: usize,
    spans: Vec<u8>,
    places: Vec<(u64, usize, usize)>,
    runs: Vec<PathBuf>,
}

pub(crate) fn draft(
    index: &Tantivy,
    text: &BTreeMap<String, Field>,
    ids: &DocIds,
) -> Result<Draft> {
    let searcher = index.reader().map_err(engine)?.searcher();
    let [segment] = searcher.segment_readers() else {
        return Err(Error::Corrupt(
            "a text part has more than one segment".into(),
        ));
    };
    let folder = tempfile::tempdir().map_err(engine)?;
    let mut chunks = Chunks::new(folder.path().to_path_buf());
    let docs = segment.max_doc();
    let mut terms = 0u64;
    for &field in text.values() {
        terms += segment
            .inverted_index(field)
            .map_err(engine)?
            .terms()
            .num_terms() as u64;
    }
    let mut short = Short::new(folder.path().to_path_buf(), terms.div_ceil(PER_BUCKET), RUN);
    let (mut fields, mut long) = (Vec::new(), Vec::new());
    for (number, (name, &field)) in text.iter().enumerate() {
        let number = u16::try_from(number).map_err(engine)?;
        let mut terms = Terms {
            segment,
            ids,
            chunks: &mut chunks,
            long: &mut long,
            short: &mut short,
        };
        fields.push((name.clone(), terms.field(number, name, field)?));
    }
    long.sort_unstable_by_key(|(key, place)| (*key, place.blob, place.start));
    let buckets = short.store(&mut chunks)?;
    let mut id_blocks = Vec::with_capacity((docs as usize).div_ceil(ID_BLOCK));
    for first in (0..docs).step_by(ID_BLOCK) {
        let last = first.saturating_add(ID_BLOCK as u32).min(docs);
        let block: Vec<Id> = (first..last)
            .map(|doc| ids.get(doc))
            .collect::<Result<_>>()?;
        id_blocks.push(chunks.append(&postcard::to_stdvec(&block)?)?);
    }
    chunks.flush()?;
    Ok(Draft {
        folder,
        lens: chunks.lens,
        docs,
        fields,
        buckets,
        long,
        id_blocks,
    })
}

struct Terms<'a> {
    segment: &'a SegmentReader,
    ids: &'a DocIds,
    chunks: &'a mut Chunks,
    long: &'a mut Vec<(u64, Place)>,
    short: &'a mut Short,
}

impl Terms<'_> {
    fn field(&mut self, number: u16, name: &str, field: Field) -> Result<u64> {
        let inverted = self.segment.inverted_index(field).map_err(engine)?;
        let norms = self.segment.get_fieldnorms_reader(field).map_err(engine)?;
        let tokens = inverted.total_num_tokens();
        let average = tokens.max(1) as f32 / self.segment.max_doc().max(1) as f32;
        let mut stream = inverted.terms().stream().map_err(engine)?;
        let mut list: Vec<Posting> = Vec::new();
        while stream.advance() {
            let Ok(term) = std::str::from_utf8(stream.key()) else {
                continue;
            };
            let mut postings = inverted
                .read_postings_from_terminfo(stream.value(), IndexRecordOption::WithFreqs)
                .map_err(engine)?;
            list.clear();
            while postings.doc() != TERMINATED {
                let doc = postings.doc();
                list.push((doc, postings.term_freq(), norms.fieldnorm_id(doc)));
                postings.advance();
            }
            if list.is_empty() {
                continue;
            }
            let span = encode(number, term, &list, best(&list, average, self.ids)?)?;
            let key = term_key(name, term);
            match list.len() > BLOCK {
                true => self.long.push((key, self.chunks.append(&span)?)),
                false => self.short.add(key, &span)?,
            }
        }
        Ok(tokens)
    }
}

fn best(list: &[Posting], average: f32, ids: &DocIds) -> Result<Vec<Best>> {
    let mut heap: BinaryHeap<Reverse<(u32, Reverse<usize>)>> = BinaryHeap::with_capacity(BEST + 1);
    for (at, &(_, tf, norm)) in list.iter().enumerate() {
        let length = FieldNormReader::id_to_fieldnorm(norm) as f32;
        let impact = tf as f32 / (tf as f32 + 1.2 * (0.25 + 0.75 * length / average));
        heap.push(Reverse((impact.max(0.0).to_bits(), Reverse(at))));
        if heap.len() > BEST {
            heap.pop();
        }
    }
    let mut kept: Vec<usize> = heap.into_iter().map(|entry| entry.0.1.0).collect();
    kept.sort_unstable();
    kept.into_iter()
        .map(|at| {
            let (doc, tf, norm) = list[at];
            let id = ids.get(doc)?;
            Ok(Best { doc, tf, norm, id })
        })
        .collect()
}

impl Short {
    fn new(folder: PathBuf, buckets: u64, limit: usize) -> Self {
        Self {
            folder,
            buckets,
            limit,
            spans: Vec::new(),
            places: Vec::new(),
            runs: Vec::new(),
        }
    }

    fn add(&mut self, key: u64, span: &[u8]) -> Result<()> {
        let bucket = key % self.buckets.max(1);
        self.places.push((bucket, self.spans.len(), span.len()));
        self.spans.extend_from_slice(span);
        match self.spans.len() >= self.limit {
            true => self.spill(),
            false => Ok(()),
        }
    }

    fn spill(&mut self) -> Result<()> {
        if self.places.is_empty() {
            return Ok(());
        }
        self.places.sort_unstable();
        let path = self.folder.join(format!("run-{}", self.runs.len()));
        let mut file = BufWriter::new(File::create(&path).map_err(engine)?);
        for &(bucket, start, len) in &self.places {
            file.write_all(&bucket.to_le_bytes()).map_err(engine)?;
            file.write_all(&(len as u32).to_le_bytes())
                .map_err(engine)?;
            (file.write_all(&self.spans[start..start + len])).map_err(engine)?;
        }
        file.flush().map_err(engine)?;
        self.runs.push(path);
        self.places.clear();
        self.spans.clear();
        Ok(())
    }

    fn store(mut self, chunks: &mut Chunks) -> Result<Vec<Place>> {
        self.spill()?;
        let mut runs: Vec<Run> = (self.runs.iter()).map(Run::open).collect::<Result<_>>()?;
        let mut buckets = Vec::with_capacity(usize::try_from(self.buckets).map_err(engine)?);
        let mut bytes = Vec::new();
        for bucket in 0..self.buckets {
            bytes.clear();
            for run in &mut runs {
                run.take(bucket, &mut bytes)?;
            }
            buckets.push(match bytes.is_empty() {
                true => Place::default(),
                false => chunks.append(&bytes)?,
            });
        }
        for path in &self.runs {
            std::fs::remove_file(path).map_err(engine)?;
        }
        Ok(buckets)
    }
}

struct Run {
    file: BufReader<File>,
    next: Option<(u64, u32)>,
}

impl Run {
    fn open(path: &PathBuf) -> Result<Self> {
        let mut run = Self {
            file: BufReader::new(File::open(path).map_err(engine)?),
            next: None,
        };
        run.advance()?;
        Ok(run)
    }

    fn advance(&mut self) -> Result<()> {
        let mut head = [0u8; 12];
        self.next = match self.file.read_exact(&mut head) {
            Ok(()) => {
                let (bucket, len) = head.split_at(8);
                let bucket = u64::from_le_bytes(bucket.try_into().unwrap_or_default());
                Some((
                    bucket,
                    u32::from_le_bytes(len.try_into().unwrap_or_default()),
                ))
            }
            Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => None,
            Err(error) => return Err(engine(error)),
        };
        Ok(())
    }

    fn take(&mut self, bucket: u64, out: &mut Vec<u8>) -> Result<()> {
        while let Some((_, len)) = self.next.filter(|next| next.0 == bucket) {
            out.extend_from_slice(&len.to_le_bytes());
            let start = out.len();
            out.resize(start + len as usize, 0);
            self.file.read_exact(&mut out[start..]).map_err(engine)?;
            self.advance()?;
        }
        Ok(())
    }
}

impl Draft {
    pub(crate) async fn store(
        self,
        storage: &Storage,
        ids: IdMap,
        written: &mut Written,
    ) -> Result<PostingsRef> {
        let mut blobs: Vec<Hash> = Vec::with_capacity(self.lens.len() + 1);
        for number in 0..self.lens.len() {
            let path = self.folder.path().join(number.to_string());
            let content = blocking(move || std::fs::read(path))
                .await?
                .map_err(engine)?;
            let hash = storage.put_blob(content).await?;
            written.blobs([hash]);
            blobs.push(hash);
        }
        let directory = Directory {
            docs: self.docs,
            fields: self.fields,
            blobs: blobs.clone(),
            buckets: self.buckets,
            long: self.long,
            id_blocks: self.id_blocks,
            ids,
        };
        let encoded = directory.encode()?;
        let directory_bytes = encoded.len() as u64;
        let directory = storage.put_blob(encoded).await?;
        written.blobs([directory]);
        blobs.push(directory);
        Ok(PostingsRef {
            directory,
            directory_bytes,
            blobs,
            bytes: self.lens.iter().sum::<u64>() + directory_bytes,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::text::postings::span::Span;

    #[test]
    fn short_spans_reach_their_buckets_over_many_runs() {
        let folder = tempfile::tempdir().unwrap();
        let mut chunks = Chunks::new(folder.path().to_path_buf());
        let mut short = Short::new(folder.path().to_path_buf(), 7, 300);
        for key in 0..500u64 {
            let span = encode(0, &format!("t{key}"), &[(key as u32, 1, 3)], Vec::new()).unwrap();
            short.add(key * 31, &span).unwrap();
        }
        assert!(short.runs.len() > 3);
        let buckets = short.store(&mut chunks).unwrap();
        let (mut seen, sums) = (0, size_of::<u64>());
        for (bucket, place) in buckets.iter().enumerate() {
            let start = place.start as usize + sums;
            let mut rest = &chunks.current[start..place.start as usize + place.len as usize];
            while let Some((len, more)) = rest.split_first_chunk::<4>() {
                let (span, more) = more.split_at(u32::from_le_bytes(*len) as usize);
                let term = Span::parse(span).unwrap().head.term;
                let key: u64 = term[1..].parse().unwrap();
                assert_eq!((key * 31 % 7) as usize, bucket);
                seen += 1;
                rest = more;
            }
        }
        assert_eq!(seen, 500);
        assert_eq!(std::fs::read_dir(folder.path()).unwrap().count(), 0);
    }
}
