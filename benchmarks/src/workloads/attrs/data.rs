use std::collections::BTreeMap;

use skywake_index::{Aggregate, Doc, Filter, Kind, Measure, Metric, Order, Schema};

use crate::datasets::random::{GOLDEN, Random, mix};

pub(crate) const VECTOR: &str = "v";
pub(crate) const POPULARITY: &str = "popularity";
pub(crate) const CATEGORY: &str = "category";
pub(crate) const GROUP: &str = "group";
pub(crate) const CREATED: &str = "created";

pub(crate) const CATEGORIES: u64 = 100;
pub(crate) const GROUPS: u64 = 1000;

const SHAPE: f64 = 0.9;
const EPOCH: i64 = 1_700_000_000;
const SPAN: u64 = 365 * 24 * 3600;

pub(crate) fn schema(dims: usize) -> Schema {
    let schema = Schema::new()
        .attribute(POPULARITY, Kind::Number)
        .attribute(CATEGORY, Kind::String)
        .attribute(GROUP, Kind::String)
        .attribute(CREATED, Kind::Int);
    match dims {
        0 => schema,
        dims => schema
            .vector(VECTOR, dims, Metric::Cosine)
            .filter_index(CATEGORY)
            .filter_index(POPULARITY),
    }
}

pub(crate) fn doc(id: u64, dims: usize) -> Doc {
    let mut random = Random(mix(id.wrapping_add(GOLDEN)));
    let popularity = (1.0 / (1.0 - random.unit())).powf(SHAPE);
    let category = category_name(random.next() % CATEGORIES);
    let group = format!("g{:03}", random.next() % GROUPS);
    let created = EPOCH + (random.next() % SPAN) as i64;
    let doc = Doc::new(id)
        .attribute(POPULARITY, popularity)
        .attribute(CATEGORY, category)
        .attribute(GROUP, group)
        .attribute(CREATED, created);
    match dims {
        0 => doc,
        dims => doc.vector(VECTOR, (0..dims).map(|_| random.normal()).collect()),
    }
}

pub(crate) fn category_name(n: u64) -> String {
    format!("c{n:02}")
}

pub(crate) fn above_share(share: f64) -> f64 {
    (1.0 / share).powf(SHAPE)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Family {
    Count,
    CountEq,
    CountAnd,
    Grouped,
    GroupedFiltered,
    Order,
    OrderFiltered,
}

impl Family {
    pub(crate) const ALL: [Family; 7] = [
        Family::Count,
        Family::CountEq,
        Family::CountAnd,
        Family::Grouped,
        Family::GroupedFiltered,
        Family::Order,
        Family::OrderFiltered,
    ];

    pub(crate) fn name(self) -> &'static str {
        match self {
            Family::Count => "count",
            Family::CountEq => "count, category = c (1%)",
            Family::CountAnd => "count, category = c and popularity > p (0.1%)",
            Family::Grouped => "count by group (1,000)",
            Family::GroupedFiltered => "count by group, popularity > p (10%)",
            Family::Order => "order by popularity desc, top 10",
            Family::OrderFiltered => "order by popularity desc, top 10, category = c",
        }
    }

    pub(crate) fn parse(text: &str) -> Option<Family> {
        Family::ALL.into_iter().find(|family| family.key() == text)
    }

    pub(crate) fn key(self) -> &'static str {
        match self {
            Family::Count => "count",
            Family::CountEq => "count-eq",
            Family::CountAnd => "count-and",
            Family::Grouped => "grouped",
            Family::GroupedFiltered => "grouped-filtered",
            Family::Order => "order",
            Family::OrderFiltered => "order-filtered",
        }
    }

    pub(crate) fn expected(self) -> (u64, f64) {
        let category = 1.0 / CATEGORIES as f64;
        match self {
            Family::Count => (1, 1.0),
            Family::CountEq => (1, category),
            Family::CountAnd => (1, category * 0.1),
            Family::Grouped => (GROUPS, 1.0),
            Family::GroupedFiltered => (GROUPS, 0.1),
            Family::Order | Family::OrderFiltered => (0, 0.0),
        }
    }

    pub(crate) fn ask(self, n: u64) -> Ask {
        let mut random = Random(mix(n.wrapping_mul(GOLDEN) ^ self as u64));
        let category = Filter::eq(CATEGORY, category_name(random.next() % CATEGORIES));
        let share = 0.08 + 0.04 * random.unit();
        let popular = Filter::gt(POPULARITY, above_share(share));
        match self {
            Family::Count => Ask::Aggregate(counting(None, Vec::new())),
            Family::CountEq => Ask::Aggregate(counting(Some(category), Vec::new())),
            Family::CountAnd => {
                let both = Filter::And(vec![category, popular]);
                Ask::Aggregate(counting(Some(both), Vec::new()))
            }
            Family::Grouped => Ask::Aggregate(counting(None, vec![GROUP.to_string()])),
            Family::GroupedFiltered => {
                Ask::Aggregate(counting(Some(popular), vec![GROUP.to_string()]))
            }
            Family::Order => Ask::Order(ordering(None)),
            Family::OrderFiltered => Ask::Order(ordering(Some(category))),
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) enum Ask {
    Aggregate(Aggregate),
    Order(Order),
}

fn counting(filter: Option<Filter>, group_by: Vec<String>) -> Aggregate {
    Aggregate {
        filter,
        group_by,
        each: Vec::new(),
        measures: BTreeMap::from([("n".to_string(), Measure::Count(None))]),
    }
}

fn ordering(filter: Option<Filter>) -> Order {
    Order {
        descending: true,
        filter,
        include: vec![CATEGORY.to_string()],
        ..Order::new(POPULARITY, 10)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shares_match_their_names() {
        let rows = 200_000;
        let docs: Vec<Doc> = (0..rows).map(|id| doc(id, 0)).collect();
        let above = above_share(0.1);
        let popular = docs
            .iter()
            .filter(|d| matches!(d.attributes[POPULARITY], skywake_index::Value::Number(p) if p > above))
            .count() as f64;
        assert!((popular / rows as f64 - 0.1).abs() < 0.005);
        let first = category_name(0);
        let in_first = docs
            .iter()
            .filter(|d| d.attributes[CATEGORY] == skywake_index::Value::from(first.as_str()))
            .count() as f64;
        assert!((in_first / rows as f64 - 0.01).abs() < 0.002);
    }

    #[test]
    fn every_family_parses_back_from_its_key() {
        for family in Family::ALL {
            assert_eq!(Family::parse(family.key()), Some(family));
        }
    }
}
