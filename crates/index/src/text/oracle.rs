use std::collections::BTreeSet;
use std::sync::Arc;
use std::time::Duration;

use object_store::memory::InMemory;

use super::{Match, TextHit, TextOptions, TextQuery};
use crate::format::legacy::V11;
use crate::format::{FORMAT, decode_version};
use crate::history::gc;
use crate::vector::ivf::Random;
use crate::{Doc, Filter, Id, Index, Kind, Options, Schema, Value};

const ODD: &[&str] = &[
    "naïve",
    "日本語",
    "größe",
    "Ünïcödé",
    "abcdefghijklmnopqrstuvwxyzabcdefghijklmn",
    "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz",
    "a",
    "🙂",
];

fn schema() -> Schema {
    let title = TextOptions {
        k1: 0.9,
        b: 0.4,
        ..TextOptions::default()
    };
    Schema::new()
        .text("body", TextOptions::default())
        .text("title", title)
        .attribute("tag", Kind::String)
        .attribute("price", Kind::Number)
}

fn word(random: &mut Random) -> String {
    match random.below(40) {
        0 => ODD[random.below(ODD.len())].to_string(),
        _ => {
            let most = random.below(300) + 1;
            format!("w{}", random.below(most))
        }
    }
}

fn sentence(random: &mut Random, most: usize) -> String {
    let count = random.below(most + 1);
    let words: Vec<String> = (0..count).map(|_| word(random)).collect();
    words.join(" ")
}

fn doc(random: &mut Random, id: u64) -> Doc {
    let mut doc = Doc::new(named(id))
        .attribute("body", sentence(random, 60).as_str())
        .attribute("tag", ["red", "green", "blue"][random.below(3)])
        .attribute("price", random.below(100) as f64);
    if random.below(3) > 0 {
        doc = doc.attribute("title", sentence(random, 6).as_str());
    }
    doc
}

fn options(postings: bool) -> Options {
    Options {
        commit_rows: 50,
        postings,
        ..Options::default()
    }
}

async fn stored(postings: bool) -> (Index, Arc<InMemory>) {
    let store = Arc::new(InMemory::new());
    (Index::create_with(store.clone(), schema(), options(postings)).await).unwrap();
    let index = Index::open_with(store.clone(), "main", options(postings));
    (index.await.unwrap(), store)
}

async fn pair(postings: bool) -> Index {
    stored(postings).await.0
}

fn query(random: &mut Random) -> TextQuery {
    let mut text = sentence(random, 5);
    if random.below(4) == 0 {
        text = format!("{text} {text}");
    }
    let mut query = TextQuery::new(&text, [1, 10, 10, 1000][random.below(4)]);
    match random.below(4) {
        0 => query.fields = vec![("body".into(), 1.0)],
        1 => query.fields = vec![("title".into(), 2.5), ("body".into(), 1.0)],
        _ => {}
    }
    if random.below(3) == 0 {
        query.k1 = Some([0.0, 0.9, 2.0][random.below(3)]);
        query.b = Some([0.0, 0.4, 1.0][random.below(3)]);
    }
    match random.below(8) {
        0 => query.filter = Some(Filter::Eq("tag".into(), Value::String("red".into()))),
        1 => query.filter = Some(Filter::Gt("price".into(), Value::Number(50.0))),
        2 => query.matches = vec![Match::AnyToken("body".into(), sentence(random, 3))],
        3 => query.fuzzy = 1,
        4 => query.last_as_prefix = true,
        5 => query.include = vec!["tag".into()],
        _ => {}
    }
    query
}

fn agree(new: &[(Id, f32)], old: &[(Id, f32)], every: &[(Id, f32)], query: &TextQuery) {
    let near = |a: f32, b: f32| (a - b).abs() <= 1e-4 * b.abs().max(1.0);
    assert_eq!(new.len(), old.len(), "{query:?}");
    let ids: BTreeSet<&Id> = new.iter().map(|hit| &hit.0).collect();
    assert_eq!(ids.len(), new.len(), "{query:?}: {new:?}");
    for (a, b) in new.iter().zip(old) {
        let own = every.iter().find(|other| other.0 == a.0);
        let known = own.is_some_and(|own| near(a.1, own.1));
        assert!(near(a.1, b.1) && known, "{query:?}: {a:?} vs {b:?}");
    }
}

fn scored(hits: &[TextHit]) -> Vec<(Id, f32)> {
    hits.iter().map(|hit| (hit.id.clone(), hit.score)).collect()
}

async fn compare(new: &Index, old: &Index, random: &mut Random, rounds: usize) {
    for _ in 0..rounds {
        let query = query(random);
        let wide = TextQuery {
            top_k: 5000,
            ..query.clone()
        };
        let (a, b) = (new.search(&query).await, old.search(&query).await);
        match (a, b) {
            (Ok(a), Ok(b)) => {
                let every = old.search(&wide).await.unwrap();
                agree(&scored(&a), &scored(&b), &scored(&every), &query);
                for hit in &a {
                    let same = every.iter().find(|other| other.id == hit.id).unwrap();
                    assert_eq!(hit.attributes, same.attributes, "{query:?}");
                }
            }
            (Err(a), Err(b)) => assert_eq!(a.to_string(), b.to_string()),
            (a, b) => panic!("{query:?}: {:?} vs {:?}", a.map(drop), b.map(drop)),
        }
    }
}

fn named(id: u64) -> Id {
    match id % 5 {
        0 => Id::Str(format!("s{id}")),
        _ => Id::Num(id),
    }
}

async fn write(indexes: [&Index; 2], random: &mut Random, upserts: usize, deletes: usize) {
    let docs: Vec<(u64, u64)> = (0..upserts)
        .map(|_| (random.below(900) as u64, random.next()))
        .collect();
    let gone: Vec<Id> = (0..deletes)
        .map(|_| named(random.below(900) as u64))
        .collect();
    for index in indexes {
        let batch = docs.iter().map(|&(id, seed)| doc(&mut Random(seed), id));
        index.upsert(batch.collect()).await.unwrap();
        index.delete(gone.clone()).await.unwrap();
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn postings_rank_like_tantivy_through_writes_deletes_and_builds() {
    let ((new, store), old) = (stored(true).await, pair(false).await);
    let mut random = Random(41);
    compare(&new, &old, &mut random, 10).await;
    write([&new, &old], &mut random, 700, 0).await;
    compare(&new, &old, &mut random, 40).await;
    for index in [&new, &old] {
        index.build().await.unwrap();
    }
    assert!(new.version().await.unwrap().has_postings());
    assert!(!old.version().await.unwrap().has_postings());
    compare(&new, &old, &mut random, 150).await;
    write([&new, &old], &mut random, 120, 60).await;
    compare(&new, &old, &mut random, 150).await;
    for index in [&new, &old] {
        index.build().await.unwrap();
    }
    compare(&new, &old, &mut random, 150).await;
    write([&new, &old], &mut random, 0, 2000).await;
    compare(&new, &old, &mut random, 40).await;
    for index in [&new, &old] {
        index.build().await.unwrap();
    }
    compare(&new, &old, &mut random, 40).await;
    write([&new, &old], &mut random, 1, 0).await;
    for index in [&new, &old] {
        index.rebuild().await.unwrap();
    }
    compare(&new, &old, &mut random, 40).await;
    drop(new);
    gc::collect(store.clone(), Duration::ZERO, false)
        .await
        .unwrap();
    let cold = Index::open_with(store, "main", options(true))
        .await
        .unwrap();
    compare(&cold, &old, &mut random, 60).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn turning_postings_on_rebuilds_the_text_once() {
    let store = Arc::new(InMemory::new());
    let old = pair(false).await;
    let index = (Index::create_with(store.clone(), schema(), options(false)).await).unwrap();
    let mut random = Random(9);
    write([&index, &old], &mut random, 300, 10).await;
    index.build().await.unwrap();
    old.build().await.unwrap();
    let before = index.version().await.unwrap();
    assert!(!before.has_postings());
    let eleven = postcard::to_stdvec(&V11::from(&*before)).unwrap();
    assert!(decode_version(&eleven).unwrap().text == before.text);
    let index = Index::open_with(store, "main", options(true))
        .await
        .unwrap();
    compare(&index, &old, &mut random, 30).await;
    write([&index, &old], &mut random, 20, 5).await;
    index.build().await.unwrap();
    old.rebuild().await.unwrap();
    let version = index.version().await.unwrap();
    let parts = &version.text.as_ref().unwrap().parts;
    assert!(parts.iter().all(|part| part.postings.is_some()));
    assert_eq!(version.format, FORMAT);
    compare(&index, &old, &mut random, 100).await;
}
