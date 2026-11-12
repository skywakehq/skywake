//! Serves a [`BranchFs`] to the Linux kernel over FUSE.

mod sync;

use std::ffi::{CString, OsStr};
use std::fs::File;
use std::future::Future;
use std::io;
use std::os::fd::AsRawFd;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::MetadataExt;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::SystemTime;

use fuser::{
    AccessFlags, BackgroundSession, BsdFileFlags, Config, Errno, FileAttr, FileHandle, FileType,
    Filesystem, FopenFlags, Generation, INodeNo, InitFlags, KernelConfig, LockOwner, MountOption,
    OpenFlags, RenameFlags, ReplyAttr, ReplyCreate, ReplyData, ReplyDirectory, ReplyEmpty,
    ReplyEntry, ReplyOpen, ReplyStatfs, ReplyWrite, ReplyXattr, Request, Session, SessionACL,
    TimeOrNow, WriteFlags,
};
use tokio::runtime::Handle;

pub use sync::sync_kernel;
use sync::{BARRIER, Rendezvous, parent_of};

use super::{
    Fsyncs, MountOptions, READDIR_BATCH, STATFS_BLOCKS, STATFS_FILES, TTL, os_error, rename_how,
    request_save, setxattr_when,
};
use crate::{Attr, BranchFs, Kind, SetAttr};

const THREADS: usize = 16;

const MAX_REQUEST: u32 = 1 << 20;

pub fn mount(
    fs: Arc<BranchFs>,
    mountpoint: &Path,
    fsyncs: Fsyncs,
) -> io::Result<BackgroundSession> {
    mount_with_options(fs, mountpoint, fsyncs, &MountOptions::default())
}

pub fn mount_with_options(
    fs: Arc<BranchFs>,
    mountpoint: &Path,
    fsyncs: Fsyncs,
    options: &MountOptions,
) -> io::Result<BackgroundSession> {
    raise_open_file_limit()?;
    let (fuse, config) = prepare(fs, fsyncs, options);
    fuser::spawn_mount(fuse, mountpoint, &config)
}

pub fn mount_dir(
    fs: Arc<BranchFs>,
    dir: &File,
    fsyncs: Fsyncs,
    options: &MountOptions,
) -> io::Result<BackgroundSession> {
    raise_open_file_limit()?;
    let target = format!("/proc/self/fd/{}", dir.as_raw_fd());
    let device = File::options().read(true).write(true).open("/dev/fuse")?;
    // SAFETY: getuid and getgid can't fail and use no memory.
    let process = unsafe { (libc::getuid(), libc::getgid()) };
    let (uid, gid) = options.owner.unwrap_or(process);
    let mut data = format!(
        "fd={},rootmode={:o},user_id={uid},group_id={gid},default_permissions",
        device.as_raw_fd(),
        dir.metadata()?.mode()
    );
    if options.allow_other {
        data.push_str(",allow_other");
    }
    let c = |text: &str| CString::new(text).map_err(io::Error::other);
    let (source, target_c, data) = (c("skywake")?, c(&target)?, c(&data)?);
    let flags = libc::MS_NODEV | libc::MS_NOSUID | libc::MS_NOATIME;
    // SAFETY: all strings are valid C strings that outlive the call.
    let mounted = unsafe {
        libc::mount(
            source.as_ptr(),
            target_c.as_ptr(),
            c"fuse".as_ptr(),
            flags,
            data.as_ptr().cast(),
        )
    };
    if mounted != 0 {
        let error = io::Error::last_os_error();
        if error.raw_os_error() != Some(libc::EPERM) {
            return Err(error);
        }
        return mount_with_options(fs, Path::new(&target), fsyncs, options);
    }
    let (fuse, config) = prepare(fs, fsyncs, options);
    Session::from_fd(fuse, device.into(), SessionACL::All, config)?.spawn()
}

fn prepare(fs: Arc<BranchFs>, fsyncs: Fsyncs, options: &MountOptions) -> (Fuse, Config) {
    // SAFETY: getuid and getgid can't fail and use no memory.
    let process = unsafe { (libc::getuid(), libc::getgid()) };
    let fuse = Fuse {
        fs,
        fsyncs,
        runtime: Handle::current(),
        owner: options.owner.unwrap_or(process),
        writes: AtomicU64::new(0),
        rendezvous: Rendezvous::default(),
    };
    let mut config = Config::default();
    config.mount_options = vec![
        MountOption::FSName("skywake".into()),
        MountOption::DefaultPermissions,
        MountOption::NoAtime,
    ];
    if options.allow_other {
        config.acl = SessionACL::All;
    }
    config.n_threads = Some(THREADS);
    (fuse, config)
}

fn raise_open_file_limit() -> io::Result<()> {
    let mut limit = libc::rlimit {
        rlim_cur: 0,
        rlim_max: 0,
    };
    // SAFETY: both calls only use the struct we pass.
    unsafe {
        if libc::getrlimit(libc::RLIMIT_NOFILE, &mut limit) != 0 {
            return Err(io::Error::last_os_error());
        }
        limit.rlim_cur = limit.rlim_max;
        if libc::setrlimit(libc::RLIMIT_NOFILE, &limit) != 0 {
            return Err(io::Error::last_os_error());
        }
    }
    Ok(())
}

struct Fuse {
    fs: Arc<BranchFs>,
    fsyncs: Fsyncs,
    runtime: Handle,
    owner: (u32, u32),
    writes: AtomicU64,
    rendezvous: Rendezvous,
}

impl Fuse {
    fn run<T>(&self, work: impl Future<Output = io::Result<T>>) -> Result<T, Errno> {
        self.runtime.block_on(work).map_err(errno)
    }

    fn file_attr(&self, attr: &Attr) -> FileAttr {
        FileAttr {
            ino: INodeNo(attr.ino),
            size: attr.size,
            blocks: attr.size.div_ceil(512),
            atime: attr.accessed,
            mtime: attr.modified,
            ctime: attr.changed,
            crtime: attr.modified,
            kind: file_type(attr.kind),
            perm: attr.mode as u16,
            nlink: attr.nlink,
            uid: attr.uid.unwrap_or(self.owner.0),
            gid: attr.gid.unwrap_or(self.owner.1),
            rdev: attr.rdev,
            blksize: 128 * 1024,
            flags: 0,
        }
    }

    fn sync(&self, reply: ReplyEmpty) {
        let saved = request_save(&self.fsyncs);
        self.runtime.spawn(async move {
            match saved.await {
                Ok(()) => reply.ok(),
                Err(error) => reply.error(errno(error)),
            }
        });
    }

    fn entry(&self, result: Result<Attr, Errno>, reply: ReplyEntry) {
        match result {
            Ok(attr) => reply.entry(&TTL, &self.file_attr(&attr), Generation(0)),
            Err(error) => reply.error(error),
        }
    }
}

impl Filesystem for Fuse {
    fn init(&mut self, _req: &Request, config: &mut KernelConfig) -> io::Result<()> {
        let wanted = InitFlags::FUSE_PARALLEL_DIROPS
            | InitFlags::FUSE_MAX_PAGES
            | InitFlags::FUSE_NO_OPEN_SUPPORT
            | InitFlags::FUSE_NO_OPENDIR_SUPPORT
            | InitFlags::FUSE_HANDLE_KILLPRIV_V2
            | InitFlags::FUSE_WRITEBACK_CACHE;
        let _ = config.add_capabilities(wanted & config.capabilities());
        let _ = config.set_max_background(u16::MAX);
        let _ = config.set_max_write(MAX_REQUEST);
        let _ = config.set_max_readahead(MAX_REQUEST);
        Ok(())
    }

    fn lookup(&self, _req: &Request, parent: INodeNo, name: &OsStr, reply: ReplyEntry) {
        let result = utf8(name).and_then(|name| self.run(self.fs.lookup(parent.0, name)));
        self.entry(result, reply);
    }

    fn forget(&self, _req: &Request, ino: INodeNo, nlookup: u64) {
        self.fs.forget(ino.0, nlookup);
    }

    fn getattr(&self, _req: &Request, ino: INodeNo, _fh: Option<FileHandle>, reply: ReplyAttr) {
        match self.fs.getattr(ino.0) {
            Ok(attr) => reply.attr(&TTL, &self.file_attr(&attr)),
            Err(error) => reply.error(errno(error)),
        }
    }

    fn setattr(
        &self,
        req: &Request,
        ino: INodeNo,
        mode: Option<u32>,
        uid: Option<u32>,
        gid: Option<u32>,
        size: Option<u64>,
        atime: Option<TimeOrNow>,
        mtime: Option<TimeOrNow>,
        _ctime: Option<SystemTime>,
        _fh: Option<FileHandle>,
        _crtime: Option<SystemTime>,
        _chgtime: Option<SystemTime>,
        _bkuptime: Option<SystemTime>,
        _flags: Option<BsdFileFlags>,
        reply: ReplyAttr,
    ) {
        let time = |time| match time {
            TimeOrNow::SpecificTime(time) => time,
            TimeOrNow::Now => SystemTime::now(),
        };
        let chown = uid.is_some() || gid.is_some();
        let mode = match self.fs.getattr(ino.0) {
            Ok(attr) if mode.is_none() && attr.kind != Kind::Dir => {
                let kill = chown || (size.is_some() && req.uid() != 0);
                (kill && kill_suid(attr.mode) != attr.mode).then(|| kill_suid(attr.mode))
            }
            _ => mode,
        };
        if chown || size.is_some() {
            let _ = self.fs.removexattr(ino.0, CAPABILITY);
        }
        let changes = SetAttr {
            mode,
            uid,
            gid,
            size,
            modified: mtime.map(time),
            accessed: atime.map(time),
        };
        match self.run(self.fs.setattr(ino.0, changes)) {
            Ok(attr) => reply.attr(&TTL, &self.file_attr(&attr)),
            Err(error) => reply.error(error),
        }
    }

    fn readlink(&self, _req: &Request, ino: INodeNo, reply: ReplyData) {
        match self.fs.readlink(ino.0) {
            Ok(target) => reply.data(target.as_bytes()),
            Err(error) => reply.error(errno(error)),
        }
    }

    fn mkdir(
        &self,
        req: &Request,
        parent: INodeNo,
        name: &OsStr,
        mode: u32,
        umask: u32,
        reply: ReplyEntry,
    ) {
        let result = utf8(name)
            .and_then(|name| self.run(self.fs.mkdir(parent.0, name, mode & !umask, owner(req))));
        self.entry(result, reply);
    }

    fn mknod(
        &self,
        req: &Request,
        parent: INodeNo,
        name: &OsStr,
        mode: u32,
        umask: u32,
        rdev: u32,
        reply: ReplyEntry,
    ) {
        let mode = mode & !(umask & 0o7777);
        let result = utf8(name)
            .and_then(|name| self.run(self.fs.mknod(parent.0, name, mode, rdev, owner(req))));
        self.entry(result, reply);
    }

    fn link(
        &self,
        _req: &Request,
        ino: INodeNo,
        newparent: INodeNo,
        newname: &OsStr,
        reply: ReplyEntry,
    ) {
        let result =
            utf8(newname).and_then(|name| self.run(self.fs.link(ino.0, newparent.0, name)));
        self.entry(result, reply);
    }

    fn unlink(&self, _req: &Request, parent: INodeNo, name: &OsStr, reply: ReplyEmpty) {
        match utf8(name).and_then(|name| self.run(self.fs.unlink(parent.0, name))) {
            Ok(()) => reply.ok(),
            Err(error) => reply.error(error),
        }
    }

    fn rmdir(&self, _req: &Request, parent: INodeNo, name: &OsStr, reply: ReplyEmpty) {
        match utf8(name).and_then(|name| self.run(self.fs.rmdir(parent.0, name))) {
            Ok(()) => reply.ok(),
            Err(error) => reply.error(error),
        }
    }

    fn symlink(
        &self,
        req: &Request,
        parent: INodeNo,
        link_name: &OsStr,
        target: &Path,
        reply: ReplyEntry,
    ) {
        let result = utf8(link_name).and_then(|name| {
            let target = utf8(target.as_os_str())?;
            self.run(self.fs.symlink(parent.0, name, target, owner(req)))
        });
        self.entry(result, reply);
    }

    fn rename(
        &self,
        _req: &Request,
        parent: INodeNo,
        name: &OsStr,
        newparent: INodeNo,
        newname: &OsStr,
        flags: RenameFlags,
        reply: ReplyEmpty,
    ) {
        let result = utf8(name).and_then(|name| {
            let newname = utf8(newname)?;
            let how = rename_how(flags.bits()).map_err(errno)?;
            self.run(self.fs.rename(parent.0, name, newparent.0, newname, how))
        });
        match result {
            Ok(()) => reply.ok(),
            Err(error) => reply.error(error),
        }
    }

    fn open(&self, _req: &Request, _ino: INodeNo, _flags: OpenFlags, reply: ReplyOpen) {
        reply.error(Errno::ENOSYS);
    }

    fn opendir(&self, _req: &Request, _ino: INodeNo, _flags: OpenFlags, reply: ReplyOpen) {
        reply.error(Errno::ENOSYS);
    }

    fn read(
        &self,
        _req: &Request,
        ino: INodeNo,
        _fh: FileHandle,
        offset: u64,
        size: u32,
        _flags: OpenFlags,
        _lock_owner: Option<LockOwner>,
        reply: ReplyData,
    ) {
        match self.run(self.fs.read(ino.0, offset, size)) {
            Ok(data) => reply.data(&data),
            Err(error) => reply.error(error),
        }
    }

    fn write(
        &self,
        _req: &Request,
        ino: INodeNo,
        _fh: FileHandle,
        offset: u64,
        data: &[u8],
        write_flags: WriteFlags,
        _flags: OpenFlags,
        _lock_owner: Option<LockOwner>,
        reply: ReplyWrite,
    ) {
        if write_flags.contains(WriteFlags::FUSE_WRITE_KILL_SUIDGID)
            && let Ok(attr) = self.fs.getattr(ino.0)
        {
            let _ = self.fs.removexattr(ino.0, CAPABILITY);
            if kill_suid(attr.mode) != attr.mode {
                let changes = SetAttr {
                    mode: Some(kill_suid(attr.mode)),
                    ..SetAttr::default()
                };
                if let Err(error) = self.run(self.fs.setattr(ino.0, changes)) {
                    return reply.error(error);
                }
            }
        }
        let written = self.run(self.fs.write(ino.0, offset, data));
        self.writes.fetch_add(1, Ordering::SeqCst);
        match written {
            Ok(written) => reply.written(written),
            Err(error) => reply.error(error),
        }
    }

    fn fsync(
        &self,
        _req: &Request,
        _ino: INodeNo,
        _fh: FileHandle,
        _datasync: bool,
        reply: ReplyEmpty,
    ) {
        self.sync(reply);
    }

    fn fsyncdir(
        &self,
        _req: &Request,
        _ino: INodeNo,
        _fh: FileHandle,
        _datasync: bool,
        reply: ReplyEmpty,
    ) {
        self.sync(reply);
    }

    fn readdir(
        &self,
        _req: &Request,
        ino: INodeNo,
        _fh: FileHandle,
        mut offset: u64,
        mut reply: ReplyDirectory,
    ) {
        loop {
            let entries = match self.run(self.fs.readdir(ino.0, offset, READDIR_BATCH)) {
                Ok(entries) => entries,
                Err(error) => return reply.error(error),
            };
            for entry in &entries {
                let kind = file_type(entry.kind);
                if reply.add(INodeNo(entry.ino), entry.offset, kind, &entry.name) {
                    return reply.ok();
                }
                offset = entry.offset;
            }
            if entries.len() < READDIR_BATCH {
                return reply.ok();
            }
        }
    }

    fn statfs(&self, _req: &Request, _ino: INodeNo, reply: ReplyStatfs) {
        let (blocks, files) = (STATFS_BLOCKS, STATFS_FILES);
        reply.statfs(blocks, blocks, blocks, files, files, 4096, 255, 4096);
    }

    fn access(&self, _req: &Request, _ino: INodeNo, _mask: AccessFlags, reply: ReplyEmpty) {
        reply.ok();
    }

    fn setxattr(
        &self,
        _req: &Request,
        ino: INodeNo,
        name: &OsStr,
        value: &[u8],
        flags: i32,
        _position: u32,
        reply: ReplyEmpty,
    ) {
        let result = setxattr_when(flags)
            .and_then(|when| self.fs.setxattr(ino.0, name.as_bytes(), value, when));
        match result {
            Ok(()) => reply.ok(),
            Err(error) => reply.error(errno(error)),
        }
    }

    fn getxattr(&self, req: &Request, ino: INodeNo, name: &OsStr, size: u32, reply: ReplyXattr) {
        let ours = || {
            let pid = req.pid();
            Path::new(&format!("/proc/self/task/{pid}")).exists()
                || parent_of(pid) == Some(std::process::id())
        };
        if name.as_bytes() == BARRIER.to_bytes() && ours() {
            return match self.rendezvous.wait(&self.writes) {
                Some(writes) => reply_xattr(&writes.to_le_bytes(), size, reply),
                None => reply.error(Errno::ETIMEDOUT),
            };
        }
        match self.fs.getxattr(ino.0, name.as_bytes()) {
            Ok(value) => reply_xattr(&value, size, reply),
            Err(error) => reply.error(errno(error)),
        }
    }

    fn listxattr(&self, _req: &Request, ino: INodeNo, size: u32, reply: ReplyXattr) {
        match self.fs.listxattr(ino.0) {
            Ok(names) => reply_xattr(&names, size, reply),
            Err(error) => reply.error(errno(error)),
        }
    }

    fn removexattr(&self, _req: &Request, ino: INodeNo, name: &OsStr, reply: ReplyEmpty) {
        match self.fs.removexattr(ino.0, name.as_bytes()) {
            Ok(()) => reply.ok(),
            Err(error) => reply.error(errno(error)),
        }
    }

    fn create(
        &self,
        req: &Request,
        parent: INodeNo,
        name: &OsStr,
        mode: u32,
        umask: u32,
        _flags: i32,
        reply: ReplyCreate,
    ) {
        let result = utf8(name)
            .and_then(|name| self.run(self.fs.create(parent.0, name, mode & !umask, owner(req))));
        match result {
            Ok(attr) => reply.created(
                &TTL,
                &self.file_attr(&attr),
                Generation(0),
                FileHandle(0),
                FopenFlags::FOPEN_KEEP_CACHE,
            ),
            Err(error) => reply.error(error),
        }
    }
}

const CAPABILITY: &[u8] = b"security.capability";

fn kill_suid(mode: u32) -> u32 {
    let mut mode = mode & !0o4000;
    if mode & 0o010 != 0 {
        mode &= !0o2000;
    }
    mode
}

fn reply_xattr(value: &[u8], size: u32, reply: ReplyXattr) {
    if size == 0 {
        reply.size(value.len() as u32);
    } else if value.len() > size as usize {
        reply.error(Errno::ERANGE);
    } else {
        reply.data(value);
    }
}

fn owner(req: &Request) -> Option<(u32, u32)> {
    Some((req.uid(), req.gid()))
}

fn file_type(kind: Kind) -> FileType {
    match kind {
        Kind::File => FileType::RegularFile,
        Kind::Dir => FileType::Directory,
        Kind::Symlink => FileType::Symlink,
        Kind::Fifo => FileType::NamedPipe,
        Kind::Socket => FileType::Socket,
        Kind::CharDevice => FileType::CharDevice,
        Kind::BlockDevice => FileType::BlockDevice,
    }
}

fn utf8(name: &OsStr) -> Result<&str, Errno> {
    name.to_str().ok_or(Errno::EINVAL)
}

fn errno(error: io::Error) -> Errno {
    Errno::from_i32(os_error(&error))
}
