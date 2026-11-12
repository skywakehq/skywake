//! Hits, rows, groups, stats and read counts as plain JavaScript objects.

use std::collections::{BTreeMap, HashMap};

use napi::Either;
use napi_derive::napi;
use serde_json::{Map, Value as Json};
use skywake_index::{FusedHit, Group, Highlight, Hit, Ranked, Reads, Row, Stats, TextHit};

use super::values::{attributes_to, id_to, value_to};

#[napi(object)]
pub struct IndexHit {
    pub id: Either<String, f64>,
    pub distance: f64,
    pub attributes: Map<String, Json>,
}

#[napi(object)]
pub struct IndexHighlight {
    pub text: String,
    pub marks: Vec<Vec<u32>>,
}

#[napi(object)]
pub struct IndexSearchHit {
    pub id: Either<String, f64>,
    pub score: f64,
    pub attributes: Map<String, Json>,
    pub highlights: HashMap<String, IndexHighlight>,
}

#[napi(object)]
pub struct IndexFusedHit {
    pub id: Either<String, f64>,
    pub score: f64,
    pub ranks: HashMap<String, u32>,
    pub scores: HashMap<String, f64>,
    pub attributes: Map<String, Json>,
    pub highlights: HashMap<String, IndexHighlight>,
}

#[napi(object)]
pub struct IndexRow {
    pub id: Either<String, f64>,
    pub attributes: Map<String, Json>,
}

#[napi(object)]
pub struct IndexRanked {
    pub id: Either<String, f64>,
    pub score: f64,
    pub attributes: Map<String, Json>,
}

#[napi(object)]
pub struct IndexGroup {
    pub key: Map<String, Json>,
    pub values: Map<String, Json>,
}

#[napi(object)]
#[derive(Default)]
pub struct IndexResult {
    pub query: Option<Vec<IndexHit>>,
    pub search: Option<Vec<IndexSearchHit>>,
    pub hybrid: Option<Vec<IndexFusedHit>>,
    pub order: Option<Vec<IndexRow>>,
    pub aggregate: Option<Vec<IndexGroup>>,
    pub rank: Option<Vec<IndexRanked>>,
}

#[napi(object)]
pub struct IndexReads {
    pub memory: f64,
    pub disk: f64,
    pub store: f64,
    pub temperature: String,
    pub hit_ratio: f64,
}

#[napi(object)]
pub struct IndexAnswers {
    pub results: Vec<IndexResult>,
    pub reads: IndexReads,
}

#[napi(object)]
pub struct IndexStats {
    pub rows: f64,
    pub deleted_rows: f64,
    pub segments: f64,
    pub indexed_rows: f64,
    pub unindexed_rows: f64,
    pub clusters: f64,
    pub bytes: f64,
}

pub(crate) fn hit_to(hit: Hit) -> IndexHit {
    IndexHit {
        id: id_to(hit.id),
        distance: hit.distance as f64,
        attributes: attributes_to(hit.attributes),
    }
}

fn highlights_to(highlights: BTreeMap<String, Highlight>) -> HashMap<String, IndexHighlight> {
    (highlights.into_iter())
        .map(|(name, h)| {
            let marks = h.marks.into_iter().map(|(a, b)| vec![a, b]).collect();
            (
                name,
                IndexHighlight {
                    text: h.text,
                    marks,
                },
            )
        })
        .collect()
}

pub(crate) fn search_hit_to(hit: TextHit) -> IndexSearchHit {
    IndexSearchHit {
        id: id_to(hit.id),
        score: hit.score as f64,
        attributes: attributes_to(hit.attributes),
        highlights: highlights_to(hit.highlights),
    }
}

pub(crate) fn fused_hit_to(hit: FusedHit) -> IndexFusedHit {
    IndexFusedHit {
        id: id_to(hit.id),
        score: hit.score as f64,
        ranks: hit.ranks.into_iter().collect(),
        scores: (hit.scores.into_iter())
            .map(|(name, score)| (name, score as f64))
            .collect(),
        attributes: attributes_to(hit.attributes),
        highlights: highlights_to(hit.highlights),
    }
}

pub(crate) fn row_to(row: Row) -> IndexRow {
    IndexRow {
        id: id_to(row.id),
        attributes: attributes_to(row.attributes),
    }
}

pub(crate) fn ranked_to(ranked: Ranked) -> IndexRanked {
    IndexRanked {
        id: id_to(ranked.id),
        score: ranked.score,
        attributes: attributes_to(ranked.attributes),
    }
}

pub(crate) fn group_to(group: Group) -> IndexGroup {
    IndexGroup {
        key: attributes_to(group.key),
        values: (group.values.into_iter())
            .map(|(name, value)| (name, value_to(value)))
            .collect(),
    }
}

pub(crate) fn reads_to(reads: Reads) -> IndexReads {
    IndexReads {
        memory: reads.memory as f64,
        disk: reads.disk as f64,
        store: reads.store as f64,
        temperature: reads.temperature().to_string(),
        hit_ratio: reads.hit_ratio(),
    }
}

pub(crate) fn stats_to(stats: Stats) -> IndexStats {
    IndexStats {
        rows: stats.rows as f64,
        deleted_rows: stats.deleted_rows as f64,
        segments: stats.segments as f64,
        indexed_rows: stats.indexed_rows as f64,
        unindexed_rows: stats.unindexed_rows as f64,
        clusters: stats.clusters as f64,
        bytes: stats.bytes as f64,
    }
}
