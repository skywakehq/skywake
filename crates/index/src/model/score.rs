//! Scores from expressions over search scores and attributes.

use std::collections::BTreeMap;

use crate::{Attributes, Filter, Id, Kind, Result, Schema, Value, invalid};

#[derive(Clone, Debug, PartialEq)]
pub enum Score {
    Constant(f64),
    Search(String),
    Attribute(String),
    Sum(Vec<Score>),
    Product(Vec<Score>),
    Max(Vec<Score>),
    Min(Vec<Score>),
    Decay {
        of: Box<Score>,
        origin: f64,
        scale: f64,
    },
    Saturate {
        of: Box<Score>,
        k: f64,
    },
    Dot {
        of: String,
        vector: Vec<(u32, f32)>,
    },
    MaxSim {
        of: String,
        vectors: Vec<Vec<f32>>,
    },
    /// 1 when the document passes the filter, else 0.
    Filter(Box<Filter>),
    /// How far a score is from `origin`, either way.
    Dist {
        of: Box<Score>,
        origin: f64,
    },
    Pow {
        of: Box<Score>,
        exponent: f64,
    },
}

impl Score {
    pub(crate) fn eval(
        &self,
        id: &Id,
        scores: &BTreeMap<String, f32>,
        attributes: &Attributes,
    ) -> f64 {
        let all = |list: &[Score]| -> Vec<f64> {
            list.iter()
                .map(|s| s.eval(id, scores, attributes))
                .collect()
        };
        let of = |score: &Score| score.eval(id, scores, attributes);
        match self {
            Score::Constant(x) => *x,
            Score::Search(name) => scores.get(name).map_or(0.0, |&x| x as f64),
            Score::Attribute(name) => match attributes.get(name) {
                Some(Value::Number(x)) => *x,
                Some(Value::Int(x) | Value::Datetime(x)) => *x as f64,
                Some(Value::Bool(x)) => *x as u8 as f64,
                _ => 0.0,
            },
            Score::Sum(list) => all(list).into_iter().sum(),
            Score::Product(list) => all(list).into_iter().product(),
            Score::Max(list) => all(list).into_iter().fold(f64::NEG_INFINITY, f64::max),
            Score::Min(list) => all(list).into_iter().fold(f64::INFINITY, f64::min),
            Score::Decay {
                of: inner,
                origin,
                scale,
            } => 0.5f64.powf((of(inner) - origin).abs() / scale),
            Score::Saturate { of: inner, k } => {
                let x = of(inner).max(0.0);
                x / (x + k)
            }
            Score::Filter(filter) => filter.matches(id, attributes) as u8 as f64,
            Score::Dist { of: inner, origin } => (of(inner) - origin).abs(),
            Score::Pow {
                of: inner,
                exponent,
            } => {
                let x = of(inner).max(0.0).powf(*exponent);
                if x.is_finite() { x } else { 0.0 }
            }
            Score::Dot { of: name, vector } => match attributes.get(name) {
                Some(Value::Sparse(pairs)) => sparse_dot(pairs, vector),
                _ => 0.0,
            },
            Score::MaxSim { of: name, vectors } => match attributes.get(name) {
                Some(Value::Vectors(found)) => max_sim(vectors, found),
                _ => 0.0,
            },
        }
    }

    pub(crate) fn check(&self, searches: &[&str], schema: &Schema) -> Result<()> {
        let all = |list: &[Score]| {
            if list.is_empty() {
                return Err(invalid("a score list needs an item"));
            }
            list.iter().try_for_each(|s| s.check(searches, schema))
        };
        match self {
            Score::Constant(x) if !x.is_finite() => Err(invalid("a score constant must be finite")),
            Score::Constant(_) => Ok(()),
            Score::Search(name) if !searches.contains(&name.as_str()) => {
                Err(invalid(format!("a score names no search `{name}`")))
            }
            Score::Search(_) => Ok(()),
            Score::Attribute(name) => match schema.kind(name)? {
                Kind::Number | Kind::Int | Kind::Datetime | Kind::Bool => Ok(()),
                _ => Err(invalid(format!(
                    "`{name}` scores only as a number, int, datetime or bool"
                ))),
            },
            Score::Sum(list) | Score::Product(list) | Score::Max(list) | Score::Min(list) => {
                all(list)
            }
            Score::Decay { scale, .. } if !(scale.is_finite() && *scale > 0.0) => {
                Err(invalid("a decay's scale must be more than 0"))
            }
            Score::Saturate { k, .. } if !(k.is_finite() && *k > 0.0) => {
                Err(invalid("saturate's k must be more than 0"))
            }
            Score::Decay { of, origin, .. } if origin.is_finite() => of.check(searches, schema),
            Score::Decay { .. } => Err(invalid("a decay's origin must be finite")),
            Score::Saturate { of, .. } => of.check(searches, schema),
            Score::Filter(filter) => filter.typed(schema).map(drop),
            Score::Dist { origin, .. } if !origin.is_finite() => {
                Err(invalid("a dist's origin must be finite"))
            }
            Score::Pow { exponent, .. } if !(exponent.is_finite() && *exponent > 0.0) => {
                Err(invalid("pow's exponent must be more than 0"))
            }
            Score::Dist { of, .. } | Score::Pow { of, .. } => of.check(searches, schema),
            Score::Dot { of, vector } => {
                kind_is(schema, of, Kind::Sparse)?;
                let given = Value::Sparse(vector.clone());
                match !vector.is_empty() && given.clone().to_kind(Kind::Sparse) == Some(given) {
                    true => Ok(()),
                    false => Err(invalid(
                        "a sparse vector needs rising indices and finite weights",
                    )),
                }
            }
            Score::MaxSim { of, vectors } => {
                kind_is(schema, of, Kind::Vectors)?;
                match Value::Vectors(vectors.clone()).to_kind(Kind::Vectors) {
                    Some(_) => Ok(()),
                    None => Err(invalid("max_sim needs vectors of one length, finite")),
                }
            }
        }
    }

    pub(crate) fn attributes(&self, out: &mut Vec<String>) {
        match self {
            Score::Attribute(name) if !out.contains(name) => out.push(name.clone()),
            Score::Sum(list) | Score::Product(list) | Score::Max(list) | Score::Min(list) => {
                list.iter().for_each(|s| s.attributes(out))
            }
            Score::Decay { of, .. }
            | Score::Saturate { of, .. }
            | Score::Dist { of, .. }
            | Score::Pow { of, .. } => of.attributes(out),
            Score::Filter(filter) => {
                let mut names = Vec::new();
                filter.names(&mut names);
                (names.into_iter())
                    .filter(|name| *name != "id")
                    .for_each(|name| {
                        if !out.iter().any(|n| n == name) {
                            out.push(name.to_string());
                        }
                    });
            }
            Score::Dot { of, .. } | Score::MaxSim { of, .. } if !out.contains(of) => {
                out.push(of.clone())
            }
            _ => {}
        }
    }
}

impl Score {
    /// The score with its filters typed by the schema, as filters are before they run.
    pub(crate) fn typed(&self, schema: &Schema) -> Result<Score> {
        let all = |list: &[Score]| -> Result<Vec<Score>> {
            list.iter().map(|s| s.typed(schema)).collect()
        };
        let boxed = |score: &Score| -> Result<Box<Score>> { Ok(Box::new(score.typed(schema)?)) };
        Ok(match self {
            Score::Filter(filter) => Score::Filter(Box::new(filter.typed(schema)?)),
            Score::Sum(list) => Score::Sum(all(list)?),
            Score::Product(list) => Score::Product(all(list)?),
            Score::Max(list) => Score::Max(all(list)?),
            Score::Min(list) => Score::Min(all(list)?),
            Score::Decay { of, origin, scale } => Score::Decay {
                of: boxed(of)?,
                origin: *origin,
                scale: *scale,
            },
            Score::Saturate { of, k } => Score::Saturate {
                of: boxed(of)?,
                k: *k,
            },
            Score::Dist { of, origin } => Score::Dist {
                of: boxed(of)?,
                origin: *origin,
            },
            Score::Pow { of, exponent } => Score::Pow {
                of: boxed(of)?,
                exponent: *exponent,
            },
            other => other.clone(),
        })
    }
}

fn kind_is(schema: &Schema, name: &str, kind: Kind) -> Result<()> {
    match schema.kind(name)? == kind {
        true => Ok(()),
        false => Err(invalid(format!("`{name}` is not {kind:?}"))),
    }
}

fn sparse_dot(a: &[(u32, f32)], b: &[(u32, f32)]) -> f64 {
    let (mut i, mut j, mut sum) = (0, 0, 0.0);
    while i < a.len() && j < b.len() {
        match a[i].0.cmp(&b[j].0) {
            std::cmp::Ordering::Less => i += 1,
            std::cmp::Ordering::Greater => j += 1,
            std::cmp::Ordering::Equal => {
                sum += a[i].1 as f64 * b[j].1 as f64;
                (i, j) = (i + 1, j + 1);
            }
        }
    }
    sum
}

fn max_sim(query: &[Vec<f32>], document: &[Vec<f32>]) -> f64 {
    if query.first().map(Vec::len) != document.first().map(Vec::len) {
        return 0.0;
    }
    let dot = |a: &[f32], b: &[f32]| {
        a.iter()
            .zip(b)
            .map(|(x, y)| *x as f64 * *y as f64)
            .sum::<f64>()
    };
    (query.iter())
        .map(|q| {
            document
                .iter()
                .map(|d| dot(q, d))
                .fold(f64::NEG_INFINITY, f64::max)
        })
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expressions_combine_scores_and_attributes() {
        let scores = BTreeMap::from([("title".to_string(), 2.0), ("body".to_string(), 1.0)]);
        let attributes = Attributes::from([
            ("stars".to_string(), Value::Number(3.0)),
            ("new".to_string(), Value::Bool(true)),
            (
                "terms".to_string(),
                Value::Sparse(vec![(1, 0.5), (3, 7.0), (9, 0.25)]),
            ),
            (
                "tokens".to_string(),
                Value::Vectors(vec![vec![0.5, 0.0], vec![0.25, 2.0]]),
            ),
        ]);
        let search = |name: &str| Score::Search(name.into());
        let attribute = |name: &str| Score::Attribute(name.into());
        let cases = [
            (Score::Sum(vec![search("title"), search("body")]), 3.0),
            (
                Score::Product(vec![Score::Constant(2.0), search("title")]),
                4.0,
            ),
            (Score::Max(vec![search("body"), attribute("stars")]), 3.0),
            (Score::Min(vec![search("missing"), attribute("new")]), 0.0),
            (
                Score::Decay {
                    of: Box::new(attribute("stars")),
                    origin: 5.0,
                    scale: 2.0,
                },
                0.5,
            ),
            (
                Score::Saturate {
                    of: Box::new(attribute("stars")),
                    k: 1.0,
                },
                0.75,
            ),
            (
                Score::Dot {
                    of: "terms".into(),
                    vector: vec![(1, 2.0), (5, 1.0), (9, 4.0)],
                },
                2.0 * 0.5 + 4.0 * 0.25,
            ),
            (
                Score::MaxSim {
                    of: "tokens".into(),
                    vectors: vec![vec![1.0, 0.0], vec![0.0, 1.0]],
                },
                0.5 + 2.0,
            ),
        ];
        for (score, want) in cases {
            assert!(
                (score.eval(&Id::Num(1), &scores, &attributes) - want).abs() < 1e-9,
                "{score:?}"
            );
        }
    }
}
