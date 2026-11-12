//! Types, filters, ordering, aggregations and writes by condition, each
//! checked on rows in the tail and in the clusters.

use std::collections::BTreeMap;
use std::sync::Arc;

use object_store::ObjectStore;
use object_store::memory::InMemory;
use skywake_index::{
    Affected, Aggregate, Changes, Condition, Doc, Element, Error, Filter, Group, Id, Index, Kind,
    Measure, Metric, Operand, Order, Patch, Query, Schema, Value, Write, parse_uuid,
};

fn store() -> Arc<dyn ObjectStore> {
    Arc::new(InMemory::new())
}

fn schema() -> Schema {
    Schema::new()
        .vector("v", 2, Metric::Euclidean)
        .attribute("n", Kind::Int)
        .attribute("x", Kind::Number)
        .attribute("id2", Kind::Uuid)
        .attribute("at", Kind::Datetime)
        .attribute("name", Kind::String)
        .attribute("tags", Kind::Strings)
        .attribute("ns", Kind::Ints)
}

fn doc(id: u64) -> Doc {
    Doc::new(id).vector("v", vec![id as f32, 0.0])
}

fn ids<T>(found: &[T], id: impl Fn(&T) -> &Id) -> Vec<u64> {
    found
        .iter()
        .map(|item| match id(item) {
            Id::Num(n) => *n,
            other => panic!("{other}"),
        })
        .collect()
}

async fn find(index: &Index, filter: Filter) -> Vec<u64> {
    let query = Query::new("v", vec![0.0, 0.0], 100).filter(filter);
    let mut found = ids(&index.query(&query).await.unwrap(), |h| &h.id);
    found.sort();
    found
}

/// Five documents: half before a build, half after.
async fn sample() -> Index {
    let index = Index::create(store(), schema()).await.unwrap();
    let rows = [
        (
            1,
            5.0,
            "a1b2c3d4-0000-4000-8000-000000000001",
            "2024-01-01T00:00:00Z",
            "Alpha",
            vec!["x", "y"],
        ),
        (
            2,
            15.0,
            "a1b2c3d4-0000-4000-8000-000000000002",
            "2024-06-01",
            "beta",
            vec!["y"],
        ),
        (
            3,
            25.0,
            "a1b2c3d4-0000-4000-8000-000000000003",
            "2025-01-01T12:30:00+02:00",
            "gamma",
            vec![],
        ),
        (
            4,
            35.0,
            "a1b2c3d4-0000-4000-8000-000000000004",
            "2025-06-01T00:00:00Z",
            "Alpine",
            vec!["x"],
        ),
        (
            5,
            45.0,
            "a1b2c3d4-0000-4000-8000-000000000005",
            "2026-01-01T00:00:00Z",
            "delta",
            vec!["x", "y", "z"],
        ),
    ];
    for (i, (id, x, uuid, at, name, tags)) in rows.into_iter().enumerate() {
        let tags: Vec<String> = tags.into_iter().map(String::from).collect();
        let doc = doc(id)
            // Numbers and strings, as JSON gives them, become the kinds.
            .attribute("n", Value::Number(id as f64 * 10.0))
            .attribute("x", x)
            .attribute("id2", uuid)
            .attribute("at", at)
            .attribute("name", name)
            .attribute("tags", tags)
            .attribute("ns", Value::Numbers(vec![id as f64, 100.0]));
        index.upsert(vec![doc]).await.unwrap();
        if i == 2 {
            index.build().await.unwrap();
        }
    }
    index
}

#[tokio::test]
async fn values_are_stored_as_their_kinds() {
    let index = sample().await;
    let one = index.get(&Id::Num(1)).await.unwrap().unwrap();
    assert_eq!(one.attributes["n"], Value::Int(10));
    let uuid = parse_uuid("a1b2c3d4-0000-4000-8000-000000000001").unwrap();
    assert_eq!(one.attributes["id2"], Value::Uuid(uuid));
    assert_eq!(one.attributes["at"], Value::Datetime(1_704_067_200_000));
    assert_eq!(one.attributes["ns"], Value::Ints(vec![1, 100]));
    // 12:30 at +02:00 is 10:30 UTC.
    let three = index.get(&Id::Num(3)).await.unwrap().unwrap();
    assert_eq!(three.attributes["at"], Value::Datetime(1_735_727_400_000));

    let bad = [
        ("n", Value::Number(1.5)),
        ("id2", Value::from("not-a-uuid")),
        ("at", Value::from("yesterday")),
        ("ns", Value::Numbers(vec![0.5])),
    ];
    for (name, value) in bad {
        let write = index.upsert(vec![doc(9).attribute(name, value)]).await;
        assert!(matches!(write, Err(Error::Invalid(_))), "{name}");
    }
}

#[tokio::test]
async fn filters_on_every_kind_in_tail_and_clusters() {
    let index = sample().await;
    assert_eq!(find(&index, Filter::eq("n", 30.0)).await, [3]);
    assert_eq!(find(&index, Filter::lt("n", 25.0)).await, [1, 2]);
    assert_eq!(find(&index, Filter::gte("n", 25.5)).await, [3, 4, 5]);
    assert_eq!(
        find(
            &index,
            Filter::eq("id2", "a1b2c3d4-0000-4000-8000-000000000004")
        )
        .await,
        [4]
    );
    assert_eq!(
        find(&index, Filter::gte("at", "2025-01-01")).await,
        [3, 4, 5]
    );
    assert_eq!(
        find(&index, Filter::lt("at", 1_717_200_000_001.0)).await,
        [1, 2]
    );
    // A list holds a value; a range holds if any item does.
    assert_eq!(find(&index, Filter::eq("ns", 4.0)).await, [4]);
    assert_eq!(find(&index, Filter::lt("ns", 3.0)).await, [1, 2]);
    assert_eq!(
        find(
            &index,
            Filter::ContainsAll("tags".into(), vec!["x".into(), "y".into()])
        )
        .await,
        [1, 5]
    );
    assert_eq!(
        find(&index, Filter::glob("name", "Al*").unwrap()).await,
        [1, 4]
    );
    assert_eq!(
        find(&index, Filter::glob("name", "?eta").unwrap()).await,
        [2]
    );
    assert_eq!(
        find(&index, Filter::glob("name", "[a-c]*").unwrap()).await,
        [2]
    );
    let iglob = Filter::Matches(
        "name".into(),
        skywake_index::Pattern::new("al*", skywake_index::Syntax::IGlob).unwrap(),
    );
    assert_eq!(find(&index, iglob).await, [1, 4]);
    assert_eq!(
        find(&index, Filter::regex("name", "lt?a$").unwrap()).await,
        [5]
    );
    assert_eq!(find(&index, Filter::glob("tags", "z").unwrap()).await, [5]);
    // A pattern on a number, or a value of the wrong kind, is refused.
    for filter in [Filter::glob("n", "1*").unwrap(), Filter::eq("id2", "nope")] {
        let query = Query::new("v", vec![0.0, 0.0], 5).filter(filter);
        assert!(matches!(index.query(&query).await, Err(Error::Invalid(_))));
    }
    assert!(Filter::regex("name", "(").is_err());
}

#[tokio::test]
async fn order_by_an_attribute_with_offset() {
    let index = sample().await;
    // A newer write moves 2 to the end; 3 loses its x.
    index
        .upsert(vec![doc(2).attribute("x", 99.0).attribute("name", "beta")])
        .await
        .unwrap();
    index.upsert(vec![doc(3)]).await.unwrap();
    let mut order = Order::new("x", 10);
    order.include = vec!["x".into()];
    let rows = index.order(&order).await.unwrap();
    assert_eq!(ids(&rows, |r| &r.id), [1, 4, 5, 2, 3]);
    assert_eq!(rows[0].attributes["x"], Value::Number(5.0));
    assert!(rows[4].attributes.is_empty());

    order.descending = true;
    order.offset = 1;
    order.top_k = 2;
    assert_eq!(ids(&index.order(&order).await.unwrap(), |r| &r.id), [5, 4]);

    let mut by_id = Order::new("id", 2);
    by_id.descending = true;
    by_id.filter = Some(Filter::gt("n", 15.0));
    assert_eq!(ids(&index.order(&by_id).await.unwrap(), |r| &r.id), [5, 4]);

    let tags = Order::new("tags", 2);
    assert!(matches!(index.order(&tags).await, Err(Error::Invalid(_))));
}

#[tokio::test]
async fn query_offset_skips_the_nearest() {
    let index = sample().await;
    let mut query = Query::new("v", vec![0.0, 0.0], 2);
    query.offset = 1;
    assert_eq!(ids(&index.query(&query).await.unwrap(), |h| &h.id), [2, 3]);
}

#[tokio::test]
async fn aggregates_by_group() {
    let index = sample().await;
    index
        .upsert(vec![doc(6).attribute("name", "beta").attribute("n", 7.0)])
        .await
        .unwrap();
    let mut aggregate = Aggregate {
        each: Vec::new(),
        group_by: vec!["name".into()],
        ..Aggregate::default()
    };
    let measures = [
        ("count", Measure::Count(None)),
        ("sum", Measure::Sum("n".into())),
        ("avg", Measure::Avg("x".into())),
        ("min", Measure::Min("at".into())),
        ("max", Measure::Max("n".into())),
    ];
    aggregate.measures = measures
        .into_iter()
        .map(|(n, m)| (n.to_string(), m))
        .collect();
    aggregate.filter = Some(Filter::eq("name", "beta"));
    let groups = index.aggregate(&aggregate).await.unwrap();
    assert_eq!(groups.len(), 1);
    let beta = &groups[0];
    assert_eq!(beta.key["name"], Value::from("beta"));
    assert_eq!(beta.values["count"], Value::Int(2));
    assert_eq!(beta.values["sum"], Value::Int(27));
    assert_eq!(beta.values["avg"], Value::Number(15.0));
    assert_eq!(beta.values["max"], Value::Int(20));

    let total = Aggregate {
        each: Vec::new(),
        measures: [("all".to_string(), Measure::Count(None))].into(),
        ..Aggregate::default()
    };
    let groups = index.aggregate(&total).await.unwrap();
    assert_eq!(
        groups,
        [Group {
            key: BTreeMap::new(),
            values: [("all".to_string(), Value::Int(6))].into()
        }]
    );
    let wrong = Aggregate {
        each: Vec::new(),
        measures: [("s".to_string(), Measure::Sum("name".into()))].into(),
        ..Aggregate::default()
    };
    assert!(matches!(
        index.aggregate(&wrong).await,
        Err(Error::Invalid(_))
    ));
}

fn changes(pairs: &[(&str, Option<Value>)]) -> Changes {
    pairs
        .iter()
        .map(|(n, v)| (n.to_string(), v.clone()))
        .collect()
}

#[tokio::test]
async fn patches_keep_the_rest_of_the_document() {
    let index = sample().await;
    let patches = vec![
        Patch {
            id: Id::Num(1),
            changes: changes(&[("x", Some(Value::Number(7.0))), ("tags", None)]),
        },
        Patch {
            id: Id::Num(4),
            changes: changes(&[("name", Some("four".into()))]),
        },
        // Not there: nothing happens.
        Patch {
            id: Id::Num(99),
            changes: changes(&[("x", Some(Value::Number(1.0)))]),
        },
    ];
    let counts = index.patch(patches).await.unwrap();
    assert_eq!(counts.patched, 2);
    let one = index.get(&Id::Num(1)).await.unwrap().unwrap();
    assert_eq!(one.attributes["x"], Value::Number(7.0));
    assert!(!one.attributes.contains_key("tags"));
    assert_eq!(one.attributes["name"], Value::from("Alpha"));
    assert_eq!(one.vectors["v"], [1.0, 0.0]);
    assert!(index.get(&Id::Num(99)).await.unwrap().is_none());
    assert_eq!(find(&index, Filter::eq("name", "four")).await, [4]);
    // A build keeps them.
    index.build().await.unwrap();
    assert_eq!(find(&index, Filter::eq("x", 7.0)).await, [1]);
}

#[tokio::test]
async fn conditions_compare_with_the_new_document() {
    let index = sample().await;
    // Write only if newer: n is the version.
    let newer: Condition = Filter::Lt("n".into(), Operand::New("n".into()));
    let write = Write {
        upserts: vec![
            doc(1).attribute("n", 11i64).attribute("name", "newer"),
            doc(2).attribute("n", 5i64).attribute("name", "older"),
            // Missing documents have no attributes, so they fail it.
            doc(7).attribute("n", 1i64),
        ],
        upsert_if: Some(newer),
        ..Write::default()
    };
    assert_eq!(index.write(write).await.unwrap().upserted, 1);
    assert_eq!(find(&index, Filter::eq("name", "newer")).await, [1]);
    assert_eq!(find(&index, Filter::eq("name", "beta")).await, [2]);
    assert!(index.get(&Id::Num(7)).await.unwrap().is_none());

    let write = Write {
        deletes: vec![Id::Num(3), Id::Num(4)],
        delete_if: Some(Filter::Eq("name".into(), Operand::Value("gamma".into()))),
        ..Write::default()
    };
    assert_eq!(index.write(write).await.unwrap().deleted, 1);
    assert!(index.get(&Id::Num(3)).await.unwrap().is_none());
    assert!(index.get(&Id::Num(4)).await.unwrap().is_some());
}

#[tokio::test]
async fn writes_by_filter_go_first() {
    let index = sample().await;
    let write = Write {
        delete_by: Some(Filter::lt("x", 20.0)),
        patch_by: Some((
            Filter::gt("x", 20.0),
            changes(&[("name", Some("patched".into()))]),
        )),
        // Deleted first by the filter, then written again.
        upserts: vec![doc(1).attribute("name", "back")],
        ..Write::default()
    };
    let counts = index.write(write).await.unwrap();
    assert_eq!((counts.deleted, counts.patched, counts.upserted), (2, 3, 1));
    let mut all = Order::new("id", 10);
    all.include = vec!["name".into()];
    let rows = index.order(&all).await.unwrap();
    assert_eq!(ids(&rows, |r| &r.id), [1, 3, 4, 5]);
    assert_eq!(rows[0].attributes["name"], Value::from("back"));
    assert_eq!(rows[1].attributes["name"], Value::from("patched"));
    assert_eq!(
        index
            .delete_by(Filter::eq("name", "patched"))
            .await
            .unwrap()
            .deleted,
        3
    );
    assert_eq!(find(&index, Filter::eq("name", "back")).await, [1]);
}

#[tokio::test]
async fn a_write_returns_the_ids_it_changed_when_asked() {
    let index = sample().await;
    let write = |return_ids| Write {
        delete_by: Some(Filter::lt("x", 10.0)),
        patch_by: Some((
            Filter::gt("x", 40.0),
            changes(&[("name", Some("p".into()))]),
        )),
        upserts: vec![doc(6), doc(1)],
        patches: vec![
            Patch {
                id: Id::Num(2),
                changes: changes(&[("name", Some("two".into()))]),
            },
            // Not there: not patched.
            Patch {
                id: Id::Num(99),
                changes: changes(&[("name", Some("none".into()))]),
            },
        ],
        // Counted whether there or not.
        deletes: vec![Id::Num(3), Id::Num(98)],
        return_ids,
        ..Write::default()
    };
    let counts = index.write(write(true)).await.unwrap();
    let nums = |list: &[u64]| list.iter().map(|&n| Id::Num(n)).collect::<Vec<_>>();
    let affected = Affected {
        upserted: nums(&[6, 1]),
        patched: nums(&[5, 2]),
        deleted: nums(&[1, 3, 98]),
    };
    assert_eq!(counts.ids, Some(affected));
    assert_eq!((counts.upserted, counts.patched, counts.deleted), (2, 2, 3));
    // Off by default.
    assert_eq!(index.write(write(false)).await.unwrap().ids, None);
}

/// UUID ids, as text in any form, are stored in 16 bytes and come back
/// in one form, in every way to read them.
#[tokio::test]
async fn uuid_ids_take_any_form_and_come_back_in_one() {
    use skywake_index::{TextOptions, TextQuery};
    let uuid = |n: u64| format!("0000000{n}-89ab-4def-8123-456789abcdef");
    let uuids = Schema::new()
        .vector("v", 2, Metric::Euclidean)
        .text("body", TextOptions::default())
        .uuid_ids();
    let index = Index::create(store(), uuids).await.unwrap();
    let doc = |n: u64, id: String| {
        Doc::new(id)
            .vector("v", vec![n as f32, 0.0])
            .attribute("body", "word")
    };
    let given = [
        uuid(1).to_uppercase(),
        uuid(2).replace('-', ""),
        uuid(3),
        uuid(4).replace('-', "").to_uppercase(),
    ];
    for (n, id) in (1..).zip(given) {
        index.upsert(vec![doc(n, id)]).await.unwrap();
        if n == 2 {
            index.build().await.unwrap();
        }
    }
    let id = |n: u64| Id::Uuid(parse_uuid(&uuid(n)).unwrap().to_be_bytes());
    assert_eq!(id(1).to_string(), uuid(1));

    let near = Query::new("v", vec![0.0, 0.0], 10);
    let hits = index.query(&near).await.unwrap();
    assert_eq!(
        hits.iter().map(|h| h.id.clone()).collect::<Vec<_>>(),
        (1..=4).map(id).collect::<Vec<_>>()
    );
    let some = Filter::ids(vec![uuid(4).to_uppercase().into(), uuid(1).into()]);
    let found = index
        .query(&near.clone().filter(some.clone()))
        .await
        .unwrap();
    assert_eq!(
        found.iter().map(|h| h.id.clone()).collect::<Vec<_>>(),
        [id(1), id(4)]
    );
    let mut words = TextQuery::new("word", 10);
    words.filter = Some(some.negate());
    let mut found: Vec<Id> = (index.search(&words).await.unwrap().into_iter())
        .map(|h| h.id)
        .collect();
    found.sort();
    assert_eq!(found, [id(2), id(3)]);

    let got = index.get(&uuid(3).replace('-', "").into()).await.unwrap();
    assert_eq!(got.unwrap().id, id(3));
    let mut by_id = Order::new("id", 10);
    by_id.descending = true;
    let rows = index.order(&by_id).await.unwrap();
    assert_eq!(
        rows.iter().map(|r| r.id.clone()).collect::<Vec<_>>(),
        [id(4), id(3), id(2), id(1)]
    );
    let page = index
        .scan(Some(&uuid(2).to_uppercase().into()), 10)
        .await
        .unwrap();
    assert_eq!(
        page.iter().map(|d| d.id.clone()).collect::<Vec<_>>(),
        [id(3), id(4)]
    );

    let write = Write {
        patches: vec![Patch {
            id: uuid(1).to_uppercase().into(),
            changes: changes(&[("body", Some("other".into()))]),
        }],
        deletes: vec![uuid(2).into()],
        return_ids: true,
        ..Write::default()
    };
    let ids = index.write(write).await.unwrap().ids.unwrap();
    assert_eq!((ids.patched, ids.deleted), (vec![id(1)], vec![id(2)]));
    index
        .delete(vec![uuid(3).to_uppercase().into()])
        .await
        .unwrap();
    let mut export = index.export().await.unwrap();
    let mut all = Vec::new();
    while let Some(docs) = export.next().await.unwrap() {
        all.extend(docs.into_iter().map(|d| d.id));
    }
    all.sort();
    assert_eq!(all, [id(1), id(4)]);

    for wrong in [Id::Num(1), Id::from("not-a-uuid")] {
        let error = index.upsert(vec![Doc::new(wrong.clone()).vector("v", vec![0.0, 0.0])]);
        assert!(matches!(error.await, Err(Error::Invalid(_))), "{wrong}");
        let filtered = near.clone().filter(Filter::ids(vec![wrong]));
        assert!(matches!(
            index.query(&filtered).await,
            Err(Error::Invalid(_))
        ));
    }
    // An index of number and string ids takes no UUID.
    let plain = Index::create(store(), schema()).await.unwrap();
    let error = plain.upsert(vec![Doc::new(id(1)).vector("v", vec![0.0, 0.0])]);
    assert!(matches!(error.await, Err(Error::Invalid(_))));
}

/// Patches through two handles at once, each setting its own attributes
/// of one document: none is lost, as each write starts again when the
/// other moved the head first.
#[tokio::test]
async fn concurrent_patches_lose_nothing() {
    let store = store();
    let mut schema = Schema::new().vector("v", 2, Metric::Euclidean);
    for i in 0..20 {
        schema = schema.attribute(&format!("a{i}"), Kind::Int);
    }
    let index = Index::create(store.clone(), schema).await.unwrap();
    index.upsert(vec![doc(1)]).await.unwrap();
    let other = Index::open(store, "main").await.unwrap();
    let run = |index: Index, from: usize| async move {
        for i in (from..20).step_by(2) {
            let patch = Patch {
                id: Id::Num(1),
                changes: changes(&[(&format!("a{i}"), Some(Value::Int(i as i64)))]),
            };
            index.patch(vec![patch]).await.unwrap();
        }
    };
    tokio::join!(run(index.clone(), 0), run(other, 1));
    let one = index.get(&Id::Num(1)).await.unwrap().unwrap();
    assert_eq!(one.attributes.len(), 20);
}

#[tokio::test]
async fn f16_and_i8_vectors_are_rounded_and_searched() {
    let schema = Schema::new()
        .vector_of("half", 2, Metric::Cosine, Element::F16)
        .vector_of("byte", 2, Metric::Dot, Element::I8);
    let index = Index::create(store(), schema).await.unwrap();
    let docs: Vec<Doc> = (0..300u64)
        .map(|i| {
            let angle = i as f32 / 50.0;
            Doc::new(i)
                .vector("half", vec![angle.cos(), angle.sin()])
                .vector("byte", vec![(i % 200) as f32 - 100.0, 1.0])
        })
        .collect();
    index.upsert(docs).await.unwrap();
    index.build().await.unwrap();
    let near = Query::new("half", vec![1.0, 0.0], 1);
    assert_eq!(index.query(&near).await.unwrap()[0].id, Id::Num(0));
    let top = Query::new("byte", vec![1.0, 0.0], 2);
    assert_eq!(
        ids(&index.query(&top).await.unwrap(), |h| &h.id),
        [199, 198]
    );
    let one = index.get(&Id::Num(7)).await.unwrap().unwrap();
    let rounded = half::f16::from_f32((7.0f32 / 50.0).sin()).to_f32();
    assert!((one.vectors["half"][1] - rounded).abs() < 1e-3);
    assert_eq!(one.vectors["byte"], [-93.0, 1.0]);

    let bad = Doc::new(1)
        .vector("half", vec![1.0, 0.0])
        .vector("byte", vec![0.5, 0.0]);
    assert!(matches!(
        index.upsert(vec![bad]).await,
        Err(Error::Invalid(_))
    ));
    let cosine = Schema::new().vector_of("v", 2, Metric::Cosine, Element::I8);
    assert!(matches!(
        Index::create(store(), cosine).await,
        Err(Error::Invalid(_))
    ));
}

#[tokio::test]
async fn a_snapshot_does_not_see_later_writes() {
    let index = sample().await;
    let snapshot = index.snapshot().await.unwrap();
    index.delete(vec![Id::Num(1)]).await.unwrap();
    let query = Query::new("v", vec![0.0, 0.0], 1);
    assert_eq!(snapshot.query(&query).await.unwrap()[0].id, Id::Num(1));
    assert_eq!(index.query(&query).await.unwrap()[0].id, Id::Num(2));
}

#[tokio::test]
async fn text_search_takes_the_new_filters() {
    use skywake_index::{TextOptions, TextQuery};
    let schema = Schema::new()
        .text("body", TextOptions::default())
        .attribute("lang", Kind::String)
        .attribute("n", Kind::Int)
        .attribute("at", Kind::Datetime)
        .attribute("tags", Kind::Strings);
    let index = Index::create(store(), schema).await.unwrap();
    let rows = [
        (1, "rust", 1, "2024-01-01", vec!["a", "b"]),
        (2, "ruby", 2, "2024-02-01", vec!["a"]),
        (3, "go", 3, "2024-03-01", vec!["b"]),
        (4, "rust", 4, "2024-04-01", vec!["a", "b"]),
    ];
    for (i, (id, lang, n, at, tags)) in rows.into_iter().enumerate() {
        let tags: Vec<String> = tags.into_iter().map(String::from).collect();
        let doc = Doc::new(id as u64)
            .attribute("body", "fast search engine")
            .attribute("lang", lang)
            .attribute("n", n as i64)
            .attribute("at", at)
            .attribute("tags", tags);
        index.upsert(vec![doc]).await.unwrap();
        if i == 1 {
            index.build().await.unwrap();
        }
    }
    let search = async |filter: Filter| {
        let mut query = TextQuery::new("search", 10);
        query.filter = Some(filter);
        let mut found = ids(&index.search(&query).await.unwrap(), |h| &h.id);
        found.sort();
        found
    };
    assert_eq!(
        search(Filter::glob("lang", "ru*").unwrap()).await,
        [1, 2, 4]
    );
    assert_eq!(
        search(Filter::regex("lang", "^r.st").unwrap()).await,
        [1, 4]
    );
    assert_eq!(search(Filter::gt("n", 1.5)).await, [2, 3, 4]);
    assert_eq!(search(Filter::lte("n", 2.5)).await, [1, 2]);
    assert_eq!(search(Filter::lt("at", "2024-03-01")).await, [1, 2]);
    let both = Filter::ContainsAll("tags".into(), vec!["a".into(), "b".into()]);
    assert_eq!(search(both).await, [1, 4]);
    assert_eq!(search(Filter::eq("n", 3.0)).await, [3]);
    let mut paged = TextQuery::new("search", 2);
    paged.offset = 3;
    assert_eq!(index.search(&paged).await.unwrap().len(), 1);
}

#[tokio::test]
async fn export_gives_each_current_document_once() {
    let index = sample().await;
    index
        .upsert(vec![doc(2).attribute("name", "two")])
        .await
        .unwrap();
    index.delete(vec![Id::Num(4)]).await.unwrap();
    let mut export = index.export().await.unwrap();
    let mut all = Vec::new();
    while let Some(docs) = export.next().await.unwrap() {
        all.extend(docs);
    }
    all.sort_by(|a, b| a.id.cmp(&b.id));
    assert_eq!(ids(&all, |d| &d.id), [1, 2, 3, 5]);
    assert_eq!(all[1].attributes["name"], Value::from("two"));
}

#[tokio::test]
async fn a_copy_is_its_own_index() {
    use skywake_index::{TextOptions, TextQuery};
    let schema = schema().text("body", TextOptions::default());
    let index = Index::create(store(), schema).await.unwrap();
    let docs = (1..=50).map(|i| doc(i).attribute("body", format!("word{i} common")));
    index.upsert(docs.collect()).await.unwrap();
    index.build().await.unwrap();
    index
        .upsert(vec![doc(51).attribute("body", "late common")])
        .await
        .unwrap();

    let target = store();
    let copy = index.copy_to(target.clone()).await.unwrap();
    index.delete(vec![Id::Num(1)]).await.unwrap();
    let near = Query::new("v", vec![0.0, 0.0], 1);
    assert_eq!(copy.query(&near).await.unwrap()[0].id, Id::Num(1));
    assert_eq!(
        copy.search(&TextQuery::new("word7", 5)).await.unwrap()[0].id,
        Id::Num(7)
    );
    assert_eq!(
        copy.search(&TextQuery::new("late", 5)).await.unwrap()[0].id,
        Id::Num(51)
    );
    // It opens on its own, and garbage collection there keeps everything.
    let reopened = Index::open(target.clone(), "main").await.unwrap();
    skywake_index::gc::collect(target, std::time::Duration::ZERO, false)
        .await
        .unwrap();
    assert_eq!(reopened.stats().await.unwrap().rows, 51);
    assert_eq!(reopened.query(&near).await.unwrap()[0].id, Id::Num(1));
}

/// With `exact_deletes`, only ids that were there count and come back.
#[tokio::test]
async fn exact_deletes_count_only_what_was_there() {
    let index = sample().await;
    let write = Write {
        deletes: vec![Id::Num(3), Id::Num(98), Id::Num(99)],
        return_ids: true,
        exact_deletes: true,
        ..Write::default()
    };
    let counts = index.write(write).await.unwrap();
    assert_eq!((counts.deleted, counts.missing), (1, 2));
    assert_eq!(counts.ids.unwrap().deleted, vec![Id::Num(3)]);
    assert!(index.get(&Id::Num(3)).await.unwrap().is_none());
}
