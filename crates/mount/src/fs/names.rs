//! Names in folders: lookup, listing, create, link, remove, rename.

use std::io;
use std::sync::Arc;
use std::time::SystemTime;

use super::log::Op;
use super::state::{Children, Content, Dir, Garbage, Node, NodeKind, check_name};
use super::{Attr, BranchFs, DirEntry, Ino, Kind, Rename, errno};

const S_IFMT: u32 = 0o170000;
const S_IFIFO: u32 = 0o010000;
const S_IFCHR: u32 = 0o020000;
const S_IFBLK: u32 = 0o060000;
const S_IFREG: u32 = 0o100000;
const S_IFSOCK: u32 = 0o140000;

impl BranchFs {
    pub async fn lookup(&self, parent: Ino, name: &str) -> io::Result<Attr> {
        check_name(name)?;
        self.load(parent).await?;
        let mut state = self.state();
        let ino = state.child(parent, name)?;
        let attr = state.node(ino)?.attr(ino);
        *state.refs.entry(ino).or_default() += 1;
        Ok(attr)
    }

    pub fn forget(&self, ino: Ino, count: u64) {
        let mut garbage = Garbage::default();
        {
            let mut state = self.state();
            let Some(refs) = state.refs.get_mut(&ino) else {
                return;
            };
            *refs = refs.saturating_sub(count);
            if *refs > 0 {
                return;
            }
            state.refs.remove(&ino);
            if state.orphans.contains(&ino) {
                state.free(ino, &mut garbage);
            }
        }
        self.dispose(garbage);
    }

    pub async fn readdir(&self, ino: Ino, offset: u64, limit: usize) -> io::Result<Vec<DirEntry>> {
        self.load(ino).await?;
        let state = self.state();
        let parent = state.dir(ino)?.parent;
        let dots = [(1, ".", ino), (2, "..", parent)];
        let dots = dots.into_iter().filter(|(position, ..)| *position > offset);
        let children = state
            .children(ino)?
            .after(offset)
            .map(|(position, name, ino)| (position, name.as_str(), ino));
        dots.chain(children)
            .take(limit)
            .map(|(offset, name, ino)| {
                Ok(DirEntry {
                    name: name.to_string(),
                    ino,
                    kind: state.node(ino)?.attr(ino).kind,
                    offset,
                })
            })
            .collect()
    }

    pub fn readlink(&self, ino: Ino) -> io::Result<String> {
        match &self.state().node(ino)?.kind {
            NodeKind::Symlink(target) => Ok(target.clone()),
            _ => Err(errno(libc::EINVAL)),
        }
    }

    pub async fn create(
        &self,
        parent: Ino,
        name: &str,
        mode: u32,
        owner: Option<(u32, u32)>,
    ) -> io::Result<Attr> {
        let kind = NodeKind::File(Content::Inline(Arc::from([])));
        self.insert(parent, name, kind, mode, owner).await
    }

    pub async fn mkdir(
        &self,
        parent: Ino,
        name: &str,
        mode: u32,
        owner: Option<(u32, u32)>,
    ) -> io::Result<Attr> {
        let kind = NodeKind::Dir(Dir {
            tree: None,
            children: Some(Children::default()),
            parent,
            name: name.to_string(),
        });
        self.insert(parent, name, kind, mode, owner).await
    }

    pub async fn symlink(
        &self,
        parent: Ino,
        name: &str,
        target: &str,
        owner: Option<(u32, u32)>,
    ) -> io::Result<Attr> {
        let kind = NodeKind::Symlink(target.to_string());
        self.insert(parent, name, kind, 0o777, owner).await
    }

    pub async fn mknod(
        &self,
        parent: Ino,
        name: &str,
        mode: u32,
        rdev: u32,
        owner: Option<(u32, u32)>,
    ) -> io::Result<Attr> {
        let kind = match mode & S_IFMT {
            0 | S_IFREG => return self.create(parent, name, mode, owner).await,
            S_IFIFO => Kind::Fifo,
            S_IFSOCK => Kind::Socket,
            S_IFCHR => Kind::CharDevice,
            S_IFBLK => Kind::BlockDevice,
            _ => return Err(errno(libc::EINVAL)),
        };
        let rdev = if matches!(kind, Kind::CharDevice | Kind::BlockDevice) {
            rdev
        } else {
            0
        };
        let kind = NodeKind::Special { kind, rdev };
        self.insert(parent, name, kind, mode, owner).await
    }

    pub async fn link(&self, ino: Ino, new_parent: Ino, new_name: &str) -> io::Result<Attr> {
        let _write = self.writable()?;
        check_name(new_name)?;
        self.load(new_parent).await?;
        let mut state = self.state();
        if state.is_dir(ino) {
            return Err(errno(libc::EPERM));
        }
        if state.node(ino)?.nlink == 0 {
            return Err(errno(libc::ENOENT));
        }
        if state.children(new_parent)?.contains(new_name) {
            return Err(errno(libc::EEXIST));
        }
        let from = state.name_of(ino);
        state.attach(new_parent, new_name, ino)?;
        if state.logging() {
            let to = state.path_in(new_parent, new_name);
            state.record(from.zip(to).map(|(from, to)| Op::Link { from, to }));
        }
        let node = state.node_mut(ino)?;
        node.nlink += 1;
        node.changed = SystemTime::now();
        let attr = node.attr(ino);
        *state.refs.entry(ino).or_default() += 1;
        Ok(attr)
    }

    pub async fn unlink(&self, parent: Ino, name: &str) -> io::Result<()> {
        let _write = self.writable()?;
        self.load(parent).await?;
        let mut garbage = Garbage::default();
        {
            let mut state = self.state();
            let ino = state.child(parent, name)?;
            if state.is_dir(ino) {
                return Err(errno(libc::EISDIR));
            }
            state.detach(parent, name, &mut garbage)?;
            state.record_at(parent, name, |path| Op::Unlink { path });
        }
        self.dispose(garbage);
        Ok(())
    }

    pub async fn rmdir(&self, parent: Ino, name: &str) -> io::Result<()> {
        let _write = self.writable()?;
        self.load(parent).await?;
        let ino = self.state().child(parent, name)?;
        self.load(ino).await?;
        let mut garbage = Garbage::default();
        {
            let mut state = self.state();
            if state.child(parent, name)? != ino {
                return Err(errno(libc::ENOENT));
            }
            if !state.children(ino)?.is_empty() {
                return Err(errno(libc::ENOTEMPTY));
            }
            state.detach(parent, name, &mut garbage)?;
            state.record_at(parent, name, |path| Op::Rmdir { path });
        }
        self.dispose(garbage);
        Ok(())
    }

    pub async fn rename(
        &self,
        parent: Ino,
        name: &str,
        new_parent: Ino,
        new_name: &str,
        how: Rename,
    ) -> io::Result<()> {
        let _write = self.writable()?;
        check_name(new_name)?;
        self.load(parent).await?;
        self.load(new_parent).await?;
        let target = self.state().child(new_parent, new_name).ok();
        if let Some(target) = target
            && self.getattr(target)?.kind == Kind::Dir
        {
            self.load(target).await?;
        }

        let mut garbage = Garbage::default();
        {
            let mut state = self.state();
            let source = state.child(parent, name)?;
            let target = state.child(new_parent, new_name).ok();
            if target == Some(source) {
                return Ok(());
            }
            let paths = state
                .path_in(parent, name)
                .zip(state.path_in(new_parent, new_name));
            if state.is_dir(source) && state.is_inside(new_parent, source)? {
                return Err(errno(libc::EINVAL));
            }
            match (how, target) {
                (Rename::Exchange, None) => return Err(errno(libc::ENOENT)),
                (Rename::Exchange, Some(target)) => {
                    if state.is_dir(target) && state.is_inside(parent, target)? {
                        return Err(errno(libc::EINVAL));
                    }
                    state.children_mut(parent)?.remove(name);
                    state.children_mut(new_parent)?.remove(new_name);
                    state.attach(parent, name, target)?;
                    state.node_mut(target)?.changed = SystemTime::now();
                }
                (Rename::NoReplace, Some(_)) => return Err(errno(libc::EEXIST)),
                (_, Some(target)) => {
                    match (state.is_dir(source), state.is_dir(target)) {
                        (true, true) if !state.children(target)?.is_empty() => {
                            return Err(errno(libc::ENOTEMPTY));
                        }
                        (true, false) => return Err(errno(libc::ENOTDIR)),
                        (false, true) => return Err(errno(libc::EISDIR)),
                        _ => {}
                    }
                    state.detach(new_parent, new_name, &mut garbage)?;
                    state.children_mut(parent)?.remove(name);
                }
                (_, None) => {
                    state.children_mut(parent)?.remove(name);
                }
            }
            state.changed_entries(parent)?;
            state.attach(new_parent, new_name, source)?;
            state.node_mut(source)?.changed = SystemTime::now();
            if state.logging() {
                let exchange = how == Rename::Exchange;
                let op = paths.map(|(from, to)| Op::Rename { from, to, exchange });
                state.record(op);
            }
        }
        self.dispose(garbage);
        Ok(())
    }

    async fn insert(
        &self,
        parent: Ino,
        name: &str,
        kind: NodeKind,
        mode: u32,
        owner: Option<(u32, u32)>,
    ) -> io::Result<Attr> {
        let _write = self.writable()?;
        check_name(name)?;
        self.load(parent).await?;
        let mut state = self.state();
        if state.children(parent)?.contains(name) {
            return Err(errno(libc::EEXIST));
        }
        let ino = state.allocate();
        let node = Node::new(kind, mode, owner);
        let attr = node.attr(ino);
        state.nodes.insert(ino, node);
        state.attach(parent, name, ino)?;
        state.refs.insert(ino, 1);
        state.touch(ino);
        if state.logging() {
            let path = state.path_in(parent, name);
            let op = match &state.node(ino)?.kind {
                NodeKind::File(_) => path.map(|path| Op::Create { path, mode }),
                NodeKind::Dir(_) => path.map(|path| Op::Mkdir { path, mode }),
                NodeKind::Symlink(target) => {
                    let target = target.clone();
                    path.map(|path| Op::Symlink { path, target })
                }
                NodeKind::Special { .. } => return Ok(attr),
            };
            state.record(op);
        }
        Ok(attr)
    }
}
