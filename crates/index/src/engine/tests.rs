use std::collections::BTreeMap;

use crate::testing::{Gate, clustered};
use crate::{
    Aggregate, Doc, Filter, Group, Id, Index, Kind, Measure, Metric, Options, Schema, Value,
};

struct Draw(u64);

impl Draw {
    fn below(&mut self, n: u64) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        (z ^ (z >> 31)) % n
    }
}

fn schema(vectors: bool) -> Schema {
    let schema = Schema::new()
        .attribute("city", Kind::String)
        .attribute("n", Kind::Int)
        .attribute("score", Kind::Number)
        .attribute("ok", Kind::Bool)
        .attribute("tags", Kind::Strings)
        .attribute("level", Kind::Number)
        .attribute("at", Kind::Datetime);
    match vectors {
        true => schema.vector("v", 8, Metric::Euclidean),
        false => schema.text("body", crate::TextOptions::default()),
    }
}

fn docs(draw: &mut Draw, ids: std::ops::Range<u64>, vectors: Option<&[Vec<f32>]>) -> Vec<Doc> {
    ids.map(|id| {
        let mut doc = Doc::new(id);
        if draw.below(8) != 0 {
            doc = doc.attribute("city", format!("c{}", draw.below(12)));
        }
        let n = match draw.below(40) {
            0 => i64::MAX / 3,
            1 => i64::MIN / 3,
            _ => draw.below(50) as i64 - 10,
        };
        doc = doc.attribute("n", n);
        if draw.below(5) != 0 {
            doc = doc.attribute("score", draw.below(400) as f64 / 8.0);
        }
        doc = doc.attribute("ok", draw.below(2) == 0);
        if draw.below(3) == 0 {
            doc = doc.attribute("tags", Value::Strings(vec![format!("t{}", draw.below(4))]));
        }
        if draw.below(4) != 0 {
            doc = doc.attribute("level", LEVELS[draw.below(LEVELS.len() as u64) as usize]);
        }
        if draw.below(4) != 0 {
            doc = doc.attribute(
                "at",
                Value::Datetime(1_700_000_000 + draw.below(1000) as i64),
            );
        }
        match vectors {
            Some(vectors) => doc.vector("v", vectors[(id % vectors.len() as u64) as usize].clone()),
            None => doc.attribute("body", format!("doc {id}")),
        }
    })
    .collect()
}

const LEVELS: [f64; 5] = [0.0, -0.0, 1.5, f64::NAN, -2.0];

fn leaf(draw: &mut Draw) -> Filter {
    let city = |d: &mut Draw| Value::from(format!("c{}", d.below(14)));
    let n = |d: &mut Draw| Value::Int(d.below(60) as i64 - 15);
    let score = |d: &mut Draw| Value::Number(d.below(420) as f64 / 8.0);
    let level = |d: &mut Draw| Value::Number(LEVELS[d.below(LEVELS.len() as u64) as usize]);
    let at = |d: &mut Draw| Value::Datetime(1_700_000_000 + d.below(1100) as i64);
    match draw.below(16) {
        0 => Filter::Eq("city".into(), city(draw)),
        1 => Filter::In("city".into(), vec![city(draw), city(draw)]),
        2 => Filter::Gt("n".into(), n(draw)),
        3 => Filter::Lte("n".into(), n(draw)),
        4 => Filter::Gte("score".into(), score(draw)),
        5 => Filter::Lt("score".into(), score(draw)),
        6 => Filter::Exists("score".into()),
        7 => Filter::Eq("ok".into(), Value::Bool(draw.below(2) == 0)),
        8 => Filter::Eq("tags".into(), Value::from(format!("t{}", draw.below(4)))),
        9 => Filter::ids((0..3).map(|_| Id::from(draw.below(300))).collect()),
        10 => Filter::Gt(
            "n".into(),
            Value::Number(draw.below(80) as f64 / 2.0 - 15.0),
        ),
        11 => Filter::Eq("level".into(), level(draw)),
        12 => Filter::Lt("level".into(), level(draw)),
        13 => Filter::Gte("at".into(), at(draw)),
        14 => Filter::Exists("tags".into()),
        _ => Filter::Eq("n".into(), n(draw)),
    }
}

fn filter(draw: &mut Draw, depth: u32) -> Filter {
    match (depth, draw.below(5)) {
        (0, _) | (_, 0..=1) => leaf(draw),
        (_, 2) => Filter::And(vec![filter(draw, depth - 1), filter(draw, depth - 1)]),
        (_, 3) => Filter::Or(vec![filter(draw, depth - 1), filter(draw, depth - 1)]),
        _ => Filter::Not(Box::new(filter(draw, depth - 1))),
    }
}

fn aggregate(draw: &mut Draw) -> Aggregate {
    let group_by = match draw.below(9) {
        0 | 1 => vec![],
        2 => vec!["city".to_string()],
        3 => vec!["ok".to_string()],
        4 => vec!["n".to_string()],
        5 => vec!["level".to_string()],
        6 => vec!["tags".to_string()],
        7 => vec!["score".to_string()],
        _ => vec!["city".to_string(), "ok".to_string()],
    };
    let mut measures = BTreeMap::from([("rows".to_string(), Measure::Count(None))]);
    if draw.below(2) == 0 {
        measures.insert("scored".into(), Measure::Count(Some("score".into())));
        measures.insert("sum".into(), Measure::Sum("n".into()));
        measures.insert("avg".into(), Measure::Avg("score".into()));
        measures.insert("low".into(), Measure::Min("city".into()));
        measures.insert("high".into(), Measure::Max("score".into()));
    }
    if draw.below(2) == 0 {
        measures.insert("least".into(), Measure::Min("level".into()));
        measures.insert("most".into(), Measure::Max("level".into()));
        measures.insert("levels".into(), Measure::Sum("level".into()));
        measures.insert("latest".into(), Measure::Max("at".into()));
        measures.insert("smallest".into(), Measure::Min("n".into()));
    }
    Aggregate {
        filter: (draw.below(3) != 0).then(|| filter(draw, 2)),
        group_by,
        each: Vec::new(),
        measures,
    }
}

fn equal(u: &Value, v: &Value) -> bool {
    match (u, v) {
        (Value::Number(u), Value::Number(v)) => {
            (u.is_nan() && v.is_nan()) || (u - v).abs() <= 1e-9 * u.abs().max(1.0)
        }
        (u, v) => u == v,
    }
}

fn same_map(a: &BTreeMap<String, Value>, b: &BTreeMap<String, Value>) -> bool {
    a.len() == b.len()
        && a.iter()
            .zip(b)
            .all(|((x, u), (y, v))| x == y && equal(u, v))
}

fn same(a: &[Group], b: &[Group]) -> bool {
    a.len() == b.len()
        && (a.iter().zip(b))
            .all(|(a, b)| same_map(&a.key, &b.key) && same_map(&a.values, &b.values))
}

async fn case(seed: u64) {
    let mut draw = Draw(seed);
    let vectors = draw.below(2) == 0;
    let points = clustered(64, 8, seed);
    let base = Options {
        cluster_rows: 20 + draw.below(60) as usize,
        page_rows: 16 + draw.below(100) as usize,
        ..Options::default()
    };
    let engine = Options {
        columns: true,
        ..base.clone()
    };
    let (a, b) = (Gate::new(), Gate::new());
    let with = Index::create_with(a, schema(vectors), engine)
        .await
        .unwrap();
    let without = Index::create_with(b, schema(vectors), base).await.unwrap();
    let rounds = 2 + draw.below(3);
    for round in 0..=rounds {
        let start = draw.below(250);
        let ids = start..start + 1 + draw.below(120);
        let batch = docs(&mut draw, ids, vectors.then_some(&points[..]));
        with.upsert(batch.clone()).await.unwrap();
        without.upsert(batch).await.unwrap();
        if draw.below(3) == 0 {
            let start = draw.below(300);
            let gone: Vec<Id> = (start..start + draw.below(30)).map(Id::from).collect();
            with.delete(gone.clone()).await.unwrap();
            without.delete(gone).await.unwrap();
        }
        if round < rounds {
            with.build().await.unwrap();
            without.build().await.unwrap();
        }
    }
    for _ in 0..25 {
        let aggregate = aggregate(&mut draw);
        let got = with.aggregate(&aggregate).await;
        let want = without.aggregate(&aggregate).await;
        let agree = match (&got, &want) {
            (Ok(got), Ok(want)) => same(got, want),
            (Err(got), Err(want)) => got.to_string() == want.to_string(),
            _ => false,
        };
        assert!(
            agree,
            "seed {seed}: {aggregate:?}\n got {got:?}\nwant {want:?}"
        );
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn aggregates_on_columns_match_the_row_path() {
    let cases: u64 = (std::env::var("ORACLE_CASES").ok())
        .and_then(|cases| cases.parse().ok())
        .unwrap_or(30);
    for seed in 0..cases {
        case(seed).await;
    }
}
