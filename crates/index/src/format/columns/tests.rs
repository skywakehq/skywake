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
    oracle(&index, &version).await;
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
    let bytes_before = plain.stats().await.unwrap().bytes;

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
    let columns = version.columns.as_ref().unwrap();
    assert!(columns.bytes > 0);
    let reopened = Index::open(gate.clone(), crate::MAIN).await.unwrap();
    let after = reopened.stats().await.unwrap().bytes;
    assert_eq!(after, bytes_before + columns.bytes);

    let head = with.storage.head(crate::MAIN).await.unwrap();
    let raw = skywake_core::Objects::new(gate.clone())
        .get_raw(head.version)
        .await
        .unwrap();
    assert_eq!(
        postcard::take_from_bytes::<u32>(&raw).unwrap().0,
        crate::format::FORMAT
    );
    crate::gc::collect(gate.clone(), std::time::Duration::ZERO, false)
        .await
        .unwrap();
    let fresh = Index::open(gate.clone(), crate::MAIN).await.unwrap();
    agree(&fresh, &fresh.version().await.unwrap()).await;
}

fn plain_schema() -> Schema {
    Schema::new()
        .text("body", crate::TextOptions::default())
        .attribute("city", Kind::String)
        .attribute("n", Kind::Int)
        .attribute("score", Kind::Number)
        .attribute("tags", Kind::Strings)
}

fn plain_docs(ids: impl Iterator<Item = u64>, salt: u64) -> Vec<Doc> {
    ids.map(|id| {
        let mut doc = Doc::new(id)
            .attribute("n", ((id + salt) * 7919 % 100_003) as i64)
            .attribute("body", format!("doc {id} salt {salt}"));
        if id % 7 != 0 {
            doc = doc.attribute(
                "city",
                ["paris", "lima", "oslo"][((id + salt) % 3) as usize],
            );
        }
        if id % 5 != 0 {
            doc = doc.attribute("score", id as f64 / 8.0);
        }
        if id % 3 == 0 {
            doc = doc.attribute("tags", Value::Strings(vec![format!("t{}", id % 4)]));
        }
        doc
    })
    .collect()
}

async fn oracle(index: &Index, version: &Version) {
    let storage = &index.storage;
    let columns = version.columns.as_ref().expect("the build wrote columns");
    let mut expected: BTreeMap<crate::Id, crate::Attributes> = BTreeMap::new();
    crate::read::live::each(storage, version, None, |id, attributes| {
        expected.insert(id.clone(), attributes);
    })
    .await
    .unwrap();
    let spans = super::directory::<super::Span>(storage, &columns.ids)
        .await
        .unwrap();
    assert_eq!(spans.len() as u64, columns.pages);
    let mut seen: BTreeMap<crate::Id, usize> = BTreeMap::new();
    for (page, span) in spans.iter().enumerate() {
        let page_ids = ids(storage, span).await.unwrap();
        for (name, column) in &columns.columns {
            let refs = pages(storage, column).await.unwrap();
            let dictionary = dictionary(storage, column).await.unwrap();
            let values = chunk(storage, &refs[page].span)
                .await
                .unwrap()
                .values(column.layout, &dictionary);
            assert_eq!(values.len(), page_ids.len(), "{name} page {page}");
            for (id, value) in page_ids.iter().zip(values) {
                assert_eq!(value, expected[id].get(name).cloned(), "{name} of {id}");
            }
        }
        for id in page_ids.iter() {
            assert!(seen.insert(id.clone(), page).is_none(), "{id} twice");
        }
    }
    assert!(seen.keys().eq(expected.keys()));
    assert_eq!(columns.live, expected.len() as u64);
    if columns.rows.is_empty() {
        return;
    }
    let map: Vec<Arc<crate::format::rows::RowPage>> =
        storage.get_all(columns.rows.clone()).await.unwrap();
    let mut mapped = 0;
    for (at, page) in map.iter().enumerate() {
        for (i, id) in page.ids.iter().enumerate() {
            assert_eq!(crate::format::rows::page_of(id, map.len()), at);
            assert_eq!(seen[id], page.clusters[i] as usize, "{id}");
            mapped += 1;
        }
    }
    assert_eq!(mapped, expected.len());
}

#[tokio::test(flavor = "multi_thread")]
async fn indexes_without_vectors_get_pages_and_a_row_map() {
    let gate = Gate::new();
    let options = Options {
        columns: true,
        ..Options::default()
    };
    let index = Index::create_with(gate.clone(), plain_schema(), options)
        .await
        .unwrap();
    for from in (0..20_000).step_by(5_000) {
        index
            .upsert(plain_docs(from..from + 5_000, 0))
            .await
            .unwrap();
    }
    index.build().await.unwrap();
    let before = index.version().await.unwrap();
    oracle(&index, &before).await;
    assert_eq!(before.columns.as_ref().unwrap().pages, 3);

    index
        .upsert(plain_docs((100..130).chain(20_000..20_100), 1))
        .await
        .unwrap();
    index.delete(vec![5u64.into(), 6u64.into()]).await.unwrap();
    index.build().await.unwrap();
    let after = index.version().await.unwrap();
    oracle(&index, &after).await;

    let (old, new) = (
        before.columns.as_ref().unwrap(),
        after.columns.as_ref().unwrap(),
    );
    assert_eq!(new.pages, old.pages + 1);
    let storage = &index.storage;
    let old_pages = pages(storage, &old.columns["city"]).await.unwrap();
    let new_pages = pages(storage, &new.columns["city"]).await.unwrap();
    let old_ids = super::directory::<super::Span>(storage, &old.ids)
        .await
        .unwrap();
    let written: Vec<u64> = (100..130).chain([5, 6]).collect();
    let mut kept = 0;
    for (page, span) in old_ids.iter().enumerate() {
        let page_ids = ids(storage, span).await.unwrap();
        let touched = page_ids
            .iter()
            .any(|id| written.iter().any(|&w| *id == w.into()));
        assert_eq!(
            new_pages[page].span != old_pages[page].span,
            touched,
            "page {page}"
        );
        kept += usize::from(!touched);
    }
    assert!(kept > 0);

    crate::gc::collect(gate.clone(), std::time::Duration::ZERO, false)
        .await
        .unwrap();
    let fresh = Index::open(gate.clone(), crate::MAIN).await.unwrap();
    oracle(&fresh, &fresh.version().await.unwrap()).await;
}

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

async fn random_case(seed: u64) {
    let mut draw = Draw(seed);
    let with_vectors = draw.below(2) == 0;
    let options = Options {
        cluster_rows: 20 + draw.below(60) as usize,
        page_rows: 16 + draw.below(100) as usize,
        build_bytes: [1 << 30, 16 << 10][draw.below(2) as usize],
        columns: true,
        ..Options::default()
    };
    let schema = match with_vectors {
        true => schema(),
        false => plain_schema(),
    };
    let gate = Gate::new();
    let index = Index::create_with(gate.clone(), schema, options)
        .await
        .unwrap();
    let vectors = clustered(64, 8, seed);
    for salt in 0..6 {
        let start = draw.below(400);
        let ids = start..start + 1 + draw.below(150);
        let mut batch = plain_docs(ids, salt);
        for doc in &mut batch {
            let id = match &doc.id {
                crate::Id::Num(n) => *n,
                other => panic!("{other:?}"),
            };
            if with_vectors {
                doc.attributes.remove("body");
                let vector = vectors[(id % vectors.len() as u64) as usize].clone();
                doc.vectors.insert("v".into(), vector);
            }
        }
        index.upsert(batch).await.unwrap();
        if draw.below(3) == 0 {
            let start = draw.below(400);
            let gone = (start..start + draw.below(40))
                .map(crate::Id::from)
                .collect();
            index.delete(gone).await.unwrap();
        }
        match draw.below(4) {
            0 => index.rebuild().await.unwrap(),
            _ => index.build().await.unwrap(),
        }
        oracle(&index, &index.version().await.unwrap()).await;
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn random_indexes_keep_columns_equal_to_their_documents() {
    let cases: u64 = (std::env::var("ORACLE_CASES").ok())
        .and_then(|cases| cases.parse().ok())
        .unwrap_or(40);
    for seed in 0..cases {
        random_case(seed).await;
    }
}
