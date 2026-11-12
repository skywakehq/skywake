//! The filesystem of a mounted branch, for any transport.

mod attrs;
mod file;
mod log;
mod names;
mod overlay;
mod prefetch;
mod save;
mod state;
mod types;

pub use log::{Op, Ops};
pub use save::{Save, Snapshot};
use std::io;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
pub use types::{Attr, DirEntry, Ino, Kind, ROOT, Rename, SetAttr, SetXattr};

use skywake_core::{Hash, IGNORE_FILE, Objects, Trees, parse_ignored};
use tokio::sync::{RwLock, RwLockReadGuard, Semaphore};

use skywake_core::cache::ChunkCache;
use state::{Children, Dir, Garbage, LocalBytes, Node, NodeKind, State};
const READ_AHEADS: usize = 64;
const PREFETCHES: usize = 32;

pub struct BranchFs {
    objects: Objects,
    trees: Trees,
    cache: Arc<ChunkCache>,
    name: String,
    state: Mutex<State>,
    saving: tokio::sync::Mutex<()>,
    open_files: Mutex<std::collections::HashMap<u64, Arc<std::fs::File>>>,
    read_ahead: Arc<Semaphore>,
    prefetching: Arc<Semaphore>,
    read_only: AtomicBool,
    local: LocalBytes,
    writes: RwLock<()>,
    sliced: Mutex<std::collections::HashSet<Hash>>,
    walked: prefetch::Walked,
}

impl BranchFs {
    pub fn new(
        objects: Objects,
        cache: Arc<ChunkCache>,
        scratch: PathBuf,
        root: Hash,
        trees: Trees,
    ) -> io::Result<Self> {
        std::fs::create_dir_all(&scratch)?;
        Ok(Self {
            objects,
            trees,
            cache,
            name: scratch.display().to_string(),
            state: Mutex::new(State::new(scratch, root)),
            saving: tokio::sync::Mutex::default(),
            open_files: Mutex::default(),
            read_ahead: Arc::new(Semaphore::new(READ_AHEADS)),
            prefetching: Arc::new(Semaphore::new(PREFETCHES)),
            read_only: AtomicBool::new(false),
            local: LocalBytes::new(0),
            writes: RwLock::new(()),
            sliced: Mutex::default(),
            walked: prefetch::Walked::default(),
        })
    }

    pub fn with_local_limit(mut self, bytes: u64) -> Self {
        self.local = LocalBytes::new(bytes);
        self
    }

    pub fn local_bytes(&self) -> u64 {
        self.local.used()
    }

    pub fn with_name(mut self, name: impl Into<String>) -> Self {
        self.name = name.into();
        self
    }

    pub fn set_read_only(&self) {
        self.read_only.store(true, Ordering::Relaxed);
    }

    pub fn set_moved(&self) {
        self.set_read_only();
        metrics::counter!("skywake_mount_moved_total").increment(1);
        tracing::warn!(mount = %self.name, "the branch moved to another machine; read-only now");
    }

    pub async fn stop_writes(&self) {
        self.set_read_only();
        drop(self.writes.write().await);
    }

    fn writable(&self) -> io::Result<RwLockReadGuard<'_, ()>> {
        let gate = self.writes.try_read().map_err(|_| errno(libc::EROFS))?;
        if self.read_only.load(Ordering::Relaxed) {
            return Err(errno(libc::EROFS));
        }
        Ok(gate)
    }

    fn state(&self) -> MutexGuard<'_, State> {
        lock(&self.state)
    }

    pub fn getattr(&self, ino: Ino) -> io::Result<Attr> {
        Ok(self.state().node(ino)?.attr(ino))
    }

    pub async fn ignored(&self) -> io::Result<Vec<String>> {
        const MAX_SIZE: u64 = 64 * 1024;
        const MAX_RULES: usize = 1000;
        fn normalise(rule: String) -> Option<String> {
            if !rule.contains('/') {
                return (rule != "." && rule != "..").then_some(rule);
            }
            let parts: Vec<&str> = rule
                .split('/')
                .filter(|part| !part.is_empty() && *part != ".")
                .collect();
            if parts.is_empty() || parts.contains(&"..") {
                return None;
            }
            Some(format!("/{}", parts.join("/")))
        }

        self.load(ROOT).await?;
        let file = self.state().child(ROOT, IGNORE_FILE);
        let text = match file {
            Ok(ino) => match self.getattr(ino)? {
                attr if attr.kind != Kind::File => None,
                attr if attr.size > MAX_SIZE => {
                    tracing::warn!(mount = %self.name, size = attr.size, "{IGNORE_FILE} is over 64 KiB; using the default rules");
                    None
                }
                attr => Some(self.read(ino, 0, attr.size as u32).await?),
            },
            Err(error) if error.raw_os_error() == Some(libc::ENOENT) => None,
            Err(error) => return Err(error),
        };
        let text = text.map(|bytes| String::from_utf8_lossy(&bytes).into_owned());
        let mut rules: Vec<String> = parse_ignored(text.as_deref())
            .into_iter()
            .filter_map(normalise)
            .collect();
        if rules.len() > MAX_RULES {
            tracing::warn!(mount = %self.name, rules = rules.len(), "{IGNORE_FILE} has over 1,000 rules; using the first 1,000");
            rules.truncate(MAX_RULES);
        }
        Ok(rules)
    }

    async fn load(&self, ino: Ino) -> io::Result<()> {
        let tree = {
            let state = self.state();
            let dir = state.dir(ino)?;
            if dir.children.is_some() {
                return Ok(());
            }
            dir.tree
        };
        let entries = match tree {
            Some(tree) => {
                let entries = self.trees.get(tree).await.map_err(io::Error::other)?;
                self.prefetch(tree);
                entries
            }
            None => Default::default(),
        };
        let mut state = self.state();
        let state = &mut *state;
        match state.dir(ino) {
            Ok(Dir { children: None, .. }) => {}
            _ => return Ok(()),
        }
        let path = state.path(ino)?;
        let mut children = Children::default();
        for (name, entry) in entries.iter() {
            let child_path = if path.is_empty() {
                name.clone()
            } else {
                format!("{path}/{name}")
            };
            let child = state.path_ino(&child_path);
            let node = Node::from_entry(entry.clone(), ino, name);
            let is_dir = matches!(node.kind, NodeKind::Dir(_));
            if !is_dir {
                state.names.insert(child, (ino, name.clone()));
            }
            children.insert(name, child, is_dir);
            state.nodes.insert(child, node);
        }
        state.dir_mut(ino)?.children = Some(children);
        Ok(())
    }

    fn dispose(&self, garbage: Garbage) {
        self.local.give_back(garbage.bytes);
        let scratch_paths: Vec<PathBuf> = {
            let state = self.state();
            garbage
                .scratch
                .iter()
                .map(|&scratch| state.scratch_path(scratch))
                .collect()
        };
        for scratch in garbage.scratch {
            self.close_scratch(scratch);
        }
        for path in scratch_paths.iter().chain(&garbage.paths) {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn errno(code: i32) -> io::Error {
    io::Error::from_raw_os_error(code)
}
