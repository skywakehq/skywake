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
use super::{Directory, ID_BLOCK, Names, Place, PostingsRef, sum, term_key};
use crate::store::{Storage, Written};
use crate::text::engine;
use crate::text::part::{IdMap, blocking};
use crate::{Error, Id, Result};

const CHUNK: usize = 32 << 20;

const PER_BUCKET: u64 = 64;

const RUN: usize = 128 << 20;

const WORKERS: usize = 8;

#[derive(Default)]
pub(crate) struct Known {
    starts: Vec<u64>,
    bytes: Vec<u8>,
}

impl Known {
    pub(crate) fn add(&mut self, id: &Id) -> Result<()> {
        self.starts.push(self.bytes.len() as u64);
        self.bytes.extend(postcard::to_stdvec(id)?);
        Ok(())
    }

    pub(crate) fn by_doc(self, order: &[u32]) -> Result<DocIds> {
        let starts = (order.iter().enumerate())
            .map(|(doc, &at)| {
                (self.starts.get(at as usize).copied())
                    .ok_or_else(|| Error::Corrupt(format!("text document {doc} has no id")))
            })
            .collect::<Result<_>>()?;
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
    first: u32,
}

impl Chunks {
    fn new(folder: PathBuf) -> Self {
        Self {
            folder,
            current: Vec::new(),
            lens: Vec::new(),
            first: 0,
        }
    }

    fn append(&mut self, bytes: &[u8]) -> Result<Place> {
        let len = bytes.len() + size_of::<u64>();
        if !self.current.is_empty() && self.current.len() + len > CHUNK {
            self.flush()?;
        }
        let place = Place {
            blob: (u32::try_from(self.lens.len()).ok())
                .and_then(|at| at.checked_add(self.first))
                .ok_or_else(|| engine("too many posting blobs"))?,
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
    _folder: tempfile::TempDir,
    files: Vec<(PathBuf, u64)>,
    docs: u32,
    fields: Vec<(String, u64)>,
    buckets: Vec<Place>,
    long: Vec<(u64, Place)>,
    names: Names,
}

struct Short {
    folder: PathBuf,
    buckets: u64,
    limit: usize,
    spans: Vec<u8>,
    places: Vec<(u64, usize, usize)>,
    runs: Vec<PathBuf>,
}

struct Job {
    number: u16,
    name: String,
    field: Field,
    from: Option<Vec<u8>>,
    to: Option<Vec<u8>>,
}

struct Piece {
    chunks: Chunks,
    long: Vec<(u64, Place)>,
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
    let docs = segment.max_doc();
    let workers = WORKERS;
    let (mut terms, mut fields, mut jobs) = (0u64, Vec::new(), Vec::new());
    for (number, (name, &field)) in text.iter().enumerate() {
        let number = u16::try_from(number).map_err(engine)?;
        let inverted = segment.inverted_index(field).map_err(engine)?;
        let count = inverted.terms().num_terms() as u64;
        terms += count;
        fields.push((name.clone(), inverted.total_num_tokens()));
        let mut cuts = vec![None];
        for i in 1..workers as u64 {
            let mut bytes = Vec::new();
            if inverted
                .terms()
                .ord_to_term(i * count / workers as u64, &mut bytes)
                .map_err(engine)?
            {
                cuts.push(Some(bytes));
            }
        }
        cuts.dedup();
        cuts.push(None);
        for pair in cuts.windows(2) {
            jobs.push(Job {
                number,
                name: name.clone(),
                field,
                from: pair[0].clone(),
                to: pair[1].clone(),
            });
        }
    }
    let runs = Names::runs(docs, |doc| ids.get(doc))?;
    let named = runs.is_some();
    let buckets = terms.div_ceil(PER_BUCKET);
    let pieces: Vec<Piece> = std::thread::scope(|scope| {
        let jobs = &jobs;
        let handles: Vec<_> = (0..workers)
            .map(|worker| {
                let folder = folder.path().join(format!("w{worker}"));
                scope.spawn(move || -> Result<Piece> {
                    std::fs::create_dir_all(&folder).map_err(engine)?;
                    let mut piece = Piece {
                        chunks: Chunks::new(folder.clone()),
                        long: Vec::new(),
                        runs: Vec::new(),
                    };
                    let mut short = Short::new(folder, buckets, RUN / 2);
                    for job in jobs.iter().skip(worker).step_by(workers) {
                        let mut terms = Terms {
                            segment,
                            ids,
                            named,
                            chunks: &mut piece.chunks,
                            long: &mut piece.long,
                            short: &mut short,
                        };
                        terms.field(job)?;
                    }
                    short.spill()?;
                    piece.chunks.flush()?;
                    piece.runs = std::mem::take(&mut short.runs);
                    Ok(piece)
                })
            })
            .collect();
        (handles.into_iter())
            .map(|handle| {
                handle
                    .join()
                    .unwrap_or_else(|panic| std::panic::resume_unwind(panic))
            })
            .collect::<Result<_>>()
    })?;
    let (mut files, mut long, mut short) = (
        Vec::new(),
        Vec::new(),
        Short::new(folder.path().to_path_buf(), buckets, RUN),
    );
    for piece in pieces {
        let offset = u32::try_from(files.len()).map_err(engine)?;
        long.extend(piece.long.into_iter().map(|(key, place)| {
            (
                key,
                Place {
                    blob: place.blob + offset,
                    ..place
                },
            )
        }));
        files.extend(
            (piece.chunks.lens.iter().enumerate())
                .map(|(at, &len)| (piece.chunks.folder.join(at.to_string()), len)),
        );
        short.runs.extend(piece.runs);
    }
    long.sort_unstable_by_key(|(key, place)| (*key, place.blob, place.start));
    let main = folder.path().join("main");
    std::fs::create_dir_all(&main).map_err(engine)?;
    let mut chunks = Chunks::new(main);
    chunks.first = u32::try_from(files.len()).map_err(engine)?;
    let buckets = short.store(&mut chunks)?;
    let names = match runs {
        Some(runs) => Names::Runs(runs),
        None => {
            let mut blocks = Vec::with_capacity((docs as usize).div_ceil(ID_BLOCK));
            for first in (0..docs).step_by(ID_BLOCK) {
                let last = first.saturating_add(ID_BLOCK as u32).min(docs);
                let block: Vec<Id> = (first..last)
                    .map(|doc| ids.get(doc))
                    .collect::<Result<_>>()?;
                blocks.push(chunks.append(&postcard::to_stdvec(&block)?)?);
            }
            Names::Blocks(blocks)
        }
    };
    chunks.flush()?;
    files.extend(
        (chunks.lens.iter().enumerate())
            .map(|(at, &len)| (chunks.folder.join(at.to_string()), len)),
    );
    Ok(Draft {
        _folder: folder,
        files,
        docs,
        fields,
        buckets,
        long,
        names,
    })
}

struct Terms<'a> {
    segment: &'a SegmentReader,
    ids: &'a DocIds,
    named: bool,
    chunks: &'a mut Chunks,
    long: &'a mut Vec<(u64, Place)>,
    short: &'a mut Short,
}

impl Terms<'_> {
    fn field(&mut self, job: &Job) -> Result<()> {
        let inverted = self.segment.inverted_index(job.field).map_err(engine)?;
        let norms = self
            .segment
            .get_fieldnorms_reader(job.field)
            .map_err(engine)?;
        let tokens = inverted.total_num_tokens();
        let average = tokens.max(1) as f32 / self.segment.max_doc().max(1) as f32;
        let mut range = inverted.terms().range();
        if let Some(from) = &job.from {
            range = range.ge(from);
        }
        if let Some(to) = &job.to {
            range = range.lt(to);
        }
        let mut stream = range.into_stream().map_err(engine)?;
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
            let best = best(&list, average, self.ids, self.named)?;
            let span = encode(job.number, term, &list, best)?;
            let key = term_key(&job.name, term);
            match list.len() > BLOCK {
                true => self.long.push((key, self.chunks.append(&span)?)),
                false => self.short.add(key, &span)?,
            }
        }
        Ok(())
    }
}

fn best(list: &[Posting], average: f32, ids: &DocIds, named: bool) -> Result<Vec<Best>> {
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
            let id = match named {
                true => None,
                false => Some(ids.get(doc)?),
            };
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
        let mut blobs: Vec<Hash> = Vec::with_capacity(self.files.len() + 1);
        for (path, _) in &self.files {
            let path = path.clone();
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
            names: self.names,
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
            bytes: self.files.iter().map(|(_, len)| len).sum::<u64>() + directory_bytes,
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
