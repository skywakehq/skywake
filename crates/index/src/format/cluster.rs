//! A cluster blob: `[header][codes][attributes][vectors]`.

use std::collections::BTreeMap;
use std::ops::Range;

use serde::{Deserialize, Serialize};
use skywake_core::Hash;

use crate::filter::attrs::Attrs;
use crate::vector::ivf;
use crate::vector::rabitq::{self, Factors, Rotation};
use crate::{Attributes, Element, Error, Id, Kind, Result};

const MAGIC: [u8; 4] = *b"swc2";

const HEADER: usize = 4 + 4 + 4 + 4 + 4 * 8;

const FACTORS: usize = size_of::<Factors>();

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub(crate) struct ClusterRef {
    pub hash: Hash,
    pub rows: u64,
    pub offsets: [u64; 4],
    pub radius: f32,
    pub scale: f32,
    pub sums: [Hash; 2],
}

impl ClusterRef {
    pub(crate) fn bytes(&self) -> u64 {
        self.offsets[3]
    }

    pub(crate) fn codes(&self) -> Range<u64> {
        self.offsets[0]..self.offsets[1]
    }

    pub(crate) fn attributes(&self) -> Range<u64> {
        self.offsets[1]..self.offsets[2]
    }

    pub(crate) fn vectors(&self, rows: Range<usize>) -> Range<u64> {
        let size = (self.offsets[3] - self.offsets[2]) / self.rows.max(1);
        self.offsets[2] + rows.start as u64 * size..self.offsets[2] + rows.end as u64 * size
    }
}

#[derive(Default)]
pub(crate) struct Cluster {
    pub ids: Vec<Id>,
    pub seqs: Vec<u64>,
    pub vectors: Vec<f32>,
    pub attributes: Vec<Attributes>,
}

pub(crate) struct Coder<'a> {
    pub dims: usize,
    pub element: Element,
    pub rotation: &'a Rotation,
    pub centroid: &'a [f32],
    pub origin: &'a [f32],
    pub kinds: &'a BTreeMap<String, Kind>,
}

pub(crate) fn encode(cluster: &Cluster, coder: &Coder) -> Result<(Vec<u8>, ClusterRef)> {
    let dims = coder.dims;
    let rows = cluster.ids.len();
    let words = rabitq::words(dims);
    let mut bits = vec![0u64; rows * words];
    let mut factors = Vec::with_capacity(rows);
    let vectors = || cluster.vectors.chunks_exact(dims.max(1));
    let radius = vectors()
        .map(|v| ivf::squared_distance(v, coder.centroid))
        .fold(0.0f32, f32::max)
        .sqrt();
    let scale = anchor_scale(coder.centroid, vectors());
    let anchor: Vec<f32> = coder.centroid.iter().map(|x| x * scale).collect();
    let lift = coder.rotation.difference(&anchor, coder.origin);
    for (row, vector) in vectors().enumerate() {
        let out = &mut bits[row * words..(row + 1) * words];
        factors.push(rabitq::encode(coder.rotation, &anchor, &lift, vector, out));
    }
    let stored: Vec<u8> = to_bytes(&cluster.vectors, coder.element);
    let checks = (stored.chunks_exact((dims * coder.element.bytes()).max(1)))
        .map(checksum)
        .collect();
    let codes = Codes {
        bits,
        factors,
        checks,
        ids: cluster.ids.clone(),
    }
    .encode()?;
    let attrs = Attrs::new(cluster.seqs.clone(), &cluster.attributes, coder.kinds);
    let attrs = postcard::to_stdvec(&attrs)?;

    let codes_start = HEADER as u64;
    let attrs_start = codes_start + codes.len() as u64;
    let vectors_start = attrs_start + attrs.len() as u64;
    let offsets = [
        codes_start,
        attrs_start,
        vectors_start,
        vectors_start + stored.len() as u64,
    ];
    let mut blob = Vec::with_capacity(offsets[3] as usize);
    blob.extend(MAGIC);
    for n in [rows as u32, dims as u32, element_code(coder.element)] {
        blob.extend(n.to_le_bytes());
    }
    offsets.iter().for_each(|o| blob.extend(o.to_le_bytes()));
    blob.extend(codes);
    blob.extend(attrs);
    blob.extend(stored);
    let section = |i: usize| Hash::of(&blob[offsets[i] as usize..offsets[i + 1] as usize]);
    let stored = ClusterRef {
        hash: Hash::of(&blob),
        rows: rows as u64,
        offsets,
        radius,
        scale,
        sums: [section(0), section(1)],
    };
    Ok((blob, stored))
}

pub(crate) fn checksum(bytes: &[u8]) -> u64 {
    let hash = blake3::hash(bytes);
    u64::from_le_bytes(hash.as_bytes()[..8].try_into().unwrap())
}

fn anchor_scale<'a>(centroid: &[f32], rows: impl Iterator<Item = &'a [f32]>) -> f32 {
    let length = ivf::dot(centroid, centroid);
    let (mut sum, mut count) = (0.0f64, 0usize);
    for row in rows {
        sum += ivf::dot(row, centroid) as f64;
        count += 1;
    }
    match length > 0.0 && count > 0 {
        true => (sum / count as f64 / length as f64) as f32,
        false => 1.0,
    }
}

pub(crate) fn decode(blob: &[u8]) -> Result<Cluster> {
    let corrupt = || Error::Corrupt("a cluster blob is damaged".into());
    let header = blob.get(..HEADER).ok_or_else(corrupt)?;
    if header[..4] != MAGIC {
        return Err(Error::Corrupt("a cluster blob is not in format 2".into()));
    }
    let number = |at: usize| u32::from_le_bytes(header[at..at + 4].try_into().unwrap());
    let (rows, dims) = (number(4) as usize, number(8) as usize);
    let element = match number(12) {
        0 => Element::F32,
        1 => Element::F16,
        2 => Element::I8,
        other => return Err(Error::Corrupt(format!("no vector type {other}"))),
    };
    let offset = |i: usize| {
        let at = 16 + 8 * i;
        u64::from_le_bytes(header[at..at + 8].try_into().unwrap()) as usize
    };
    let section = |i: usize| blob.get(offset(i)..offset(i + 1)).ok_or_else(corrupt);
    let codes = Codes::decode(section(0)?, rows, dims)?;
    let attrs: Attrs = postcard::from_bytes(section(1)?)?;
    Ok(Cluster {
        attributes: (0..rows).map(|row| attrs.row(row, None)).collect(),
        ids: codes.ids,
        seqs: attrs.seqs,
        vectors: from_bytes(section(2)?, element),
    })
}

#[derive(Default)]
pub(crate) struct Codes {
    pub bits: Vec<u64>,
    pub factors: Vec<Factors>,
    pub checks: Vec<u64>,
    pub ids: Vec<Id>,
}

impl Codes {
    pub(crate) fn decode(bytes: &[u8], rows: usize, dims: usize) -> Result<Self> {
        let words = rabitq::words(dims);
        let (bits, rest) = bytes
            .split_at_checked(rows * words * 8)
            .ok_or_else(|| Error::Corrupt("a cluster's codes are cut short".into()))?;
        let (factors, rest) = rest
            .split_at_checked(rows * FACTORS)
            .ok_or_else(|| Error::Corrupt("a cluster's codes are cut short".into()))?;
        let (checks, ids) = rest
            .split_at_checked(rows * 8)
            .ok_or_else(|| Error::Corrupt("a cluster's codes are cut short".into()))?;
        let floats = floats(factors);
        Ok(Self {
            bits: (bits.as_chunks::<8>().0.iter())
                .map(|b| u64::from_le_bytes(*b))
                .collect(),
            factors: floats.as_chunks::<4>().0.to_vec(),
            checks: (checks.as_chunks::<8>().0.iter())
                .map(|b| u64::from_le_bytes(*b))
                .collect(),
            ids: postcard::from_bytes(ids)?,
        })
    }

    pub(crate) fn encode(&self) -> Result<Vec<u8>> {
        let mut out = Vec::with_capacity(8 * self.bits.len() + (FACTORS + 8) * self.checks.len());
        self.bits.iter().for_each(|w| out.extend(w.to_le_bytes()));
        (self.factors.iter().flatten()).for_each(|f| out.extend(f.to_le_bytes()));
        self.checks.iter().for_each(|c| out.extend(c.to_le_bytes()));
        out.extend(postcard::to_stdvec(&self.ids)?);
        Ok(out)
    }

    pub(crate) fn push(&mut self, from: &Codes, row: usize, words: usize) {
        (self.bits).extend_from_slice(&from.bits[row * words..(row + 1) * words]);
        self.factors.push(from.factors[row]);
        self.checks.push(from.checks[row]);
        self.ids.push(from.ids[row].clone());
    }

    pub(crate) fn zeros(rows: usize, words: usize) -> Self {
        Self {
            bits: vec![0; rows * words],
            factors: vec![[0.0; 4]; rows],
            checks: vec![0; rows],
            ids: vec![Id::Num(0); rows],
        }
    }

    pub(crate) fn set(&mut self, at: usize, from: &Codes, row: usize, words: usize) {
        (self.bits[at * words..(at + 1) * words])
            .copy_from_slice(&from.bits[row * words..(row + 1) * words]);
        self.factors[at] = from.factors[row];
        self.checks[at] = from.checks[row];
        self.ids[at] = from.ids[row].clone();
    }

    pub(crate) fn weight(&self) -> usize {
        8 * self.bits.len() + (FACTORS + 8) * self.factors.len() + 24 * self.ids.len()
    }
}

fn element_code(element: Element) -> u32 {
    match element {
        Element::F32 => 0,
        Element::F16 => 1,
        Element::I8 => 2,
    }
}

pub(crate) fn to_bytes(vectors: &[f32], element: Element) -> Vec<u8> {
    match element {
        Element::F32 => vectors.iter().flat_map(|x| x.to_le_bytes()).collect(),
        Element::F16 => (vectors.iter())
            .flat_map(|&x| half::f16::from_f32(x).to_le_bytes())
            .collect(),
        Element::I8 => vectors.iter().map(|&x| x as i8 as u8).collect(),
    }
}

pub(crate) fn from_bytes(bytes: &[u8], element: Element) -> Vec<f32> {
    match element {
        Element::F32 => floats(bytes),
        Element::F16 => (bytes.as_chunks::<2>().0.iter())
            .map(|b| half::f16::from_le_bytes(*b).to_f32())
            .collect(),
        Element::I8 => bytes.iter().map(|&b| b as i8 as f32).collect(),
    }
}

pub(crate) fn floats(bytes: &[u8]) -> Vec<f32> {
    (bytes.as_chunks::<4>().0.iter())
        .map(|b| f32::from_le_bytes(*b))
        .collect()
}
