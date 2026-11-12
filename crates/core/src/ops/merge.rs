//! Three-way merge: combines two trees using the tree they both came from.

use std::collections::BTreeSet;
use std::sync::Arc;

use crate::ops::files;
use crate::{Entry, Hash, Objects, Result, Tree, Trees};

const TEXT_MAX: u64 = 4 * 1024 * 1024;

pub(crate) struct Sides<'a> {
    pub base: &'a Trees,
    pub ours: &'a Trees,
    pub theirs: &'a Trees,
}

pub(crate) async fn merge(
    objects: &Objects,
    sides: &Sides<'_>,
    base: Option<Hash>,
    ours: Hash,
    theirs: Hash,
) -> Result<(Hash, Vec<String>)> {
    let mut conflicts = Vec::new();
    let tree = merge_dir(objects, sides, base, ours, theirs, "", &mut conflicts).await?;
    Ok((tree, conflicts))
}

async fn merge_dir(
    objects: &Objects,
    sides: &Sides<'_>,
    base: Option<Hash>,
    ours: Hash,
    theirs: Hash,
    prefix: &str,
    conflicts: &mut Vec<String>,
) -> Result<Hash> {
    if ours == theirs || base == Some(theirs) {
        return Ok(ours);
    }
    if base == Some(ours) {
        return Ok(theirs);
    }
    let base_tree = async {
        match base {
            Some(base) => sides.base.get(base).await,
            None => Ok(Arc::new(Tree::new())),
        }
    };
    let (b, o, t) = futures::try_join!(base_tree, sides.ours.get(ours), sides.theirs.get(theirs))?;
    let names: BTreeSet<&String> = b.keys().chain(o.keys()).chain(t.keys()).collect();
    let mut merged = Tree::new();
    for name in names {
        let path = format!("{prefix}{name}");
        let (b, o, t) = (b.get(name), o.get(name), t.get(name));
        let entry = if same(o, t) || same(b, t) {
            o.cloned()
        } else if same(b, o) {
            t.cloned()
        } else {
            match (o, t) {
                (Some(Entry::Dir { tree: o }), Some(Entry::Dir { tree: t })) => {
                    let b = match b {
                        Some(Entry::Dir { tree }) => Some(*tree),
                        _ => None,
                    };
                    let path = format!("{path}/");
                    let tree =
                        Box::pin(merge_dir(objects, sides, b, *o, *t, &path, conflicts)).await?;
                    Some(Entry::Dir { tree })
                }
                (Some(o), Some(t)) => match merge_file(objects, b, o, t).await? {
                    Some(entry) => Some(entry),
                    None => {
                        conflicts.push(path);
                        Some(o.clone())
                    }
                },
                _ => {
                    conflicts.push(path);
                    o.cloned()
                }
            }
        };
        if let Some(entry) = entry {
            merged.insert(name.clone(), entry);
        }
    }
    sides.ours.add(merged)
}

fn same(a: Option<&Entry>, b: Option<&Entry>) -> bool {
    match (a, b) {
        (Some(a), Some(b)) => a.same_content(b),
        (a, b) => a.is_none() && b.is_none(),
    }
}

async fn merge_file(
    objects: &Objects,
    base: Option<&Entry>,
    ours: &Entry,
    theirs: &Entry,
) -> Result<Option<Entry>> {
    let (
        Entry::File {
            mode: o, data: od, ..
        },
        Entry::File {
            mode: t, data: td, ..
        },
    ) = (ours, theirs)
    else {
        return Ok(None);
    };
    let (b, bd) = match base {
        Some(Entry::File { mode, data, .. }) => (Some(*mode), Some(data)),
        _ => (None, None),
    };
    let Some(mode) = three_way(b, *o, *t) else {
        return Ok(None);
    };
    let kept = if od == td || bd == Some(td) {
        Some(ours)
    } else if bd == Some(od) {
        Some(theirs)
    } else {
        None
    };
    if let Some(Entry::File {
        size,
        modified_ns,
        data,
        ..
    }) = kept
    {
        return Ok(Some(Entry::File {
            size: *size,
            modified_ns: *modified_ns,
            mode,
            data: data.clone(),
        }));
    }
    let (Some(ours_text), Some(theirs_text)) =
        (text(objects, ours).await?, text(objects, theirs).await?)
    else {
        return Ok(None);
    };
    let base_text = match base {
        Some(base) => match text(objects, base).await? {
            Some(text) => text,
            None => return Ok(None),
        },
        None => Vec::new(),
    };
    let Ok(merged) = diffy::merge_bytes(&base_text, &ours_text, &theirs_text) else {
        return Ok(None);
    };
    files::store(objects, &merged, mode).await.map(Some)
}

fn three_way<T: PartialEq>(base: Option<T>, ours: T, theirs: T) -> Option<T> {
    if ours == theirs || base.as_ref() == Some(&theirs) {
        Some(ours)
    } else if base.as_ref() == Some(&ours) {
        Some(theirs)
    } else {
        None
    }
}

async fn text(objects: &Objects, entry: &Entry) -> Result<Option<Vec<u8>>> {
    let Entry::File { size, data, .. } = entry else {
        return Ok(None);
    };
    if *size > TEXT_MAX {
        return Ok(None);
    }
    let bytes = files::read(objects, data, 0, *size).await?;
    Ok((!bytes.contains(&0)).then_some(bytes))
}
