//! Older Version formats. These types never change, so old indexes still open.

use std::collections::{BTreeMap, BTreeSet};

use serde::Deserialize;
use skywake_core::Hash;

use super::pages::Pages;
use super::{Ann, Clusters, FORMAT, SegmentRef, Version};
use crate::filter::FilterPart;
use crate::text::part::TextIndex;
use crate::text::{Language, TextOptions};
use crate::vector::calibrate::Calibration;
use crate::{Column, Element, IdKind, Kind, Metric, Result, Schema};

#[derive(Deserialize)]
pub(crate) struct OldColumn {
    dims: usize,
    metric: Metric,
}

fn columns(old: BTreeMap<String, OldColumn>) -> BTreeMap<String, Column> {
    (old.into_iter())
        .map(|(name, c)| {
            let column = Column {
                dims: c.dims,
                metric: c.metric,
                element: Element::F32,
            };
            (name, column)
        })
        .collect()
}

#[derive(Deserialize)]
pub(crate) struct OldClusters {
    centroids: Hash,
    table: Pages,
    seed: u64,
    calibration: Calibration,
}

#[derive(Deserialize)]
pub(crate) struct OldAnn {
    columns: BTreeMap<String, OldClusters>,
    rows: Vec<Hash>,
    rows_bytes: u64,
    live: u64,
    full_rows: u64,
    removed: u64,
    filters: Hash,
}

impl From<OldAnn> for AnnV7 {
    fn from(old: OldAnn) -> Self {
        let columns = (old.columns.into_iter())
            .map(|(name, c)| {
                let clusters = ClustersV9 {
                    centroids: c.centroids,
                    origin: None,
                    table: c.table,
                    seed: c.seed,
                    calibration: c.calibration,
                };
                (name, clusters)
            })
            .collect();
        Self {
            columns,
            rows: old.rows,
            rows_bytes: old.rows_bytes,
            live: old.live,
            full_rows: old.full_rows,
            removed: old.removed,
            filters: old.filters,
        }
    }
}

#[derive(Deserialize)]
#[cfg_attr(test, derive(serde::Serialize))]
pub(crate) struct ClustersV9 {
    pub centroids: Hash,
    pub origin: Option<Hash>,
    pub table: Pages,
    pub seed: u64,
    pub calibration: Calibration,
}

impl From<ClustersV9> for Clusters {
    fn from(c: ClustersV9) -> Self {
        Self {
            centroids: c.centroids,
            origin: c.origin,
            table: c.table,
            seed: c.seed,
            calibration: c.calibration,
            directory: None,
        }
    }
}

fn clusters_v9(old: BTreeMap<String, ClustersV9>) -> BTreeMap<String, Clusters> {
    (old.into_iter())
        .map(|(name, c)| (name, c.into()))
        .collect()
}

#[cfg(test)]
impl From<&Clusters> for ClustersV9 {
    fn from(c: &Clusters) -> Self {
        Self {
            centroids: c.centroids,
            origin: c.origin,
            table: c.table.clone(),
            seed: c.seed,
            calibration: c.calibration.clone(),
        }
    }
}

#[derive(Deserialize)]
#[cfg_attr(test, derive(serde::Serialize))]
pub(crate) struct AnnV9 {
    columns: BTreeMap<String, ClustersV9>,
    rows: Vec<Hash>,
    rows_bytes: u64,
    live: u64,
    full_rows: u64,
    removed: u64,
    filters: Hash,
    parts: BTreeMap<String, FilterPart>,
}

impl From<AnnV9> for Ann {
    fn from(old: AnnV9) -> Self {
        Self {
            columns: clusters_v9(old.columns),
            rows: old.rows,
            rows_bytes: old.rows_bytes,
            live: old.live,
            full_rows: old.full_rows,
            removed: old.removed,
            filters: old.filters,
            parts: old.parts,
        }
    }
}

#[derive(Deserialize)]
#[cfg_attr(test, derive(serde::Serialize))]
pub(crate) struct AnnV7 {
    pub columns: BTreeMap<String, ClustersV9>,
    pub rows: Vec<Hash>,
    pub rows_bytes: u64,
    pub live: u64,
    pub full_rows: u64,
    pub removed: u64,
    pub filters: Hash,
}

impl From<AnnV7> for Ann {
    fn from(old: AnnV7) -> Self {
        Self {
            columns: clusters_v9(old.columns),
            rows: old.rows,
            rows_bytes: old.rows_bytes,
            live: old.live,
            full_rows: old.full_rows,
            removed: old.removed,
            filters: old.filters,
            parts: BTreeMap::new(),
        }
    }
}

#[cfg(test)]
impl From<&Ann> for AnnV7 {
    fn from(ann: &Ann) -> Self {
        let columns = (ann.columns.iter())
            .map(|(name, c)| (name.clone(), ClustersV9::from(c)))
            .collect();
        Self {
            columns,
            rows: ann.rows.clone(),
            rows_bytes: ann.rows_bytes,
            live: ann.live,
            full_rows: ann.full_rows,
            removed: ann.removed,
            filters: ann.filters,
        }
    }
}

fn ann(old: Option<OldAnn>) -> Option<Ann> {
    old.map(|old| AnnV7::from(old).into())
}

#[derive(Deserialize)]
pub(crate) struct OldTextOptions {
    k1: f32,
    b: f32,
}

fn text_options(old: BTreeMap<String, OldTextOptions>) -> BTreeMap<String, TextOptions> {
    (old.into_iter())
        .map(|(name, o)| {
            let options = TextOptions {
                k1: o.k1,
                b: o.b,
                ..TextOptions::default()
            };
            (name, options)
        })
        .collect()
}

#[derive(Deserialize)]
pub(crate) struct OldSchema {
    vectors: BTreeMap<String, Column>,
    attributes: BTreeMap<String, Kind>,
    text: BTreeMap<String, OldTextOptions>,
}

impl From<OldSchema> for Schema {
    fn from(old: OldSchema) -> Self {
        Self {
            vectors: old.vectors,
            attributes: old.attributes,
            text: text_options(old.text),
            ..Schema::default()
        }
    }
}

#[derive(Deserialize)]
pub(crate) struct V2 {
    _format: u32,
    pub parent: Option<Hash>,
    pub schema: (BTreeMap<String, OldColumn>, BTreeMap<String, Kind>),
    pub built: Pages,
    pub tail: Vec<SegmentRef>,
    pub ann: Option<OldAnn>,
    pub next_seq: u64,
}

impl From<V2> for Version {
    fn from(old: V2) -> Self {
        let (vectors, attributes) = old.schema;
        Self {
            format: FORMAT,
            parent: old.parent,
            schema: Schema {
                vectors: columns(vectors),
                attributes,
                ..Schema::default()
            },
            built: old.built,
            tail: old.tail,
            ann: ann(old.ann),
            next_seq: old.next_seq,
            text: None,
        }
    }
}

#[derive(Deserialize)]
pub(crate) struct V3 {
    _format: u32,
    pub parent: Option<Hash>,
    pub schema: (
        BTreeMap<String, OldColumn>,
        BTreeMap<String, Kind>,
        BTreeMap<String, OldTextOptions>,
    ),
    pub built: Pages,
    pub tail: Vec<SegmentRef>,
    pub ann: Option<OldAnn>,
    pub next_seq: u64,
    pub text: Option<TextIndex>,
}

impl From<V3> for Version {
    fn from(old: V3) -> Self {
        let (vectors, attributes, text) = old.schema;
        Self {
            format: FORMAT,
            parent: old.parent,
            schema: Schema {
                vectors: columns(vectors),
                attributes,
                text: text_options(text),
                ..Schema::default()
            },
            built: old.built,
            tail: old.tail,
            ann: ann(old.ann),
            next_seq: old.next_seq,
            text: old.text,
        }
    }
}

#[derive(Deserialize)]
pub(crate) struct V4 {
    _format: u32,
    pub parent: Option<Hash>,
    pub schema: OldSchema,
    pub built: Pages,
    pub tail: Vec<SegmentRef>,
    pub ann: Option<OldAnn>,
    pub next_seq: u64,
    pub text: Option<TextIndex>,
}

impl From<V4> for Version {
    fn from(old: V4) -> Self {
        Self {
            format: FORMAT,
            parent: old.parent,
            schema: old.schema.into(),
            built: old.built,
            tail: old.tail,
            ann: ann(old.ann),
            next_seq: old.next_seq,
            text: old.text,
        }
    }
}

#[derive(Deserialize)]
pub(crate) struct V5 {
    _format: u32,
    pub parent: Option<Hash>,
    pub schema: OldSchema,
    pub built: Pages,
    pub tail: Vec<SegmentRef>,
    pub ann: Option<AnnV7>,
    pub next_seq: u64,
    pub text: Option<TextIndex>,
}

impl From<V5> for Version {
    fn from(old: V5) -> Self {
        Self {
            format: FORMAT,
            parent: old.parent,
            schema: old.schema.into(),
            built: old.built,
            tail: old.tail,
            ann: old.ann.map(Ann::from),
            next_seq: old.next_seq,
            text: old.text,
        }
    }
}

#[derive(Deserialize)]
pub(crate) struct SchemaV6 {
    vectors: BTreeMap<String, Column>,
    attributes: BTreeMap<String, Kind>,
    text: BTreeMap<String, TextOptionsV8>,
}

impl From<SchemaV6> for Schema {
    fn from(old: SchemaV6) -> Self {
        Self {
            vectors: old.vectors,
            attributes: old.attributes,
            text: texts_v8(old.text),
            ..Schema::default()
        }
    }
}

#[derive(Deserialize)]
pub(crate) struct V6 {
    _format: u32,
    pub parent: Option<Hash>,
    pub schema: SchemaV6,
    pub built: Pages,
    pub tail: Vec<SegmentRef>,
    pub ann: Option<AnnV7>,
    pub next_seq: u64,
    pub text: Option<TextIndex>,
}

impl From<V6> for Version {
    fn from(old: V6) -> Self {
        Self {
            format: FORMAT,
            parent: old.parent,
            schema: old.schema.into(),
            built: old.built,
            tail: old.tail,
            ann: old.ann.map(Ann::from),
            next_seq: old.next_seq,
            text: old.text,
        }
    }
}

#[derive(Deserialize)]
#[cfg_attr(test, derive(serde::Serialize))]
pub(crate) struct SchemaV7 {
    pub vectors: BTreeMap<String, Column>,
    pub attributes: BTreeMap<String, Kind>,
    pub text: BTreeMap<String, TextOptionsV8>,
    pub id: IdKind,
}

#[derive(Deserialize)]
#[cfg_attr(test, derive(serde::Serialize))]
pub(crate) struct V7 {
    pub _format: u32,
    pub parent: Option<Hash>,
    pub schema: SchemaV7,
    pub built: Pages,
    pub tail: Vec<SegmentRef>,
    pub ann: Option<AnnV7>,
    pub next_seq: u64,
    pub text: Option<TextIndex>,
}

impl From<V7> for Version {
    fn from(old: V7) -> Self {
        let schema = Schema {
            vectors: old.schema.vectors,
            attributes: old.schema.attributes,
            text: texts_v8(old.schema.text),
            id: old.schema.id,
            ..Schema::default()
        };
        Self {
            format: FORMAT,
            parent: old.parent,
            schema,
            built: old.built,
            tail: old.tail,
            ann: old.ann.map(Ann::from),
            next_seq: old.next_seq,
            text: old.text,
        }
    }
}

#[derive(Deserialize)]
#[cfg_attr(test, derive(serde::Serialize))]
pub(crate) struct TextOptionsV8 {
    pub k1: f32,
    pub b: f32,
    pub language: Language,
    pub stopwords: bool,
}

#[cfg(test)]
pub(crate) fn old_texts(now: &BTreeMap<String, TextOptions>) -> BTreeMap<String, TextOptionsV8> {
    (now.iter())
        .map(|(name, o)| {
            let old = TextOptionsV8 {
                k1: o.k1,
                b: o.b,
                language: o.language,
                stopwords: o.stopwords,
            };
            (name.clone(), old)
        })
        .collect()
}

fn texts_v8(old: BTreeMap<String, TextOptionsV8>) -> BTreeMap<String, TextOptions> {
    (old.into_iter())
        .map(|(name, o)| {
            let options = TextOptions {
                k1: o.k1,
                b: o.b,
                language: o.language,
                stopwords: o.stopwords,
                ..TextOptions::default()
            };
            (name, options)
        })
        .collect()
}

#[derive(Deserialize)]
#[cfg_attr(test, derive(serde::Serialize))]
pub(crate) struct SchemaV8 {
    pub vectors: BTreeMap<String, Column>,
    pub attributes: BTreeMap<String, Kind>,
    pub text: BTreeMap<String, TextOptionsV8>,
    pub id: IdKind,
    pub filter_index: BTreeSet<String>,
}

#[derive(Deserialize)]
#[cfg_attr(test, derive(serde::Serialize))]
pub(crate) struct V8 {
    pub _format: u32,
    pub parent: Option<Hash>,
    pub schema: SchemaV8,
    pub built: Pages,
    pub tail: Vec<SegmentRef>,
    pub ann: Option<AnnV9>,
    pub next_seq: u64,
    pub text: Option<TextIndex>,
}

impl From<V8> for Version {
    fn from(old: V8) -> Self {
        let schema = Schema {
            vectors: old.schema.vectors,
            attributes: old.schema.attributes,
            text: texts_v8(old.schema.text),
            id: old.schema.id,
            filter_index: old.schema.filter_index,
            ..Schema::default()
        };
        V9 {
            _format: 9,
            parent: old.parent,
            schema,
            built: old.built,
            tail: old.tail,
            ann: old.ann,
            next_seq: old.next_seq,
            text: old.text,
        }
        .into()
    }
}

#[derive(Deserialize)]
pub(crate) struct V9 {
    _format: u32,
    parent: Option<Hash>,
    schema: Schema,
    built: Pages,
    tail: Vec<SegmentRef>,
    ann: Option<AnnV9>,
    next_seq: u64,
    text: Option<TextIndex>,
}

impl From<V9> for Version {
    fn from(old: V9) -> Self {
        Self {
            format: FORMAT,
            parent: old.parent,
            schema: old.schema,
            built: old.built,
            tail: old.tail,
            ann: old.ann.map(Ann::from),
            next_seq: old.next_seq,
            text: old.text,
        }
    }
}

pub(crate) fn decode_version(raw: &[u8]) -> Result<Version> {
    #[derive(Deserialize)]
    struct Format {
        format: u32,
    }
    let Format { format } = postcard::from_bytes(raw)?;
    Ok(match format {
        FORMAT => postcard::from_bytes(raw)?,
        9 => postcard::from_bytes::<V9>(raw)?.into(),
        8 => postcard::from_bytes::<V8>(raw)?.into(),
        7 => postcard::from_bytes::<V7>(raw)?.into(),
        6 => postcard::from_bytes::<V6>(raw)?.into(),
        5 => postcard::from_bytes::<V5>(raw)?.into(),
        4 => postcard::from_bytes::<V4>(raw)?.into(),
        3 => postcard::from_bytes::<V3>(raw)?.into(),
        2 => postcard::from_bytes::<V2>(raw)?.into(),
        other => {
            return Err(crate::Error::Corrupt(format!(
                "the index is in format {other}; this version reads format {FORMAT}"
            )));
        }
    })
}
