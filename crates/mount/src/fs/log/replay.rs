//! Replays changes another mount of the branch kept, by path.

use std::io;
use std::time::{Duration, UNIX_EPOCH};

use super::Op;
use crate::fs::state::NodeKind;
use crate::fs::{BranchFs, Ino, ROOT, Rename, SetAttr, errno};

impl BranchFs {
    pub async fn replay(&self, ops: Vec<Op>) -> usize {
        let mut failed = 0;
        for op in ops {
            if let Err(error) = self.apply(&op).await {
                tracing::warn!(mount = %self.name, ?error, "can't replay a logged change");
                failed += 1;
            }
        }
        failed
    }

    async fn apply(&self, op: &Op) -> io::Result<()> {
        match op {
            Op::Write { path, offset, data } => {
                let ino = self.find(path).await?;
                self.write(ino, *offset, data).await.map(drop)
            }
            Op::Size { path, size } => {
                let ino = self.find(path).await?;
                let size = Some(*size);
                self.setattr(
                    ino,
                    SetAttr {
                        size,
                        ..SetAttr::default()
                    },
                )
                .await
                .map(drop)
            }
            Op::Attr {
                path,
                mode,
                modified_ns,
            } => {
                let ino = self.find(path).await?;
                let modified = modified_ns.map(|ns| UNIX_EPOCH + Duration::from_nanos(ns));
                let changes = SetAttr {
                    mode: *mode,
                    modified,
                    ..SetAttr::default()
                };
                self.setattr(ino, changes).await.map(drop)
            }
            Op::Create { path, mode } => {
                let (parent, name) = self.find_parent(path).await?;
                let ino = self.create(parent, name, *mode, None).await?.ino;
                self.forget(ino, 1);
                Ok(())
            }
            Op::Mkdir { path, mode } => {
                let (parent, name) = self.find_parent(path).await?;
                let ino = self.mkdir(parent, name, *mode, None).await?.ino;
                self.forget(ino, 1);
                Ok(())
            }
            Op::Symlink { path, target } => {
                let (parent, name) = self.find_parent(path).await?;
                let ino = self.symlink(parent, name, target, None).await?.ino;
                self.forget(ino, 1);
                Ok(())
            }
            Op::Link { from, to } => {
                let ino = self.find(from).await?;
                let (parent, name) = self.find_parent(to).await?;
                self.link(ino, parent, name).await?;
                self.forget(ino, 1);
                Ok(())
            }
            Op::Unlink { path } => {
                let (parent, name) = self.find_parent(path).await?;
                self.unlink(parent, name).await
            }
            Op::Rmdir { path } => {
                let (parent, name) = self.find_parent(path).await?;
                self.rmdir(parent, name).await
            }
            Op::Rename { from, to, exchange } => {
                let (parent, name) = self.find_parent(from).await?;
                let (new_parent, new_name) = self.find_parent(to).await?;
                let how = if *exchange {
                    Rename::Exchange
                } else {
                    Rename::Replace
                };
                self.rename(parent, name, new_parent, new_name, how).await
            }
        }
    }

    async fn find(&self, path: &str) -> io::Result<Ino> {
        let mut ino = ROOT;
        for name in path.split('/').filter(|name| !name.is_empty()) {
            self.load(ino).await?;
            ino = self.state().child(ino, name)?;
        }
        Ok(ino)
    }

    async fn find_parent<'a>(&self, path: &'a str) -> io::Result<(Ino, &'a str)> {
        let (dir, name) = path.rsplit_once('/').unwrap_or(("", path));
        let parent = self.find(dir).await?;
        if !matches!(self.state().node(parent)?.kind, NodeKind::Dir(_)) {
            return Err(errno(libc::ENOTDIR));
        }
        Ok((parent, name))
    }
}
