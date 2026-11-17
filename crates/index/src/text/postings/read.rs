use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use futures::future::try_join_all;
use skywake_core::Hash;

use super::span::Span;
use super::{Directory, ID_BLOCK, Place, PostingsRef, sum, term_key};
use crate::store::{Storage, part};
use crate::text::part::{blocking, read_blob};
use crate::{Error, Id, Result};

pub(crate) async fn open(storage: &Storage, hash: Hash, bytes: u64) -> Result<Arc<Directory>> {
    let key = part(hash, "postings");
    if let Some(found) = storage.cache().get(key) {
        return Ok(found);
    }
    let raw = read_blob(storage.store.as_ref(), hash, bytes).await?;
    let directory = Arc::new(Directory::decode(&raw)?);
    (storage.cache()).insert(key, directory.clone(), directory.weight());
    Ok(directory)
}

pub(crate) async fn opened(storage: &Storage, postings: &PostingsRef) -> Result<Arc<Directory>> {
    open(storage, postings.directory, postings.directory_bytes).await
}

pub(crate) async fn span(
    storage: &Storage,
    directory: &Directory,
    field: &str,
    term: &str,
) -> Result<Option<Arc<Span>>> {
    let Some(number) = directory.field(field) else {
        return Ok(None);
    };
    let wanted = |span: &Span| span.head.field == number && span.head.term == term;
    let key = term_key(field, term);
    let from = directory.long.partition_point(|(hash, _)| *hash < key);
    for (_, place) in directory.long[from..]
        .iter()
        .take_while(|(hash, _)| *hash == key)
    {
        let found = long(storage, directory, place).await?;
        if wanted(&found) {
            return Ok(Some(found));
        }
    }
    if directory.buckets.is_empty() {
        return Ok(None);
    }
    let place = &directory.buckets[(key % directory.buckets.len() as u64) as usize];
    let spans = bucket(storage, directory, place).await?;
    Ok(spans.iter().find(|span| wanted(span)).cloned())
}

async fn bytes_at(storage: &Storage, directory: &Directory, place: &Place) -> Result<Vec<u8>> {
    let blob = directory.blob(place)?;
    let end = (place.start.checked_add(place.len))
        .ok_or_else(|| Error::Corrupt("a posting place overflows".into()))?;
    let bytes = storage.range(blob, place.start..end).await?;
    if bytes.len() as u64 != place.len {
        return Err(Error::Corrupt(format!("posting blob {blob} is cut short")));
    }
    Ok(bytes)
}

fn body(bytes: &[u8]) -> Result<&[u8]> {
    (bytes.split_first_chunk::<8>())
        .filter(|(stored, body)| u64::from_le_bytes(**stored) == sum(body))
        .map(|(_, body)| body)
        .ok_or_else(|| Error::Corrupt("a posting blob does not match its sum".into()))
}

async fn long(storage: &Storage, directory: &Directory, place: &Place) -> Result<Arc<Span>> {
    let key = part(directory.blob(place)?, &format!("span/{}", place.start));
    if let Some(found) = storage.cache().get(key) {
        return Ok(found);
    }
    let bytes = bytes_at(storage, directory, place).await?;
    let span = Arc::new(blocking(move || Span::parse(body(&bytes)?)).await??);
    storage.cache().insert(key, span.clone(), span.weight());
    Ok(span)
}

type Bucket = Vec<Arc<Span>>;

async fn bucket(storage: &Storage, directory: &Directory, place: &Place) -> Result<Arc<Bucket>> {
    if place.len == 0 {
        return Ok(Arc::default());
    }
    let key = part(directory.blob(place)?, &format!("bucket/{}", place.start));
    if let Some(found) = storage.cache().get(key) {
        return Ok(found);
    }
    let bytes = bytes_at(storage, directory, place).await?;
    let mut spans = Vec::new();
    let mut rest = body(&bytes)?;
    while let Some((len, more)) = rest.split_first_chunk::<4>() {
        let (span, more) = (more.split_at_checked(u32::from_le_bytes(*len) as usize))
            .ok_or_else(|| Error::Corrupt("a posting bucket is cut short".into()))?;
        spans.push(Arc::new(Span::parse(span)?));
        rest = more;
    }
    let weight = 64 + spans.iter().map(|span| span.weight()).sum::<usize>();
    let spans = Arc::new(spans);
    storage.cache().insert(key, spans.clone(), weight);
    Ok(spans)
}

pub(crate) async fn ids(
    storage: &Storage,
    directory: &Directory,
    docs: &[u32],
    known: &HashMap<u32, Id>,
) -> Result<Vec<Id>> {
    let missing = docs.iter().filter(|doc| !known.contains_key(doc));
    let blocks: BTreeMap<usize, ()> = missing.map(|doc| (*doc as usize / ID_BLOCK, ())).collect();
    let read = try_join_all(
        blocks
            .keys()
            .map(|&block| id_block(storage, directory, block)),
    )
    .await?;
    let read: BTreeMap<usize, Arc<Vec<Id>>> = blocks.into_keys().zip(read).collect();
    docs.iter()
        .map(|doc| {
            let (block, at) = (*doc as usize / ID_BLOCK, *doc as usize % ID_BLOCK);
            (known.get(doc).cloned())
                .or_else(|| read.get(&block)?.get(at).cloned())
                .ok_or_else(|| Error::Corrupt(format!("text document {doc} has no id")))
        })
        .collect()
}

async fn id_block(storage: &Storage, directory: &Directory, block: usize) -> Result<Arc<Vec<Id>>> {
    let place = (directory.id_blocks.get(block))
        .ok_or_else(|| Error::Corrupt(format!("a posting directory has no id block {block}")))?;
    let key = part(directory.blob(place)?, &format!("ids/{}", place.start));
    if let Some(found) = storage.cache().get(key) {
        return Ok(found);
    }
    let bytes = bytes_at(storage, directory, place).await?;
    let ids: Arc<Vec<Id>> = Arc::new(postcard::from_bytes(body(&bytes)?)?);
    storage.cache().insert(key, ids.clone(), bytes.len() + 64);
    Ok(ids)
}
