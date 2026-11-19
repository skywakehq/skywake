//! Older Version formats. These types never change, so old indexes still open.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use skywake_core::Hash;
use skywake_core::list::List;

use super::columns::chunk::Layout;
use super::columns::projection::ProjectionRef;
use super::columns::{ColumnRef, Columns};
use super::pages::Pages;
use super::rows::RowMap;
use super::{Ann, Clusters, FORMAT, SegmentRef, Version};
use crate::filter::FilterPart;
use crate::text::part::{PartRef, TextIndex};
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
            groups: c.table.len,
            calibrated: c.table.len,
            centroids: c.centroids,
            origin: c.origin,
            table: c.table,
            seed: c.seed,
            calibration: c.calibration,
            directory: None,
            extended: false,
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
            rows: List::Inline(old.rows),
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
            rows: List::Inline(old.rows),
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
            rows: flat(&ann.rows),
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
            folded: 0,
            parts: List::default(),
            line: Default::default(),
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
            columns: None,
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
    pub text: Option<OldText>,
}

impl From<V3> for Version {
    fn from(old: V3) -> Self {
        let (vectors, attributes, text) = old.schema;
        Self {
            format: FORMAT,
            folded: 0,
            parts: List::default(),
            line: Default::default(),
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
            text: old.text.map(TextIndex::from),
            columns: None,
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
    pub text: Option<OldText>,
}

impl From<V4> for Version {
    fn from(old: V4) -> Self {
        Self {
            format: FORMAT,
            folded: 0,
            parts: List::default(),
            line: Default::default(),
            parent: old.parent,
            schema: old.schema.into(),
            built: old.built,
            tail: old.tail,
            ann: ann(old.ann),
            next_seq: old.next_seq,
            text: old.text.map(TextIndex::from),
            columns: None,
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
    pub text: Option<OldText>,
}

impl From<V5> for Version {
    fn from(old: V5) -> Self {
        Self {
            format: FORMAT,
            folded: 0,
            parts: List::default(),
            line: Default::default(),
            parent: old.parent,
            schema: old.schema.into(),
            built: old.built,
            tail: old.tail,
            ann: old.ann.map(Ann::from),
            next_seq: old.next_seq,
            text: old.text.map(TextIndex::from),
            columns: None,
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
    pub text: Option<OldText>,
}

impl From<V6> for Version {
    fn from(old: V6) -> Self {
        Self {
            format: FORMAT,
            folded: 0,
            parts: List::default(),
            line: Default::default(),
            parent: old.parent,
            schema: old.schema.into(),
            built: old.built,
            tail: old.tail,
            ann: old.ann.map(Ann::from),
            next_seq: old.next_seq,
            text: old.text.map(TextIndex::from),
            columns: None,
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
    pub text: Option<OldText>,
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
            folded: 0,
            parts: List::default(),
            line: Default::default(),
            parent: old.parent,
            schema,
            built: old.built,
            tail: old.tail,
            ann: old.ann.map(Ann::from),
            next_seq: old.next_seq,
            text: old.text.map(TextIndex::from),
            columns: None,
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
    pub text: Option<OldText>,
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
    text: Option<OldText>,
}

impl From<V9> for Version {
    fn from(old: V9) -> Self {
        Self {
            format: FORMAT,
            folded: 0,
            parts: List::default(),
            line: Default::default(),
            parent: old.parent,
            schema: old.schema,
            built: old.built,
            tail: old.tail,
            ann: old.ann.map(Ann::from),
            next_seq: old.next_seq,
            text: old.text.map(TextIndex::from),
            columns: None,
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct OldText {
    parts: Vec<OldPart>,
}

#[derive(Clone, Serialize, Deserialize)]
struct OldPart {
    hot: Hash,
    hot_bytes: u64,
    blobs: Vec<Hash>,
    docs: u32,
    dead: Option<Hash>,
    dead_docs: u32,
    bytes: u64,
}

impl From<OldText> for TextIndex {
    fn from(old: OldText) -> Self {
        let parts = old.parts.into_iter().map(|part| PartRef {
            hot: part.hot,
            hot_bytes: part.hot_bytes,
            blobs: part.blobs,
            docs: part.docs,
            dead: part.dead,
            dead_docs: part.dead_docs,
            bytes: part.bytes,
            postings: None,
        });
        Self {
            parts: parts.collect(),
        }
    }
}

impl From<&TextIndex> for OldText {
    fn from(text: &TextIndex) -> Self {
        let parts = text.parts.iter().map(|part| OldPart {
            hot: part.hot,
            hot_bytes: part.hot_bytes,
            blobs: part.blobs.clone(),
            docs: part.docs,
            dead: part.dead,
            dead_docs: part.dead_docs,
            bytes: part.bytes,
        });
        Self {
            parts: parts.collect(),
        }
    }
}

#[derive(Serialize, Deserialize)]
pub(crate) struct V10 {
    format: u32,
    parent: Option<Hash>,
    schema: Schema,
    built: Pages,
    tail: Vec<SegmentRef>,
    ann: Option<AnnV14>,
    next_seq: u64,
    text: Option<OldText>,
}

pub(crate) const V10_FORMAT: u32 = 10;

impl From<V10> for Version {
    fn from(old: V10) -> Self {
        Self {
            format: FORMAT,
            folded: 0,
            parts: List::default(),
            line: Default::default(),
            parent: old.parent,
            schema: old.schema,
            built: old.built,
            tail: old.tail,
            ann: old.ann.map(Ann::from),
            next_seq: old.next_seq,
            text: old.text.map(TextIndex::from),
            columns: None,
        }
    }
}

impl From<&Version> for V10 {
    fn from(version: &Version) -> Self {
        Self {
            format: V10_FORMAT,
            parent: version.parent,
            schema: version.schema.clone(),
            built: version.built.clone(),
            tail: version.tail.clone(),
            ann: version.ann.as_ref().map(AnnV14::from),
            next_seq: version.next_seq,
            text: version.text.as_ref().map(OldText::from),
        }
    }
}

#[derive(Serialize, Deserialize)]
pub(crate) struct V11 {
    format: u32,
    parent: Option<Hash>,
    schema: Schema,
    built: Pages,
    tail: Vec<SegmentRef>,
    ann: Option<AnnV14>,
    next_seq: u64,
    text: Option<OldText>,
    columns: Option<OldColumns>,
}

pub(crate) const V11_FORMAT: u32 = 11;

impl From<V11> for Version {
    fn from(old: V11) -> Self {
        Self {
            format: FORMAT,
            folded: 0,
            parts: List::default(),
            line: Default::default(),
            parent: old.parent,
            schema: old.schema,
            built: old.built,
            tail: old.tail,
            ann: old.ann.map(Ann::from),
            next_seq: old.next_seq,
            text: old.text.map(TextIndex::from),
            columns: old.columns.map(Columns::from),
        }
    }
}

impl From<&Version> for V11 {
    fn from(version: &Version) -> Self {
        Self {
            format: V11_FORMAT,
            parent: version.parent,
            schema: version.schema.clone(),
            built: version.built.clone(),
            tail: version.tail.clone(),
            ann: version.ann.as_ref().map(AnnV14::from),
            next_seq: version.next_seq,
            text: version.text.as_ref().map(OldText::from),
            columns: version.columns.as_ref().map(OldColumns::from),
        }
    }
}

#[derive(Serialize, Deserialize)]
pub(crate) struct V12 {
    format: u32,
    parent: Option<Hash>,
    schema: Schema,
    built: Pages,
    tail: Vec<SegmentRef>,
    ann: Option<AnnV14>,
    next_seq: u64,
    text: Option<TextIndex>,
    columns: Option<OldColumns>,
}

pub(crate) const V12_FORMAT: u32 = 12;

impl From<V12> for Version {
    fn from(old: V12) -> Self {
        Self {
            format: FORMAT,
            folded: 0,
            parts: List::default(),
            line: Default::default(),
            parent: old.parent,
            schema: old.schema,
            built: old.built,
            tail: old.tail,
            ann: old.ann.map(Ann::from),
            next_seq: old.next_seq,
            text: old.text,
            columns: old.columns.map(Columns::from),
        }
    }
}

impl From<&Version> for V12 {
    fn from(version: &Version) -> Self {
        Self {
            format: V12_FORMAT,
            parent: version.parent,
            schema: version.schema.clone(),
            built: version.built.clone(),
            tail: version.tail.clone(),
            ann: version.ann.as_ref().map(AnnV14::from),
            next_seq: version.next_seq,
            text: version.text.clone(),
            columns: version.columns.as_ref().map(OldColumns::from),
        }
    }
}

#[derive(Serialize, Deserialize)]
pub(crate) struct V13 {
    format: u32,
    parent: Option<Hash>,
    schema: Schema,
    built: Pages,
    tail: Vec<SegmentRef>,
    ann: Option<AnnV14>,
    next_seq: u64,
    text: Option<TextIndex>,
    columns: Option<Columns13>,
}

pub(crate) const V13_FORMAT: u32 = 13;

impl From<V13> for Version {
    fn from(old: V13) -> Self {
        Self {
            format: FORMAT,
            folded: 0,
            parts: List::default(),
            line: Default::default(),
            parent: old.parent,
            schema: old.schema,
            built: old.built,
            tail: old.tail,
            ann: old.ann.map(Ann::from),
            next_seq: old.next_seq,
            text: old.text,
            columns: old.columns.map(Columns::from),
        }
    }
}

impl From<&Version> for V13 {
    fn from(version: &Version) -> Self {
        Self {
            format: V13_FORMAT,
            parent: version.parent,
            schema: version.schema.clone(),
            built: version.built.clone(),
            tail: version.tail.clone(),
            ann: version.ann.as_ref().map(AnnV14::from),
            next_seq: version.next_seq,
            text: version.text.clone(),
            columns: version.columns.as_ref().map(Columns13::from),
        }
    }
}

#[derive(Serialize, Deserialize)]
pub(crate) struct Columns13 {
    pages: u64,
    live: u64,
    bytes: u64,
    rows: Vec<Hash>,
    rows_bytes: u64,
    ids: Vec<Hash>,
    columns: BTreeMap<String, ColumnRef>,
}

impl From<Columns13> for Columns {
    fn from(old: Columns13) -> Self {
        Self {
            pages: old.pages,
            live: old.live,
            bytes: old.bytes,
            rows: List::Inline(old.rows),
            rows_bytes: old.rows_bytes,
            ids: old.ids,
            columns: old.columns,
            projections: Vec::new(),
        }
    }
}

impl From<&Columns> for Columns13 {
    fn from(columns: &Columns) -> Self {
        Self {
            pages: columns.pages,
            live: columns.live,
            bytes: columns.bytes,
            rows: flat(&columns.rows),
            rows_bytes: columns.rows_bytes,
            ids: columns.ids.clone(),
            columns: columns.columns.clone(),
        }
    }
}

#[derive(Serialize, Deserialize)]
pub(crate) struct OldColumns {
    pages: u64,
    live: u64,
    bytes: u64,
    rows: Vec<Hash>,
    rows_bytes: u64,
    ids: Vec<Hash>,
    columns: BTreeMap<String, OldColumnRef>,
}

#[derive(Serialize, Deserialize)]
pub(crate) struct OldColumnRef {
    layout: Layout,
    dictionary: Hash,
    totals: Hash,
    directory: Vec<Hash>,
}

impl From<OldColumns> for Columns {
    fn from(old: OldColumns) -> Self {
        let columns = old.columns.into_iter().map(|(name, c)| {
            let column = ColumnRef {
                layout: c.layout,
                dictionary: c.dictionary,
                totals: c.totals,
                directory: c.directory,
                leaders: None,
            };
            (name, column)
        });
        Self {
            pages: old.pages,
            live: old.live,
            bytes: old.bytes,
            rows: List::Inline(old.rows),
            rows_bytes: old.rows_bytes,
            ids: old.ids,
            columns: columns.collect(),
            projections: Vec::new(),
        }
    }
}

impl From<&Columns> for OldColumns {
    fn from(columns: &Columns) -> Self {
        let old = columns.columns.iter().map(|(name, c)| {
            let column = OldColumnRef {
                layout: c.layout,
                dictionary: c.dictionary,
                totals: c.totals,
                directory: c.directory.clone(),
            };
            (name.clone(), column)
        });
        Self {
            pages: columns.pages,
            live: columns.live,
            bytes: columns.bytes,
            rows: flat(&columns.rows),
            rows_bytes: columns.rows_bytes,
            ids: columns.ids.clone(),
            columns: old.collect(),
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
        V16_FORMAT => postcard::from_bytes::<V16>(raw)?.into(),
        V15_FORMAT => postcard::from_bytes::<V15>(raw)?.into(),
        V14_FORMAT => postcard::from_bytes::<V14>(raw)?.into(),
        V13_FORMAT => postcard::from_bytes::<V13>(raw)?.into(),
        V12_FORMAT => postcard::from_bytes::<V12>(raw)?.into(),
        V11_FORMAT => postcard::from_bytes::<V11>(raw)?.into(),
        V10_FORMAT => postcard::from_bytes::<V10>(raw)?.into(),
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

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct ClustersV14 {
    centroids: Hash,
    origin: Option<Hash>,
    table: Pages,
    seed: u64,
    calibration: Calibration,
    directory: Option<Hash>,
}

impl From<ClustersV14> for Clusters {
    fn from(c: ClustersV14) -> Self {
        Self {
            groups: c.table.len,
            calibrated: c.table.len,
            centroids: c.centroids,
            origin: c.origin,
            table: c.table,
            seed: c.seed,
            calibration: c.calibration,
            directory: c.directory,
            extended: false,
        }
    }
}

impl From<&Clusters> for ClustersV14 {
    fn from(c: &Clusters) -> Self {
        Self {
            centroids: c.centroids,
            origin: c.origin,
            table: c.table.clone(),
            seed: c.seed,
            calibration: c.calibration.clone(),
            directory: c.directory,
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct AnnV14 {
    columns: BTreeMap<String, ClustersV14>,
    rows: Vec<Hash>,
    rows_bytes: u64,
    live: u64,
    full_rows: u64,
    removed: u64,
    filters: Hash,
    parts: BTreeMap<String, FilterPart>,
}

impl From<AnnV14> for Ann {
    fn from(old: AnnV14) -> Self {
        Self {
            columns: (old.columns.into_iter())
                .map(|(name, c)| (name, c.into()))
                .collect(),
            rows: List::Inline(old.rows),
            rows_bytes: old.rows_bytes,
            live: old.live,
            full_rows: old.full_rows,
            removed: old.removed,
            filters: old.filters,
            parts: old.parts,
        }
    }
}

impl From<&Ann> for AnnV14 {
    fn from(ann: &Ann) -> Self {
        Self {
            columns: (ann.columns.iter())
                .map(|(name, c)| (name.clone(), c.into()))
                .collect(),
            rows: flat(&ann.rows),
            rows_bytes: ann.rows_bytes,
            live: ann.live,
            full_rows: ann.full_rows,
            removed: ann.removed,
            filters: ann.filters,
            parts: ann.parts.clone(),
        }
    }
}

#[derive(Serialize, Deserialize)]
pub(crate) struct V14 {
    format: u32,
    parent: Option<Hash>,
    schema: Schema,
    built: Pages,
    tail: Vec<SegmentRef>,
    ann: Option<AnnV14>,
    next_seq: u64,
    text: Option<TextIndex>,
    columns: Option<ColumnsV16>,
}

pub(crate) const V14_FORMAT: u32 = 14;

impl From<V14> for Version {
    fn from(old: V14) -> Self {
        Self {
            format: FORMAT,
            folded: 0,
            parts: List::default(),
            line: Default::default(),
            parent: old.parent,
            schema: old.schema,
            built: old.built,
            tail: old.tail,
            ann: old.ann.map(Ann::from),
            next_seq: old.next_seq,
            text: old.text,
            columns: old.columns.map(Columns::from),
        }
    }
}

impl From<&Version> for V14 {
    fn from(version: &Version) -> Self {
        Self {
            format: V14_FORMAT,
            parent: version.parent,
            schema: version.schema.clone(),
            built: version.built.clone(),
            tail: version.tail.clone(),
            ann: version.ann.as_ref().map(AnnV14::from),
            next_seq: version.next_seq,
            text: version.text.clone(),
            columns: version.columns.as_ref().map(ColumnsV16::from),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct ClustersV15 {
    centroids: Hash,
    origin: Option<Hash>,
    table: Pages,
    seed: u64,
    calibration: Calibration,
    directory: Option<Hash>,
    groups: u64,
    calibrated: u64,
}

impl From<ClustersV15> for Clusters {
    fn from(c: ClustersV15) -> Self {
        Self {
            centroids: c.centroids,
            origin: c.origin,
            table: c.table,
            seed: c.seed,
            calibration: c.calibration,
            directory: c.directory,
            groups: c.groups,
            calibrated: c.calibrated,
            extended: false,
        }
    }
}

impl From<&Clusters> for ClustersV15 {
    fn from(c: &Clusters) -> Self {
        Self {
            centroids: c.centroids,
            origin: c.origin,
            table: c.table.clone(),
            seed: c.seed,
            calibration: c.calibration.clone(),
            directory: c.directory,
            groups: c.groups,
            calibrated: c.calibrated,
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct AnnV15 {
    columns: BTreeMap<String, ClustersV15>,
    rows: Vec<Hash>,
    rows_bytes: u64,
    live: u64,
    full_rows: u64,
    removed: u64,
    filters: Hash,
    parts: BTreeMap<String, FilterPart>,
}

impl From<AnnV15> for Ann {
    fn from(old: AnnV15) -> Self {
        Self {
            columns: (old.columns.into_iter())
                .map(|(name, c)| (name, c.into()))
                .collect(),
            rows: List::Inline(old.rows),
            rows_bytes: old.rows_bytes,
            live: old.live,
            full_rows: old.full_rows,
            removed: old.removed,
            filters: old.filters,
            parts: old.parts,
        }
    }
}

impl From<&Ann> for AnnV15 {
    fn from(ann: &Ann) -> Self {
        Self {
            columns: (ann.columns.iter())
                .map(|(name, c)| (name.clone(), c.into()))
                .collect(),
            rows: flat(&ann.rows),
            rows_bytes: ann.rows_bytes,
            live: ann.live,
            full_rows: ann.full_rows,
            removed: ann.removed,
            filters: ann.filters,
            parts: ann.parts.clone(),
        }
    }
}

#[derive(Serialize, Deserialize)]
pub(crate) struct V15 {
    format: u32,
    parent: Option<Hash>,
    schema: Schema,
    built: Pages,
    tail: Vec<SegmentRef>,
    ann: Option<AnnV15>,
    next_seq: u64,
    text: Option<TextIndex>,
    columns: Option<ColumnsV16>,
}

pub(crate) const V15_FORMAT: u32 = 15;

impl From<V15> for Version {
    fn from(old: V15) -> Self {
        Self {
            format: FORMAT,
            folded: 0,
            parts: List::default(),
            line: Default::default(),
            parent: old.parent,
            schema: old.schema,
            built: old.built,
            tail: old.tail,
            ann: old.ann.map(Ann::from),
            next_seq: old.next_seq,
            text: old.text,
            columns: old.columns.map(Columns::from),
        }
    }
}

impl From<&Version> for V15 {
    fn from(version: &Version) -> Self {
        Self {
            format: V15_FORMAT,
            parent: version.parent,
            schema: version.schema.clone(),
            built: version.built.clone(),
            tail: version.tail.clone(),
            ann: version.ann.as_ref().map(AnnV15::from),
            next_seq: version.next_seq,
            text: version.text.clone(),
            columns: version.columns.as_ref().map(ColumnsV16::from),
        }
    }
}

pub(crate) fn flat(map: &RowMap) -> Vec<Hash> {
    match map {
        List::Inline(pages) => pages.clone(),
        List::Tree { .. } => unreachable!("only the current format holds a row map tree"),
    }
}

#[derive(Serialize, Deserialize)]
pub(crate) struct ColumnsV16 {
    pages: u64,
    live: u64,
    bytes: u64,
    rows: Vec<Hash>,
    rows_bytes: u64,
    ids: Vec<Hash>,
    columns: BTreeMap<String, ColumnRef>,
    projections: Vec<ProjectionRef>,
}

impl From<ColumnsV16> for Columns {
    fn from(old: ColumnsV16) -> Self {
        Self {
            pages: old.pages,
            live: old.live,
            bytes: old.bytes,
            rows: List::Inline(old.rows),
            rows_bytes: old.rows_bytes,
            ids: old.ids,
            columns: old.columns,
            projections: old.projections,
        }
    }
}

impl From<&Columns> for ColumnsV16 {
    fn from(columns: &Columns) -> Self {
        Self {
            pages: columns.pages,
            live: columns.live,
            bytes: columns.bytes,
            rows: flat(&columns.rows),
            rows_bytes: columns.rows_bytes,
            ids: columns.ids.clone(),
            columns: columns.columns.clone(),
            projections: columns.projections.clone(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct AnnV16 {
    columns: BTreeMap<String, Clusters>,
    rows: Vec<Hash>,
    rows_bytes: u64,
    live: u64,
    full_rows: u64,
    removed: u64,
    filters: Hash,
    parts: BTreeMap<String, FilterPart>,
}

impl From<AnnV16> for Ann {
    fn from(old: AnnV16) -> Self {
        Self {
            columns: old.columns,
            rows: List::Inline(old.rows),
            rows_bytes: old.rows_bytes,
            live: old.live,
            full_rows: old.full_rows,
            removed: old.removed,
            filters: old.filters,
            parts: old.parts,
        }
    }
}

impl From<&Ann> for AnnV16 {
    fn from(ann: &Ann) -> Self {
        Self {
            columns: ann.columns.clone(),
            rows: flat(&ann.rows),
            rows_bytes: ann.rows_bytes,
            live: ann.live,
            full_rows: ann.full_rows,
            removed: ann.removed,
            filters: ann.filters,
            parts: ann.parts.clone(),
        }
    }
}

#[derive(Serialize, Deserialize)]
pub(crate) struct V16 {
    format: u32,
    parent: Option<Hash>,
    schema: Schema,
    built: Pages,
    tail: Vec<SegmentRef>,
    ann: Option<AnnV16>,
    next_seq: u64,
    text: Option<TextIndex>,
    columns: Option<ColumnsV16>,
}

pub(crate) const V16_FORMAT: u32 = 16;

impl From<V16> for Version {
    fn from(old: V16) -> Self {
        Self {
            format: FORMAT,
            folded: 0,
            parts: List::default(),
            line: Default::default(),
            parent: old.parent,
            schema: old.schema,
            built: old.built,
            tail: old.tail,
            ann: old.ann.map(Ann::from),
            next_seq: old.next_seq,
            text: old.text,
            columns: old.columns.map(Columns::from),
        }
    }
}

impl From<&Version> for V16 {
    fn from(version: &Version) -> Self {
        Self {
            format: V16_FORMAT,
            parent: version.parent,
            schema: version.schema.clone(),
            built: version.built.clone(),
            tail: version.tail.clone(),
            ann: version.ann.as_ref().map(AnnV16::from),
            next_seq: version.next_seq,
            text: version.text.clone(),
            columns: version.columns.as_ref().map(ColumnsV16::from),
        }
    }
}
