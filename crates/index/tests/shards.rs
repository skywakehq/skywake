//! A sharded index answers as one index does, for the same documents.

use std::sync::Arc;

use object_store::ObjectStore;
use object_store::memory::InMemory;
use skywake_index::{
    Aggregate, Doc, Filter, Id, Index, Kind, Measure, Metric, Options, Order, Query, Schema,
    Shards, TextOptions, TextQuery, Value, Write,
};

fn schema() -> Schema {
    Schema::new()
        .vector("v", 2, Metric::Euclidean)
        .text("body", TextOptions::default())
        .attribute("group", Kind::String)
        .attribute("n", Kind::Int)
}

fn docs() -> Vec<Doc> {
    (0..400u64)
        .map(|i| {
            let angle = i as f32 * 0.37;
            let word = ["alpha", "beta", "gamma", "delta"][i as usize % 4];
            Doc::new(i)
                .vector(
                    "v",
                    vec![angle.cos() * (1.0 + i as f32 / 400.0), angle.sin()],
                )
                .attribute("body", format!("{word} item number{i}"))
                .attribute("group", ["a", "b", "c"][i as usize % 3])
                .attribute("n", (i * 7 % 100) as i64)
        })
        .collect()
}

async fn both() -> (Index, Shards) {
    let one = Index::create(Arc::new(InMemory::new()), schema())
        .await
        .unwrap();
    let stores: Vec<Arc<dyn ObjectStore>> =
        (0..4).map(|_| Arc::new(InMemory::new()) as _).collect();
    let many = Shards::create(stores, schema(), Options::default())
        .await
        .unwrap();
    let mut built = docs();
    let tail = built.split_off(300);
    one.upsert(built.clone()).await.unwrap();
    many.upsert(built).await.unwrap();
    one.build().await.unwrap();
    many.build().await.unwrap();
    one.upsert(tail.clone()).await.unwrap();
    many.upsert(tail).await.unwrap();
    (one, many)
}

fn ids<T>(items: &[T], id: impl Fn(&T) -> &Id) -> Vec<Id> {
    items.iter().map(|item| id(item).clone()).collect()
}

#[tokio::test]
async fn shards_answer_as_one_index() {
    let (one, many) = both().await;
    let mut query = Query::new("v", vec![1.0, 0.2], 10).recall(1.0);
    query.offset = 3;
    query.filter = Some(Filter::eq("group", "b"));
    assert_eq!(
        ids(&one.query(&query).await.unwrap(), |h| &h.id),
        ids(&many.query(&query).await.unwrap(), |h| &h.id)
    );

    let mut order = Order::new("n", 15);
    order.descending = true;
    order.offset = 5;
    let (a, b) = (
        one.order(&order).await.unwrap(),
        many.order(&order).await.unwrap(),
    );
    assert_eq!(ids(&a, |r| &r.id), ids(&b, |r| &r.id));
    assert!(b.iter().all(|row| row.attributes.is_empty()));

    let aggregate = Aggregate {
        each: Vec::new(),
        group_by: vec!["group".into()],
        measures: [
            ("count".to_string(), Measure::Count(None)),
            ("sum".to_string(), Measure::Sum("n".into())),
            ("avg".to_string(), Measure::Avg("n".into())),
            ("max".to_string(), Measure::Max("n".into())),
        ]
        .into(),
        ..Aggregate::default()
    };
    assert_eq!(
        one.aggregate(&aggregate).await.unwrap(),
        many.aggregate(&aggregate).await.unwrap()
    );

    // BM25 counts words per shard, so only the set of hits is the same.
    let search = TextQuery::new("number17", 5);
    assert_eq!(many.search(&search).await.unwrap()[0].id, Id::Num(17));
    let mut words = TextQuery::new("gamma", 1000);
    words.offset = 0;
    let mut a = ids(&one.search(&words).await.unwrap(), |h| &h.id);
    let mut b = ids(&many.search(&words).await.unwrap(), |h| &h.id);
    a.sort();
    b.sort();
    assert_eq!(a, b);

    assert_eq!(
        one.stats().await.unwrap().rows,
        many.stats().await.unwrap().rows
    );
    let page = many.scan(Some(&Id::Num(10)), 5).await.unwrap();
    assert_eq!(
        ids(&page, |d| &d.id),
        (11..16).map(Id::Num).collect::<Vec<_>>()
    );
    let got = many
        .get_many(&[Id::Num(399), Id::Num(5), Id::Num(1000)])
        .await
        .unwrap();
    assert_eq!(ids(&got, |d| &d.id), [Id::Num(399), Id::Num(5)]);
}

#[tokio::test]
async fn writes_reach_the_shard_of_each_id() {
    let (one, many) = both().await;
    let write = || Write {
        delete_by: Some(Filter::lt("n", 10.0)),
        patch_by: Some((
            Filter::eq("group", "c"),
            [("n".to_string(), Some(Value::Int(1000)))].into(),
        )),
        deletes: vec![Id::Num(1), Id::Num(2)],
        return_ids: true,
        ..Write::default()
    };
    let sorted = |mut ids: Vec<Id>| {
        ids.sort();
        ids
    };
    let (a, b) = (
        one.write(write()).await.unwrap(),
        many.write(write()).await.unwrap(),
    );
    let (x, y) = (a.ids.clone().unwrap(), b.ids.clone().unwrap());
    assert_eq!(sorted(x.deleted), sorted(y.deleted));
    assert_eq!(sorted(x.patched), sorted(y.patched));
    assert_eq!(
        (a.upserted, a.patched, a.deleted),
        (b.upserted, b.patched, b.deleted)
    );
    let all = Order::new("id", 1000);
    let (a, b) = (
        one.order(&all).await.unwrap(),
        many.order(&all).await.unwrap(),
    );
    assert_eq!(ids(&a, |r| &r.id), ids(&b, |r| &r.id));
    let mut export = many.export().await.unwrap();
    let mut count = 0;
    while let Some(docs) = export.next().await.unwrap() {
        count += docs.len();
    }
    assert_eq!(count, a.len());
    let fork = many.fork("try").await.unwrap();
    fork.delete(vec![Id::Num(3)]).await.unwrap();
    assert!(fork.get(&Id::Num(3)).await.unwrap().is_none());
    assert!(many.get(&Id::Num(3)).await.unwrap().is_some());
}

/// Each shard counts only the deletes of ids it had.
#[tokio::test]
async fn exact_deletes_reach_every_shard() {
    let (_, many) = both().await;
    let write = Write {
        deletes: vec![Id::Num(3), Id::Num(4), Id::Num(5000), Id::Num(5001)],
        exact_deletes: true,
        return_ids: true,
        ..Write::default()
    };
    let done = many.write(write).await.unwrap();
    let mut deleted = done.ids.unwrap().deleted;
    deleted.sort();
    assert_eq!(
        (done.deleted, done.missing, deleted),
        (2, 2, vec![Id::Num(3), Id::Num(4)])
    );
}

/// A UUID id goes to one shard in whatever form it is given, also
/// through shards opened again.
#[tokio::test]
async fn uuid_ids_find_their_shard_in_any_form() {
    let uuid = |n: u64| format!("{n:08}-89ab-4def-8123-456789abcdef");
    let schema = Schema::new().vector("v", 2, Metric::Euclidean).uuid_ids();
    let stores: Vec<Arc<dyn ObjectStore>> =
        (0..4).map(|_| Arc::new(InMemory::new()) as _).collect();
    let many = Shards::create(stores.clone(), schema, Options::default())
        .await
        .unwrap();
    let docs = (0..40).map(|n| Doc::new(uuid(n).to_uppercase()).vector("v", vec![n as f32, 0.0]));
    many.upsert(docs.collect()).await.unwrap();
    let again = Shards::open(stores, "main", Options::default())
        .await
        .unwrap();
    for n in 0..40 {
        let found = again.get(&uuid(n).replace('-', "").into()).await.unwrap();
        assert_eq!(found.unwrap().id.to_string(), uuid(n));
    }
    let gone: Vec<Id> = (0..20).map(|n| uuid(n).into()).collect();
    again.delete(gone).await.unwrap();
    let all = again.order(&Order::new("id", 100)).await.unwrap();
    assert_eq!(all.len(), 20);
}
