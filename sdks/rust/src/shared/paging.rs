use futures::stream::{self, BoxStream, StreamExt, TryStreamExt};
use serde::Deserialize;
use serde::de::DeserializeOwned;

use super::http::{Http, Params};
use crate::{Error, Result};

pub type List<T> = BoxStream<'static, Result<T>>;

#[derive(Deserialize)]
pub(crate) struct Page<T> {
    pub data: Vec<T>,
    pub next: Option<String>,
}

pub(crate) fn pages<T>(http: Http, path: String, params: Params) -> List<T>
where
    T: DeserializeOwned + Send + 'static,
{
    stream::try_unfold(Some(None), move |cursor: Option<Option<String>>| {
        let (http, path, mut params) = (http.clone(), path.clone(), params.clone());
        async move {
            let Some(cursor) = cursor else {
                return Ok::<_, Error>(None);
            };
            params.extend(cursor.map(|cursor| ("cursor", cursor)));
            let page: Page<T> = http.get(&path, params).await?;
            let items = stream::iter(page.data.into_iter().map(Ok::<T, Error>));
            Ok(Some((items, page.next.map(Some))))
        }
    })
    .try_flatten()
    .boxed()
}

pub(crate) async fn collect<T>(list: List<T>) -> Result<Vec<T>> {
    list.try_collect().await
}
