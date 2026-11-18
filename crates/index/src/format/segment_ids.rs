use std::fmt;
use std::marker::PhantomData;

use serde::Deserialize;
use serde::de::{self, Deserializer, SeqAccess, Visitor};

use crate::{Attributes, Id};

const FIELDS: &[&str] = &["ids", "vectors", "attributes", "deletes"];

#[derive(Default)]
pub(crate) struct SegmentIds {
    pub ids: Vec<Id>,
    pub deletes: Vec<Id>,
}

impl SegmentIds {
    pub(crate) fn writes(&self, first_seq: u64) -> impl Iterator<Item = (u64, &Id, bool)> {
        let docs = self.ids.iter().map(|id| (id, true));
        let deletes = self.deletes.iter().map(|id| (id, false));
        (first_seq..)
            .zip(docs.chain(deletes))
            .map(|(seq, (id, doc))| (seq, id, doc))
    }

    pub(crate) fn weight(&self) -> usize {
        let text = |id: &Id| match id {
            Id::Str(text) => text.len(),
            _ => 0,
        };
        let ids = self.ids.iter().chain(&self.deletes);
        64 + ids.map(|id| 32 + text(id)).sum::<usize>()
    }
}

impl<'de> Deserialize<'de> for SegmentIds {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_struct("Segment", FIELDS, IdsOnly)
    }
}

struct IdsOnly;

impl<'de> Visitor<'de> for IdsOnly {
    type Value = SegmentIds;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a tail segment")
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<SegmentIds, A::Error> {
        let missing = |n| de::Error::invalid_length(n, &self);
        let ids: Vec<Id> = seq.next_element()?.ok_or_else(|| missing(0))?;
        seq.next_element::<Skip<Skip<f32>>>()?
            .ok_or_else(|| missing(1))?;
        seq.next_element::<Skip<Attributes>>()?
            .ok_or_else(|| missing(2))?;
        let deletes: Vec<Id> = seq.next_element()?.ok_or_else(|| missing(3))?;
        Ok(SegmentIds { ids, deletes })
    }
}

struct Skip<T>(PhantomData<T>);

impl<'de, T: Deserialize<'de>> Deserialize<'de> for Skip<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_seq(Skip(PhantomData))
    }
}

impl<'de, T: Deserialize<'de>> Visitor<'de> for Skip<T> {
    type Value = Skip<T>;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a sequence")
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Skip<T>, A::Error> {
        while seq.next_element::<T>()?.is_some() {}
        Ok(Skip(PhantomData))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::format::Segment;

    #[test]
    fn reads_only_the_ids_of_a_segment() {
        let segment = Segment {
            ids: vec![Id::Num(1), Id::Str("b".to_string())],
            vectors: vec![vec![0.5; 6]],
            attributes: vec![Attributes::default(), Attributes::default()],
            deletes: vec![Id::Num(7)],
        };
        let bytes = postcard::to_allocvec(&segment).unwrap();
        let ids: SegmentIds = postcard::from_bytes(&bytes).unwrap();
        assert_eq!(ids.ids, segment.ids);
        assert_eq!(ids.deletes, segment.deletes);
        let full: Vec<_> = segment
            .writes(10)
            .map(|(s, id, row)| (s, id.clone(), row.is_some()))
            .collect();
        let only: Vec<_> = ids
            .writes(10)
            .map(|(s, id, doc)| (s, id.clone(), doc))
            .collect();
        assert_eq!(full, only);
    }
}
