use std::collections::BTreeMap;
use std::sync::Arc;

use tantivy::query::Bm25Weight;

use super::pack::{PAD, pack, packed_len, unpack, width};
use super::score::{Hit, Term, search_on};
use super::span::{BLOCK, Best, Posting, Span, encode};
use crate::Id;
use crate::vector::ivf::Random;

fn postings(random: &mut Random, docs: u32, share: usize) -> Vec<Posting> {
    let mut list = Vec::new();
    for doc in 0..docs {
        if random.below(share) == 0 {
            list.push((doc, 1 + random.below(5) as u32, random.below(40) as u8));
        }
    }
    list
}

fn span(list: &[Posting], best: usize) -> Arc<Span> {
    let mut top: Vec<Posting> = list.to_vec();
    top.sort_by_key(|&(_, tf, norm)| (std::cmp::Reverse(tf), norm));
    let best = (top.iter().take(best))
        .map(|&(doc, tf, norm)| Best {
            doc,
            tf,
            norm,
            id: Some(Id::Num(doc as u64)),
        })
        .collect();
    Arc::new(Span::parse(&encode(0, "word", list, best).unwrap()).unwrap())
}

fn brute(terms: &[Term], lists: &[Vec<Posting>], blocked: Option<&[u64]>) -> Vec<Hit> {
    let mut scores: BTreeMap<u32, f64> = BTreeMap::new();
    for (term, list) in terms.iter().zip(lists) {
        for &(doc, tf, norm) in list {
            *scores.entry(doc).or_default() += term.weight.score(norm, tf) as f64;
        }
    }
    let gone = |doc: u32| {
        blocked.is_some_and(|words| {
            (words.get(doc as usize / 64)).is_some_and(|word| word >> (doc % 64) & 1 == 1)
        })
    };
    let mut hits: Vec<Hit> = (scores.into_iter())
        .filter(|(doc, _)| !gone(*doc))
        .map(|(doc, score)| Hit {
            score: score as f32,
            doc,
        })
        .collect();
    hits.sort_by(|a, b| b.cmp(a));
    hits
}

fn weight(random: &mut Random, df: usize, docs: u32) -> Bm25Weight {
    let (k1, b) = (
        [1.2, 0.9, 0.0, 2.0][random.below(4)],
        [0.75, 0.4, 1.0, 0.0][random.below(4)],
    );
    Bm25Weight::for_one_term(df as u64, docs as u64, 12.0)
        .with_params(k1, b)
        .boost_by([1.0, 2.5, 0.01][random.below(3)])
}

#[test]
fn packing_round_trips_every_width() {
    let mut random = Random(3);
    for bits in 0..=32u8 {
        let max = if bits == 0 {
            0
        } else {
            u32::MAX >> (32 - bits)
        };
        let values: Vec<u32> = (0..BLOCK)
            .map(|i| {
                if i == 0 {
                    max
                } else {
                    (random.next() as u32) & max
                }
            })
            .collect();
        assert_eq!(width(max), bits);
        let mut bytes = Vec::new();
        pack(&values, bits, &mut bytes);
        assert_eq!(bytes.len(), packed_len(values.len(), bits));
        bytes.extend_from_slice(&[0; PAD]);
        let mut out = vec![0; values.len()];
        unpack(&bytes, bits, &mut out);
        assert_eq!(out, values);
    }
}

#[test]
fn spans_round_trip_and_reject_damage() {
    let mut random = Random(5);
    for (docs, share) in [
        (1, 1),
        (128, 1),
        (129, 1),
        (5000, 3),
        (200_000, 700),
        (0, 1),
    ] {
        let list = postings(&mut random, docs, share);
        let bytes = encode(7, "wörd", &list, Vec::new()).unwrap();
        let span = Span::parse(&bytes).unwrap();
        assert_eq!(span.postings(), list);
        assert_eq!((span.head.field, span.head.term.as_str()), (7, "wörd"));
        assert_eq!(span.head.df as usize, list.len());
        for cut in [0, 3, bytes.len() / 2, bytes.len() - 1] {
            assert!(Span::parse(&bytes[..cut]).is_err() || list.is_empty());
        }
    }
    let far = [(0, 1, 0), (u32::MAX - 1, 9, 255)];
    assert_eq!(span(&far, 0).postings(), far);
}

#[test]
fn search_is_the_exact_top_k_on_every_thread_count() {
    let mut random = Random(11);
    for round in 0..120 {
        let docs = [1u32, 90, 3000, 40_000][random.below(4)];
        let count = 1 + random.below(6);
        let mut lists: Vec<Vec<Posting>> = (0..count)
            .map(|_| {
                let share = [1, 2, 7, 60, 900][random.below(5)];
                postings(&mut random, docs, share)
            })
            .collect();
        if random.below(3) == 0 {
            lists.push(lists[0].clone());
        }
        let best = [0, 4, 32][random.below(3)];
        let terms: Vec<Term> = (lists.iter())
            .map(|list| Term {
                span: span(list, best),
                weight: weight(&mut random, list.len(), docs),
            })
            .collect();
        let blocked: Option<Vec<u64>> = (random.below(3) != 0).then(|| {
            let share = 1 + random.below(5);
            let mut words =
                vec![0u64; (docs as usize).div_ceil(64) - random.below(2).min(docs as usize / 64)];
            for doc in 0..docs {
                if random.below(share) == 0 && (doc as usize / 64) < words.len() {
                    words[doc as usize / 64] |= 1 << (doc % 64);
                }
            }
            words
        });
        let all = brute(&terms, &lists, blocked.as_deref());
        for k in [1, 10, 1000] {
            let kth = all.get(k - 1).map_or(0.0, |hit| hit.score);
            let floor = [f32::MIN, 0.0, kth * 0.5, kth, f32::NAN][random.below(5)];
            for threads in [1, 2, 7] {
                let found = search_on(&terms, docs, blocked.as_deref(), k, floor, Some(threads));
                let wanted = &all[..all.len().min(k)];
                assert_eq!(found, wanted, "round {round}, k {k}, {threads} threads");
            }
        }
    }
}

#[test]
fn a_floor_keeps_only_the_hits_at_or_above_it() {
    let lists = [(0..900)
        .map(|doc| (doc, 1 + doc % 7, (doc % 13) as u8))
        .collect::<Vec<_>>()];
    let terms = [Term {
        span: span(&lists[0], 32),
        weight: Bm25Weight::for_one_term(900, 900, 5.0),
    }];
    let all = brute(&terms, &lists, None);
    let floor = all[40].score;
    let wanted: Vec<Hit> = all
        .iter()
        .copied()
        .filter(|hit| hit.score >= floor)
        .collect();
    for threads in [1, 3] {
        assert_eq!(
            search_on(&terms, 900, None, 1000, floor, Some(threads)),
            wanted
        );
        assert!(search_on(&terms, 900, None, 5, f32::INFINITY, Some(threads)).is_empty());
    }
}

#[test]
fn damaged_spans_never_hang_or_panic() {
    let mut random = Random(17);
    let list = postings(&mut random, 4000, 3);
    let bytes = encode(0, "word", &list, span(&list, 32).head.best.clone()).unwrap();
    for _ in 0..3000 {
        let mut damaged = bytes.clone();
        for _ in 0..1 + random.below(3) {
            let at = random.below(damaged.len());
            damaged[at] ^= 1 << random.below(8);
        }
        let Ok(parsed) = Span::parse(&damaged) else {
            continue;
        };
        let terms = [
            Term {
                span: Arc::new(parsed),
                weight: Bm25Weight::for_one_term(list.len() as u64, 4000, 12.0),
            },
            Term {
                span: span(&list, 32),
                weight: Bm25Weight::for_one_term(900, 4000, 12.0),
            },
        ];
        for floor in [f32::MIN, 1.0] {
            search_on(&terms, 4000, None, 10, floor, Some(2));
        }
    }
}

#[test]
fn a_floor_above_every_score_finds_nothing_and_no_terms_find_nothing() {
    let list: Vec<Posting> = (0..500).map(|doc| (doc, 2, 3)).collect();
    let term = Term {
        span: span(&list, 32),
        weight: Bm25Weight::for_one_term(500, 500, 3.0),
    };
    assert!(search_on(std::slice::from_ref(&term), 500, None, 10, 1e9, None).is_empty());
    assert!(search_on(&[], 500, None, 10, 0.0, None).is_empty());
    assert!(search_on(&[term], 500, None, 0, 0.0, None).is_empty());
}

#[test]
fn id_runs_name_every_document_and_give_up_on_scattered_ids() {
    use super::Names;
    let dense = [7u64, 8, 9, 20, 21, 3];
    let runs = Names::runs(6, |doc| Ok(Id::Num(dense[doc as usize]))).unwrap();
    let names = Names::Runs(runs.unwrap());
    for (doc, id) in dense.iter().enumerate() {
        assert_eq!(names.named(doc as u32, 6), Some(Id::Num(*id)));
    }
    assert_eq!(names.named(6, 6), None);
    let scattered = Names::runs(10_000, |doc| Ok(Id::Num(doc as u64 * 2))).unwrap();
    assert!(scattered.is_none());
    let text = Names::runs(3, |doc| Ok(Id::Str(doc.to_string()))).unwrap();
    assert!(text.is_none());
}

#[test]
fn two_ids_with_one_key_fail_the_build() {
    use crate::text::part::entries;
    assert!(entries(&[9, 4, 7], &[2, 0, 1]).is_ok());
    let shared = entries(&[5, 3, 5], &[0, 1, 2]);
    assert!(matches!(shared, Err(crate::Error::Invalid(_))));
}
