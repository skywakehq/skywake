use std::collections::BTreeMap;
use std::sync::Arc;

use super::chunk::Layout;
use super::{ColumnRef, chunk, dictionary, ids, pages, totals};
use crate::format::Version;
use crate::testing::{Gate, clustered, table};
use crate::{Doc, Index, Kind, Metric, Options, Schema, Value};

fn schema() -> Schema {
    Schema::new()
        .vector("v", 8, Metric::Euclidean)
        .attribute("city", Kind::String)
        .attribute("n", Kind::Int)
        .attribute("score", Kind::Number)
        .attribute("ok", Kind::Bool)
        .attribute("at", Kind::Datetime)
        .attribute("tags", Kind::Strings)
}

fn docs(from: u64, to: u64, vectors: &[Vec<f32>]) -> Vec<Doc> {
    (from..to)
        .map(|id| {
            let mut doc =
                Doc::new(id).vector("v", vectors[(id % vectors.len() as u64) as usize].clone());
            if id % 7 != 0 {
                doc = doc.attribute("city", ["paris", "lima", "oslo"][(id % 3) as usize]);
            }
            doc = doc.attribute("n", (id * 7919 % 100_003) as i64);
            if id % 5 != 0 {
                doc = doc.attribute("score", id as f64 / 8.0);
            }
            doc = doc.attribute("ok", id % 2 == 0);
            doc = doc.attribute("at", Value::Datetime(1_700_000_000_000 + id as i64));
            if id % 3 == 0 {
                doc = doc.attribute("tags", Value::Strings(vec![format!("t{}", id % 4)]));
            }
            doc
        })
        .collect()
}

async fn index(gate: &Arc<Gate>) -> Index {
    let options = Options {
        cluster_rows: 150,
        columns: true,
        ..Options::default()
    };
    Index::create_with(gate.clone(), schema(), options)
        .await
        .unwrap()
}

async fn agree(index: &Index, version: &Version) {
    let storage = &index.storage;
    let columns = version.columns.as_ref().expect("the build wrote columns");
    let clusters = table(index, version).await;
    assert_eq!(columns.pages as usize, clusters.len());
    let spans = super::directory::<super::Span>(storage, &columns.ids)
        .await
        .unwrap();
    let mut rows = 0;
    for (page, cluster) in clusters.iter().enumerate() {
        let (codes, attrs) = storage.codes_and_attrs(cluster, 8).await.unwrap();
        assert_eq!(*ids(storage, &spans[page]).await.unwrap(), codes.ids);
        rows += codes.ids.len() as u64;
        for (name, column) in &columns.columns {
            let refs = pages(storage, column).await.unwrap();
            let dictionary = dictionary(storage, column).await.unwrap();
            let chunk = chunk(storage, &refs[page].span).await.unwrap();
            let expected = match attrs.columns.get(name) {
                Some(values) => values.clone(),
                None => vec![None; codes.ids.len()],
            };
            assert_eq!(
                chunk.values(column.layout, &dictionary),
                expected,
                "{name} page {page}"
            );
        }
    }
    for (name, column) in &columns.columns {
        let totals = totals(storage, column).await.unwrap();
        assert_eq!(totals.rows, rows, "{name}");
    }
    assert_eq!(rows, version.ann.as_ref().unwrap().live);
}

fn layouts(columns: &BTreeMap<String, ColumnRef>) -> BTreeMap<&str, Layout> {
    columns
        .iter()
        .map(|(n, c)| (n.as_str(), c.layout))
        .collect()
}

#[tokio::test(flavor = "multi_thread")]
async fn column_pages_hold_what_the_clusters_hold() {
    let gate = Gate::new();
    let index = index(&gate).await;
    let vectors = clustered(1500, 8, 3);
    index.upsert(docs(0, 1500, &vectors)).await.unwrap();
    index.build().await.unwrap();
    let version = index.version().await.unwrap();
    agree(&index, &version).await;
    let columns = version.columns.as_ref().unwrap();
    let chosen = layouts(&columns.columns);
    assert_eq!(chosen["city"], Layout::Dictionary);
    assert_eq!(chosen["ok"], Layout::Dictionary);
    assert_eq!(chosen["n"], Layout::Ints);
    assert_eq!(chosen["at"], Layout::Datetimes);
    assert_eq!(chosen["tags"], Layout::Values);

    let city = totals(&index.storage, &columns.columns["city"])
        .await
        .unwrap();
    let dictionary = dictionary(&index.storage, &columns.columns["city"])
        .await
        .unwrap();
    let paris = dictionary
        .values
        .iter()
        .position(|v| v == &Value::from("paris"))
        .unwrap();
    let expected = (0..1500u64).filter(|id| id % 7 != 0 && id % 3 == 0).count() as u64;
    assert_eq!(city.histogram[paris], expected);
    assert_eq!(
        city.missing,
        (0..1500u64).filter(|id| id % 7 == 0).count() as u64
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn an_incremental_build_rewrites_only_the_pages_it_touches() {
    let gate = Gate::new();
    let index = index(&gate).await;
    let vectors = clustered(3000, 8, 5);
    index.upsert(docs(0, 3000, &vectors)).await.unwrap();
    index.build().await.unwrap();
    let before = index.version().await.unwrap();

    let mut changed = docs(10, 40, &vectors);
    for doc in &mut changed {
        doc.attributes.insert("city".into(), Value::from("quito"));
    }
    index.upsert(changed).await.unwrap();
    index.delete(vec![5u64.into(), 6u64.into()]).await.unwrap();
    index.build().await.unwrap();
    let after = index.version().await.unwrap();
    assert_eq!(
        after.ann.as_ref().unwrap().full_rows,
        before.ann.as_ref().unwrap().full_rows,
        "a full build ran"
    );
    agree(&index, &after).await;

    let (old, new) = (
        &before.columns.as_ref().unwrap(),
        &after.columns.as_ref().unwrap(),
    );
    let old_pages = pages(&index.storage, &old.columns["city"]).await.unwrap();
    let new_pages = pages(&index.storage, &new.columns["city"]).await.unwrap();
    let kept = new_pages
        .iter()
        .filter(|p| old_pages.iter().any(|o| o.span == p.span))
        .count();
    assert!(
        kept > 0 && kept < new_pages.len(),
        "{kept} of {} pages kept",
        new_pages.len()
    );

    let old_city = dictionary(&index.storage, &old.columns["city"])
        .await
        .unwrap();
    let new_city = dictionary(&index.storage, &new.columns["city"])
        .await
        .unwrap();
    assert_eq!(
        new_city.values[..old_city.values.len()],
        old_city.values[..]
    );
    assert!(new_city.values.contains(&Value::from("quito")));
}

#[tokio::test(flavor = "multi_thread")]
async fn turning_columns_on_backfills_and_off_writes_format_10() {
    let gate = Gate::new();
    let options = Options {
        cluster_rows: 150,
        ..Options::default()
    };
    let plain = Index::create_with(gate.clone(), schema(), options.clone())
        .await
        .unwrap();
    let vectors = clustered(600, 8, 9);
    plain.upsert(docs(0, 600, &vectors)).await.unwrap();
    plain.build().await.unwrap();
    let head = plain.storage.head(crate::MAIN).await.unwrap();
    let raw = skywake_core::Objects::new(gate.clone())
        .get_raw(head.version)
        .await
        .unwrap();
    assert_eq!(postcard::take_from_bytes::<u32>(&raw).unwrap().0, 10);
    assert!(plain.version().await.unwrap().columns.is_none());

    let options = Options {
        columns: true,
        ..options
    };
    let with = Index::open_with(gate.clone(), crate::MAIN, options)
        .await
        .unwrap();
    with.build().await.unwrap();
    let version = with.storage.current(crate::MAIN).await.unwrap();
    agree(&with, &version).await;

    let head = with.storage.head(crate::MAIN).await.unwrap();
    let raw = skywake_core::Objects::new(gate.clone())
        .get_raw(head.version)
        .await
        .unwrap();
    assert_eq!(postcard::take_from_bytes::<u32>(&raw).unwrap().0, 11);
    crate::gc::collect(gate.clone(), std::time::Duration::ZERO, false)
        .await
        .unwrap();
    let fresh = Index::open(gate.clone(), crate::MAIN).await.unwrap();
    agree(&fresh, &fresh.version().await.unwrap()).await;
}
