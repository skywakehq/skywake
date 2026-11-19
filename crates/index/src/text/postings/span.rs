use serde::{Deserialize, Serialize};

use super::pack::{PAD, pack, packed_len, unpack, width};
use crate::{Error, Id, Result};

pub(crate) const BLOCK: usize = 128;

pub(crate) const BEST: usize = 32;

const META: usize = 17;

pub(crate) type Posting = (u32, u32, u8);

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct Best {
    pub doc: u32,
    pub tf: u32,
    pub norm: u8,
    pub id: Option<Id>,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct Head {
    pub field: u16,
    pub term: String,
    pub df: u32,
    pub max_tf: u32,
    pub min_norm: u8,
    pub best: Vec<Best>,
    blocks: u32,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct Meta {
    pub last: u32,
    pub max_tf: u32,
    pub min_norm: u8,
    start: u32,
    doc_bits: u8,
    tf_bits: u8,
    norm_bits: u8,
    count: u8,
}

impl Meta {
    fn count(&self) -> usize {
        self.count as usize + 1
    }

    fn docs_len(&self) -> usize {
        packed_len(self.count(), self.doc_bits)
    }

    fn tfs_len(&self) -> usize {
        packed_len(self.count(), self.tf_bits)
    }

    fn norms_len(&self) -> usize {
        packed_len(self.count(), self.norm_bits)
    }

    fn end(&self) -> u64 {
        self.start as u64 + (self.docs_len() + self.tfs_len() + self.norms_len()) as u64
    }

    fn write(&self, out: &mut Vec<u8>) {
        out.extend_from_slice(&self.last.to_le_bytes());
        out.extend_from_slice(&self.max_tf.to_le_bytes());
        out.extend_from_slice(&self.start.to_le_bytes());
        out.extend_from_slice(&[
            self.min_norm,
            self.doc_bits,
            self.tf_bits,
            self.norm_bits,
            self.count,
        ]);
    }

    fn read(raw: &[u8; META]) -> Self {
        let word = |at: usize| u32::from_le_bytes([raw[at], raw[at + 1], raw[at + 2], raw[at + 3]]);
        Self {
            last: word(0),
            max_tf: word(4),
            start: word(8),
            min_norm: raw[12],
            doc_bits: raw[13],
            tf_bits: raw[14],
            norm_bits: raw[15],
            count: raw[16],
        }
    }
}

#[derive(Debug)]
pub(crate) struct Span {
    pub head: Head,
    pub metas: Vec<Meta>,
    data: Vec<u8>,
}

pub(crate) fn encode(
    field: u16,
    term: &str,
    postings: &[Posting],
    best: Vec<Best>,
) -> Result<Vec<u8>> {
    let mut metas = Vec::with_capacity(postings.len().div_ceil(BLOCK) * META);
    let mut data = Vec::new();
    let mut base = 0u32;
    let mut gaps = [0u32; BLOCK];
    let mut tfs = [0u32; BLOCK];
    let mut norms = [0u32; BLOCK];
    for block in postings.chunks(BLOCK) {
        let mut before = base;
        for (i, &(doc, tf, _)) in block.iter().enumerate() {
            gaps[i] = doc - before;
            tfs[i] = tf.max(1) - 1;
            before = doc + 1;
        }
        let min_norm = block.iter().map(|p| p.2).min().unwrap_or(0);
        for (i, &(_, _, norm)) in block.iter().enumerate() {
            norms[i] = (norm - min_norm) as u32;
        }
        let count = block.len();
        let (gaps, tfs, norms) = (&gaps[..count], &tfs[..count], &norms[..count]);
        let meta = Meta {
            last: block[count - 1].0,
            max_tf: block.iter().map(|p| p.1.max(1)).max().unwrap_or(1),
            min_norm,
            start: u32::try_from(data.len()).map_err(|_| too_long(term))?,
            doc_bits: width(gaps.iter().copied().max().unwrap_or(0)),
            tf_bits: width(tfs.iter().copied().max().unwrap_or(0)),
            norm_bits: width(norms.iter().copied().max().unwrap_or(0)),
            count: (count - 1) as u8,
        };
        pack(gaps, meta.doc_bits, &mut data);
        pack(tfs, meta.tf_bits, &mut data);
        pack(norms, meta.norm_bits, &mut data);
        meta.write(&mut metas);
        base = meta.last + 1;
    }
    u32::try_from(data.len() + PAD).map_err(|_| too_long(term))?;
    let best = match best.len() == postings.len() && best.iter().all(|b| b.id.is_none()) {
        true => Vec::new(),
        false => best,
    };
    let head = postcard::to_stdvec(&Head {
        field,
        term: term.to_string(),
        df: postings.len() as u32,
        max_tf: postings.iter().map(|p| p.1.max(1)).max().unwrap_or(1),
        min_norm: postings.iter().map(|p| p.2).min().unwrap_or(0),
        best,
        blocks: postings.len().div_ceil(BLOCK) as u32,
    })?;
    let mut out = Vec::with_capacity(4 + head.len() + metas.len() + data.len() + PAD);
    out.extend_from_slice(&(head.len() as u32).to_le_bytes());
    out.extend_from_slice(&head);
    out.extend_from_slice(&metas);
    out.extend_from_slice(&data);
    out.extend_from_slice(&[0; PAD]);
    Ok(out)
}

fn too_long(term: &str) -> Error {
    Error::Corrupt(format!("the postings of `{term}` are longer than 4 GiB"))
}

fn broken(what: &str) -> Error {
    Error::Corrupt(format!("a posting span {what}"))
}

impl Span {
    pub(crate) fn parse(bytes: &[u8]) -> Result<Self> {
        let (len, rest) = bytes
            .split_first_chunk::<4>()
            .ok_or_else(|| broken("is cut short"))?;
        let len = u32::from_le_bytes(*len) as usize;
        let (head, rest) = rest
            .split_at_checked(len)
            .ok_or_else(|| broken("has no head"))?;
        let head: Head = postcard::from_bytes(head)?;
        let blocks = head.blocks as usize;
        let (metas, data) = (blocks.checked_mul(META))
            .and_then(|len| rest.split_at_checked(len))
            .ok_or_else(|| broken("has no block index"))?;
        let metas: Vec<Meta> = metas.as_chunks::<META>().0.iter().map(Meta::read).collect();
        let mut span = Self {
            head,
            metas,
            data: data.to_vec(),
        };
        span.check()?;
        if span.head.best.is_empty() && span.head.df as usize <= BEST {
            span.head.best = (span.postings().into_iter())
                .map(|(doc, tf, norm)| Best {
                    doc,
                    tf,
                    norm,
                    id: None,
                })
                .collect();
        }
        Ok(span)
    }

    fn check(&self) -> Result<()> {
        let (mut count, mut next) = (0usize, 0u64);
        for meta in &self.metas {
            let fits = meta.end() + PAD as u64 <= self.data.len() as u64;
            let ordered = meta.last as u64 + 1 >= next + meta.count() as u64;
            if !fits
                || !ordered
                || meta.doc_bits > 32
                || meta.tf_bits > 32
                || meta.norm_bits > 8
                || meta.count() > BLOCK
            {
                return Err(broken("has a block out of place"));
            }
            if meta.last == u32::MAX {
                return Err(broken("names a document past the last"));
            }
            count += meta.count();
            next = meta.last as u64 + 1;
        }
        if count != self.head.df as usize {
            return Err(broken("does not hold its document count"));
        }
        Ok(())
    }

    pub(crate) fn weight(&self) -> usize {
        let ids = (self.head.best.iter()).map(|best| match &best.id {
            Some(Id::Str(text)) => 48 + text.len(),
            _ => 48,
        });
        256 + self.data.len()
            + self.metas.len() * size_of::<Meta>()
            + self.head.term.len()
            + ids.sum::<usize>()
    }

    pub(crate) fn docs(&self, block: usize, out: &mut [u32; BLOCK]) -> usize {
        let meta = &self.metas[block];
        let count = meta.count();
        unpack(
            &self.data[meta.start as usize..],
            meta.doc_bits,
            &mut out[..count],
        );
        let mut next = match block {
            0 => 0,
            _ => self.metas[block - 1].last.wrapping_add(1),
        };
        for doc in &mut out[..count] {
            *doc = next.wrapping_add(*doc);
            next = doc.wrapping_add(1);
        }
        count
    }

    pub(crate) fn tfs(&self, block: usize, out: &mut [u32; BLOCK]) {
        let meta = &self.metas[block];
        let start = meta.start as usize + meta.docs_len();
        unpack(&self.data[start..], meta.tf_bits, &mut out[..meta.count()]);
        for tf in &mut out[..meta.count()] {
            *tf = tf.saturating_add(1);
        }
    }

    pub(crate) fn norms(&self, block: usize, out: &mut [u8; BLOCK]) {
        let meta = &self.metas[block];
        let start = meta.start as usize + meta.docs_len() + meta.tfs_len();
        let mut raw = [0u32; BLOCK];
        unpack(
            &self.data[start..],
            meta.norm_bits,
            &mut raw[..meta.count()],
        );
        for (norm, raw) in out.iter_mut().zip(&raw[..meta.count()]) {
            *norm = meta.min_norm.saturating_add(*raw as u8);
        }
    }

    pub(crate) fn postings(&self) -> Vec<Posting> {
        let (mut docs, mut tfs, mut norms) = ([0; BLOCK], [0; BLOCK], [0; BLOCK]);
        let mut all = Vec::with_capacity(self.head.df as usize);
        for block in 0..self.metas.len() {
            let count = self.docs(block, &mut docs);
            self.tfs(block, &mut tfs);
            self.norms(block, &mut norms);
            all.extend((0..count).map(|i| (docs[i], tfs[i], norms[i])));
        }
        all
    }
}
