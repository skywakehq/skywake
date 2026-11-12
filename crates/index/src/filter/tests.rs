//! Filter-first queries against brute force over the exported documents.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use object_store::{GetRange, ObjectStore, ObjectStoreExt};
use skywake_core::Objects;

use crate::format::cluster::ClusterRef;
use crate::format::legacy::{AnnV7, SchemaV7, V7};
use crate::history::gc;
use crate::store::blob_path;
use crate::store::head;
use crate::testing::{Gate, brute_force};
use crate::vector::ivf::Random;
use crate::{
    Doc, Element, Filter, Hit, Id, Index, Kind, MAIN, Metric, Options, Query, Schema, Value,
};

const COLORS: [&str; 3] = ["red", "green", "blue"];

fn schema() -> Schema {
    Schema::new()
        .vector("a", 8, Metric::Euclidean)
        .vector_of("b", 6, Metric::Cosine, Element::F16)
        .vector_of("c", 4, Metric::Dot, Element::I8)
        .attribute("tag", Kind::Int)
        .attribute("color", Kind::String)
        .attribute("n", Kind::Number)
        .filter_index("tag")
        .filter_index("color")
}

fn options() -> Options {
    Options {
        cluster_rows: 50,
        build_bytes: 100_000,
        ..Options::default()
    }
}

fn unit(random: &mut Random) -> f32 {
    (random.next() >> 40) as f32 / (1u64 << 23) as f32 - 1.0
}

fn doc(random: &mut Random, id: u64) -> Doc {
    let a = (0..8).map(|_| unit(random)).collect();
    let b = (0..6).map(|_| unit(random)).collect();
    let c = (0..4).map(|_| (random.below(255) as f32) - 127.0).collect();
    let mut doc = Doc::new(id)
        .vector("a", a)
        .vector("b", b)
        .vector("c", c)
        .attribute("tag", random.below(40) as i64)
        .attribute("n", random.below(100) as f64);
    if let Some(color) = COLORS.get(random.below(4)) {
        doc = doc.attribute("color", *color);
    }
    doc
}

async fn index(store: Arc<dyn ObjectStore>, schema: Schema) -> Index {
    let mut random = Random(7);
    let index = Index::create_with(store, schema, options()).await.unwrap();
    let docs = (0..2000).map(|id| doc(&mut random, id)).collect();
    index.upsert(docs).await.unwrap();
    index.build().await.unwrap();
    let docs = (0..200).map(|id| doc(&mut random, id)).collect();
    index.upsert(docs).await.unwrap();
    index
        .delete((200..300).map(Id::Num).collect())
        .await
        .unwrap();
    index.build().await.unwrap();
    let docs = (300..350).chain(2000..2100).map(|id| doc(&mut random, id));
    index.upsert(docs.collect()).await.unwrap();
    index
        .delete((350..400).map(Id::Num).collect())
        .await
        .unwrap();
    index
}

fn filters() -> Vec<Filter> {
    vec![
        Filter::eq("tag", 3i64),
        Filter::is_in("tag", vec![Value::Int(5), Value::Int(39)]),
        Filter::lt("tag", 2i64),
        Filter::And(vec![Filter::gte("tag", 10i64), Filter::lte("tag", 11i64)]),
        Filter::eq("color", "red"),
        Filter::And(vec![Filter::eq("tag", 7i64), Filter::eq("color", "green")]),
        Filter::And(vec![
            Filter::gt("tag", 30i64),
            Filter::eq("color", "blue").negate(),
            Filter::ids((0..1000).map(Id::Num).collect()),
        ]),
    ]
}

fn found(hits: &[Hit]) -> Vec<(Id, f32)> {
    hits.iter()
        .map(|hit| (hit.id.clone(), hit.distance))
        .collect()
}

fn same(got: &[(Id, f32)], want: &[(Id, f32)]) -> bool {
    got.len() == want.len()
        && (got.iter().zip(want)).all(|(g, w)| g.0 == w.0 && (g.1 - w.1).abs() <= 1e-4)
}

fn query(random: &mut Random, column: &str, dims: usize, filter: &Filter) -> Query {
    let vector = (0..dims).map(|_| unit(random) * 50.0).collect();
    Query::new(column, vector, 10).filter(filter.clone())
}

async fn cluster_reads(index: &Index) -> HashSet<(String, u64, u64)> {
    let version = index.version().await.unwrap();
    let mut ranges = HashSet::new();
    for clusters in version.ann.as_ref().unwrap().columns.values() {
        let table = clusters
            .table
            .open::<ClusterRef>(&index.storage)
            .await
            .unwrap();
        for cluster in table.iter() {
            let range = cluster.codes().start..cluster.attributes().end;
            ranges.insert((blob_path(cluster.hash).to_string(), range.start, range.end));
        }
    }
    ranges
}

async fn read_the_part(gate: &Gate, index: &Index) -> bool {
    let version = index.version().await.unwrap();
    let parts: HashSet<String> = (version.ann.as_ref().unwrap().parts.values())
        .flat_map(|part| part.blobs.iter().map(|&h| blob_path(h).to_string()))
        .collect();
    let clusters = cluster_reads(index).await;
    let reads = std::mem::take(&mut *gate.reads.lock().unwrap());
    let part = reads.iter().any(|(path, _)| parts.contains(path));
    let codes = reads.into_iter().any(|(path, range)| match range {
        Some(GetRange::Bounded(range)) => clusters.contains(&(path, range.start, range.end)),
        _ => false,
    });
    part && !codes
}

#[tokio::test]
async fn filter_first_finds_the_exact_top_k_with_overwrites_deletes_and_a_tail() {
    let gate = Gate::new();
    let index = index(gate.clone(), schema()).await;
    let mut random = Random(11);
    for (column, dims) in [("a", 8), ("b", 6), ("c", 4)] {
        for filter in filters() {
            let query = query(&mut random, column, dims, &filter).recall(1.0);
            let want = brute_force(&index, &query).await;
            assert!(!want.is_empty(), "{filter:?}");
            let cold = Index::open_with(gate.clone(), MAIN, options())
                .await
                .unwrap();
            gate.reads.lock().unwrap().clear();
            let got = found(&cold.query(&query).await.unwrap());
            assert!(same(&got, &want), "{column} {filter:?}\n{got:?}\n{want:?}");
            assert!(read_the_part(&gate, &cold).await, "{column} {filter:?}");
        }
    }
}

#[tokio::test]
async fn a_filter_on_an_attribute_without_a_filter_index_reads_the_clusters() {
    let gate = Gate::new();
    let index = index(gate.clone(), schema()).await;
    let filter = Filter::And(vec![Filter::eq("tag", 3i64), Filter::lt("n", 50.0)]);
    let query = query(&mut Random(3), "a", 8, &filter).recall(1.0);
    let want = brute_force(&index, &query).await;
    gate.reads.lock().unwrap().clear();
    let got = found(&index.query(&query).await.unwrap());
    assert!(same(&got, &want));
    assert!(!read_the_part(&gate, &index).await);
}

#[tokio::test]
async fn the_default_recall_finds_nearly_all_of_the_true_top_k() {
    let gate = Gate::new();
    let index = index(gate.clone(), schema()).await;
    let mut random = Random(5);
    let (mut hits, mut wanted) = (0, 0);
    for filter in filters() {
        for _ in 0..5 {
            let query = query(&mut random, "a", 8, &filter);
            let want: HashSet<Id> = brute_force(&index, &query)
                .await
                .into_iter()
                .map(|w| w.0)
                .collect();
            let got = index.query(&query).await.unwrap();
            wanted += want.len();
            hits += got.iter().filter(|hit| want.contains(&hit.id)).count();
        }
    }
    assert!(hits as f64 >= 0.95 * wanted as f64, "{hits} of {wanted}");
}

#[tokio::test]
async fn the_tail_and_the_built_rows_give_the_same_answer() {
    let index = index(Arc::new(object_store::memory::InMemory::new()), schema()).await;
    let mut random = Random(13);
    let queries: Vec<Query> = (filters().iter())
        .map(|filter| query(&mut random, "b", 6, filter).recall(1.0))
        .collect();
    let mut before = Vec::new();
    for query in &queries {
        before.push(found(&index.query(query).await.unwrap()));
    }
    index.build().await.unwrap();
    assert!(index.version().await.unwrap().tail.is_empty());
    for (query, before) in queries.iter().zip(before) {
        assert!(same(&found(&index.query(query).await.unwrap()), &before));
    }
}

#[tokio::test]
async fn a_filter_index_added_later_is_built_by_the_next_build() {
    let gate = Gate::new();
    let plain = Schema {
        filter_index: Default::default(),
        ..schema()
    };
    let index = index(gate.clone(), plain).await;
    index.build().await.unwrap();
    let schema = index.alter(&schema()).await.unwrap();
    assert_eq!(schema.filter_index.len(), 2);
    assert!(
        index
            .version()
            .await
            .unwrap()
            .ann
            .as_ref()
            .unwrap()
            .parts
            .is_empty()
    );
    index.build().await.unwrap();
    let query = query(&mut Random(17), "a", 8, &Filter::eq("tag", 9i64)).recall(1.0);
    gate.reads.lock().unwrap().clear();
    let got = found(&index.query(&query).await.unwrap());
    assert!(same(&got, &brute_force(&index, &query).await));
    assert!(read_the_part(&gate, &index).await);
}

#[tokio::test]
async fn a_filter_index_takes_one_value_that_sorts() {
    let schema = Schema::new()
        .vector("v", 2, Metric::Euclidean)
        .attribute("tags", Kind::Strings)
        .filter_index("tags");
    let store = Arc::new(object_store::memory::InMemory::new());
    assert!(Index::create(store.clone(), schema).await.is_err());
    let missing = Schema::new()
        .vector("v", 2, Metric::Euclidean)
        .filter_index("nope");
    assert!(Index::create(store, missing).await.is_err());
}

#[tokio::test]
async fn collection_keeps_the_parts_branches_use() {
    let gate = Gate::new();
    let index = index(gate.clone(), schema()).await;
    let first = index.version().await.unwrap().ann.clone().unwrap().parts;
    index.build().await.unwrap();
    let parts = index.version().await.unwrap().ann.clone().unwrap().parts;
    assert_ne!(first, parts);
    let keep = Some(Duration::ZERO);
    gc::collect_keeping(gate.clone(), Duration::ZERO, keep, false)
        .await
        .unwrap();
    let exists = |hash| {
        let gate = gate.clone();
        async move { gate.head(&blob_path(hash)).await.is_ok() }
    };
    for part in parts.values() {
        for &blob in &part.blobs {
            assert!(exists(blob).await);
        }
    }
    for part in first.values() {
        for &blob in &part.blobs {
            assert!(!exists(blob).await);
        }
    }
    let query = query(&mut Random(19), "c", 4, &Filter::eq("color", "blue")).recall(1.0);
    let cold = Index::open(gate.clone(), MAIN).await.unwrap();
    let got = found(&cold.query(&query).await.unwrap());
    assert!(same(&got, &brute_force(&index, &query).await));
}

#[tokio::test]
async fn a_version_of_format_7_opens_and_queries_the_same() {
    let store: Arc<dyn ObjectStore> = Arc::new(object_store::memory::InMemory::new());
    let plain = Schema {
        filter_index: Default::default(),
        ..schema()
    };
    let index = index(store.clone(), plain).await;
    index.build().await.unwrap();
    let version = index.version().await.unwrap();
    let old = V7 {
        _format: 7,
        parent: version.parent,
        schema: SchemaV7 {
            vectors: version.schema.vectors.clone(),
            attributes: version.schema.attributes.clone(),
            text: crate::format::legacy::old_texts(&version.schema.text),
            id: version.schema.id,
        },
        built: version.built.clone(),
        tail: version.tail.clone(),
        ann: version.ann.as_ref().map(AnnV7::from),
        next_seq: version.next_seq,
        text: version.text.clone(),
    };
    let hash = Objects::new(store.clone()).put(&old).await.unwrap();
    head::create(store.as_ref(), "old", hash, &[])
        .await
        .unwrap();
    let opened = Index::open(store, "old").await.unwrap();
    assert_eq!(
        opened.schema().await.unwrap(),
        index.schema().await.unwrap()
    );
    let mut random = Random(23);
    for filter in filters() {
        let query = query(&mut random, "a", 8, &filter);
        let a = found(&index.query(&query).await.unwrap());
        let b = found(&opened.query(&query).await.unwrap());
        assert!(same(&a, &b));
    }
}
