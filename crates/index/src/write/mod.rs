//! The write path, with group commit.

pub(crate) mod change;
pub(crate) mod merge;

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, PoisonError};

use futures::{StreamExt, TryStreamExt, stream};
use tokio::sync::oneshot::error::TryRecvError;
use tokio::sync::{Notify, oneshot};

use crate::format::{BLOB_MAX, Segment, SegmentRef, Version, pack};
use crate::store::{PARALLELISM, Storage, Written};
use crate::vector::ivf;
use crate::{Doc, Element, Id, Metric, Result, Schema, invalid};

pub(crate) enum Op {
    Upsert(Vec<Doc>),
    Delete(Vec<Id>),
}

impl Op {
    fn rows(&self) -> usize {
        match self {
            Op::Upsert(docs) => docs.len(),
            Op::Delete(ids) => ids.len(),
        }
    }
}

pub(crate) struct Writer {
    waiting: Mutex<VecDeque<Waiting>>,
    turn: tokio::sync::Mutex<()>,
    tickets: AtomicU64,
    max_rows: usize,
    max_queued: usize,
    pub written: Notify,
}

struct Waiting {
    ticket: u64,
    op: Op,
    done: oneshot::Sender<Result<()>>,
}

impl Writer {
    pub(crate) fn new(max_rows: usize, max_queued: usize) -> Self {
        Self {
            waiting: Mutex::default(),
            turn: tokio::sync::Mutex::new(()),
            tickets: AtomicU64::new(0),
            max_rows: max_rows.max(1),
            max_queued,
            written: Notify::new(),
        }
    }

    pub(crate) async fn alone(&self) -> tokio::sync::MutexGuard<'_, ()> {
        self.turn.lock().await
    }

    pub(crate) async fn write(
        &self,
        storage: &Storage,
        branch: &str,
        schema: &Schema,
        op: Op,
    ) -> Result<()> {
        let ticket = self.tickets.fetch_add(1, Ordering::Relaxed);
        let (done, mut result) = oneshot::channel();
        {
            let mut queue = self.queue();
            let queued: usize = queue.iter().map(|waiting| waiting.op.rows()).sum();
            if queued > 0 && queued + op.rows() > self.max_queued {
                return Err(crate::Error::Busy(format!(
                    "{queued} rows are waiting to be stored on index branch `{branch}`; try again soon"
                )));
            }
            queue.push_back(Waiting { ticket, op, done });
        }
        loop {
            let _turn = self.turn.lock().await;
            match result.try_recv() {
                Ok(result) => return result,
                Err(TryRecvError::Closed) => return Err(cancelled()),
                Err(TryRecvError::Empty) => {}
            }
            let batch = self.take();
            let (ops, waiters): (Vec<Op>, Vec<_>) = batch
                .into_iter()
                .map(|waiting| (waiting.op, (waiting.ticket, waiting.done)))
                .unzip();
            let stored = commit(storage, branch, schema, ops).await;
            if stored.is_ok() {
                self.written.notify_one();
            }
            let mut mine = None;
            for (other, done) in waiters {
                match other == ticket {
                    true => mine = Some(done),
                    false => {
                        let _ = done.send(stored.as_ref().map_err(|e| e.copy()).copied());
                    }
                }
            }
            if mine.is_some() {
                return stored;
            }
        }
    }

    fn take(&self) -> Vec<Waiting> {
        let mut queue = self.queue();
        let mut batch = Vec::new();
        let mut rows = 0;
        while let Some(next) = queue.front() {
            if !batch.is_empty() && rows + next.op.rows() > self.max_rows {
                break;
            }
            rows += next.op.rows();
            batch.extend(queue.pop_front());
        }
        batch
    }

    fn queue(&self) -> std::sync::MutexGuard<'_, VecDeque<Waiting>> {
        self.waiting.lock().unwrap_or_else(PoisonError::into_inner)
    }

    #[cfg(test)]
    pub fn queued(&self) -> usize {
        self.queue().len()
    }
}

fn cancelled() -> crate::Error {
    crate::Error::Store(object_store::Error::Generic {
        store: "skywake-index",
        source: "the write was stored with another that was cancelled; it may not have landed"
            .into(),
    })
}

async fn commit(storage: &Storage, branch: &str, schema: &Schema, ops: Vec<Op>) -> Result<()> {
    let mut docs = Vec::new();
    let mut deletes = Vec::new();
    for op in ops {
        match op {
            Op::Upsert(batch) => docs.extend(batch),
            Op::Delete(ids) => deletes.extend(ids),
        }
    }
    let mut blobs = encode_docs(schema, &docs)?;
    blobs.extend(encode_deletes(&deletes)?);
    if blobs.is_empty() {
        return Ok(());
    }
    let (written, stored) = store(storage, blobs).await?;
    storage
        .save(branch, &written, |current| Some(append(current, &stored)))
        .await?;
    Ok(())
}

pub(crate) async fn store(
    storage: &Storage,
    blobs: Vec<(Vec<u8>, usize)>,
) -> Result<(Written, Vec<SegmentRef>)> {
    let mut written = Written::new();
    let stored: Vec<SegmentRef> = stream::iter(blobs)
        .map(|(bytes, rows)| async move {
            let size = bytes.len() as u64;
            let hash = storage.put(bytes).await?;
            Ok::<_, crate::Error>(SegmentRef {
                hash,
                rows: rows as u64,
                first_seq: 0,
                bytes: size,
            })
        })
        .buffered(PARALLELISM)
        .try_collect()
        .await?;
    written.chunks(stored.iter().map(|segment| segment.hash));
    Ok((written, stored))
}

pub(crate) fn append(current: &Version, stored: &[SegmentRef]) -> Version {
    let mut next = current.clone();
    for segment in stored {
        next.tail.push(SegmentRef {
            first_seq: next.next_seq,
            ..segment.clone()
        });
        next.next_seq += segment.rows;
    }
    next
}

pub(crate) fn encode_docs(schema: &Schema, docs: &[Doc]) -> Result<Vec<(Vec<u8>, usize)>> {
    let row_bytes = 64 + 4 * schema.vectors.values().map(|c| c.dims).sum::<usize>();
    pack(docs, row_bytes, &|docs| {
        let segment = Segment {
            ids: docs.iter().map(|doc| doc.id.clone()).collect(),
            vectors: schema
                .vectors
                .keys()
                .map(|name| {
                    docs.iter()
                        .flat_map(|doc| &doc.vectors[name])
                        .copied()
                        .collect()
                })
                .collect(),
            attributes: docs.iter().map(|doc| doc.attributes.clone()).collect(),
            deletes: Vec::new(),
        };
        Ok(postcard::to_stdvec(&segment)?)
    })
}

pub(crate) fn encode_deletes(ids: &[Id]) -> Result<Vec<(Vec<u8>, usize)>> {
    pack(ids, 16, &|ids| {
        let segment = Segment {
            deletes: ids.to_vec(),
            ..Segment::default()
        };
        Ok(postcard::to_stdvec(&segment)?)
    })
}

pub(crate) fn check(schema: &Schema, doc: &mut Doc) -> Result<()> {
    doc.id = schema
        .id
        .check(std::mem::replace(&mut doc.id, Id::Num(0)))?;
    let id = &doc.id;
    if let Some(name) = doc
        .vectors
        .keys()
        .find(|n| !schema.vectors.contains_key(*n))
    {
        return Err(invalid(format!("{id}: no vector column `{name}`")));
    }
    let mut bytes = 0;
    for (name, column) in &schema.vectors {
        let vector = doc
            .vectors
            .get_mut(name)
            .ok_or_else(|| invalid(format!("{id}: missing vector `{name}`")))?;
        if vector.len() != column.dims {
            return Err(invalid(format!(
                "{id}: vector `{name}` has {} dimensions, not {}",
                vector.len(),
                column.dims
            )));
        }
        if column.metric == Metric::Cosine {
            ivf::normalize(vector);
        }
        round(vector, column.element)
            .map_err(|e| invalid(format!("{id}: vector `{name}`: {e}")))?;
        bytes += 4 * vector.len();
    }
    bytes += postcard::to_stdvec(&(&doc.id, &doc.attributes))?.len();
    if bytes > BLOB_MAX {
        return Err(invalid("a document is larger than 4 MiB"));
    }
    for (name, value) in &mut doc.attributes {
        let Some(&kind) = schema.attributes.get(name) else {
            return Err(invalid(format!("{id}: no attribute `{name}`")));
        };
        let taken = std::mem::replace(value, crate::Value::Bool(false));
        *value = (taken.to_kind(kind))
            .ok_or_else(|| invalid(format!("{id}: `{name}` must be {kind:?}")))?;
    }
    Ok(())
}

fn round(vector: &mut [f32], element: Element) -> std::result::Result<(), String> {
    match element {
        Element::F32 => {}
        Element::F16 => {
            for x in vector.iter_mut() {
                *x = half::f16::from_f32(*x).to_f32();
            }
        }
        Element::I8 => {
            if let Some(x) = vector
                .iter()
                .find(|x| x.fract() != 0.0 || !(-128.0..=127.0).contains(*x))
            {
                return Err(format!("{x} is not a whole number from -128 to 127"));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;
