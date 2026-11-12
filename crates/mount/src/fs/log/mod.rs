//! Changes since the last save, kept by path so another machine can replay them.

mod replay;

use serde::{Deserialize, Serialize};

use super::state::State;
use super::{BranchFs, Ino};

const MAX_BYTES: usize = 64 << 20;

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub enum Op {
    Write {
        path: String,
        offset: u64,
        data: Vec<u8>,
    },
    Size {
        path: String,
        size: u64,
    },
    Attr {
        path: String,
        mode: Option<u32>,
        modified_ns: Option<u64>,
    },
    Create {
        path: String,
        mode: u32,
    },
    Mkdir {
        path: String,
        mode: u32,
    },
    Symlink {
        path: String,
        target: String,
    },
    Link {
        from: String,
        to: String,
    },
    Unlink {
        path: String,
    },
    Rmdir {
        path: String,
    },
    Rename {
        from: String,
        to: String,
        exchange: bool,
    },
}

#[derive(Default)]
pub struct Ops {
    pub ops: Vec<(u64, Op)>,
    pub lost: u64,
}

#[derive(Default)]
pub(super) struct OpLog {
    ops: Vec<(u64, Op)>,
    bytes: usize,
    lost: u64,
}

impl Op {
    fn bytes(&self) -> usize {
        match self {
            Op::Write { path, data, .. } => path.len() + data.len(),
            Op::Symlink { path, target } => path.len() + target.len(),
            Op::Link { from, to } | Op::Rename { from, to, .. } => from.len() + to.len(),
            Op::Size { path, .. }
            | Op::Attr { path, .. }
            | Op::Create { path, .. }
            | Op::Mkdir { path, .. }
            | Op::Unlink { path }
            | Op::Rmdir { path } => path.len(),
        }
    }
}

impl State {
    pub(super) fn logging(&self) -> bool {
        self.log.is_some()
    }

    pub(super) fn record(&mut self, op: Option<Op>) {
        if self.log.is_none() {
            return;
        }
        self.changes += 1;
        let tag = self.changes;
        let log = self.log.as_mut().expect("checked above");
        let Some(op) = op else {
            log.lost = tag;
            return;
        };
        log.bytes += op.bytes();
        log.ops.push((tag, op));
        if log.bytes > MAX_BYTES {
            log.ops.clear();
            log.bytes = 0;
            log.lost = tag;
        }
    }

    pub(super) fn record_file(&mut self, ino: Ino, op: impl FnOnce(String) -> Op) {
        if !self.logging() || self.nodes.get(&ino).is_none_or(|node| node.nlink == 0) {
            return;
        }
        let op = self.name_of(ino).map(op);
        self.record(op);
    }

    pub(super) fn name_of(&self, ino: Ino) -> Option<String> {
        if self.is_dir(ino) {
            return self.path(ino).ok();
        }
        let (parent, name) = self.names.get(&ino)?;
        let dir = self.path(*parent).ok()?;
        self.children(*parent)
            .ok()?
            .get(name)
            .filter(|child| *child == ino)?;
        Some(join(&dir, name))
    }

    pub(super) fn path_in(&self, parent: Ino, name: &str) -> Option<String> {
        Some(join(&self.path(parent).ok()?, name))
    }

    pub(super) fn record_at(&mut self, parent: Ino, name: &str, op: impl FnOnce(String) -> Op) {
        if self.logging() {
            let op = self.path_in(parent, name).map(op);
            self.record(op);
        }
    }

    pub(super) fn drop_ops_through(&mut self, through: u64) {
        if let Some(log) = &mut self.log {
            log.ops.retain(|(tag, _)| *tag > through);
            log.bytes = log.ops.iter().map(|(_, op)| op.bytes()).sum();
        }
    }
}

impl BranchFs {
    pub fn start_log(&self) {
        self.state().log.get_or_insert_default();
    }

    pub fn take_ops(&self) -> Ops {
        let mut state = self.state();
        let Some(log) = &mut state.log else {
            return Ops::default();
        };
        log.bytes = 0;
        Ops {
            ops: std::mem::take(&mut log.ops),
            lost: log.lost,
        }
    }
}

fn join(dir: &str, name: &str) -> String {
    match dir.is_empty() {
        true => name.to_string(),
        false => format!("{dir}/{name}"),
    }
}
