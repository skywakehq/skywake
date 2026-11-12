//! Hybrid search: vector and text searches fused into one ranking.

use std::collections::BTreeMap;

use futures::future::try_join_all;

use super::{FusedHit, Highlight, Hybrid, Search, search};
use crate::format::Version;
use crate::read::query;
use crate::store::Storage;
use crate::{Attributes, Id, Result, Score, invalid};

pub(crate) const MAX_SEARCHES: usize = 16;

pub(crate) async fn hybrid(
    storage: &Storage,
    version: &Version,
    hybrid: &Hybrid,
) -> Result<Vec<FusedHit>> {
    let count = hybrid.searches.len();
    if !(1..=MAX_SEARCHES).contains(&count) {
        return Err(invalid(format!(
            "a hybrid query takes 1 to {MAX_SEARCHES} searches"
        )));
    }
    if !hybrid.k.is_finite() || hybrid.k < 0.0 {
        return Err(invalid("the rank constant k must be 0 or more"));
    }
    for (name, weight) in &hybrid.weights {
        if !hybrid.searches.iter().any(|(n, _)| n == name) {
            return Err(invalid(format!("a weight names no search `{name}`")));
        }
        if !weight.is_finite() || *weight < 0.0 {
            return Err(invalid(format!("the weight of `{name}` must be 0 or more")));
        }
    }
    let (asked, mut needed) = (hybrid.include(), Vec::new());
    let mut rank = None;
    if let Some(score) = &hybrid.rank {
        let names: Vec<&str> = hybrid.searches.iter().map(|(n, _)| n.as_str()).collect();
        score.check(&names, &version.schema)?;
        score.attributes(&mut needed);
        rank = Some(score.typed(&version.schema)?);
    }
    let needed: Vec<String> = needed.into_iter().filter(|n| !asked.contains(n)).collect();
    let mut searches = hybrid.searches.clone();
    for (_, run) in &mut searches {
        let include = match run {
            Search::Vector(q) => &mut q.include,
            Search::Text(q) => &mut q.include,
        };
        include.extend(needed.iter().cloned());
    }
    let runs = searches.iter().map(|(_, run)| async move {
        Ok::<_, crate::Error>(match run {
            Search::Vector(q) => (query::run(storage, version, q).await?)
                .into_iter()
                .map(|hit| (hit.id, hit.distance, hit.attributes, BTreeMap::new()))
                .collect::<Vec<_>>(),
            Search::Text(q) => (search(storage, version, q).await?)
                .into_iter()
                .map(|hit| (hit.id, hit.score, hit.attributes, hit.highlights))
                .collect(),
        })
    });
    let lists = try_join_all(runs).await?;
    let mut hits = fuse(hybrid, rank.as_ref(), lists);
    for hit in &mut hits {
        hit.attributes.retain(|name, _| !needed.contains(name));
    }
    Ok(hits)
}

type Found = (Id, f32, Attributes, BTreeMap<String, Highlight>);

fn fuse(hybrid: &Hybrid, rank: Option<&Score>, lists: Vec<Vec<Found>>) -> Vec<FusedHit> {
    let mut fused: BTreeMap<Id, FusedHit> = BTreeMap::new();
    for ((name, _), list) in hybrid.searches.iter().zip(lists) {
        let weight = hybrid.weights.get(name).copied().unwrap_or(1.0);
        for (rank, (id, score, attributes, highlights)) in (1..).zip(list) {
            let hit = fused.entry(id.clone()).or_insert_with(|| FusedHit {
                id,
                score: 0.0,
                ranks: BTreeMap::new(),
                scores: BTreeMap::new(),
                attributes: Attributes::new(),
                highlights: BTreeMap::new(),
            });
            hit.score += weight / (hybrid.k + rank as f32);
            hit.ranks.insert(name.clone(), rank);
            hit.scores.insert(name.clone(), score);
            hit.attributes.extend(attributes);
            hit.highlights.extend(highlights);
        }
    }
    let mut hits: Vec<FusedHit> = fused.into_values().collect();
    if let Some(rank) = rank {
        for hit in &mut hits {
            hit.score = rank.eval(&hit.id, &hit.scores, &hit.attributes) as f32;
        }
    }
    hits.sort_by(|a, b| b.score.total_cmp(&a.score).then_with(|| a.id.cmp(&b.id)));
    hits.truncate(hybrid.top_k);
    hits
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::text::TextQuery;

    fn found(ids: &[u64]) -> Vec<Found> {
        (ids.iter())
            .map(|&id| (Id::Num(id), 0.5, Attributes::new(), BTreeMap::new()))
            .collect()
    }

    #[test]
    fn rrf_adds_reciprocal_ranks_and_breaks_ties_by_id() {
        let text = || Search::Text(TextQuery::new("x", 10));
        let hybrid = Hybrid {
            searches: vec![("a".into(), text()), ("b".into(), text())],
            k: 60.0,
            weights: [("b".to_string(), 2.0)].into(),
            top_k: 3,
            offset: 0,
            per: None,
            rank: None,
        };
        let hits = fuse(
            &hybrid,
            hybrid.rank.as_ref(),
            vec![found(&[1, 2, 3]), found(&[3, 4])],
        );
        let ids: Vec<Id> = hits.iter().map(|h| h.id.clone()).collect();
        assert_eq!(ids, [Id::Num(3), Id::Num(4), Id::Num(1)]);
        assert_eq!(hits[0].ranks, [("a".into(), 3), ("b".into(), 1)].into());
        assert!((hits[0].score - (1.0 / 63.0 + 2.0 / 61.0)).abs() < 1e-6);
        let even = Hybrid {
            weights: BTreeMap::new(),
            ..hybrid
        };
        let hits = fuse(&even, even.rank.as_ref(), vec![found(&[1]), found(&[2])]);
        assert_eq!(hits[0].id, Id::Num(1));
    }
}
