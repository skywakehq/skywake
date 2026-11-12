//! The tail: segments written since the last build.

use std::collections::HashMap;
use std::sync::Arc;

use crate::Id;
use crate::Result;
use crate::format::{Segment, Version};
use crate::store::Storage;

pub(crate) struct Tail {
    pub segments: Vec<(u64, Arc<Segment>)>,
}

#[derive(Clone, Copy)]
pub(crate) struct Row {
    pub segment: usize,
    pub row: usize,
    pub seq: u64,
}

impl Tail {
    pub(crate) async fn load(storage: &Storage, version: &Version) -> Result<Self> {
        let refs = version.tail();
        let segments = storage
            .get_all(refs.iter().map(|r| r.hash).collect())
            .await?;
        let firsts = refs.iter().map(|r| r.first_seq);
        Ok(Self {
            segments: firsts.zip(segments).collect(),
        })
    }

    pub(crate) fn newest(&self) -> HashMap<&Id, Option<Row>> {
        let mut newest = HashMap::new();
        for (segment, (first_seq, blob)) in self.segments.iter().enumerate() {
            for (seq, id, row) in blob.writes(*first_seq) {
                let row = row.map(|row| Row { segment, row, seq });
                newest.insert(id, row);
            }
        }
        newest
    }

    pub(crate) fn live<'a>(&'a self, newest: &HashMap<&Id, Option<Row>>) -> Vec<(&'a Id, Row)> {
        let mut live = Vec::new();
        for (segment, (first_seq, blob)) in self.segments.iter().enumerate() {
            for (seq, id, row) in blob.writes(*first_seq) {
                if let (Some(row), Some(Some(newest))) = (row, newest.get(id))
                    && newest.seq == seq
                {
                    live.push((id, Row { segment, row, seq }));
                }
            }
        }
        live
    }

    pub(crate) fn segment(&self, row: Row) -> &Segment {
        &self.segments[row.segment].1
    }
}
