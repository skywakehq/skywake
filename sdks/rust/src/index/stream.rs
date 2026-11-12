//! Lists read a page at a time, and exports read a line at a time.

use futures::stream::{self, Stream, StreamExt, TryStreamExt};

use super::request::BATCH;
use crate::{Document, Error, Result};

/// Every item of a list, one page at a time. `get_page(key)` gives the items
/// of the page at `key` (the first at None) and the key of the next page,
/// None after the last.
pub(super) fn pages<'a, T, F, Page>(get_page: F) -> impl Stream<Item = Result<T>> + 'a
where
    T: 'a,
    F: Fn(Option<String>) -> Page + 'a,
    Page: Future<Output = Result<(Vec<T>, Option<String>)>> + 'a,
{
    // None once the last page is in.
    stream::try_unfold(Some(None), move |key: Option<Option<String>>| {
        let page = key.map(&get_page);
        async move {
            let Some(page) = page else {
                return Ok::<_, Error>(None);
            };
            let (items, next) = page.await?;
            Ok(Some((
                stream::iter(items.into_iter().map(Ok::<T, Error>)),
                next.map(Some),
            )))
        }
    })
    .try_flatten()
}

/// Every item of a list whose pages start after the key of an item, until
/// a short page. `get_page(after)` gives the page after the key `after`.
pub(super) fn every<'a, T, F, Page>(
    get_page: F,
    key: fn(&T) -> String,
) -> impl Stream<Item = Result<T>> + 'a
where
    T: 'a,
    F: Fn(Option<String>) -> Page + 'a,
    Page: Future<Output = Result<Vec<T>>> + 'a,
{
    pages(move |after| {
        let page = get_page(after);
        async move {
            let items = page.await?;
            let next = (items.len() == BATCH).then(|| items.last().map(key));
            Ok((items, next.flatten()))
        }
    })
}

/// The documents of a stream of JSON lines.
pub(super) fn lines<B: AsRef<[u8]>>(
    bytes: impl Stream<Item = reqwest::Result<B>> + Send + 'static,
) -> impl Stream<Item = Result<Document>> {
    stream::try_unfold(
        (Box::pin(bytes), Vec::new()),
        |(mut bytes, mut buffer)| async move {
            loop {
                if let Some(end) = buffer.iter().position(|&b| b == b'\n') {
                    let line: Vec<u8> = buffer.drain(..=end).collect();
                    if line.trim_ascii().is_empty() {
                        continue;
                    }
                    return Ok(Some((serde_json::from_slice(&line)?, (bytes, buffer))));
                }
                match bytes.next().await.transpose()? {
                    Some(chunk) => buffer.extend_from_slice(chunk.as_ref()),
                    None if buffer.trim_ascii().is_empty() => return Ok(None),
                    None => {
                        let document = serde_json::from_slice(&std::mem::take(&mut buffer))?;
                        return Ok(Some((document, (bytes, buffer))));
                    }
                }
            }
        },
    )
}
