//! Hedged reads: a GET that runs well past the recent median is sent again, and the first answer wins.

use std::collections::VecDeque;
use std::fmt;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use async_trait::async_trait;
use futures::future::{self, Either};
use futures::stream::BoxStream;
use object_store::path::Path;
use object_store::{
    CopyOptions, GetOptions, GetResult, ListResult, MultipartUpload, ObjectMeta, ObjectStore,
    PutMultipartOptions, PutOptions, PutPayload, PutResult, RenameOptions, Result,
};

const SEEN: usize = 256;
const WARM: usize = 16;
const FLOOR: Duration = Duration::from_millis(20);
const SLOWER: u32 = 3;
const HEDGES: usize = 8;

#[derive(Debug)]
pub(crate) struct Hedged {
    inner: Arc<dyn ObjectStore>,
    seen: Mutex<VecDeque<Duration>>,
    hedging: AtomicUsize,
}

struct Hedge<'a>(&'a AtomicUsize);

impl Drop for Hedge<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::Relaxed);
    }
}

impl Hedged {
    pub(crate) fn new(inner: Arc<dyn ObjectStore>) -> Self {
        Self {
            inner,
            seen: Mutex::new(VecDeque::with_capacity(SEEN)),
            hedging: AtomicUsize::new(0),
        }
    }

    fn hedge(&self) -> Option<Hedge<'_>> {
        let taken = self.hedging.fetch_add(1, Ordering::Relaxed);
        let hedge = Hedge(&self.hedging);
        (taken < HEDGES).then_some(hedge)
    }

    fn after(&self) -> Option<Duration> {
        let seen = self.seen.lock().unwrap_or_else(PoisonError::into_inner);
        if seen.len() < WARM {
            return None;
        }
        let mut sorted: Vec<Duration> = seen.iter().copied().collect();
        let middle = sorted.len() / 2;
        let (_, median, _) = sorted.select_nth_unstable(middle);
        Some((*median * SLOWER).max(FLOOR))
    }

    fn record(&self, took: Duration) {
        let mut seen = self.seen.lock().unwrap_or_else(PoisonError::into_inner);
        if seen.len() == SEEN {
            seen.pop_front();
        }
        seen.push_back(took);
    }
}

impl fmt::Display for Hedged {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}, hedged", self.inner)
    }
}

#[async_trait]
impl ObjectStore for Hedged {
    async fn put_opts(
        &self,
        location: &Path,
        payload: PutPayload,
        opts: PutOptions,
    ) -> Result<PutResult> {
        self.inner.put_opts(location, payload, opts).await
    }

    async fn put_multipart_opts(
        &self,
        location: &Path,
        opts: PutMultipartOptions,
    ) -> Result<Box<dyn MultipartUpload>> {
        self.inner.put_multipart_opts(location, opts).await
    }

    async fn get_opts(&self, location: &Path, options: GetOptions) -> Result<GetResult> {
        let started = Instant::now();
        let first = self.inner.get_opts(location, options.clone());
        let got = match self.after() {
            None => first.await,
            Some(after) => {
                let first = std::pin::pin!(first);
                let timer = std::pin::pin!(tokio::time::sleep(after));
                match future::select(first, timer).await {
                    Either::Left((got, _)) => got,
                    Either::Right((_, first)) => match self.hedge() {
                        None => first.await,
                        Some(_hedge) => {
                            let second = std::pin::pin!(self.inner.get_opts(location, options));
                            match future::select(first, second).await {
                                Either::Left((Err(_), second)) => second.await,
                                Either::Right((Err(_), first)) => first.await,
                                Either::Left((got, _)) | Either::Right((got, _)) => got,
                            }
                        }
                    },
                }
            }
        };
        if got.is_ok() {
            self.record(started.elapsed());
        }
        got
    }

    fn delete_stream(
        &self,
        locations: BoxStream<'static, Result<Path>>,
    ) -> BoxStream<'static, Result<Path>> {
        self.inner.delete_stream(locations)
    }

    fn list(&self, prefix: Option<&Path>) -> BoxStream<'static, Result<ObjectMeta>> {
        self.inner.list(prefix)
    }

    fn list_with_offset(
        &self,
        prefix: Option<&Path>,
        offset: &Path,
    ) -> BoxStream<'static, Result<ObjectMeta>> {
        self.inner.list_with_offset(prefix, offset)
    }

    async fn list_with_delimiter(&self, prefix: Option<&Path>) -> Result<ListResult> {
        self.inner.list_with_delimiter(prefix).await
    }

    async fn copy_opts(&self, from: &Path, to: &Path, options: CopyOptions) -> Result<()> {
        self.inner.copy_opts(from, to, options).await
    }

    async fn rename_opts(&self, from: &Path, to: &Path, options: RenameOptions) -> Result<()> {
        self.inner.rename_opts(from, to, options).await
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use object_store::memory::InMemory;
    use object_store::{ObjectStoreExt, PutPayload};

    use super::*;

    #[derive(Debug)]
    struct Stall {
        inner: InMemory,
        calls: AtomicUsize,
        stall: usize,
        slow: Option<Duration>,
        fail: Option<usize>,
    }

    impl fmt::Display for Stall {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            write!(f, "stall")
        }
    }

    #[async_trait]
    impl ObjectStore for Stall {
        async fn put_opts(
            &self,
            location: &Path,
            payload: PutPayload,
            opts: PutOptions,
        ) -> Result<PutResult> {
            self.inner.put_opts(location, payload, opts).await
        }

        async fn put_multipart_opts(
            &self,
            location: &Path,
            opts: PutMultipartOptions,
        ) -> Result<Box<dyn MultipartUpload>> {
            self.inner.put_multipart_opts(location, opts).await
        }

        async fn get_opts(&self, location: &Path, options: GetOptions) -> Result<GetResult> {
            let call = self.calls.fetch_add(1, Ordering::SeqCst);
            if call == self.stall {
                match self.slow {
                    Some(slow) => tokio::time::sleep(slow).await,
                    None => future::pending::<()>().await,
                }
            }
            if Some(call) == self.fail {
                return Err(object_store::Error::Generic {
                    store: "stall",
                    source: "refused".into(),
                });
            }
            tokio::time::sleep(Duration::from_millis(2)).await;
            self.inner.get_opts(location, options).await
        }

        fn delete_stream(
            &self,
            locations: BoxStream<'static, Result<Path>>,
        ) -> BoxStream<'static, Result<Path>> {
            self.inner.delete_stream(locations)
        }

        fn list(&self, prefix: Option<&Path>) -> BoxStream<'static, Result<ObjectMeta>> {
            self.inner.list(prefix)
        }

        async fn list_with_delimiter(&self, prefix: Option<&Path>) -> Result<ListResult> {
            self.inner.list_with_delimiter(prefix).await
        }

        async fn copy_opts(&self, from: &Path, to: &Path, options: CopyOptions) -> Result<()> {
            self.inner.copy_opts(from, to, options).await
        }
    }

    #[tokio::test]
    async fn a_stalled_get_is_answered_by_its_hedge() {
        let stall = Arc::new(Stall {
            inner: InMemory::new(),
            calls: AtomicUsize::new(0),
            stall: WARM,
            slow: None,
            fail: None,
        });
        let hedged = Hedged::new(stall.clone());
        let path = Path::from("object");
        hedged
            .put(&path, PutPayload::from_static(b"bytes"))
            .await
            .unwrap();
        for _ in 0..=WARM {
            let got = hedged.get(&path).await.unwrap().bytes().await.unwrap();
            assert_eq!(got.as_ref(), b"bytes");
        }
        assert_eq!(stall.calls.load(Ordering::SeqCst), WARM + 2);
    }

    #[tokio::test]
    async fn a_failed_hedge_waits_for_the_slow_answer() {
        let stall = Arc::new(Stall {
            inner: InMemory::new(),
            calls: AtomicUsize::new(0),
            stall: WARM,
            slow: Some(Duration::from_millis(80)),
            fail: Some(WARM + 1),
        });
        let hedged = Hedged::new(stall.clone());
        let path = Path::from("object");
        hedged
            .put(&path, PutPayload::from_static(b"bytes"))
            .await
            .unwrap();
        for _ in 0..=WARM {
            let got = hedged.get(&path).await.unwrap().bytes().await.unwrap();
            assert_eq!(got.as_ref(), b"bytes");
        }
        assert_eq!(stall.calls.load(Ordering::SeqCst), WARM + 2);
    }

    #[tokio::test]
    async fn no_hedge_before_enough_reads_are_seen() {
        let hedged = Hedged::new(Arc::new(InMemory::new()));
        assert_eq!(hedged.after(), None);
        for _ in 0..WARM {
            hedged.record(Duration::from_millis(1));
        }
        assert_eq!(hedged.after(), Some(FLOOR));
        for _ in 0..SEEN {
            hedged.record(Duration::from_millis(50));
        }
        assert_eq!(hedged.after(), Some(Duration::from_millis(150)));
    }
}
