//! Answers the guest's FUSE requests with [`BranchFs`].

use std::ffi::CStr;
use std::io;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use fuse_backend_rs::abi::fuse_abi::{CreateIn, stat64, statvfs64};
use fuse_backend_rs::api::filesystem::{
    Context, DirEntry, Entry, FileSystem, FsOptions, GetxattrReply, ListxattrReply, OpenOptions,
    SetattrValid, ZeroCopyReader, ZeroCopyWriter,
};
use tokio::runtime::Handle;

use crate::transport::{
    Fsyncs, READDIR_BATCH, STATFS_BLOCKS, STATFS_FILES, TTL, os_error, rename_how, request_save,
    setxattr_when,
};
use crate::{Attr, BranchFs, Kind, SetAttr};

pub(super) struct VmFs {
    fs: Arc<BranchFs>,
    fsyncs: Fsyncs,
    runtime: Handle,
}

impl VmFs {
    pub(super) fn new(fs: Arc<BranchFs>, fsyncs: Fsyncs) -> Self {
        Self {
            fs,
            fsyncs,
            runtime: Handle::current(),
        }
    }

    fn entry(&self, ctx: &Context, attr: io::Result<Attr>) -> io::Result<Entry> {
        let attr = attr.map_err(eio)?;
        Ok(Entry {
            inode: attr.ino,
            generation: 0,
            attr: stat(ctx, &attr),
            attr_flags: 0,
            attr_timeout: TTL,
            entry_timeout: TTL,
        })
    }

    fn run<T>(&self, work: impl Future<Output = io::Result<T>>) -> io::Result<T> {
        self.runtime.block_on(work).map_err(eio)
    }
}

impl FileSystem for VmFs {
    type Inode = u64;
    type Handle = u64;

    fn init(&self, capable: FsOptions) -> io::Result<FsOptions> {
        Ok(capable
            & (FsOptions::PARALLEL_DIROPS
                | FsOptions::MAX_PAGES
                | FsOptions::ZERO_MESSAGE_OPEN
                | FsOptions::ZERO_MESSAGE_OPENDIR))
    }

    fn lookup(&self, ctx: &Context, parent: u64, name: &CStr) -> io::Result<Entry> {
        let attr = self.run(self.fs.lookup(parent, utf8(name)?));
        self.entry(ctx, attr)
    }

    fn forget(&self, _ctx: &Context, inode: u64, count: u64) {
        self.fs.forget(inode, count);
    }

    fn batch_forget(&self, _ctx: &Context, requests: Vec<(u64, u64)>) {
        for (inode, count) in requests {
            self.fs.forget(inode, count);
        }
    }

    fn getattr(
        &self,
        ctx: &Context,
        inode: u64,
        _handle: Option<u64>,
    ) -> io::Result<(stat64, Duration)> {
        let attr = self.fs.getattr(inode).map_err(eio)?;
        Ok((stat(ctx, &attr), TTL))
    }

    fn setattr(
        &self,
        ctx: &Context,
        inode: u64,
        attr: stat64,
        _handle: Option<u64>,
        valid: SetattrValid,
    ) -> io::Result<(stat64, Duration)> {
        let mode = valid.contains(SetattrValid::MODE).then_some(attr.st_mode);
        let uid = valid.contains(SetattrValid::UID).then_some(attr.st_uid);
        let gid = valid.contains(SetattrValid::GID).then_some(attr.st_gid);
        let size = valid
            .contains(SetattrValid::SIZE)
            .then_some(attr.st_size as u64);
        let time = |now, set, secs: i64, nanos: i64| {
            if valid.contains(now) {
                Some(SystemTime::now())
            } else if valid.contains(set) {
                Some(UNIX_EPOCH + Duration::new(secs as u64, nanos as u32))
            } else {
                None
            }
        };
        let modified = time(
            SetattrValid::MTIME_NOW,
            SetattrValid::MTIME,
            attr.st_mtime,
            attr.st_mtime_nsec,
        );
        let accessed = time(
            SetattrValid::ATIME_NOW,
            SetattrValid::ATIME,
            attr.st_atime,
            attr.st_atime_nsec,
        );
        let changes = SetAttr {
            mode,
            uid,
            gid,
            size,
            modified,
            accessed,
        };
        let attr = self.run(self.fs.setattr(inode, changes))?;
        Ok((stat(ctx, &attr), TTL))
    }

    fn readlink(&self, _ctx: &Context, inode: u64) -> io::Result<Vec<u8>> {
        Ok(self.fs.readlink(inode).map_err(eio)?.into_bytes())
    }

    fn symlink(&self, ctx: &Context, target: &CStr, parent: u64, name: &CStr) -> io::Result<Entry> {
        let attr = self.run(
            self.fs
                .symlink(parent, utf8(name)?, utf8(target)?, owner(ctx)),
        );
        self.entry(ctx, attr)
    }

    fn mkdir(
        &self,
        ctx: &Context,
        parent: u64,
        name: &CStr,
        mode: u32,
        umask: u32,
    ) -> io::Result<Entry> {
        let attr = self.run(
            self.fs
                .mkdir(parent, utf8(name)?, mode & !umask, owner(ctx)),
        );
        self.entry(ctx, attr)
    }

    fn mknod(
        &self,
        ctx: &Context,
        parent: u64,
        name: &CStr,
        mode: u32,
        rdev: u32,
        umask: u32,
    ) -> io::Result<Entry> {
        let mode = mode & !(umask & 0o7777);
        let attr = self.run(self.fs.mknod(parent, utf8(name)?, mode, rdev, owner(ctx)));
        self.entry(ctx, attr)
    }

    fn link(
        &self,
        ctx: &Context,
        inode: u64,
        new_parent: u64,
        new_name: &CStr,
    ) -> io::Result<Entry> {
        let attr = self.run(self.fs.link(inode, new_parent, utf8(new_name)?));
        self.entry(ctx, attr)
    }

    fn unlink(&self, _ctx: &Context, parent: u64, name: &CStr) -> io::Result<()> {
        self.run(self.fs.unlink(parent, utf8(name)?))
    }

    fn rmdir(&self, _ctx: &Context, parent: u64, name: &CStr) -> io::Result<()> {
        self.run(self.fs.rmdir(parent, utf8(name)?))
    }

    fn rename(
        &self,
        _ctx: &Context,
        parent: u64,
        name: &CStr,
        new_parent: u64,
        new_name: &CStr,
        flags: u32,
    ) -> io::Result<()> {
        let (name, new_name) = (utf8(name)?, utf8(new_name)?);
        let how = rename_how(flags)?;
        self.run(self.fs.rename(parent, name, new_parent, new_name, how))
    }

    fn open(
        &self,
        _ctx: &Context,
        _inode: u64,
        _flags: u32,
        _fuse_flags: u32,
    ) -> io::Result<(Option<u64>, OpenOptions, Option<u32>)> {
        Err(io::Error::from_raw_os_error(libc::ENOSYS))
    }

    fn opendir(
        &self,
        _ctx: &Context,
        _inode: u64,
        _flags: u32,
    ) -> io::Result<(Option<u64>, OpenOptions)> {
        Err(io::Error::from_raw_os_error(libc::ENOSYS))
    }

    fn create(
        &self,
        ctx: &Context,
        parent: u64,
        name: &CStr,
        args: CreateIn,
    ) -> io::Result<(Entry, Option<u64>, OpenOptions, Option<u32>)> {
        let mode = args.mode & !args.umask;
        let attr = self.run(self.fs.create(parent, utf8(name)?, mode, owner(ctx)));
        Ok((self.entry(ctx, attr)?, None, OpenOptions::KEEP_CACHE, None))
    }

    fn read(
        &self,
        _ctx: &Context,
        inode: u64,
        _handle: u64,
        writer: &mut dyn ZeroCopyWriter,
        size: u32,
        offset: u64,
        _lock_owner: Option<u64>,
        _flags: u32,
    ) -> io::Result<usize> {
        let data = self.run(self.fs.read(inode, offset, size))?;
        writer.write_all(&data)?;
        Ok(data.len())
    }

    fn write(
        &self,
        _ctx: &Context,
        inode: u64,
        _handle: u64,
        reader: &mut dyn ZeroCopyReader,
        size: u32,
        offset: u64,
        _lock_owner: Option<u64>,
        _delayed_write: bool,
        _flags: u32,
        _fuse_flags: u32,
    ) -> io::Result<usize> {
        let mut data = vec![0; size as usize];
        reader.read_exact(&mut data)?;
        Ok(self.run(self.fs.write(inode, offset, &data))? as usize)
    }

    fn fsync(&self, _ctx: &Context, _inode: u64, _datasync: bool, _handle: u64) -> io::Result<()> {
        self.runtime
            .block_on(request_save(&self.fsyncs))
            .map_err(eio)
    }

    fn fsyncdir(&self, ctx: &Context, inode: u64, datasync: bool, handle: u64) -> io::Result<()> {
        self.fsync(ctx, inode, datasync, handle)
    }

    fn readdir(
        &self,
        _ctx: &Context,
        inode: u64,
        _handle: u64,
        _size: u32,
        mut offset: u64,
        add_entry: &mut dyn FnMut(DirEntry) -> io::Result<usize>,
    ) -> io::Result<()> {
        loop {
            let entries = self.run(self.fs.readdir(inode, offset, READDIR_BATCH))?;
            for entry in &entries {
                let added = add_entry(DirEntry {
                    ino: entry.ino,
                    offset: entry.offset,
                    type_: file_type(entry.kind) >> 12,
                    name: entry.name.as_bytes(),
                })?;
                if added == 0 {
                    return Ok(());
                }
                offset = entry.offset;
            }
            if entries.len() < READDIR_BATCH {
                return Ok(());
            }
        }
    }

    fn statfs(&self, _ctx: &Context, _inode: u64) -> io::Result<statvfs64> {
        // SAFETY: statvfs64 is plain data; all zeroes is valid.
        let mut stats: statvfs64 = unsafe { std::mem::zeroed() };
        stats.f_bsize = 4096;
        stats.f_frsize = 4096;
        stats.f_blocks = STATFS_BLOCKS;
        stats.f_bfree = STATFS_BLOCKS;
        stats.f_bavail = STATFS_BLOCKS;
        stats.f_files = STATFS_FILES;
        stats.f_ffree = STATFS_FILES;
        stats.f_namemax = 255;
        Ok(stats)
    }

    fn access(&self, _ctx: &Context, _inode: u64, _mask: u32) -> io::Result<()> {
        Ok(())
    }

    fn setxattr(
        &self,
        _ctx: &Context,
        inode: u64,
        name: &CStr,
        value: &[u8],
        flags: u32,
    ) -> io::Result<()> {
        let when = setxattr_when(flags as i32)?;
        self.fs
            .setxattr(inode, name.to_bytes(), value, when)
            .map_err(eio)
    }

    fn getxattr(
        &self,
        _ctx: &Context,
        inode: u64,
        name: &CStr,
        size: u32,
    ) -> io::Result<GetxattrReply> {
        let value = self.fs.getxattr(inode, name.to_bytes()).map_err(eio)?;
        match size {
            0 => Ok(GetxattrReply::Count(value.len() as u32)),
            size if value.len() > size as usize => Err(io::Error::from_raw_os_error(libc::ERANGE)),
            _ => Ok(GetxattrReply::Value(value)),
        }
    }

    fn listxattr(&self, _ctx: &Context, inode: u64, size: u32) -> io::Result<ListxattrReply> {
        let names = self.fs.listxattr(inode).map_err(eio)?;
        match size {
            0 => Ok(ListxattrReply::Count(names.len() as u32)),
            size if names.len() > size as usize => Err(io::Error::from_raw_os_error(libc::ERANGE)),
            _ => Ok(ListxattrReply::Names(names)),
        }
    }

    fn removexattr(&self, _ctx: &Context, inode: u64, name: &CStr) -> io::Result<()> {
        self.fs.removexattr(inode, name.to_bytes()).map_err(eio)
    }
}

fn owner(ctx: &Context) -> Option<(u32, u32)> {
    Some((ctx.uid, ctx.gid))
}

fn stat(ctx: &Context, attr: &Attr) -> stat64 {
    // SAFETY: stat64 is plain data; all zeroes is valid.
    let mut stat: stat64 = unsafe { std::mem::zeroed() };
    let modified = attr.modified.duration_since(UNIX_EPOCH).unwrap_or_default();
    stat.st_ino = attr.ino;
    stat.st_mode = file_type(attr.kind) | attr.mode;
    stat.st_nlink = attr.nlink as _;
    stat.st_uid = attr.uid.unwrap_or(ctx.uid);
    stat.st_gid = attr.gid.unwrap_or(ctx.gid);
    stat.st_rdev = attr.rdev.into();
    stat.st_size = attr.size as i64;
    stat.st_blksize = 128 * 1024;
    stat.st_blocks = attr.size.div_ceil(512) as i64;
    stat.st_mtime = modified.as_secs() as i64;
    stat.st_mtime_nsec = i64::from(modified.subsec_nanos());
    let changed = attr.changed.duration_since(UNIX_EPOCH).unwrap_or_default();
    stat.st_ctime = changed.as_secs() as i64;
    stat.st_ctime_nsec = i64::from(changed.subsec_nanos());
    let accessed = attr.accessed.duration_since(UNIX_EPOCH).unwrap_or_default();
    stat.st_atime = accessed.as_secs() as i64;
    stat.st_atime_nsec = i64::from(accessed.subsec_nanos());
    stat
}

fn file_type(kind: Kind) -> u32 {
    match kind {
        Kind::File => libc::S_IFREG,
        Kind::Dir => libc::S_IFDIR,
        Kind::Symlink => libc::S_IFLNK,
        Kind::Fifo => libc::S_IFIFO,
        Kind::Socket => libc::S_IFSOCK,
        Kind::CharDevice => libc::S_IFCHR,
        Kind::BlockDevice => libc::S_IFBLK,
    }
}

fn utf8(name: &CStr) -> io::Result<&str> {
    name.to_str()
        .map_err(|_| io::Error::from_raw_os_error(libc::EINVAL))
}

fn eio(error: io::Error) -> io::Error {
    io::Error::from_raw_os_error(os_error(&error))
}
