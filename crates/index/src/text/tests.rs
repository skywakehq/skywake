//! Text search against an oracle.

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use std::time::Duration;

use object_store::ObjectStore;
use object_store::memory::InMemory;

use super::fields::{analyzer, tokens};
use super::*;
use crate::history::gc;
use crate::vector::ivf::Random;
use crate::{Doc, Filter, Index, Kind, Metric, Options, Query, Schema, Value};

const WORDS: &[&str] = &[
    "reset", "password", "account", "login", "email", "billing", "invoice", "refund", "card",
    "running", "runner", "ran", "the", "a", "to", "of", "and", "secure", "token", "page",
];

fn schema() -> Schema {
    Schema::new()
        .text("body", TextOptions::default())
        .text(
            "title",
            TextOptions {
                k1: 0.9,
                b: 0.4,
                ..TextOptions::default()
            },
        )
        .attribute("tag", Kind::String)
        .attribute("price", Kind::Number)
}

fn sentence(random: &mut Random, words: usize) -> String {
    (0..words)
        .map(|_| WORDS[random.below(WORDS.len())])
        .collect::<Vec<_>>()
        .join(" ")
}

fn doc(id: u64, body: &str, tag: &str, price: f64) -> Doc {
    Doc::new(id)
        .attribute("body", body)
        .attribute("tag", tag)
        .attribute("price", price)
}

async fn index(store: Arc<dyn ObjectStore>) -> Index {
    let options = Options {
        commit_rows: 50,
        ..Options::default()
    };
    Index::create_with(store.clone(), schema(), options.clone())
        .await
        .unwrap();
    Index::open_with(store, "main", options).await.unwrap()
}

fn oracle(docs: &BTreeMap<u64, String>, query: &str, k1: f32, b: f32, k: usize) -> Vec<(u64, f32)> {
    let mut analyzer = analyzer(&TextOptions::default());
    let analyzed: BTreeMap<u64, Vec<String>> = (docs.iter())
        .map(|(&id, text)| (id, tokens(&mut analyzer, text)))
        .collect();
    let n = analyzed.len() as f32;
    let avg = analyzed.values().map(|t| t.len()).sum::<usize>() as f32 / n;
    let words = tokens(&mut analyzer, query);
    let mut scored: Vec<(u64, f32)> = Vec::new();
    for (&id, toks) in &analyzed {
        let mut score = 0.0;
        let mut matched = false;
        for word in &words {
            let tf = toks.iter().filter(|t| *t == word).count() as f32;
            if tf == 0.0 {
                continue;
            }
            matched = true;
            let df = analyzed.values().filter(|t| t.contains(word)).count() as f32;
            let idf = (1.0 + (n - df + 0.5) / (df + 0.5)).ln();
            let len = toks.len() as f32;
            score += idf * (k1 + 1.0) * tf / (tf + k1 * (1.0 - b + b * len / avg));
        }
        if matched {
            scored.push((id, score));
        }
    }
    scored.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
    scored.truncate(k);
    scored
}

fn query(text: &str, k: usize) -> TextQuery {
    TextQuery {
        fields: vec![("body".into(), 1.0)],
        ..TextQuery::new(text, k)
    }
}

async fn found(index: &Index, query: &TextQuery) -> Vec<(u64, f32)> {
    let hits = index.search(query).await.unwrap();
    (hits.into_iter())
        .map(|hit| match hit.id {
            crate::Id::Num(id) => (id, hit.score),
            other => panic!("unexpected id {other}"),
        })
        .collect()
}

fn same(a: &[(u64, f32)], b: &[(u64, f32)]) {
    assert_eq!(a.len(), b.len(), "{a:?} vs {b:?}");
    for (x, y) in a.iter().zip(b) {
        assert!(
            (x.1 - y.1).abs() <= 1e-4 * x.1.abs().max(1.0),
            "{a:?} vs {b:?}"
        );
    }
    let ids = |list: &[(u64, f32)]| {
        let mut ids: Vec<u64> = list.iter().map(|e| e.0).collect();
        ids.sort();
        ids
    };
    let last = a.last().map(|e| e.1).unwrap_or(0.0);
    let firm = |list: &[(u64, f32)]| -> Vec<(u64, f32)> {
        (list.iter().copied())
            .filter(|e| (e.1 - last).abs() > 1e-4)
            .collect()
    };
    assert_eq!(ids(&firm(a)), ids(&firm(b)), "{a:?} vs {b:?}");
}

#[tokio::test(flavor = "multi_thread")]
async fn the_tail_and_the_parts_score_like_the_formula() {
    let index = index(Arc::new(InMemory::new())).await;
    let mut random = Random(7);
    let mut docs = BTreeMap::new();
    let mut batch = Vec::new();
    for id in 0..400 {
        let words = 3 + random.below(20);
        let body = sentence(&mut random, words);
        batch.push(doc(id, &body, "a", id as f64));
        docs.insert(id, body);
    }
    index.upsert(batch).await.unwrap();
    let asks = [
        "reset password",
        "running the account",
        "refund card card",
        "token",
    ];
    for (k1, b) in [(1.2, 0.75), (0.9, 0.4)] {
        for ask in asks {
            let mut q = query(ask, 10);
            (q.k1, q.b) = (Some(k1), Some(b));
            same(&found(&index, &q).await, &oracle(&docs, ask, k1, b, 10));
        }
    }
    index.build().await.unwrap();
    assert_eq!(index.stats().await.unwrap().unindexed_rows, 0);
    for (k1, b) in [(1.2, 0.75), (0.9, 0.4), (2.0, 1.0), (0.5, 0.0)] {
        for ask in asks {
            let mut q = query(ask, 10);
            (q.k1, q.b) = (Some(k1), Some(b));
            same(&found(&index, &q).await, &oracle(&docs, ask, k1, b, 10));
        }
    }
    let mut batch = Vec::new();
    for id in 400..600 {
        let body = sentence(&mut random, 8);
        batch.push(doc(id, &body, "b", 1.0));
        docs.insert(id, body);
    }
    index.upsert(batch).await.unwrap();
    for ask in asks {
        same(
            &found(&index, &query(ask, 20)).await,
            &oracle(&docs, ask, 1.2, 0.75, 20),
        );
    }
    assert_eq!(sync_misses(), 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn writes_deletes_and_builds_never_show_a_stale_document() {
    let index = index(Arc::new(InMemory::new())).await;
    let mut random = Random(11);
    let mut docs: BTreeMap<u64, String> = BTreeMap::new();
    for round in 0..12 {
        let mut batch = Vec::new();
        for _ in 0..40 {
            let id = random.below(150) as u64;
            let words = 2 + random.below(10);
            let body = sentence(&mut random, words);
            batch.push(doc(id, &body, "x", round as f64));
            docs.insert(id, body);
        }
        index.upsert(batch).await.unwrap();
        let gone: Vec<u64> = (0..5).map(|_| random.below(150) as u64).collect();
        index
            .delete(gone.iter().map(|&id| id.into()).collect())
            .await
            .unwrap();
        for id in gone {
            docs.remove(&id);
        }
        if round % 3 == 2 {
            index.build().await.unwrap();
        }
        for ask in ["password", "reset token", "the a"] {
            let hits = index.search(&query(ask, 1000)).await.unwrap();
            let want = oracle(&docs, ask, 1.2, 0.75, 1000);
            assert_eq!(hits.len(), want.len(), "round {round}, {ask}");
            for hit in hits {
                let crate::Id::Num(id) = hit.id else { panic!() };
                let mut q = query(ask, 1);
                q.include = vec!["body".into()];
                assert!(docs.contains_key(&id), "round {round}: {id} is deleted");
            }
            let mut q = query(ask, 1000);
            q.include = vec!["body".into()];
            for hit in index.search(&q).await.unwrap() {
                let crate::Id::Num(id) = hit.id else { panic!() };
                assert_eq!(hit.attributes["body"], Value::String(docs[&id].clone()));
            }
        }
    }
    index.rebuild().await.unwrap();
    for ask in ["password", "reset token", "running card"] {
        same(
            &found(&index, &query(ask, 10)).await,
            &oracle(&docs, ask, 1.2, 0.75, 10),
        );
    }
    assert_eq!(sync_misses(), 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn filters_phrases_prefixes_and_highlights_agree_in_tail_and_parts() {
    let index = index(Arc::new(InMemory::new())).await;
    let texts = [
        (1, "Reset your password from the login page", "help", 5.0),
        (2, "The password reset link expires", "help", 15.0),
        (3, "Billing: a refund goes to your card", "billing", 25.0),
        (
            4,
            "Passwords and passkeys keep an account secure",
            "security",
            35.0,
        ),
        (5, "Runners reset their pace", "sport", 45.0),
    ];
    let docs: Vec<Doc> = (texts.iter())
        .map(|&(id, body, tag, price)| doc(id, body, tag, price))
        .collect();
    let cases: Vec<(TextQuery, Vec<u64>)> = vec![
        (query("password reset", 10), vec![1, 2, 4, 5]),
        (
            TextQuery {
                filter: Some(Filter::eq("tag", "help")),
                ..query("reset", 10)
            },
            vec![1, 2],
        ),
        (
            TextQuery {
                filter: Some(Filter::And(vec![
                    Filter::gte("price", 10.0),
                    Filter::eq("tag", "help").negate(),
                ])),
                ..query("reset password card", 10)
            },
            vec![3, 4, 5],
        ),
        (
            TextQuery {
                matches: vec![Match::Phrase("body".into(), "password reset".into())],
                ..query("reset", 10)
            },
            vec![2],
        ),
        (
            TextQuery {
                matches: vec![Match::Prefix("body".into(), "pass".into())],
                ..query("password secure", 10)
            },
            vec![1, 2, 4],
        ),
        (
            TextQuery {
                matches: vec![Match::Prefix("body".into(), "your pass".into())],
                ..query("password", 10)
            },
            vec![1],
        ),
        (
            TextQuery {
                matches: vec![Match::AllTokens("body".into(), "Password RESETS".into())],
                ..query("password reset", 10)
            },
            vec![1, 2],
        ),
        (
            TextQuery {
                matches: vec![Match::AnyToken("body".into(), "refund passkeys".into())],
                ..query("password reset card", 10)
            },
            vec![3, 4],
        ),
        (
            TextQuery {
                matches: vec![
                    Match::AnyToken("body".into(), "login link".into()),
                    Match::AllTokens("body".into(), "reset".into()),
                ],
                ..query("password", 10)
            },
            vec![1, 2],
        ),
        (
            TextQuery {
                filter: Some(Filter::is_in("tag", vec!["sport".into(), "billing".into()])),
                ..query("reset refund", 10)
            },
            vec![3, 5],
        ),
        (
            TextQuery {
                filter: Some(Filter::ids(vec![5.into(), 1.into(), 2.into()])),
                ..query("reset", 10)
            },
            vec![1, 2, 5],
        ),
        (
            TextQuery {
                filter: Some(Filter::And(vec![
                    Filter::ids(vec![1.into(), 2.into()]).negate(),
                    Filter::eq("tag", "billing").negate(),
                ])),
                ..query("reset password card", 10)
            },
            vec![4, 5],
        ),
        (query("pasword", 10), vec![]),
        (
            TextQuery {
                fuzzy: 1,
                ..query("pasword", 10)
            },
            vec![1, 2, 4],
        ),
        (
            TextQuery {
                fuzzy: 2,
                ..query("pasord rest", 10)
            },
            vec![1, 2, 4, 5],
        ),
        (
            TextQuery {
                per: Some(crate::Per {
                    attributes: vec!["tag".into()],
                    limit: 1,
                }),
                ..query("password reset", 10)
            },
            vec![2, 4, 5],
        ),
    ];
    let check = |hits: Vec<TextHit>, want: &[u64], case: usize| {
        let mut ids: Vec<u64> = (hits.iter())
            .map(|h| match h.id {
                crate::Id::Num(id) => id,
                _ => 0,
            })
            .collect();
        ids.sort();
        assert_eq!(ids, want, "case {case}");
    };
    index.upsert(docs).await.unwrap();
    let mut before = Vec::new();
    for (case, (q, want)) in cases.iter().enumerate() {
        let hits = index.search(q).await.unwrap();
        before.push(hits.iter().map(|h| h.score).collect::<Vec<_>>());
        check(hits, want, case);
    }
    index.build().await.unwrap();
    for (case, (q, want)) in cases.iter().enumerate() {
        let hits = index.search(q).await.unwrap();
        let scores: Vec<f32> = hits.iter().map(|h| h.score).collect();
        for (a, b) in scores.iter().zip(&before[case]) {
            assert!(
                (a - b).abs() < 1e-4,
                "case {case}: {scores:?} vs {:?}",
                before[case]
            );
        }
        check(hits, want, case);
    }
    let q = TextQuery {
        highlight: vec!["body".into()],
        include: vec!["tag".into()],
        ..query("password reset", 1)
    };
    let hit = &index.search(&q).await.unwrap()[0];
    let marked = &hit.highlights["body"];
    let text: Vec<u16> = marked.text.encode_utf16().collect();
    let words: Vec<String> = (marked.marks.iter())
        .map(|&(a, b)| String::from_utf16_lossy(&text[a as usize..b as usize]).to_lowercase())
        .collect();
    assert!(words.contains(&"password".to_string()), "{marked:?}");
    assert_eq!(hit.attributes.keys().collect::<Vec<_>>(), ["tag"]);
    let bad = TextQuery {
        filter: Some(Filter::eq("body", "x")),
        ..query("x", 1)
    };
    assert!(index.search(&bad).await.is_err());
    assert_eq!(sync_misses(), 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn forks_share_parts_and_collection_keeps_what_branches_name() {
    let store: Arc<dyn ObjectStore> = Arc::new(InMemory::new());
    let main = index(store.clone()).await;
    let mut random = Random(3);
    let docs: Vec<Doc> = (0..200)
        .map(|id| doc(id, &sentence(&mut random, 6), "a", 1.0))
        .collect();
    main.upsert(docs).await.unwrap();
    main.build().await.unwrap();
    let fork = main.fork("try").await.unwrap();
    fork.upsert(vec![doc(1, "unique zebra words", "a", 1.0)])
        .await
        .unwrap();
    fork.delete(vec![2.into()]).await.unwrap();
    fork.build().await.unwrap();
    let zebra = query("zebra", 5);
    assert_eq!(found(&fork, &zebra).await.len(), 1);
    assert!(found(&main, &zebra).await.is_empty());
    let all = |index: Index| async move {
        let q = query("the a to of and reset password", 1000);
        found(&index, &q)
            .await
            .into_iter()
            .map(|e| e.0)
            .collect::<Vec<_>>()
    };
    assert!(all(main.clone()).await.contains(&2));
    assert!(!all(fork.clone()).await.contains(&2));
    let version = fork.version().await.unwrap();
    let parts = &version.text.as_ref().unwrap().parts;
    assert_eq!(parts.len(), 2);
    assert_eq!(parts[0].dead_docs, 2);

    let before = all(fork.clone()).await;
    let collected = gc::collect(store.clone(), Duration::ZERO, false)
        .await
        .unwrap();
    assert_eq!(collected.missing, 0);
    let fresh = Index::open(store.clone(), "try").await.unwrap();
    assert_eq!(all(fresh).await, before);
    main.delete_branch("try").await.unwrap();
    let left = gc::collect(store, Duration::ZERO, false).await.unwrap();
    assert!(left.deleted > 0);
    assert!(all(main).await.contains(&2));
}

#[tokio::test(flavor = "multi_thread")]
async fn hybrid_fuses_vector_and_text_ranks() {
    let schema = Schema::new()
        .vector("v", 2, Metric::Euclidean)
        .text("body", TextOptions::default())
        .attribute("stars", Kind::Number);
    let store: Arc<dyn ObjectStore> = Arc::new(InMemory::new());
    let index = Index::create(store, schema).await.unwrap();
    let docs = [
        (1, [0.0, 0.0], "red apple", 0.0),
        (2, [1.0, 0.0], "green apple pie", 0.0),
        (3, [5.0, 5.0], "apple apple apple", 10.0),
        (4, [0.1, 0.0], "banana", 5.0),
    ];
    let docs: Vec<Doc> = (docs.iter())
        .map(|&(id, v, body, stars)| {
            Doc::new(id as u64)
                .vector("v", v.to_vec())
                .attribute("body", body)
                .attribute("stars", stars)
        })
        .collect();
    index.upsert(docs).await.unwrap();
    for built in [false, true] {
        if built {
            index.build().await.unwrap();
        }
        let hybrid = Hybrid {
            searches: vec![
                (
                    "near".into(),
                    Search::Vector(Query::new("v", vec![0.0, 0.0], 3)),
                ),
                ("words".into(), Search::Text(TextQuery::new("apple", 3))),
            ],
            k: 60.0,
            weights: BTreeMap::new(),
            top_k: 4,
            offset: 0,
            per: None,
            rank: None,
        };
        let hits = index.hybrid(&hybrid).await.unwrap();
        let ids: Vec<crate::Id> = hits.iter().map(|h| h.id.clone()).collect();
        assert_eq!(ids[0], crate::Id::Num(1));
        let ranks: HashMap<String, u32> = hits[0].ranks.clone().into_iter().collect();
        assert_eq!(ranks["near"], 1);
        assert!(
            hits.iter()
                .any(|h| h.id == crate::Id::Num(4) && h.ranks.len() == 1)
        );
        assert!(hits[0].scores["near"] <= 1e-6);

        let rank = crate::Score::Sum(vec![
            crate::Score::Search("words".into()),
            crate::Score::Attribute("stars".into()),
        ]);
        let ranked = Hybrid {
            rank: Some(rank),
            ..hybrid
        };
        let hits = index.hybrid(&ranked).await.unwrap();
        let ids: Vec<crate::Id> = hits.iter().map(|h| h.id.clone()).collect();
        assert_eq!(ids[..2], [crate::Id::Num(3), crate::Id::Num(4)]);
        assert!(hits.iter().all(|h| h.attributes.is_empty()));
        assert_eq!(hits[1].score, 5.0);
        let bad = Hybrid {
            rank: Some(crate::Score::Search("nope".into())),
            ..ranked
        };
        assert!(index.hybrid(&bad).await.is_err());
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn attributes_added_later_are_searched_in_old_and_new_parts() {
    let index = index(Arc::new(InMemory::new())).await;
    let old = (1..=3).map(|id| doc(id, "reset the password", "help", 1.0));
    index.upsert(old.collect()).await.unwrap();
    index.build().await.unwrap();

    let added = Schema::new()
        .text("summary", TextOptions::default())
        .attribute("lang", Kind::String);
    let schema = index.alter(&added).await.unwrap();
    assert_eq!(schema.attributes["lang"], Kind::String);
    assert_eq!(index.alter(&added).await.unwrap(), schema);
    let retyped = Schema::new().attribute("lang", Kind::Int);
    assert!(index.alter(&retyped).await.is_err());
    let vector = Schema::new().vector("v", 2, Metric::Euclidean);
    assert!(index.alter(&vector).await.is_err());

    let new = |id: u64, lang: &str| {
        doc(id, "reset the token", "help", 2.0)
            .attribute("summary", "a password reset")
            .attribute("lang", lang)
    };
    index
        .upsert(vec![new(4, "en"), new(5, "fr")])
        .await
        .unwrap();
    let ids = |hits: Vec<(u64, f32)>| {
        let mut ids: Vec<u64> = hits.into_iter().map(|h| h.0).collect();
        ids.sort();
        ids
    };
    for build in [false, true] {
        if build {
            index.build().await.unwrap();
        }
        let english = TextQuery {
            filter: Some(Filter::eq("lang", "en")),
            ..query("reset", 10)
        };
        assert_eq!(ids(found(&index, &english).await), [4], "build {build}");
        let other = TextQuery {
            filter: Some(Filter::eq("lang", "en").negate()),
            ..query("reset", 10)
        };
        assert_eq!(ids(found(&index, &other).await), [1, 2, 3, 5]);
        let summary = TextQuery {
            fields: vec![("summary".into(), 1.0)],
            matches: vec![Match::Phrase("summary".into(), "password reset".into())],
            ..TextQuery::new("password", 10)
        };
        assert_eq!(ids(found(&index, &summary).await), [4, 5]);
    }
    let parts = index.version().await.unwrap().text.clone().unwrap().parts;
    assert_eq!(parts.len(), 2);
}

#[tokio::test(flavor = "multi_thread")]
async fn an_index_of_text_alone_builds_and_counts() {
    let schema = Schema::new().text("body", TextOptions::default());
    let index = Index::create(Arc::new(InMemory::new()), schema)
        .await
        .unwrap();
    index
        .upsert(vec![Doc::new(1).attribute("body", "hello world")])
        .await
        .unwrap();
    index.build().await.unwrap();
    let version = index.version().await.unwrap();
    index.build().await.unwrap();
    assert!(Arc::ptr_eq(&version, &index.version().await.unwrap()) || version.tail.is_empty());
    let stats = index.stats().await.unwrap();
    assert_eq!((stats.rows, stats.indexed_rows), (1, 1));
    assert_eq!(found(&index, &TextQuery::new("hello", 3)).await.len(), 1);
    let none = Schema::new();
    assert!(
        Index::create(Arc::new(InMemory::new()), none)
            .await
            .is_err()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn languages_and_stopwords_agree_in_tail_and_parts() {
    let french = TextOptions {
        language: Language::French,
        stopwords: true,
        ..TextOptions::default()
    };
    let plain = TextOptions {
        language: Language::None,
        ..TextOptions::default()
    };
    let schema = Schema::new().text("body", french).text("raw", plain);
    let index = Index::create(Arc::new(InMemory::new()), schema)
        .await
        .unwrap();
    let texts = [
        (1, "Le cheval de la maison", "running"),
        (2, "Les chevaux courent", "run"),
        (3, "Une maison blanche", "runs"),
        (4, "Cheval maison", "ran"),
    ];
    let docs: Vec<Doc> = (texts.iter())
        .map(|&(id, body, raw)| Doc::new(id).attribute("body", body).attribute("raw", raw))
        .collect();
    let on = |field: &str, text: &str| TextQuery {
        fields: vec![(field.into(), 1.0)],
        ..TextQuery::new(text, 10)
    };
    let cases: Vec<(TextQuery, Vec<u64>)> = vec![
        (on("body", "chevaux"), vec![1, 2, 4]),
        (on("body", "le de la"), vec![]),
        (
            TextQuery {
                matches: vec![Match::Phrase("body".into(), "cheval de la maison".into())],
                ..on("body", "maison")
            },
            vec![1, 4],
        ),
        (
            TextQuery {
                matches: vec![Match::Prefix("body".into(), "cheval de la mai".into())],
                ..on("body", "cheval")
            },
            vec![1, 4],
        ),
        (
            TextQuery {
                matches: vec![Match::AllTokens("body".into(), "les chevaux".into())],
                ..on("body", "maison cheval")
            },
            vec![1, 2, 4],
        ),
        (
            TextQuery {
                matches: vec![Match::AllTokens("body".into(), "le la".into())],
                ..on("body", "maison")
            },
            vec![],
        ),
        (on("raw", "running"), vec![1]),
        (on("raw", "run runs"), vec![2, 3]),
    ];
    let ids = |hits: &[TextHit]| {
        let mut ids: Vec<u64> = (hits.iter())
            .map(|h| match h.id {
                crate::Id::Num(id) => id,
                _ => 0,
            })
            .collect();
        ids.sort();
        ids
    };
    index.upsert(docs).await.unwrap();
    let mut before = Vec::new();
    for (case, (q, want)) in cases.iter().enumerate() {
        let hits = index.search(q).await.unwrap();
        assert_eq!(&ids(&hits), want, "case {case}");
        before.push(hits.iter().map(|h| h.score).collect::<Vec<_>>());
    }
    index.build().await.unwrap();
    for (case, (q, want)) in cases.iter().enumerate() {
        let hits = index.search(q).await.unwrap();
        assert_eq!(&ids(&hits), want, "case {case}");
        let scores: Vec<f32> = hits.iter().map(|h| h.score).collect();
        for (a, b) in scores.iter().zip(&before[case]) {
            assert!(
                (a - b).abs() < 1e-4,
                "case {case}: {scores:?} vs {before:?}"
            );
        }
    }
    let q = TextQuery {
        highlight: vec!["body".into()],
        ..on("body", "cheval")
    };
    let hits = index.search(&q).await.unwrap();
    let two = hits.iter().find(|h| h.id == crate::Id::Num(2)).unwrap();
    assert_eq!(two.highlights["body"].marks, [(4, 11)]);
    let german = Schema::new().text(
        "body",
        TextOptions {
            language: Language::German,
            ..french
        },
    );
    assert!(index.alter(&german).await.is_err());
    let arabic = Schema::new().text(
        "body",
        TextOptions {
            language: Language::Arabic,
            stopwords: true,
            ..TextOptions::default()
        },
    );
    assert!(
        Index::create(Arc::new(InMemory::new()), arabic)
            .await
            .is_err()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_version_of_format_5_reads_its_text_as_english() {
    use serde::Serialize;
    use skywake_core::Objects;

    use crate::store::head;

    #[derive(Serialize)]
    struct OldSchema {
        vectors: BTreeMap<String, crate::Column>,
        attributes: BTreeMap<String, Kind>,
        text: BTreeMap<String, (f32, f32)>,
    }
    #[derive(Serialize)]
    struct Old<'a> {
        format: u32,
        parent: Option<skywake_core::Hash>,
        schema: OldSchema,
        built: &'a crate::format::pages::Pages,
        tail: &'a [crate::format::SegmentRef],
        ann: Option<crate::format::Ann>,
        next_seq: u64,
        text: &'a Option<part::TextIndex>,
    }
    let store: Arc<dyn ObjectStore> = Arc::new(InMemory::new());
    let schema = Schema::new().text("body", TextOptions::default());
    let index = Index::create(store.clone(), schema).await.unwrap();
    let docs = vec![Doc::new(1).attribute("body", "Running dogs")];
    index.upsert(docs).await.unwrap();
    index.build().await.unwrap();
    let now = index.version().await.unwrap();
    let old = Old {
        format: 5,
        parent: None,
        schema: OldSchema {
            vectors: BTreeMap::new(),
            attributes: now.schema.attributes.clone(),
            text: [("body".to_string(), (1.2, 0.75))].into(),
        },
        built: &now.built,
        tail: &now.tail,
        ann: None,
        next_seq: now.next_seq,
        text: &now.text,
    };
    let hash = Objects::new(store.clone()).put(&old).await.unwrap();
    head::create(store.as_ref(), "old", hash, &[])
        .await
        .unwrap();
    let opened = Index::open(store, "old").await.unwrap();
    let version = opened.version().await.unwrap();
    assert_eq!(version.schema.text["body"], TextOptions::default());
    assert_eq!(found(&opened, &query("run", 1)).await.len(), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_version_of_format_2_still_opens() {
    use serde::Serialize;
    use skywake_core::{Hash, Objects};

    use crate::format::pages::Pages;
    use crate::format::{Ann, SegmentRef};
    use crate::store::head;

    #[derive(Serialize)]
    struct Old {
        format: u32,
        parent: Option<Hash>,
        schema: (BTreeMap<String, (usize, Metric)>, BTreeMap<String, Kind>),
        built: Pages,
        tail: Vec<SegmentRef>,
        ann: Option<Ann>,
        next_seq: u64,
    }
    let store: Arc<dyn ObjectStore> = Arc::new(InMemory::new());
    let schema = Schema::new().vector("v", 2, Metric::Euclidean);
    let index = Index::create(store.clone(), schema).await.unwrap();
    index
        .upsert(vec![Doc::new(1).vector("v", vec![1.0, 0.0])])
        .await
        .unwrap();
    let now = index.version().await.unwrap();
    let columns = (now.schema.vectors.iter())
        .map(|(name, c)| (name.clone(), (c.dims, c.metric)))
        .collect();
    let old = Old {
        format: 2,
        parent: None,
        schema: (columns, now.schema.attributes.clone()),
        built: now.built.clone(),
        tail: now.tail.clone(),
        ann: None,
        next_seq: now.next_seq,
    };
    let hash = Objects::new(store.clone()).put(&old).await.unwrap();
    head::create(store.as_ref(), "old", hash, &[])
        .await
        .unwrap();
    let opened = Index::open(store, "old").await.unwrap();
    let hits = opened
        .query(&Query::new("v", vec![1.0, 0.0], 1))
        .await
        .unwrap();
    assert_eq!(hits[0].id, crate::Id::Num(1));
    opened
        .upsert(vec![Doc::new(2).vector("v", vec![0.0, 1.0])])
        .await
        .unwrap();
    assert_eq!(
        opened.version().await.unwrap().format,
        crate::format::FORMAT
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn text_options_filters_and_prefixes_agree_in_tail_and_parts() {
    let exact = TextOptions {
        stemming: false,
        case_sensitive: true,
        filterable: true,
        ..TextOptions::default()
    };
    let folded = TextOptions {
        stemming: false,
        ascii_folding: true,
        max_token: 6,
        ..TextOptions::default()
    };
    let tags = TextOptions {
        pre_tokenized: true,
        ..TextOptions::default()
    };
    let schema = Schema::new()
        .text("title", exact)
        .text("body", folded)
        .text("tags", tags)
        .attribute("color", Kind::String);
    let index = Index::create(Arc::new(InMemory::new()), schema)
        .await
        .unwrap();
    let rows = [
        (
            1,
            "Running Shoes",
            "café crème shoelaces",
            vec!["New York", "sale"],
        ),
        (2, "running socks", "cafe noir", vec!["new york"]),
        (3, "Runner", "the runway", vec!["Paris"]),
        (4, "Running Shoes", "plain", vec![]),
    ];
    let docs: Vec<Doc> = (rows.iter())
        .map(|(id, title, body, tags)| {
            let doc = Doc::new(*id)
                .attribute("title", *title)
                .attribute("body", *body)
                .attribute(
                    "tags",
                    Value::Strings(tags.iter().map(|t| t.to_string()).collect()),
                );
            match id {
                1 | 3 => doc.attribute("color", "red"),
                _ => doc,
            }
        })
        .collect();
    let on = |field: &str, text: &str| TextQuery {
        fields: vec![(field.into(), 1.0)],
        ..TextQuery::new(text, 10)
    };
    let id_range = Filter::IdRange(
        std::ops::Bound::Included(crate::Id::Num(2)),
        std::ops::Bound::Excluded(crate::Id::Num(4)),
    );
    let cases: Vec<(TextQuery, Vec<u64>)> = vec![
        (on("title", "Running"), vec![1, 4]),
        (on("title", "running"), vec![2]),
        (on("title", "run"), vec![]),
        (on("body", "cafe"), vec![1, 2]),
        (on("body", "shoelaces"), vec![]),
        (on("tags", "New York"), vec![1]),
        (on("tags", "new york"), vec![2]),
        (
            TextQuery {
                last_as_prefix: true,
                ..on("body", "the run")
            },
            vec![3],
        ),
        (
            TextQuery {
                last_as_prefix: true,
                ..on("title", "Run")
            },
            vec![1, 3, 4],
        ),
        (
            TextQuery {
                filter: Some(Filter::Eq("title".into(), "Running Shoes".into())),
                ..on("body", "cafe plain")
            },
            vec![1, 4],
        ),
        (
            TextQuery {
                filter: Some(Filter::Exists("color".into())),
                ..on("title", "Running Runner")
            },
            vec![1, 3],
        ),
        (
            TextQuery {
                filter: Some(Filter::Not(Box::new(Filter::Exists("color".into())))),
                ..on("title", "Running Runner")
            },
            vec![4],
        ),
        (
            TextQuery {
                filter: Some(id_range.clone()),
                ..on("title", "running Runner")
            },
            vec![2, 3],
        ),
    ];
    let ids = |hits: &[TextHit]| {
        let mut ids: Vec<u64> = (hits.iter())
            .map(|h| match h.id {
                crate::Id::Num(id) => id,
                _ => 0,
            })
            .collect();
        ids.sort();
        ids
    };
    index.upsert(docs).await.unwrap();
    for (case, (q, want)) in cases.iter().enumerate() {
        let hits = index.search(q).await.unwrap();
        assert_eq!(&ids(&hits), want, "tail case {case}");
    }
    index.build().await.unwrap();
    for (case, (q, want)) in cases.iter().enumerate() {
        let hits = index.search(q).await.unwrap();
        assert_eq!(&ids(&hits), want, "part case {case}");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_version_of_format_8_keeps_its_text_language() {
    use skywake_core::Objects;

    use crate::format::legacy::{SchemaV8, V8, old_texts};
    use crate::store::head;

    let store: Arc<dyn ObjectStore> = Arc::new(InMemory::new());
    let french = TextOptions {
        language: Language::French,
        stopwords: true,
        ..TextOptions::default()
    };
    let schema = Schema::new().text("body", french);
    let index = Index::create(store.clone(), schema).await.unwrap();
    let docs = vec![Doc::new(1).attribute("body", "Les chevaux courent")];
    index.upsert(docs).await.unwrap();
    index.build().await.unwrap();
    let now = index.version().await.unwrap();
    let old = V8 {
        _format: 8,
        parent: None,
        schema: SchemaV8 {
            vectors: now.schema.vectors.clone(),
            attributes: now.schema.attributes.clone(),
            text: old_texts(&now.schema.text),
            id: now.schema.id,
            filter_index: now.schema.filter_index.clone(),
        },
        built: now.built.clone(),
        tail: now.tail.clone(),
        ann: None,
        next_seq: now.next_seq,
        text: now.text.clone(),
    };
    let hash = Objects::new(store.clone()).put(&old).await.unwrap();
    head::create(store.as_ref(), "old", hash, &[])
        .await
        .unwrap();
    let opened = Index::open(store, "old").await.unwrap();
    assert_eq!(opened.version().await.unwrap().schema, now.schema);
    let hits = opened.search(&TextQuery::new("cheval", 10)).await.unwrap();
    assert_eq!(hits.len(), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn dropping_an_attribute_clears_it_and_lets_it_back_only_as_it_was() {
    let schema = Schema::new()
        .text("body", TextOptions::default())
        .attribute("color", Kind::String)
        .attribute("size", Kind::Int);
    let index = Index::create(Arc::new(InMemory::new()), schema)
        .await
        .unwrap();
    let docs = vec![
        Doc::new(1)
            .attribute("body", "red shoes")
            .attribute("color", "red")
            .attribute("size", 9),
        Doc::new(2)
            .attribute("body", "blue shoes")
            .attribute("size", 7),
    ];
    index.upsert(docs).await.unwrap();
    index.build().await.unwrap();
    let left = index.drop_attributes(&["color".into()]).await.unwrap();
    assert!(!left.attributes.contains_key("color"));
    let q = TextQuery {
        include: vec!["size".into()],
        ..TextQuery::new("shoes", 10)
    };
    assert_eq!(index.search(&q).await.unwrap().len(), 2);
    let colors = TextQuery {
        include: vec!["color".into()],
        ..TextQuery::new("shoes", 10)
    };
    assert!(index.search(&colors).await.is_err());
    let as_int = Schema::new().attribute("color", Kind::Int);
    assert!(index.alter(&as_int).await.is_err());
    let back = Schema::new().attribute("color", Kind::String);
    index.alter(&back).await.unwrap();
    let hits = index.search(&colors).await.unwrap();
    assert!(hits.iter().all(|hit| !hit.attributes.contains_key("color")));
    assert!(index.drop_attributes(&["nothing".into()]).await.is_err());
    assert!(index.drop_attributes(&["body".into()]).await.is_err());
}
