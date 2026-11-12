use std::sync::Arc;

use object_store::memory::InMemory;
use object_store::path::Path;
use object_store::{GetRange, ObjectStoreExt};

use crate::format::cluster::ClusterRef;
use crate::testing::{Gate, brute_force, built, clustered, doc, schema, table};
use crate::{
    Aggregate, Doc, Filter, Id, Index, Kind, Measure, Metric, Options, Order, Query, Rank, Schema,
    Score, Value,
};

#[derive(Debug, PartialEq)]
enum Read {
    Codes,
    Vectors,
    Attributes,
    Other,
}

async fn cold_query(gate: &Arc<Gate>, table: &[ClusterRef], query: &Query) -> (Vec<Read>, u64) {
    gate.reads.lock().unwrap().clear();
    let index = Index::open(gate.clone(), "main").await.unwrap();
    assert_eq!(index.query(query).await.unwrap().len(), query.top_k);
    let reads = std::mem::take(&mut *gate.reads.lock().unwrap());
    let mut kinds = Vec::new();
    let mut bytes = 0;
    for (path, range) in reads {
        let Some(hash) = path.strip_prefix("blobs/") else {
            kinds.push(Read::Other);
            continue;
        };
        let cluster = table.iter().find(|c| c.hash.to_string() == hash).unwrap();
        let Some(GetRange::Bounded(range)) = range else {
            panic!("a whole cluster was read");
        };
        bytes += range.end - range.start;
        let vectors = cluster.vectors(0..cluster.rows as usize);
        kinds.push(match range {
            range if range == cluster.codes() => Read::Codes,
            range if range == cluster.attributes() => Read::Attributes,
            range if vectors.start <= range.start && range.end <= vectors.end => Read::Vectors,
            range => panic!("an unexpected range {range:?}"),
        });
    }
    (kinds, bytes)
}

async fn damage(gate: &Arc<Gate>, table: &[ClusterRef], section: usize) {
    for cluster in table {
        let at = Path::from(format!("blobs/{}", cluster.hash));
        let mut bytes = gate
            .inner
            .get(&at)
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap()
            .to_vec();
        let range = cluster.offsets[section] as usize..cluster.offsets[section + 1] as usize;
        bytes[range].iter_mut().for_each(|b| *b ^= 0x10);
        gate.inner.put(&at, bytes.into()).await.unwrap();
    }
}

#[tokio::test]
async fn orders_by_many_keys_groups_by_items_and_scores_filters() {
    let schema = schema()
        .attribute("tier", Kind::String)
        .attribute("n", Kind::Number)
        .attribute("tags", Kind::Strings);
    let index = Index::create(Arc::new(InMemory::new()), schema)
        .await
        .unwrap();
    let row = |id: u64, tier: Option<&str>, n: f64, tags: &[&str]| {
        let mut d = doc(id).attribute("n", Value::Number(n));
        if let Some(tier) = tier {
            d = d.attribute("tier", Value::from(tier));
        }
        let tags = tags.iter().map(|t| t.to_string()).collect();
        d.attribute("tags", Value::Strings(tags))
    };
    index
        .upsert(vec![
            row(1, Some("b"), 1.0, &["x", "y"]),
            row(2, Some("a"), 5.0, &["x", "x"]),
            row(3, Some("b"), 9.0, &[]),
        ])
        .await
        .unwrap();
    index.build().await.unwrap();
    index.upsert(vec![row(4, None, 2.0, &["y"])]).await.unwrap();

    let ids = |rows: Vec<crate::Row>| rows.into_iter().map(|r| r.id).collect::<Vec<_>>();
    let mut order = Order::new("tier", 10);
    order.then = vec![("n".into(), true)];
    assert_eq!(
        ids(index.order(&order).await.unwrap()),
        [Id::Num(2), Id::Num(3), Id::Num(1), Id::Num(4)]
    );
    order.missing_lowest = true;
    assert_eq!(ids(index.order(&order).await.unwrap())[0], Id::Num(4));
    order.descending = true;
    assert_eq!(ids(index.order(&order).await.unwrap())[3], Id::Num(4));

    let aggregate = Aggregate {
        filter: None,
        group_by: vec!["tags".into()],
        each: vec!["tags".into()],
        measures: [("count".to_string(), Measure::Count(None))].into(),
    };
    let groups = index.aggregate(&aggregate).await.unwrap();
    let counts: Vec<(Value, Value)> = (groups.into_iter())
        .map(|g| (g.key["tags"].clone(), g.values["count"].clone()))
        .collect();
    assert_eq!(
        counts,
        [
            (Value::from("x"), Value::Int(2)),
            (Value::from("y"), Value::Int(2)),
        ]
    );

    let rank = |score: Score| {
        let index = index.clone();
        async move {
            let rank = Rank {
                score,
                top_k: 10,
                offset: 0,
                filter: None,
                include: Vec::new(),
            };
            let hits = index.rank(&rank).await.unwrap();
            hits.into_iter()
                .map(|h| (h.id, h.score))
                .collect::<Vec<_>>()
        }
    };
    let tagged = Score::Sum(vec![
        Score::Filter(Box::new(Filter::eq("tier", "b"))),
        Score::Product(vec![
            Score::Constant(0.1),
            Score::Dist {
                of: Box::new(Score::Attribute("n".into())),
                origin: 4.0,
            },
        ]),
    ]);
    let scored = rank(tagged).await;
    assert_eq!(scored[0].0, Id::Num(3));
    assert!((scored[0].1 - 1.5).abs() < 1e-9, "{scored:?}");
    let squared = Score::Pow {
        of: Box::new(Score::Attribute("n".into())),
        exponent: 2.0,
    };
    assert_eq!(rank(squared).await[0], (Id::Num(3), 81.0));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_query_reads_the_codes_of_some_clusters_and_a_few_vectors() {
    let gate = Gate::new();
    let index = built(&gate, 10_000, 128, 2000).await;
    let version = index.version().await.unwrap();
    let table = table(&index, &version).await;
    let total: u64 = table.iter().map(|c| c.bytes()).sum();
    let mut read = 0;
    for vector in clustered(10, 128, 2) {
        let (kinds, bytes) = cold_query(&gate, &table, &Query::new("v", vector, 10)).await;
        let count = |kind: Read| kinds.iter().filter(|k| **k == kind).count();
        let (codes, vectors) = (count(Read::Codes), count(Read::Vectors));
        assert!(
            codes > 0 && codes < table.len() / 2,
            "{codes} of {}",
            table.len()
        );
        assert!(vectors <= 40, "{vectors} vector reads");
        assert_eq!(count(Read::Attributes), 0);
        read += bytes;
    }
    assert!(
        read / 10 < total / 10,
        "{} of {total} bytes a query",
        read / 10
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_recall_of_one_returns_the_true_top_k() {
    use crate::Element;

    let (rows, dims) = (3000, 16);
    let schema = Schema::new()
        .vector("f32", dims, Metric::Euclidean)
        .vector_of("f16", dims, Metric::Cosine, Element::F16)
        .vector_of("i8", dims, Metric::Dot, Element::I8)
        .attribute("m", Kind::Int);
    let options = Options {
        cluster_rows: 100,
        ..Options::default()
    };
    let index = Index::create_with(Arc::new(InMemory::new()), schema, options)
        .await
        .unwrap();
    let byte = |v: &[f32]| (v.iter().map(|x| (8.0 * x).round().clamp(-128.0, 127.0))).collect();
    let docs = |seed: u64, from: usize| -> Vec<Doc> {
        (clustered(rows, dims, seed).into_iter().enumerate())
            .map(|(i, v)| {
                Doc::new((from + i) as u64)
                    .vector("i8", byte(&v))
                    .vector("f16", v.clone())
                    .vector("f32", v)
                    .attribute("m", (i % 7) as i64)
            })
            .collect()
    };
    index.upsert(docs(1, 0)).await.unwrap();
    index.build().await.unwrap();
    index.upsert(docs(2, 2500)).await.unwrap();
    index.delete((0..300).map(Id::Num).collect()).await.unwrap();
    index.build().await.unwrap();
    index.upsert(docs(3, 5000)[..200].to_vec()).await.unwrap();
    index
        .delete((5000..5050).map(Id::Num).collect())
        .await
        .unwrap();
    let clusters = index.stats().await.unwrap().clusters;
    assert!(clusters > 100, "{clusters} clusters");

    for (i, vector) in clustered(10, dims, 9).into_iter().enumerate() {
        for column in ["f32", "f16", "i8"] {
            let vector = if column == "i8" {
                byte(&vector)
            } else {
                vector.clone()
            };
            let mut query = Query::new(column, vector, 10).recall(1.0);
            if i % 2 == 1 {
                query = query.filter(Filter::eq("m", 3i64));
            }
            let found: Vec<(Id, f32)> = (index.query(&query).await.unwrap().into_iter())
                .map(|hit| (hit.id, hit.distance))
                .collect();
            assert_eq!(
                found,
                brute_force(&index, &query).await,
                "{column}, query {i}"
            );
        }
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_cold_query_reads_in_three_rounds() {
    let gate = Gate::new();
    let index = built(&gate, 10_000, 128, 2000).await;
    let version = index.version().await.unwrap();
    let table = table(&index, &version).await;
    let vector = clustered(1, 128, 3).remove(0);
    let (kinds, _) = cold_query(&gate, &table, &Query::new("v", vector, 10)).await;
    let first_codes = kinds.iter().position(|k| *k == Read::Codes).unwrap();
    let last_codes = kinds.iter().rposition(|k| *k == Read::Codes).unwrap();
    let first_vectors = kinds.iter().position(|k| *k == Read::Vectors).unwrap();
    let last_other = kinds.iter().rposition(|k| *k == Read::Other).unwrap();
    assert!(first_codes > 0 && last_other < first_codes, "{kinds:?}");
    assert!(last_codes < first_vectors, "{kinds:?}");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_query_checks_every_range_it_reads() {
    for section in [0, 2] {
        let gate = Gate::new();
        let index = built(&gate, 2000, 32, 2000).await;
        let version = index.version().await.unwrap();
        let table = table(&index, &version).await;
        damage(&gate, &table, section).await;
        let fresh = Index::open(gate.clone(), "main").await.unwrap();
        let vector = clustered(1, 32, 2).remove(0);
        let found = fresh.query(&Query::new("v", vector, 10).probe(4)).await;
        assert!(
            matches!(found, Err(crate::Error::Corrupt(_))),
            "section {section}: {found:?}"
        );
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_recall_of_zero_or_less_is_refused() {
    let gate = Gate::new();
    let index = built(&gate, 200, 8, 200).await;
    for recall in [0.0, -1.0, f32::NAN] {
        let query = Query::new("v", vec![0.0; 8], 10).recall(recall);
        assert!(matches!(
            index.query(&query).await,
            Err(crate::Error::Invalid(_))
        ));
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_filtered_query_reads_codes_and_attributes_in_one_request() {
    let gate = Gate::new();
    let schema = (Schema::new().vector("v", 32, Metric::Euclidean)).attribute("n", Kind::Number);
    let options = Options {
        cluster_rows: 200,
        ..Options::default()
    };
    let index = Index::create_with(gate.clone(), schema, options)
        .await
        .unwrap();
    let docs = (clustered(4000, 32, 1).into_iter().enumerate())
        .map(|(id, v)| Doc::new(id as u64).vector("v", v).attribute("n", id as f64))
        .collect();
    index.upsert(docs).await.unwrap();
    index.build().await.unwrap();
    let version = index.version().await.unwrap();
    let table = table(&index, &version).await;

    let fresh = Index::open(gate.clone(), "main").await.unwrap();
    gate.reads.lock().unwrap().clear();
    let vector = clustered(1, 32, 2).remove(0);
    let query = Query::new("v", vector, 10)
        .filter(Filter::lt("n", 400.0))
        .probe(4);
    assert_eq!(fresh.query(&query).await.unwrap().len(), 10);
    let reads = std::mem::take(&mut *gate.reads.lock().unwrap());
    let mut both = 0;
    for (path, range) in reads {
        let Some(hash) = path.strip_prefix("blobs/") else {
            continue;
        };
        let cluster = table.iter().find(|c| c.hash.to_string() == hash).unwrap();
        let Some(GetRange::Bounded(range)) = range else {
            panic!("a whole cluster was read");
        };
        if range == (cluster.codes().start..cluster.attributes().end) {
            both += 1;
        } else {
            let vectors = cluster.vectors(0..cluster.rows as usize);
            assert!(
                vectors.start <= range.start && range.end <= vectors.end,
                "{range:?}"
            );
        }
    }
    assert_eq!(both, 4);
}

#[tokio::test(flavor = "multi_thread")]
async fn ids_and_limits_per_value_agree_before_and_after_a_build() {
    let schema = schema().attribute("group", Kind::Int);
    let index = Index::create(Arc::new(InMemory::new()), schema)
        .await
        .unwrap();
    let docs = (0..100u64).map(|id| doc(id).attribute("group", (id / 10) as i64));
    index.upsert(docs.collect()).await.unwrap();
    let near = |top_k| Query::new("v", vec![0.0, 0.0], top_k);
    let cases = [
        (
            near(10).filter(Filter::ids(vec![97.into(), 3.into(), 50.into()])),
            vec![3, 50, 97],
        ),
        (
            near(2).filter(Filter::ids(vec![0.into(), 1.into()]).negate()),
            vec![2, 3],
        ),
        (
            Query {
                per: Some(crate::Per {
                    attributes: vec!["group".into()],
                    limit: 2,
                }),
                offset: 1,
                ..near(5)
            },
            vec![1, 10, 11, 20, 21],
        ),
    ];
    for built in [false, true] {
        if built {
            index.build().await.unwrap();
        }
        for (query, want) in &cases {
            let hits = index.query(query).await.unwrap();
            let ids: Vec<Id> = hits.iter().map(|hit| hit.id.clone()).collect();
            let want: Vec<Id> = want.iter().map(|&id| Id::Num(id)).collect();
            assert_eq!(ids, want, "built: {built}, {query:?}");
            assert!(hits.iter().all(|hit| hit.attributes.is_empty()));
        }
    }
}

#[tokio::test]
async fn sparse_and_late_interaction_vectors_rank_exactly() {
    let schema = schema()
        .attribute("terms", Kind::Sparse)
        .attribute("tokens", Kind::Vectors);
    let index = Index::create(Arc::new(InMemory::new()), schema)
        .await
        .unwrap();
    let with = |id: u64, terms: Vec<(u32, f32)>, tokens: Vec<Vec<f32>>| {
        doc(id)
            .attribute("terms", Value::Sparse(terms))
            .attribute("tokens", Value::Vectors(tokens))
    };
    index
        .upsert(vec![
            with(1, vec![(7, 1.0), (2, 1.0)], vec![vec![1.0, 0.0]]),
            with(2, vec![(2, 3.0)], vec![vec![0.0, 1.0], vec![0.6, 0.8]]),
        ])
        .await
        .unwrap();
    index.build().await.unwrap();
    index
        .upsert(vec![with(3, vec![(9, 1.0)], vec![vec![0.0, 1.0]])])
        .await
        .unwrap();
    let ranked = |score: Score| {
        let index = index.clone();
        async move {
            let rank = Rank {
                score,
                top_k: 10,
                offset: 0,
                filter: None,
                include: Vec::new(),
            };
            let hits = index.rank(&rank).await.unwrap();
            hits.into_iter()
                .map(|hit| (hit.id, hit.score))
                .collect::<Vec<_>>()
        }
    };
    let dot = Score::Dot {
        of: "terms".into(),
        vector: vec![(2, 1.0), (9, 2.0)],
    };
    assert_eq!(
        ranked(dot).await,
        [(Id::Num(2), 3.0), (Id::Num(3), 2.0), (Id::Num(1), 1.0)]
    );
    let max_sim = Score::MaxSim {
        of: "tokens".into(),
        vectors: vec![vec![1.0, 0.0], vec![0.0, 1.0]],
    };
    let scores = ranked(max_sim).await;
    assert_eq!(scores[0].0, Id::Num(2));
    assert!((scores[0].1 - 1.6).abs() < 1e-6, "{scores:?}");

    let unsorted = Score::Dot {
        of: "terms".into(),
        vector: vec![(9, 1.0), (2, 1.0)],
    };
    let rank = Rank {
        score: unsorted,
        top_k: 1,
        offset: 0,
        filter: None,
        include: Vec::new(),
    };
    assert!(index.rank(&rank).await.is_err());
    let query = Query {
        filter: Some(Filter::eq("terms", 1.0)),
        ..Query::new("v", vec![0.0, 0.0], 1)
    };
    assert!(index.query(&query).await.is_err());
    let ragged = with(4, vec![], vec![vec![1.0], vec![1.0, 2.0]]);
    assert!(index.upsert(vec![ragged]).await.is_err());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_repeated_query_reads_only_the_head() {
    let gate = Gate::new();
    let index = built(&gate, 2000, 16, 500).await;
    let query = Query::new("v", clustered(1, 16, 9).remove(0), 10);
    index.query(&query).await.unwrap();
    gate.reads.lock().unwrap().clear();
    index.query(&query).await.unwrap();
    let reads = gate.reads.lock().unwrap();
    assert!(
        reads.iter().all(|(path, _)| path.starts_with("refs/")),
        "{reads:?}"
    );
}
