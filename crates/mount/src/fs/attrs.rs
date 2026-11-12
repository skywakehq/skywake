//! File attributes and extended attributes.

use std::io;
use std::time::SystemTime;

use super::log::Op;
use super::state::nanos;
use super::{Attr, BranchFs, Ino, SetAttr, SetXattr, errno};

const XATTR_SIZE_MAX: usize = 64 * 1024;

impl BranchFs {
    pub async fn setattr(&self, ino: Ino, changes: SetAttr) -> io::Result<Attr> {
        let _write = self.writable()?;
        if let Some(size) = changes.size {
            self.resize(ino, size).await?;
        }
        let mut state = self.state();
        if changes.mode.is_some() || changes.modified.is_some() {
            state.leave_branch(ino);
        }
        let node = state.node_mut(ino)?;
        if let Some(mode) = changes.mode {
            node.mode = mode & 0o7777;
        }
        if let Some(uid) = changes.uid {
            node.uid = Some(uid);
        }
        if let Some(gid) = changes.gid {
            node.gid = Some(gid);
        }
        if let Some(modified) = changes.modified {
            node.modified = modified;
        }
        if let Some(accessed) = changes.accessed {
            node.accessed = Some(accessed);
        }
        node.changed = SystemTime::now();
        let attr = node.attr(ino);
        if changes.mode.is_some() || changes.modified.is_some() {
            state.touch(ino);
            let (mode, modified_ns) = (changes.mode, changes.modified.map(nanos));
            state.record_file(ino, |path| Op::Attr {
                path,
                mode,
                modified_ns,
            });
        }
        Ok(attr)
    }

    pub fn getxattr(&self, ino: Ino, name: &[u8]) -> io::Result<Vec<u8>> {
        let state = self.state();
        let node = state.node(ino)?;
        node.xattrs
            .as_ref()
            .and_then(|xattrs| xattrs.get(name))
            .cloned()
            .ok_or_else(|| errno(libc::ENODATA))
    }

    pub fn listxattr(&self, ino: Ino) -> io::Result<Vec<u8>> {
        let state = self.state();
        let mut names = Vec::new();
        for name in state
            .node(ino)?
            .xattrs
            .iter()
            .flat_map(|xattrs| xattrs.keys())
        {
            names.extend_from_slice(name);
            names.push(0);
        }
        Ok(names)
    }

    pub fn setxattr(&self, ino: Ino, name: &[u8], value: &[u8], when: SetXattr) -> io::Result<()> {
        let _write = self.writable()?;
        check_xattr_name(name)?;
        if value.len() > XATTR_SIZE_MAX {
            return Err(errno(libc::E2BIG));
        }
        let mut state = self.state();
        let node = state.node_mut(ino)?;
        let xattrs = node.xattrs.get_or_insert_default();
        match (when, xattrs.contains_key(name)) {
            (SetXattr::Create, true) => return Err(errno(libc::EEXIST)),
            (SetXattr::Replace, false) => return Err(errno(libc::ENODATA)),
            _ => {}
        }
        xattrs.insert(name.to_vec(), value.to_vec());
        node.changed = SystemTime::now();
        Ok(())
    }

    pub fn removexattr(&self, ino: Ino, name: &[u8]) -> io::Result<()> {
        let _write = self.writable()?;
        let mut state = self.state();
        let node = state.node_mut(ino)?;
        let removed = node.xattrs.as_mut().and_then(|xattrs| xattrs.remove(name));
        if removed.is_none() {
            return Err(errno(libc::ENODATA));
        }
        if node.xattrs.as_ref().is_some_and(|xattrs| xattrs.is_empty()) {
            node.xattrs = None;
        }
        node.changed = SystemTime::now();
        Ok(())
    }
}

fn check_xattr_name(name: &[u8]) -> io::Result<()> {
    if name.is_empty() || name.len() > 255 {
        return Err(errno(libc::ERANGE));
    }
    if name.starts_with(b"system.") {
        return Err(errno(libc::EOPNOTSUPP));
    }
    Ok(())
}
