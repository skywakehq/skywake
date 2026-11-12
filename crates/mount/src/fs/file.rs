//! File contents: stored chunks, small files in memory, changed files on local disk.

use std::io;
use std::os::unix::fs::FileExt;
use std::sync::Arc;
use std::time::SystemTime;

use skywake_core::cache::{InBundle, Source};
use skywake_core::{Bundled, Chunk, Hash, INLINE_MAX};
use tokio::sync::RwLockWriteGuard;
use tokio::time::Instant;

use super::log::Op;
use super::overlay::{Overlay, read_up_to};
use super::state::{Content, InHead, NodeKind, stored};
use super::{BranchFs, Ino, errno, lock};

const READ_AHEAD_CHUNKS: usize = 16;
const SLICED_MAX: usize = 100_000;

const OPEN_FILES: usize = 256;

type Locked<'a> = RwLockWriteGuard<'a, Option<Overlay>>;

impl BranchFs {
    pub async fn read(&self, ino: Ino, offset: u64, size: u32) -> io::Result<Vec<u8>> {
        let len = u64::from(size);
        loop {
            match self.content(ino)? {
                Content::Stored {
                    size: total,
                    chunks,
                    bundled,
                } => {
                    let end = total.min(offset.saturating_add(len));
                    return self.read_stored(&chunks, bundled, offset, end).await;
                }
                Content::Inline(bytes) => {
                    let start = (offset as usize).min(bytes.len());
                    let end = (start + size as usize).min(bytes.len());
                    return Ok(bytes[start..end].to_vec());
                }
                Content::Local { .. } => {
                    let lock = self.state().file_lock(ino)?;
                    let overlay = lock.read().await;
                    let Content::Local { size, scratch } = self.content(ino)? else {
                        continue;
                    };
                    let file = self.scratch_file(scratch)?;
                    if let Some(overlay) = overlay.as_ref() {
                        return overlay.read(&file, offset, len, size);
                    }
                    let end = size.min(offset.saturating_add(len));
                    let mut buffer = vec![0; end.saturating_sub(offset) as usize];
                    let read = read_up_to(&file, &mut buffer, offset)?;
                    buffer.truncate(read);
                    return Ok(buffer);
                }
            }
        }
    }

    pub async fn write(&self, ino: Ino, offset: u64, data: &[u8]) -> io::Result<u32> {
        let _write = self.writable()?;
        let lock = self.state().changing_file(ino)?;
        let mut overlay = lock.write().await;
        let written = self.write_data(ino, offset, data, &mut overlay).await?;
        // Logged while the file is still locked, so the log keeps the order writes landed in.
        self.state().record_file(ino, |path| Op::Write {
            path,
            offset,
            data: data.to_vec(),
        });
        Ok(written)
    }

    async fn write_data(
        &self,
        ino: Ino,
        offset: u64,
        data: &[u8],
        overlay: &mut Locked<'_>,
    ) -> io::Result<u32> {
        let end = offset
            .checked_add(data.len() as u64)
            .ok_or_else(|| errno(libc::EFBIG))?;
        let (start, end_index) = (offset as usize, end as usize);
        if end <= INLINE_MAX
            && self.change_inline(ino, |bytes| {
                if bytes.len() < end_index {
                    bytes.resize(end_index, 0);
                }
                bytes[start..end_index].copy_from_slice(data);
            })?
        {
            return Ok(data.len() as u32);
        }
        let (old_size, scratch) = self.make_local(ino, u64::MAX).await?;
        let grow = end.saturating_sub(old_size);
        self.take_local(grow).await?;
        let written = self.write_local(ino, scratch, overlay, |file, overlay| match overlay {
            Some(overlay) => overlay.write(offset, data),
            None => file.write_all_at(data, offset),
        });
        let mut state = self.state();
        let node = match (written, state.nodes.get_mut(&ino)) {
            (Ok(()), Some(node)) => node,
            (result, _) => {
                self.local.give_back(grow);
                return result.and(Err(errno(libc::ENOENT)));
            }
        };
        if let NodeKind::File(Content::Local { size, .. }) = &mut node.kind {
            *size = (*size).max(end);
            let size = *size;
            self.local.settle(node, size, grow);
        }
        state.saved.remove(&ino);
        let node = state.node_mut(ino)?;
        let now = SystemTime::now();
        node.modified = now;
        node.changed = now;
        state.touch(ino);
        Ok(data.len() as u32)
    }

    pub(super) async fn resize(&self, ino: Ino, size: u64) -> io::Result<()> {
        let lock = self.state().changing_file(ino)?;
        let mut overlay = lock.write().await;
        self.resize_data(ino, size, &mut overlay).await?;
        self.state()
            .record_file(ino, |path| Op::Size { path, size });
        Ok(())
    }

    async fn resize_data(&self, ino: Ino, size: u64, overlay: &mut Locked<'_>) -> io::Result<()> {
        if size <= INLINE_MAX {
            if let Content::Stored {
                chunks, bundled, ..
            } = self.content(ino)?
            {
                let mut bytes = self.read_stored(&chunks, bundled, 0, size).await?;
                bytes.resize(size as usize, 0);
                self.set_inline(ino, bytes)?;
                return Ok(());
            }
            if self.change_inline(ino, |bytes| bytes.resize(size as usize, 0))? {
                return Ok(());
            }
        }
        let (old_size, scratch) = self.make_local(ino, size).await?;
        let grow = size.saturating_sub(old_size);
        self.take_local(grow).await?;
        let changed = self.write_local(ino, scratch, overlay, |file, overlay| match overlay {
            Some(overlay) => {
                overlay.truncate(size);
                Ok(())
            }
            None => file.set_len(size),
        });
        let mut state = self.state();
        let node = match (changed, state.nodes.get_mut(&ino)) {
            (Ok(()), Some(node)) => node,
            (result, _) => {
                self.local.give_back(grow);
                return result.and(Err(errno(libc::ENOENT)));
            }
        };
        node.kind = NodeKind::File(Content::Local { size, scratch });
        self.local.settle(node, size, grow);
        state.saved.remove(&ino);
        let node = state.node_mut(ino)?;
        let now = SystemTime::now();
        node.modified = now;
        node.changed = now;
        state.touch(ino);
        Ok(())
    }

    fn write_local(
        &self,
        ino: Ino,
        scratch: u64,
        overlay: &mut Locked<'_>,
        change: impl FnOnce(&std::fs::File, Option<&mut Overlay>) -> io::Result<()>,
    ) -> io::Result<()> {
        let file = self.scratch_file(scratch)?;
        let (frozen, size, path) = {
            let state = self.state();
            let size = match &state.node(ino)?.kind {
                NodeKind::File(Content::Local { size, .. }) => *size,
                _ => 0,
            };
            let path = state.scratch_path(scratch).with_extension("overlay");
            (state.frozen.contains(&ino), size, path)
        };
        if !frozen {
            return change(&file, None);
        }
        if overlay.is_none() {
            **overlay = Some(Overlay::new(path, size)?);
        }
        change(&file, overlay.as_mut())
    }

    fn change_inline(&self, ino: Ino, change: impl FnOnce(&mut Vec<u8>)) -> io::Result<bool> {
        let Content::Inline(bytes) = self.content(ino)? else {
            return Ok(false);
        };
        let mut changed = bytes.to_vec();
        change(&mut changed);
        self.set_inline(ino, changed)?;
        Ok(true)
    }

    fn set_inline(&self, ino: Ino, bytes: Vec<u8>) -> io::Result<()> {
        let (path, on_disk) = {
            let state = self.state();
            (state.inline_copy_path(ino), state.node(ino)?.on_disk)
        };
        let len = bytes.len() as u64;
        let grow = len.saturating_sub(on_disk);
        self.local.take(grow)?;
        let written = std::fs::write(path, &bytes);
        let mut state = self.state();
        let node = match (written, state.nodes.get_mut(&ino)) {
            (Ok(()), Some(node)) => node,
            (result, _) => {
                self.local.give_back(grow);
                return result.and(Err(errno(libc::ENOENT)));
            }
        };
        self.local.settle(node, len, grow);
        node.kind = NodeKind::File(Content::Inline(bytes.into()));
        let now = SystemTime::now();
        node.modified = now;
        node.changed = now;
        state.touch(ino);
        Ok(())
    }

    async fn make_local(&self, ino: Ino, limit: u64) -> io::Result<(u64, u64)> {
        let content = self.content(ino)?;
        if let Content::Local { size, scratch } = content {
            return Ok((size, scratch));
        }
        let copy = match &content {
            Content::Inline(bytes) => bytes.len() as u64,
            Content::Stored { size, .. } => *size,
            Content::Local { .. } => unreachable!(),
        }
        .min(limit);
        self.take_local(copy).await?;
        let (scratch, path) = {
            let mut state = self.state();
            state.next_scratch += 1;
            let scratch = state.next_scratch;
            (scratch, state.scratch_path(scratch))
        };
        // A bundled file's chunk is not at `chunks/<hash>`, so a save can't reuse it by hash.
        if let Content::Stored {
            chunks,
            bundled: None,
            ..
        } = &content
        {
            let chunks = chunks.iter().map(|(_, chunk)| chunk.hash).collect();
            let in_head = InHead {
                chunks: Arc::new(chunks),
                at: Instant::now(),
            };
            self.state().in_head.insert(ino, in_head);
        }
        let copied = async {
            let file = std::fs::File::create_new(&path)?;
            let mut copied = 0;
            match &content {
                Content::Inline(bytes) => {
                    let bytes = &bytes[..bytes.len().min(limit as usize)];
                    file.write_all_at(bytes, 0)?;
                    copied = bytes.len() as u64;
                }
                Content::Stored { chunks, .. } => {
                    for (start, chunk) in chunks.iter().take_while(|(start, _)| *start < limit) {
                        let len = u64::from(chunk.size).min(limit - start);
                        let data = self
                            .cache
                            .read(&self.objects, chunk.hash, 0, len as usize)
                            .await?;
                        file.write_all_at(&data, *start)?;
                        copied = start + data.len() as u64;
                    }
                }
                Content::Local { .. } => unreachable!(),
            }
            Ok::<_, io::Error>(copied)
        }
        .await;
        let size = match copied {
            Ok(size) => size,
            Err(error) => {
                self.local.give_back(copy);
                let _ = std::fs::remove_file(&path);
                return Err(error);
            }
        };
        let inline_copy = {
            let mut state = self.state();
            let Ok(node) = state.node_mut(ino) else {
                self.local.give_back(copy);
                return Err(errno(libc::ENOENT));
            };
            node.kind = NodeKind::File(Content::Local { size, scratch });
            self.local.settle(node, size, copy);
            state.inline_copy_path(ino)
        };
        let _ = std::fs::remove_file(inline_copy);
        Ok((size, scratch))
    }

    pub(super) async fn reclaim_scratch(&self, idle: std::time::Duration) {
        let candidates: Vec<_> = {
            let mut state = self.state();
            let idle: Vec<Ino> = state
                .saved
                .iter()
                .filter(|(ino, saved)| {
                    saved.at.elapsed() >= idle
                        && !state.changed.contains_key(ino)
                        && !state.frozen.contains(ino)
                })
                .map(|(&ino, _)| ino)
                .collect();
            idle.into_iter()
                .filter_map(|ino| Some((ino, state.file_lock(ino).ok()?)))
                .collect()
        };
        for (ino, lock) in candidates {
            let Ok(_held) = lock.try_write() else {
                continue;
            };
            let reclaimable = |state: &super::state::State| {
                if state.changed.contains_key(&ino) || state.frozen.contains(&ino) {
                    return None;
                }
                let saved = state.saved.get(&ino)?;
                match state.node(ino).ok()?.kind {
                    NodeKind::File(Content::Local { scratch, .. }) => {
                        Some((scratch, saved.data.clone()))
                    }
                    _ => None,
                }
            };
            let Some((scratch, data)) = reclaimable(&self.state()) else {
                continue;
            };
            self.cache_chunks(scratch, data.chunks());
            {
                let mut state = self.state();
                if reclaimable(&state).is_none_or(|(now, _)| now != scratch) {
                    continue;
                }
                state.saved.remove(&ino);
                if let Ok(node) = state.node_mut(ino) {
                    node.kind = NodeKind::File(stored(&data));
                    self.local.settle(node, 0, 0);
                }
            }
            self.close_scratch(scratch);
            let _ = std::fs::remove_file(self.state().scratch_path(scratch));
        }
    }

    async fn take_local(&self, bytes: u64) -> io::Result<()> {
        if self.local.take(bytes).is_ok() {
            return Ok(());
        }
        if let Ok(_saving) = self.saving.try_lock() {
            self.reclaim_scratch(std::time::Duration::ZERO).await;
        }
        self.local.take(bytes)
    }

    fn cache_chunks(&self, scratch: u64, chunks: &[Chunk]) {
        let Ok(file) = self.scratch_file(scratch) else {
            return;
        };
        let mut start = 0;
        for chunk in chunks {
            let mut bytes = vec![0; chunk.size as usize];
            if file.read_exact_at(&mut bytes, start).is_err() {
                return;
            }
            if let Err(error) = self.cache.insert(chunk.hash, &bytes) {
                tracing::debug!(hash = %chunk.hash, %error, "can't keep a saved chunk in the cache");
            }
            start += u64::from(chunk.size);
        }
    }

    pub(super) async fn read_stored(
        &self,
        chunks: &[(u64, Chunk)],
        bundled: Option<Bundled>,
        offset: u64,
        end: u64,
    ) -> io::Result<Vec<u8>> {
        let in_bundle = bundled.map(|at| InBundle {
            objects: self.objects.clone(),
            at,
        });
        let source: &dyn Source = match &in_bundle {
            Some(in_bundle) => in_bundle,
            None => &self.objects,
        };
        let mut data = Vec::with_capacity(end.saturating_sub(offset) as usize);
        let first =
            chunks.partition_point(|(start, chunk)| start + u64::from(chunk.size) <= offset);
        let mut next = first;
        let mut sliced = false;
        for (start, chunk) in &chunks[first..] {
            if *start >= end {
                break;
            }
            let from = offset.max(*start) - start;
            let to = end.min(start + u64::from(chunk.size)) - start;
            let len = (to - from) as usize;
            data.extend(match self.read_part(source, chunk, from, len).await {
                Some(part) => {
                    sliced = true;
                    part
                }
                None => self.cache.read(source, chunk.hash, from, len).await?,
            });
            next += 1;
        }
        let ahead = if sliced { 0 } else { READ_AHEAD_CHUNKS };
        for (_, chunk) in chunks.iter().skip(next).take(ahead) {
            let Ok(permit) = self.read_ahead.clone().try_acquire_owned() else {
                break;
            };
            let (cache, objects, hash) = (self.cache.clone(), self.objects.clone(), chunk.hash);
            tokio::spawn(async move {
                let _ = cache.fetch(&objects, hash).await;
                drop(permit);
            });
        }
        Ok(data)
    }

    async fn read_part(
        &self,
        source: &dyn Source,
        chunk: &Chunk,
        from: u64,
        len: usize,
    ) -> Option<Vec<u8>> {
        if len as u64 > u64::from(chunk.size) / 4 || !self.first_slice(chunk.hash) {
            return None;
        }
        self.cache.read_slice(source, chunk.hash, from, len).await
    }

    fn first_slice(&self, hash: Hash) -> bool {
        let mut sliced = lock(&self.sliced);
        if sliced.len() >= SLICED_MAX {
            sliced.clear();
        }
        sliced.insert(hash)
    }

    pub(super) fn content(&self, ino: Ino) -> io::Result<Content> {
        match &self.state().node(ino)?.kind {
            NodeKind::File(content) => Ok(content.clone()),
            NodeKind::Dir(_) => Err(errno(libc::EISDIR)),
            _ => Err(errno(libc::EINVAL)),
        }
    }

    fn scratch_file(&self, scratch: u64) -> io::Result<Arc<std::fs::File>> {
        let path = self.state().scratch_path(scratch);
        let mut open = super::lock(&self.open_files);
        if let Some(file) = open.get(&scratch) {
            return Ok(file.clone());
        }
        if open.len() >= OPEN_FILES {
            open.clear();
        }
        let file = Arc::new(std::fs::File::options().read(true).write(true).open(path)?);
        open.insert(scratch, file.clone());
        Ok(file)
    }

    pub(super) fn close_scratch(&self, scratch: u64) {
        super::lock(&self.open_files).remove(&scratch);
    }
}
