//! Limits per value, such as three hits per file.

use std::collections::HashMap;

use crate::{Attributes, FusedHit, Hit, Result, TextHit};

#[derive(Clone, Debug, PartialEq)]
pub struct Per {
    pub attributes: Vec<String>,
    pub limit: usize,
}

pub(crate) trait Attributed {
    fn attributes(&mut self) -> &mut Attributes;
}

impl Attributed for Hit {
    fn attributes(&mut self) -> &mut Attributes {
        &mut self.attributes
    }
}

impl Attributed for TextHit {
    fn attributes(&mut self) -> &mut Attributes {
        &mut self.attributes
    }
}

impl Attributed for FusedHit {
    fn attributes(&mut self) -> &mut Attributes {
        &mut self.attributes
    }
}

pub(crate) async fn limited<T, F, Searched>(
    per: Option<&Per>,
    include: &[String],
    top_k: usize,
    offset: usize,
    search: F,
) -> Result<Vec<T>>
where
    T: Attributed,
    F: Fn(usize, Vec<String>) -> Searched,
    Searched: Future<Output = Result<Vec<T>>>,
{
    let wanted = top_k + offset;
    let Some(per) = per else {
        let hits = search(wanted, include.to_vec()).await?;
        return Ok(hits.into_iter().skip(offset).collect());
    };
    if per.limit == 0 {
        return Ok(Vec::new());
    }
    let mut with = include.to_vec();
    with.extend(
        per.attributes
            .iter()
            .filter(|a| !include.contains(a))
            .cloned(),
    );
    let mut k = wanted.max(1) * 4;
    loop {
        let hits = search(k, with.clone()).await?;
        let done = hits.len() < k;
        let mut counts: HashMap<Vec<u8>, usize> = HashMap::new();
        let mut kept = Vec::new();
        for mut hit in hits {
            let attributes = hit.attributes();
            let values: Vec<_> = per.attributes.iter().map(|n| attributes.get(n)).collect();
            let key = postcard::to_stdvec(&values).unwrap_or_default();
            let count = counts.entry(key).or_default();
            if *count == per.limit {
                continue;
            }
            *count += 1;
            hit.attributes().retain(|name, _| include.contains(name));
            kept.push(hit);
            if kept.len() == wanted {
                break;
            }
        }
        if kept.len() == wanted || done {
            return Ok(kept.into_iter().skip(offset).collect());
        }
        k *= 4;
    }
}
