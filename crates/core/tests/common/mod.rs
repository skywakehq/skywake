//! A test store that fails, pauses and ages on request.

#![allow(dead_code)]

use std::collections::HashSet;
use std::fmt;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use futures::future::BoxFuture;
use futures::stream::{self, BoxStream};
use futures::{StreamExt, TryStreamExt};
use object_store::memory::InMemory;
use object_store::path::Path;
use object_store::{
    CopyOptions, Error, GetOptions, GetResult, ListResult, MultipartUpload, ObjectMeta,
    ObjectStore, ObjectStoreExt, PutMultipartOptions, PutOptions, PutPayload, PutResult, Result,
};
use tokio::sync::Notify;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Op {
    Put,
    Get,
    Head,
    Delete,
    List,
}

#[derive(Clone, Copy, Debug)]
pub enum Fault {
    Fail,
    TimeoutAfter,
    PreconditionAfter,
    Missing,
    Denied,
}

struct Rule {
    op: Op,
    prefix: String,
    fault: Fault,
    times: usize,
}

type Hook = Arc<dyn Fn() -> BoxFuture<'static, ()> + Send + Sync>;

struct Trigger {
    op: Op,
    prefix: String,
    times: usize,
    hook: Hook,
}

#[derive(Clone, Default)]
pub struct Gate {
    reached: Arc<Notify>,
    go: Arc<Notify>,
}

impl Gate {
    pub async fn reached(&self) {
        self.reached.notified().await;
    }

    pub async fn reached_within(&self, wait: Duration) -> bool {
        tokio::time::timeout(wait, self.reached()).await.is_ok()
    }

    pub fn open(&self) {
        self.go.notify_one();
    }
}

pub struct State {
    pub inner: Arc<InMemory>,
    rules: Mutex<Vec<Rule>>,
    triggers: Mutex<Vec<Trigger>>,
    aged: Mutex<HashSet<Path>>,
    pub put_bytes: AtomicU64,
    pub puts: AtomicU64,
}

#[derive(Clone)]
pub struct Faulty(pub Arc<State>);

const AGE: Duration = Duration::from_secs(30 * 24 * 3600);

impl Faulty {
    pub fn new() -> Self {
        Self(Arc::new(State {
            inner: Arc::new(InMemory::new()),
            rules: Mutex::default(),
            triggers: Mutex::default(),
            aged: Mutex::default(),
            put_bytes: AtomicU64::new(0),
            puts: AtomicU64::new(0),
        }))
    }

    pub fn fail(&self, op: Op, prefix: &str, fault: Fault, times: usize) {
        self.0.rules.lock().unwrap().push(Rule {
            op,
            prefix: prefix.to_string(),
            fault,
            times,
        });
    }

    pub fn gate(&self, op: Op, prefix: &str) -> Gate {
        let gate = Gate::default();
        let held = gate.clone();
        self.on(op, prefix, 1, move || {
            let gate = held.clone();
            Box::pin(async move {
                gate.reached.notify_one();
                gate.go.notified().await;
            })
        });
        gate
    }

    pub fn on(
        &self,
        op: Op,
        prefix: &str,
        times: usize,
        hook: impl Fn() -> BoxFuture<'static, ()> + Send + Sync + 'static,
    ) {
        self.0.triggers.lock().unwrap().push(Trigger {
            op,
            prefix: prefix.to_string(),
            times,
            hook: Arc::new(hook),
        });
    }

    pub async fn age_everything(&self) {
        let listing: Vec<ObjectMeta> = self.0.inner.list(None).try_collect().await.unwrap();
        let mut aged = self.0.aged.lock().unwrap();
        aged.extend(listing.into_iter().map(|meta| meta.location));
    }

    pub fn reset_counts(&self) {
        self.0.put_bytes.store(0, Ordering::Relaxed);
        self.0.puts.store(0, Ordering::Relaxed);
    }
}

impl State {
    async fn before(&self, op: Op, path: &str) -> Option<Fault> {
        let hook = {
            let mut triggers = self.triggers.lock().unwrap();
            let found = triggers
                .iter_mut()
                .find(|trigger| trigger.op == op && path.starts_with(&trigger.prefix));
            found.map(|trigger| {
                trigger.times = trigger.times.saturating_sub(1);
                trigger.hook.clone()
            })
        };
        self.triggers
            .lock()
            .unwrap()
            .retain(|trigger| trigger.times > 0);
        if let Some(hook) = hook {
            hook().await;
        }
        let mut rules = self.rules.lock().unwrap();
        let rule = rules
            .iter_mut()
            .find(|rule| rule.op == op && path.starts_with(&rule.prefix) && rule.times > 0)?;
        rule.times -= 1;
        Some(rule.fault)
    }

    fn adjust(&self, mut meta: ObjectMeta) -> ObjectMeta {
        if self.aged.lock().unwrap().contains(&meta.location) {
            meta.last_modified -= AGE;
        }
        meta
    }
}

fn failure(path: &Path, fault: Fault) -> Error {
    match fault {
        Fault::Missing => Error::NotFound {
            path: path.to_string(),
            source: "injected".into(),
        },
        Fault::PreconditionAfter => Error::Precondition {
            path: path.to_string(),
            source: "injected".into(),
        },
        Fault::Denied => Error::PermissionDenied {
            path: path.to_string(),
            source: "injected".into(),
        },
        Fault::Fail | Fault::TimeoutAfter => Error::Generic {
            store: "Faulty",
            source: "injected timeout".into(),
        },
    }
}

impl fmt::Display for Faulty {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Faulty")
    }
}

impl fmt::Debug for Faulty {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Faulty")
    }
}

#[async_trait]
impl ObjectStore for Faulty {
    async fn put_opts(
        &self,
        location: &Path,
        payload: PutPayload,
        opts: PutOptions,
    ) -> Result<PutResult> {
        let fault = self.0.before(Op::Put, location.as_ref()).await;
        if let Some(fault @ (Fault::Fail | Fault::Missing | Fault::Denied)) = fault {
            return Err(failure(location, fault));
        }
        let size = payload.content_length() as u64;
        let result = self.0.inner.put_opts(location, payload, opts).await?;
        self.0.aged.lock().unwrap().remove(location);
        self.0.put_bytes.fetch_add(size, Ordering::Relaxed);
        self.0.puts.fetch_add(1, Ordering::Relaxed);
        match fault {
            Some(fault) => Err(failure(location, fault)),
            None => Ok(result),
        }
    }

    async fn put_multipart_opts(
        &self,
        location: &Path,
        opts: PutMultipartOptions,
    ) -> Result<Box<dyn MultipartUpload>> {
        self.0.inner.put_multipart_opts(location, opts).await
    }

    async fn get_opts(&self, location: &Path, options: GetOptions) -> Result<GetResult> {
        let op = match options.head {
            true => Op::Head,
            false => Op::Get,
        };
        if let Some(fault) = self.0.before(op, location.as_ref()).await {
            return Err(failure(location, fault));
        }
        let mut result = self.0.inner.get_opts(location, options).await?;
        result.meta = self.0.adjust(result.meta);
        Ok(result)
    }

    fn delete_stream(
        &self,
        locations: BoxStream<'static, Result<Path>>,
    ) -> BoxStream<'static, Result<Path>> {
        let state = self.0.clone();
        locations
            .and_then(move |location| {
                let state = state.clone();
                async move {
                    if let Some(fault) = state.before(Op::Delete, location.as_ref()).await {
                        return Err(failure(&location, fault));
                    }
                    state.inner.delete(&location).await?;
                    Ok(location)
                }
            })
            .boxed()
    }

    fn list(&self, prefix: Option<&Path>) -> BoxStream<'static, Result<ObjectMeta>> {
        let state = self.0.clone();
        let prefix = prefix.cloned();
        stream::once(async move {
            let name = prefix.as_ref().map_or("", |prefix| prefix.as_ref());
            state.before(Op::List, name).await;
            let adjusting = state.clone();
            state
                .inner
                .list(prefix.as_ref())
                .map_ok(move |meta| adjusting.adjust(meta))
                .boxed()
        })
        .flatten()
        .boxed()
    }

    async fn list_with_delimiter(&self, prefix: Option<&Path>) -> Result<ListResult> {
        self.0.inner.list_with_delimiter(prefix).await
    }

    async fn copy_opts(&self, from: &Path, to: &Path, options: CopyOptions) -> Result<()> {
        self.0.inner.copy_opts(from, to, options).await
    }
}
