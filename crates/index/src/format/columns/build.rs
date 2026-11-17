use std::collections::HashMap;
use std::sync::Arc;

use futures::{StreamExt, TryStreamExt, stream};

use super::Columns;
use super::writer::{Old, Writer, covers};
use crate::filter::attrs::Attrs;
use crate::format::Ann;
use crate::format::cluster::ClusterRef;
use crate::store::{PARALLELISM, Storage, Written};
use crate::{Error, Id, Result, Schema};

pub(crate) struct Base<'a> {
    pub ann: &'a Ann,
    pub columns: &'a Columns,
}

pub(crate) async fn build(
    storage: &Storage,
    schema: &Schema,
    ann: &Ann,
    base: Option<Base<'_>>,
    written: &mut Written,
) -> Result<Columns> {
    let (first, column) = (schema.vectors.iter().next())
        .ok_or_else(|| Error::Corrupt("clustered columns need a vector column".into()))?;
    let dims = column.dims;
    let table = clusters(storage, ann, first).await?;
    let base = base.filter(|base| covers(base.columns, schema));
    let (old, at) = match &base {
        Some(base) => {
            let old = Old::load(storage, base.columns).await?;
            let at: HashMap<_, _> = (clusters(storage, base.ann, first).await?.iter())
                .enumerate()
                .map(|(i, cluster)| (cluster.hash, i))
                .collect();
            (Some(old), at)
        }
        None => (None, HashMap::new()),
    };
    let sample: Arc<Attrs> = storage.get(ann.filters).await?;
    let mut writer = Writer::new(storage, schema, Some(&sample.columns), old.as_ref());
    let mut read = stream::iter(table)
        .map(|cluster| {
            let kept = at.get(&cluster.hash).copied();
            async move {
                match kept {
                    Some(at) => Ok::<_, Error>(Page::Kept(at)),
                    None => {
                        let (codes, attrs) = storage.codes_and_attrs(&cluster, dims).await?;
                        Ok(Page::Read(codes.ids.clone(), attrs))
                    }
                }
            }
        })
        .buffered(PARALLELISM);
    while let Some(page) = read.try_next().await? {
        match page {
            Page::Kept(at) => writer.keep(at),
            Page::Read(ids, attrs) => writer.add(&ids, &attrs.columns, written).await?,
        }
    }
    drop(read);
    writer.finish(Vec::new(), ann.live, written).await
}

enum Page {
    Kept(usize),
    Read(Vec<Id>, Arc<Attrs>),
}

async fn clusters(storage: &Storage, ann: &Ann, first: &str) -> Result<Vec<ClusterRef>> {
    let clusters = (ann.columns.get(first))
        .ok_or_else(|| Error::Corrupt(format!("no clusters for `{first}`")))?;
    let table = clusters.table.open::<ClusterRef>(storage).await?;
    Ok(table.iter().cloned().collect())
}
