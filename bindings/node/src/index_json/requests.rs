//! Queries, searches, hybrid, order, rank and aggregate requests from plain JavaScript objects.

use std::collections::HashMap;

use napi::Result;
use napi_derive::napi;
use serde_json::Value as Json;
use skywake_index::{
    Aggregate, Hybrid, Measure, Order, Per, Query, Rank, Score, Search, TextQuery,
};

use super::filters::{filter_from, split_matches};
use super::values::{floats, sparse_from};
use crate::error::invalid;

#[napi(object)]
pub struct IndexQuery {
    pub column: String,
    pub vector: Vec<f64>,
    pub top_k: u32,
    pub recall: Option<f64>,
    pub probe: Option<u32>,
    pub filter: Option<Json>,
    pub include: Option<Vec<String>>,
    pub offset: Option<u32>,
    pub per: Option<IndexPer>,
}

#[napi(object)]
pub struct IndexPer {
    pub attributes: Vec<String>,
    pub limit: u32,
}

#[napi(object)]
pub struct IndexSearch {
    pub query: String,
    pub fields: Option<Vec<String>>,
    pub boosts: Option<HashMap<String, f64>>,
    pub top_k: u32,
    pub k1: Option<f64>,
    pub b: Option<f64>,
    pub filter: Option<Json>,
    pub include: Option<Vec<String>>,
    pub highlight: Option<Vec<String>>,
    pub offset: Option<u32>,
    pub per: Option<IndexPer>,
    pub fuzzy: Option<u32>,
    pub last_as_prefix: Option<bool>,
}

#[napi(object)]
pub struct IndexNamedSearch {
    pub name: String,
    pub vector: Option<IndexQuery>,
    pub text: Option<IndexSearch>,
}

#[napi(object)]
pub struct IndexHybrid {
    pub searches: Vec<IndexNamedSearch>,
    pub top_k: u32,
    pub k: Option<f64>,
    pub weights: Option<HashMap<String, f64>>,
    pub offset: Option<u32>,
    pub per: Option<IndexPer>,
    pub rank: Option<Json>,
}

#[napi(object)]
pub struct IndexOrderKey {
    pub by: String,
    pub descending: Option<bool>,
}

#[napi(object)]
pub struct IndexOrder {
    pub by: String,
    pub descending: Option<bool>,
    pub then_by: Option<Vec<IndexOrderKey>>,
    pub missing_lowest: Option<bool>,
    pub top_k: u32,
    pub offset: Option<u32>,
    pub filter: Option<Json>,
    pub include: Option<Vec<String>>,
}

#[napi(object)]
pub struct IndexRank {
    pub score: Json,
    pub top_k: u32,
    pub offset: Option<u32>,
    pub filter: Option<Json>,
    pub include: Option<Vec<String>>,
}

#[napi(object)]
pub struct IndexAggregate {
    pub filter: Option<Json>,
    pub group_by: Option<Vec<String>>,
    pub each: Option<Vec<String>>,
    pub measures: HashMap<String, Vec<String>>,
}

#[napi(object)]
pub struct IndexRequest {
    pub query: Option<IndexQuery>,
    pub search: Option<IndexSearch>,
    pub hybrid: Option<IndexHybrid>,
    pub order: Option<IndexOrder>,
    pub aggregate: Option<IndexAggregate>,
    pub rank: Option<IndexRank>,
}

#[napi(object)]
pub struct IndexMultiOptions {
    pub eventual: Option<bool>,
    pub epoch: Option<f64>,
}

pub(crate) enum Request {
    Query(Query),
    Search(TextQuery),
    Hybrid(Hybrid),
    Order(Order),
    Aggregate(Aggregate),
    Rank(Rank),
}

fn per_from(per: Option<IndexPer>) -> Option<Per> {
    per.map(|per| Per {
        attributes: per.attributes,
        limit: per.limit as usize,
    })
}

pub(crate) fn query_from(input: IndexQuery) -> Result<Query> {
    Ok(Query {
        column: input.column,
        vector: input.vector.into_iter().map(|x| x as f32).collect(),
        top_k: input.top_k as usize,
        recall: input.recall.map(|recall| recall as f32),
        probe: input.probe.map(|probe| probe as usize),
        filter: input.filter.as_ref().map(filter_from).transpose()?,
        include: input.include.unwrap_or_default(),
        offset: input.offset.unwrap_or(0) as usize,
        per: per_from(input.per),
    })
}

pub(crate) fn search_from(input: IndexSearch) -> Result<TextQuery> {
    let boosts = input.boosts.unwrap_or_default();
    let fields = input.fields.unwrap_or_default();
    if let Some(name) = boosts.keys().find(|name| !fields.contains(name)) {
        return Err(invalid(format!(
            "the boost of `{name}` names no field in `fields`"
        )));
    }
    let fields = (fields.into_iter())
        .map(|name| {
            let boost = boosts.get(&name).map_or(1.0, |&boost| boost as f32);
            (name, boost)
        })
        .collect();
    let mut matches = Vec::new();
    let filter = match &input.filter {
        Some(json) => split_matches(json, &mut matches)?,
        None => None,
    };
    Ok(TextQuery {
        query: input.query,
        fields,
        top_k: input.top_k as usize,
        k1: input.k1.map(|k1| k1 as f32),
        b: input.b.map(|b| b as f32),
        filter,
        matches,
        include: input.include.unwrap_or_default(),
        highlight: input.highlight.unwrap_or_default(),
        offset: input.offset.unwrap_or(0) as usize,
        per: per_from(input.per),
        fuzzy: input.fuzzy.unwrap_or(0).min(u8::MAX as u32) as u8,
        last_as_prefix: input.last_as_prefix.unwrap_or(false),
    })
}

pub(crate) fn hybrid_from(input: IndexHybrid) -> Result<Hybrid> {
    let searches = (input.searches.into_iter())
        .map(|named| {
            let search = match (named.vector, named.text) {
                (Some(vector), None) => Search::Vector(query_from(vector)?),
                (None, Some(text)) => Search::Text(search_from(text)?),
                _ => {
                    return Err(invalid(format!(
                        "search `{}` takes one of `vector` or `text`",
                        named.name
                    )));
                }
            };
            Ok((named.name, search))
        })
        .collect::<Result<_>>()?;
    Ok(Hybrid {
        searches,
        k: input.k.map_or(60.0, |k| k as f32),
        weights: (input.weights.unwrap_or_default().into_iter())
            .map(|(name, weight)| (name, weight as f32))
            .collect(),
        top_k: input.top_k as usize,
        offset: input.offset.unwrap_or(0) as usize,
        per: per_from(input.per),
        rank: input.rank.as_ref().map(score_from).transpose()?,
    })
}

fn score_from(json: &Json) -> Result<Score> {
    if let Some(x) = json.as_f64() {
        return Ok(Score::Constant(x));
    }
    let one = json.as_object().filter(|o| o.len() == 1);
    let Some((key, inner)) = one.and_then(|o| o.iter().next()) else {
        return Err(invalid(
            "a score is a number or an object with one key, such as {\"sum\": [..]}",
        ));
    };
    let name = || {
        (inner.as_str().map(str::to_string)).ok_or_else(|| invalid(format!("`{key}` takes a name")))
    };
    let list = || -> Result<Vec<Score>> {
        (inner.as_array())
            .ok_or_else(|| invalid(format!("`{key}` takes a list of scores")))?
            .iter()
            .map(score_from)
            .collect()
    };
    let field = |name: &str| -> Result<&Json> {
        inner
            .get(name)
            .ok_or_else(|| invalid(format!("`{key}` needs `{name}`")))
    };
    let attribute = || -> Result<String> {
        (field("attribute")?.as_str().map(str::to_string))
            .ok_or_else(|| invalid(format!("`{key}.attribute` takes a name")))
    };
    let number = |name: &str| -> Result<f64> {
        field(name)?
            .as_f64()
            .ok_or_else(|| invalid(format!("`{key}.{name}` takes a number")))
    };
    Ok(match key.as_str() {
        "search" => Score::Search(name()?),
        "attribute" => Score::Attribute(name()?),
        "sum" => Score::Sum(list()?),
        "product" => Score::Product(list()?),
        "max" => Score::Max(list()?),
        "min" => Score::Min(list()?),
        "decay" => Score::Decay {
            of: Box::new(score_from(field("of")?)?),
            origin: number("origin")?,
            scale: number("scale")?,
        },
        "filter" => Score::Filter(Box::new(filter_from(inner)?)),
        "dist" => Score::Dist {
            of: Box::new(score_from(field("of")?)?),
            origin: number("origin")?,
        },
        "pow" => Score::Pow {
            of: Box::new(score_from(field("of")?)?),
            exponent: number("exponent")?,
        },
        "saturate" => Score::Saturate {
            of: Box::new(score_from(field("of")?)?),
            k: number("k")?,
        },
        "dot" => Score::Dot {
            of: attribute()?,
            vector: sparse_from(inner)?,
        },
        "max_sim" => Score::MaxSim {
            of: attribute()?,
            vectors: (field("vectors")?.as_array())
                .ok_or_else(|| invalid("`max_sim.vectors` takes a list of vectors"))?
                .iter()
                .map(floats)
                .collect::<Result<_>>()?,
        },
        other => return Err(invalid(format!("no score `{other}`"))),
    })
}

pub(crate) fn order_from(input: IndexOrder) -> Result<Order> {
    Ok(Order {
        by: input.by,
        descending: input.descending.unwrap_or(false),
        then: (input.then_by.unwrap_or_default().into_iter())
            .map(|key| (key.by, key.descending.unwrap_or(false)))
            .collect(),
        missing_lowest: input.missing_lowest.unwrap_or(false),
        top_k: input.top_k as usize,
        offset: input.offset.unwrap_or(0) as usize,
        filter: input.filter.as_ref().map(filter_from).transpose()?,
        include: input.include.unwrap_or_default(),
    })
}

fn rank_from(input: IndexRank) -> Result<Rank> {
    Ok(Rank {
        score: score_from(&input.score)?,
        top_k: input.top_k as usize,
        offset: input.offset.unwrap_or(0) as usize,
        filter: input.filter.as_ref().map(filter_from).transpose()?,
        include: input.include.unwrap_or_default(),
    })
}

pub(crate) fn aggregate_from(input: IndexAggregate) -> Result<Aggregate> {
    let measures = (input.measures.into_iter())
        .map(|(name, spec)| {
            let measure = match spec.iter().map(String::as_str).collect::<Vec<_>>()[..] {
                ["count"] => Measure::Count(None),
                ["count", of] => Measure::Count(Some(of.to_string())),
                ["sum", of] => Measure::Sum(of.to_string()),
                ["avg", of] => Measure::Avg(of.to_string()),
                ["min", of] => Measure::Min(of.to_string()),
                ["max", of] => Measure::Max(of.to_string()),
                _ => return Err(invalid(format!("`{name}`: no measure {spec:?}"))),
            };
            Ok((name, measure))
        })
        .collect::<Result<_>>()?;
    Ok(Aggregate {
        filter: input.filter.as_ref().map(filter_from).transpose()?,
        group_by: input.group_by.unwrap_or_default(),
        each: input.each.unwrap_or_default(),
        measures,
    })
}

pub(crate) fn request_from(input: IndexRequest) -> Result<Request> {
    let mut asked = Vec::new();
    asked.extend(input.query.map(|q| query_from(q).map(Request::Query)));
    asked.extend(input.search.map(|s| search_from(s).map(Request::Search)));
    asked.extend(input.hybrid.map(|h| hybrid_from(h).map(Request::Hybrid)));
    asked.extend(input.order.map(|o| order_from(o).map(Request::Order)));
    asked.extend(
        input
            .aggregate
            .map(|a| aggregate_from(a).map(Request::Aggregate)),
    );
    asked.extend(input.rank.map(|r| rank_from(r).map(Request::Rank)));
    match asked.len() {
        1 => asked.remove(0),
        _ => Err(invalid(
            "a request takes one of query, search, hybrid, order, aggregate or rank",
        )),
    }
}
