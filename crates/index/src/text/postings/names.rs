use serde::{Deserialize, Serialize};

use super::Place;
use crate::{Id, Result};

#[derive(Serialize, Deserialize)]
pub(crate) enum Names {
    Runs(Vec<(u32, u64)>),
    Blocks(Vec<Place>),
}

impl Names {
    pub(crate) fn runs(
        docs: u32,
        id: impl Fn(u32) -> Result<Id>,
    ) -> Result<Option<Vec<(u32, u64)>>> {
        let most = docs as usize / 64 + 16;
        let mut runs: Vec<(u32, u64)> = Vec::new();
        let mut next = None;
        for doc in 0..docs {
            let Id::Num(id) = id(doc)? else {
                return Ok(None);
            };
            if next != Some(id) {
                runs.push((doc, id));
                if runs.len() > most {
                    return Ok(None);
                }
            }
            next = id.checked_add(1);
        }
        Ok(Some(runs))
    }

    pub(crate) fn named(&self, doc: u32, docs: u32) -> Option<Id> {
        let Self::Runs(runs) = self else {
            return None;
        };
        let at = runs.partition_point(|run| run.0 <= doc).checked_sub(1)?;
        let (first, id) = runs[at];
        let id = id.checked_add((doc - first) as u64)?;
        (doc < docs).then_some(Id::Num(id))
    }

    pub(crate) fn len(&self) -> usize {
        match self {
            Self::Runs(runs) => runs.len(),
            Self::Blocks(blocks) => blocks.len(),
        }
    }
}
