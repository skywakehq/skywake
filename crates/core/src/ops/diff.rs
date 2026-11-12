use std::collections::BTreeSet;

use crate::model::Entry;
use crate::{Hash, Result, Trees};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Change {
    Added(String),
    Removed(String),
    Modified(String),
}

pub(crate) async fn diff(from: (&Trees, Hash), to: (&Trees, Hash)) -> Result<Vec<Change>> {
    let mut changes = Vec::new();
    diff_dir((from.0, to.0), from.1, to.1, "", &mut changes).await?;
    Ok(changes)
}

async fn diff_dir(
    trees: (&Trees, &Trees),
    from: Hash,
    to: Hash,
    prefix: &str,
    changes: &mut Vec<Change>,
) -> Result<()> {
    if from == to {
        return Ok(());
    }
    let (old, new) = futures::try_join!(trees.0.get(from), trees.1.get(to))?;
    let names: BTreeSet<&String> = old.keys().chain(new.keys()).collect();
    for name in names {
        let path = format!("{prefix}{name}");
        match (old.get(name), new.get(name)) {
            (Some(Entry::Dir { tree: a }), Some(Entry::Dir { tree: b })) => {
                Box::pin(diff_dir(trees, *a, *b, &format!("{path}/"), changes)).await?
            }
            (Some(a), Some(b)) if !a.same_content(b) => changes.push(Change::Modified(path)),
            (Some(_), None) => changes.push(Change::Removed(path)),
            (None, Some(_)) => changes.push(Change::Added(path)),
            _ => {}
        }
    }
    Ok(())
}
