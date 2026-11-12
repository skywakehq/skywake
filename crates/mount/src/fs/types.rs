//! The types of the filesystem's API, shared by every transport.

use std::time::SystemTime;

pub type Ino = u64;
pub const ROOT: Ino = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    File,
    Dir,
    Symlink,
    Fifo,
    Socket,
    CharDevice,
    BlockDevice,
}

#[derive(Debug, Clone)]
pub struct Attr {
    pub ino: Ino,
    pub kind: Kind,
    pub size: u64,
    pub mode: u32,
    pub nlink: u32,
    pub uid: Option<u32>,
    pub gid: Option<u32>,
    pub rdev: u32,
    pub modified: SystemTime,
    pub accessed: SystemTime,
    pub changed: SystemTime,
}

#[derive(Debug, Clone)]
pub struct DirEntry {
    pub name: String,
    pub ino: Ino,
    pub kind: Kind,
    pub offset: u64,
}

#[derive(Debug, Clone, Default)]
pub struct SetAttr {
    pub mode: Option<u32>,
    pub uid: Option<u32>,
    pub gid: Option<u32>,
    pub size: Option<u64>,
    pub modified: Option<SystemTime>,
    pub accessed: Option<SystemTime>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rename {
    Replace,
    NoReplace,
    Exchange,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SetXattr {
    Always,
    Create,
    Replace,
}
