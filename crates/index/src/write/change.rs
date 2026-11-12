//! Writes that depend on what is there: patches, conditions, writes by filter.

use std::collections::{BTreeMap, HashMap, HashSet};

use super::{append, check, encode_deletes, encode_docs, store};
use crate::read::live;
use crate::store::Storage;
use crate::{Attributes, Condition, Doc, Error, Filter, Id, Index, Result, Schema, Value, invalid};

const ATTEMPTS: usize = 8;

pub type Changes = BTreeMap<String, Option<Value>>;

#[derive(Clone, Debug)]
pub struct Patch {
    pub id: Id,
    pub changes: Changes,
}

#[derive(Clone, Debug, Default)]
pub struct Write {
    pub upserts: Vec<Doc>,
    pub patches: Vec<Patch>,
    pub deletes: Vec<Id>,
    pub upsert_if: Option<Condition>,
    pub patch_if: Option<Condition>,
    pub delete_if: Option<Condition>,
    pub delete_by: Option<Filter>,
    pub patch_by: Option<(Filter, Changes)>,
    pub return_ids: bool,
    /// Counts and returns only the deleted ids that were there, at the cost
    /// of looking each one up. Off, every id in `deletes` counts.
    pub exact_deletes: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Counts {
    pub upserted: usize,
    pub patched: usize,
    pub deleted: usize,
    /// With `exact_deletes`: deletes of ids that were not there, not counted
    /// in `deleted`.
    pub missing: usize,
    pub ids: Option<Affected>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Affected {
    pub upserted: Vec<Id>,
    pub patched: Vec<Id>,
    pub deleted: Vec<Id>,
}

impl Counts {
    pub(crate) fn add(self, other: Counts) -> Counts {
        let ids = match (self.ids, other.ids) {
            (Some(mut a), Some(b)) => {
                a.upserted.extend(b.upserted);
                a.patched.extend(b.patched);
                a.deleted.extend(b.deleted);
                Some(a)
            }
            (a, b) => a.or(b),
        };
        Counts {
            upserted: self.upserted + other.upserted,
            patched: self.patched + other.patched,
            deleted: self.deleted + other.deleted,
            missing: self.missing + other.missing,
            ids,
        }
    }
}

impl Index {
    pub async fn write(&self, mut write: Write) -> Result<Counts> {
        let schema = self.writable().await?;
        for doc in &mut write.upserts {
            check(&schema, doc)?;
        }
        for patch in &mut write.patches {
            patch.id = schema
                .id
                .check(std::mem::replace(&mut patch.id, Id::Num(0)))?;
        }
        let deletes = std::mem::take(&mut write.deletes).into_iter();
        write.deletes = deletes
            .map(|id| schema.id.check(id))
            .collect::<Result<_>>()?;
        let patches = write.patches.iter().map(|p| &p.changes);
        for changes in patches.chain(write.patch_by.as_ref().map(|(_, c)| c)) {
            check_changes(&schema, changes)?;
        }
        for attempt in 0..ATTEMPTS {
            let _alone = self.writer.alone().await;
            let version = self.storage.current(&self.branch).await?;
            let plan = plan(&self.storage, &version, &schema, &write).await?;
            let mut blobs = encode_deletes(&plan.first)?;
            blobs.extend(encode_docs(&schema, &plan.docs)?);
            blobs.extend(encode_deletes(&plan.last)?);
            if blobs.is_empty() {
                return Ok(plan.counts);
            }
            let (written, stored) = store(&self.storage, blobs).await?;
            let seq = version.next_seq;
            let moved = (self.storage)
                .save(&self.branch, &written, |current| {
                    (current.next_seq == seq).then(|| append(current, &stored))
                })
                .await?;
            if moved {
                self.writer.written.notify_one();
                return Ok(plan.counts);
            }
            crate::store::head::backoff(attempt as u32).await;
        }
        Err(Error::Conflict(self.branch.clone()))
    }

    pub async fn patch(&self, patches: Vec<Patch>) -> Result<Counts> {
        self.write(Write {
            patches,
            ..Write::default()
        })
        .await
    }

    pub async fn delete_by(&self, filter: Filter) -> Result<Counts> {
        self.write(Write {
            delete_by: Some(filter),
            ..Write::default()
        })
        .await
    }
}

struct Plan {
    first: Vec<Id>,
    docs: Vec<Doc>,
    last: Vec<Id>,
    counts: Counts,
}

async fn plan(
    storage: &Storage,
    version: &crate::format::Version,
    schema: &Schema,
    write: &Write,
) -> Result<Plan> {
    let mut first = Vec::new();
    if let Some(filter) = &write.delete_by {
        let filter = filter.typed(schema)?;
        live::each(storage, version, Some(&filter), |id, _| {
            first.push(id.clone())
        })
        .await?;
    }
    let gone: HashSet<&Id> = first.iter().collect();
    let mut by_patch = Vec::new();
    if let Some((filter, _)) = &write.patch_by {
        let filter = filter.typed(schema)?;
        live::each(storage, version, Some(&filter), |id, _| {
            if !gone.contains(id) {
                by_patch.push(id.clone());
            }
        })
        .await?;
    }

    let mut wanted: Vec<Id> = by_patch.clone();
    wanted.extend(write.patches.iter().map(|p| p.id.clone()));
    if write.upsert_if.is_some() {
        wanted.extend(write.upserts.iter().map(|d| d.id.clone()));
    }
    if write.delete_if.is_some() || write.exact_deletes {
        wanted.extend(write.deletes.iter().cloned());
    }
    let mut current = live::fetch(storage, version, &wanted).await?;
    current.retain(|id, _| !gone.contains(id));
    let empty = Attributes::new();
    let before = |id: &Id| current.get(id).map_or(&empty, |doc| &doc.attributes);
    let passes = |condition: &Option<Condition>, new: &Attributes, id: &Id| -> Result<bool> {
        match condition {
            None => Ok(true),
            Some(condition) => Ok(condition
                .resolve(new)
                .typed(schema)?
                .matches(id, before(id))),
        }
    };

    let mut counts = Counts {
        deleted: first.len(),
        ..Counts::default()
    };
    let mut ids = write.return_ids.then(|| Affected {
        deleted: first.clone(),
        ..Affected::default()
    });
    let mut note = |list: fn(&mut Affected) -> &mut Vec<Id>, id: &Id| {
        if let Some(ids) = &mut ids {
            list(ids).push(id.clone());
        }
    };
    let mut made: HashMap<Id, Doc> = HashMap::new();
    let mut docs = Vec::new();
    if let Some((_, changes)) = &write.patch_by {
        for id in &by_patch {
            if let Some(doc) = current.get(id) {
                let doc = patched(schema, doc, changes)?;
                made.insert(id.clone(), doc.clone());
                docs.push(doc);
                counts.patched += 1;
                note(|ids| &mut ids.patched, id);
            }
        }
    }
    for doc in &write.upserts {
        if passes(&write.upsert_if, &doc.attributes, &doc.id)? {
            made.insert(doc.id.clone(), doc.clone());
            docs.push(doc.clone());
            counts.upserted += 1;
            note(|ids| &mut ids.upserted, &doc.id);
        }
    }
    for patch in &write.patches {
        let Some(base) = made.get(&patch.id).or_else(|| current.get(&patch.id)) else {
            continue;
        };
        let new: Attributes = (patch.changes.iter())
            .filter_map(|(name, value)| Some((name.clone(), value.clone()?)))
            .collect();
        if !passes(&write.patch_if, &new, &patch.id)? {
            continue;
        }
        let doc = patched(schema, base, &patch.changes)?;
        made.insert(patch.id.clone(), doc.clone());
        docs.push(doc);
        counts.patched += 1;
        note(|ids| &mut ids.patched, &patch.id);
    }
    let mut last = Vec::new();
    for id in &write.deletes {
        let exists = current.contains_key(id) || made.contains_key(id);
        if write.delete_if.is_none() || (exists && passes(&write.delete_if, &empty, id)?) {
            // A missing id is still written down as deleted, so a delete
            // still wins over a write that lands at the same time.
            last.push(id.clone());
            if exists || !write.exact_deletes {
                counts.deleted += 1;
                note(|ids| &mut ids.deleted, id);
            } else {
                counts.missing += 1;
            }
        }
    }
    counts.ids = ids;
    Ok(Plan {
        first,
        docs,
        last,
        counts,
    })
}

fn patched(schema: &Schema, doc: &Doc, changes: &Changes) -> Result<Doc> {
    let mut doc = doc.clone();
    for (name, value) in changes {
        match value {
            Some(value) => doc.attributes.insert(name.clone(), value.clone()),
            None => doc.attributes.remove(name),
        };
    }
    check(schema, &mut doc)?;
    Ok(doc)
}

fn check_changes(schema: &Schema, changes: &Changes) -> Result<()> {
    for (name, value) in changes {
        let kind = schema.kind(name)?;
        if let Some(value) = value
            && value.clone().to_kind(kind).is_none()
        {
            return Err(invalid(format!("`{name}` must be {kind:?}")));
        }
    }
    Ok(())
}
