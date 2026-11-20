//! Filesystems as drives in Finder, with no Apple account or kernel
//! extension: each one is served by a small NFS server on 127.0.0.1, and
//! macOS mounts it with its own NFS client. A drive shows one branch.
//!
//! Saving: a file being written is kept in a local file. Two seconds after
//! the last write it is uploaded in parts, and everything ready goes into one
//! commit. Folders, deletes and moves are committed at once.

use std::collections::HashMap;
use std::os::unix::fs::FileExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime};

use serde::Serialize;

use async_trait::async_trait;
use nfsserve::nfs::{
    fattr3, fileid3, filename3, ftype3, nfspath3, nfsstat3, nfstime3, sattr3, set_size3, specdata3,
};
use nfsserve::tcp::{NFSTcp, NFSTcpListener};
use nfsserve::vfs::{DirEntry, NFSFileSystem, ReadDirResult, VFSCapabilities};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::io::AsyncReadExt;

use crate::auth::{Account, encode};

/// How long a folder's listing is trusted before it is asked for again.
const FRESH: Duration = Duration::from_secs(5);
/// How long a file must be left alone before it is uploaded.
const SETTLE: Duration = Duration::from_secs(2);
/// The size of each uploaded part.
const PART: usize = 8 * 1024 * 1024;
const ROOT: fileid3 = 1;

#[derive(Clone, Deserialize)]
struct Info {
    name: String,
    kind: String,
    size: u64,
    executable: bool,
    #[serde(default)]
    target: String,
    modified: u64,
}

#[derive(Deserialize)]
struct Listing {
    entries: Vec<Info>,
}

#[derive(Deserialize)]
struct Uploaded {
    part: String,
}

struct Node {
    path: String,
    info: Info,
}

/// A file with changes not yet committed. Its bytes are in `local`.
struct Dirty {
    local: PathBuf,
    /// Goes up with every write, so a flush knows if it saw the latest bytes.
    version: u64,
    changed: Instant,
    /// Not on the branch yet, so a move or delete need not ask skywake-api.
    new: bool,
}

/// What the drive knows. NFS names files by number, so every path we have
/// seen gets one, for as long as the drive is mounted.
#[derive(Default)]
struct State {
    nodes: Vec<Node>,
    ids: HashMap<String, fileid3>,
    listings: HashMap<String, (Instant, Vec<fileid3>)>,
    dirty: HashMap<fileid3, Dirty>,
}

impl State {
    fn node(&self, id: fileid3) -> Result<&Node, nfsstat3> {
        let at = (id as usize)
            .checked_sub(1)
            .ok_or(nfsstat3::NFS3ERR_STALE)?;
        self.nodes.get(at).ok_or(nfsstat3::NFS3ERR_STALE)
    }

    fn node_mut(&mut self, id: fileid3) -> &mut Node {
        &mut self.nodes[id as usize - 1]
    }

    /// The number for a path, made if new. A file with local changes keeps
    /// its local size and time.
    fn register(&mut self, path: String, info: Info) -> fileid3 {
        if let Some(&id) = self.ids.get(&path) {
            if !self.dirty.contains_key(&id) {
                self.node_mut(id).info = info;
            }
            return id;
        }
        self.nodes.push(Node {
            path: path.clone(),
            info,
        });
        let id = self.nodes.len() as fileid3;
        self.ids.insert(path, id);
        id
    }

    /// Forgets a path and everything under it. Their numbers go stale.
    fn forget(&mut self, path: &str) {
        let under = format!("{path}/");
        self.ids
            .retain(|known, _| known != path && !known.starts_with(&under));
    }

    /// Gives a path and everything under it a new place, keeping their numbers.
    fn repath(&mut self, from: &str, to: &str) {
        self.forget(to);
        let under = format!("{from}/");
        let moved: Vec<(String, fileid3)> = self
            .ids
            .iter()
            .filter(|(path, _)| *path == from || path.starts_with(&under))
            .map(|(path, &id)| (path.clone(), id))
            .collect();
        for (old, id) in moved {
            let new = format!("{to}{}", &old[from.len()..]);
            self.ids.remove(&old);
            self.ids.insert(new.clone(), id);
            let node = self.node_mut(id);
            node.info.name = name_of(&new).to_string();
            node.path = new;
        }
        self.listings.clear();
    }
}

/// One disk's branch, through skywake-api.
struct Remote {
    http: reqwest::Client,
    /// `{api}/v1/namespaces/{disk}`.
    base: String,
    /// `/branches/{branch}`.
    branch: String,
    account: Arc<Account>,
    health: Mutex<Health>,
    /// Tells the window that the drive's health changed.
    changed: Arc<dyn Fn() + Send + Sync>,
    device: String,
    state: Mutex<State>,
    /// Where files with changes are kept until they are committed.
    scratch: PathBuf,
    next: AtomicU64,
    /// One flush at a time.
    flushing: tokio::sync::Mutex<()>,
    uid: u32,
    gid: u32,
    /// When the drive was mounted, in milliseconds: the time folders show,
    /// since Skywake keeps none for them.
    mounted: u64,
}

impl Remote {
    fn new(
        account: Arc<Account>,
        disk: &str,
        branch: &str,
        scratch: PathBuf,
        changed: Arc<dyn Fn() + Send + Sync>,
    ) -> Self {
        let root = Info {
            name: String::new(),
            kind: "folder".into(),
            size: 0,
            executable: false,
            target: String::new(),
            modified: 0,
        };
        let mut state = State::default();
        state.register(String::new(), root);
        Remote {
            http: reqwest::Client::new(),
            base: format!("{}/v1/namespaces/{}", account.api, encode(disk)),
            branch: format!("/branches/{}", encode(branch)),
            account,
            health: Mutex::new(Health::default()),
            changed,
            device: gethostname::gethostname()
                .to_string_lossy()
                .trim_end_matches(".local")
                .to_string(),
            state: Mutex::new(state),
            scratch,
            next: AtomicU64::new(0),
            flushing: tokio::sync::Mutex::new(()),
            // Files show as yours, so Finder lets you open them.
            uid: unsafe { libc::getuid() },
            gid: unsafe { libc::getgid() },
            mounted: now(),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap()
    }

    fn node(&self, id: fileid3) -> Result<(String, Info), nfsstat3> {
        let state = self.lock();
        let node = state.node(id)?;
        Ok((node.path.clone(), node.info.clone()))
    }

    async fn token(&self) -> Result<String, nfsstat3> {
        self.account.token().await.map_err(|error| {
            self.failed(String::from(error));
            nfsstat3::NFS3ERR_ACCES
        })
    }

    /// A request to the branch, such as `/files`; one to the disk when `on_disk`.
    async fn get(&self, path: &str) -> Result<reqwest::RequestBuilder, nfsstat3> {
        let url = format!("{}{}{path}", self.base, self.branch);
        Ok(self.http.get(url).bearer_auth(self.token().await?))
    }

    async fn post(&self, path: &str, on_disk: bool) -> Result<reqwest::RequestBuilder, nfsstat3> {
        let branch = if on_disk { "" } else { self.branch.as_str() };
        let url = format!("{}{branch}{path}", self.base);
        Ok(self.http.post(url).bearer_auth(self.token().await?))
    }

    fn failed(&self, error: String) {
        self.health.lock().unwrap().error = Some(error);
        (self.changed)();
    }

    /// Files changed here and not yet on the branch, Finder's own left out.
    fn pending(&self) -> usize {
        let state = self.lock();
        state
            .dirty
            .keys()
            .filter(|&&id| {
                state
                    .node(id)
                    .is_ok_and(|node| !finder_file(&node.info.name))
            })
            .count()
    }

    /// What a folder holds, asking skywake-api when the last answer is old.
    /// New files not yet committed are listed too.
    async fn list(&self, dir: fileid3) -> Result<Vec<fileid3>, nfsstat3> {
        let (path, info) = self.node(dir)?;
        if info.kind != "folder" {
            return Err(nfsstat3::NFS3ERR_NOTDIR);
        }
        if let Some((when, ids)) = self.lock().listings.get(&path)
            && when.elapsed() < FRESH
        {
            return Ok(ids.clone());
        }

        let response = self
            .get("/files")
            .await?
            .query(&[("path", &path)])
            .send()
            .await
            .map_err(|_| nfsstat3::NFS3ERR_IO)?;
        // A new disk has no `main` yet: it is just empty.
        let entries = match response.status().as_u16() {
            404 if path.is_empty() => Vec::new(),
            404 => return Err(nfsstat3::NFS3ERR_NOENT),
            200 => {
                let listing: Listing = response.json().await.map_err(|_| nfsstat3::NFS3ERR_IO)?;
                listing.entries
            }
            _ => return Err(nfsstat3::NFS3ERR_IO),
        };

        let mut state = self.lock();
        let mut ids: Vec<fileid3> = entries
            .into_iter()
            .map(|info| state.register(child(&path, &info.name), info))
            .collect();
        for (&id, dirty) in &state.dirty {
            let node = state.node(id)?;
            if dirty.new && parent_of(&node.path) == path && state.ids.get(&node.path) == Some(&id)
            {
                ids.push(id);
            }
        }
        ids.sort_by(|a, b| {
            let name = |id: &fileid3| state.nodes[*id as usize - 1].info.name.clone();
            name(a).cmp(&name(b))
        });
        ids.dedup();
        state.listings.insert(path, (Instant::now(), ids.clone()));
        Ok(ids)
    }

    fn attr(&self, id: fileid3, info: &Info) -> fattr3 {
        let (ftype, mode, nlink) = match info.kind.as_str() {
            "folder" => (ftype3::NF3DIR, 0o755, 2),
            "symlink" => (ftype3::NF3LNK, 0o777, 1),
            _ if info.executable => (ftype3::NF3REG, 0o755, 1),
            _ => (ftype3::NF3REG, 0o644, 1),
        };
        let modified = match info.modified {
            0 => self.mounted,
            ms => ms,
        };
        let time = nfstime3 {
            seconds: (modified / 1000) as u32,
            nseconds: (modified % 1000 * 1_000_000) as u32,
        };
        fattr3 {
            ftype,
            mode,
            nlink,
            uid: self.uid,
            gid: self.gid,
            size: info.size,
            used: info.size,
            rdev: specdata3::default(),
            fsid: 0,
            fileid: id,
            atime: time,
            mtime: time,
            ctime: time,
        }
    }

    fn scratch_file(&self) -> PathBuf {
        self.scratch
            .join(self.next.fetch_add(1, Ordering::Relaxed).to_string())
    }

    /// The local copy of a file, downloading it the first time it is changed.
    async fn local(&self, id: fileid3) -> Result<PathBuf, nfsstat3> {
        if let Some(dirty) = self.lock().dirty.get(&id) {
            return Ok(dirty.local.clone());
        }
        let (path, info) = self.node(id)?;
        if info.kind != "file" {
            return Err(nfsstat3::NFS3ERR_ISDIR);
        }
        let bytes = self
            .get("/files/content")
            .await?
            .query(&[("path", &path)])
            .send()
            .await
            .and_then(|response| response.error_for_status())
            .map_err(|_| nfsstat3::NFS3ERR_IO)?
            .bytes()
            .await
            .map_err(|_| nfsstat3::NFS3ERR_IO)?;
        let local = self.scratch_file();
        std::fs::write(&local, &bytes).map_err(|_| nfsstat3::NFS3ERR_IO)?;

        let mut state = self.lock();
        // Someone else may have made it while this one downloaded.
        if let Some(dirty) = state.dirty.get(&id) {
            let _ = std::fs::remove_file(&local);
            return Ok(dirty.local.clone());
        }
        state.dirty.insert(
            id,
            Dirty {
                local: local.clone(),
                version: 0,
                changed: Instant::now(),
                new: false,
            },
        );
        Ok(local)
    }

    /// Notes that a file changed: its new size, and when.
    fn touched(&self, id: fileid3, size: u64) -> fattr3 {
        let mut state = self.lock();
        if let Some(dirty) = state.dirty.get_mut(&id) {
            dirty.version += 1;
            dirty.changed = Instant::now();
        }
        let node = state.node_mut(id);
        node.info.size = size;
        node.info.modified = now();
        let info = node.info.clone();
        drop(state);
        self.attr(id, &info)
    }

    /// Commits changes to the branch, making `main` first on a new disk.
    async fn commit(&self, message: String, changes: Vec<Value>) -> Result<(), nfsstat3> {
        let body = json!({ "message": message, "changes": changes });
        for first in [true, false] {
            let response = self
                .post("/commits", false)
                .await?
                .json(&body)
                .send()
                .await
                .map_err(|_| nfsstat3::NFS3ERR_IO)?;
            match response.status().as_u16() {
                200 | 201 => return Ok(()),
                404 if first && self.branch == "/branches/main" => {
                    let _ = self
                        .post("/branches", true)
                        .await?
                        .json(&json!({ "name": "main" }))
                        .send()
                        .await;
                }
                404 => return Err(nfsstat3::NFS3ERR_NOENT),
                401 | 403 => return Err(nfsstat3::NFS3ERR_ACCES),
                _ => return Err(nfsstat3::NFS3ERR_IO),
            }
        }
        Err(nfsstat3::NFS3ERR_IO)
    }

    /// Uploads a file in parts, returning the parts' hashes in order.
    async fn upload(&self, local: &Path) -> Result<Vec<String>, nfsstat3> {
        let mut file = tokio::fs::File::open(local)
            .await
            .map_err(|_| nfsstat3::NFS3ERR_IO)?;
        let mut parts = Vec::new();
        loop {
            let mut buffer = Vec::with_capacity(PART);
            (&mut file)
                .take(PART as u64)
                .read_to_end(&mut buffer)
                .await
                .map_err(|_| nfsstat3::NFS3ERR_IO)?;
            if buffer.is_empty() {
                return Ok(parts);
            }
            let uploaded: Uploaded = self
                .post("/uploads", true)
                .await?
                .header("content-type", "application/octet-stream")
                .body(buffer)
                .send()
                .await
                .and_then(|response| response.error_for_status())
                .map_err(|_| nfsstat3::NFS3ERR_IO)?
                .json()
                .await
                .map_err(|_| nfsstat3::NFS3ERR_IO)?;
            parts.push(uploaded.part);
        }
    }

    /// Commits changed files: those left alone for a moment, or with `all`,
    /// every one. Finder's own files (`.DS_Store`, `._*`) stay on this computer.
    async fn flush(&self, all: bool) -> Result<(), nfsstat3> {
        let _one = self.flushing.lock().await;
        let ready: Vec<(fileid3, String, PathBuf, u64, bool)> = {
            let state = self.lock();
            state
                .dirty
                .iter()
                .filter(|(_, dirty)| all || dirty.changed.elapsed() >= SETTLE)
                .filter_map(|(&id, dirty)| {
                    let node = state.node(id).ok()?;
                    let current = state.ids.get(&node.path) == Some(&id);
                    (current && !finder_file(&node.info.name)).then(|| {
                        let local = dirty.local.clone();
                        (
                            id,
                            node.path.clone(),
                            local,
                            dirty.version,
                            node.info.executable,
                        )
                    })
                })
                .collect()
        };
        if ready.is_empty() {
            return Ok(());
        }
        self.health.lock().unwrap().syncing = true;
        (self.changed)();
        let saved = self.save(ready).await;
        let mut health = self.health.lock().unwrap();
        health.syncing = false;
        match &saved {
            Ok(()) => {
                health.error = None;
                health.saved_at = Some(now());
            }
            Err(error) => health.error = Some(describe(*error)),
        }
        drop(health);
        (self.changed)();
        saved
    }

    async fn save(
        &self,
        ready: Vec<(fileid3, String, PathBuf, u64, bool)>,
    ) -> Result<(), nfsstat3> {
        let mut changes = Vec::new();
        for (_, path, local, _, executable) in &ready {
            let parts = self.upload(local).await?;
            changes.push(match parts.is_empty() {
                true => json!({ "path": path, "text": "", "executable": executable }),
                false => json!({ "path": path, "parts": parts, "executable": executable }),
            });
        }
        let what = match ready.as_slice() {
            [(_, path, ..)] => name_of(path).to_string(),
            many => format!("{} files", many.len()),
        };
        self.commit(format!("Saved {what} from {}", self.device), changes)
            .await?;

        let mut state = self.lock();
        for (id, path, _, version, _) in ready {
            state.listings.remove(parent_of(&path));
            match state.dirty.get_mut(&id) {
                Some(dirty) if dirty.version == version => {
                    let _ = std::fs::remove_file(&dirty.local);
                    state.dirty.remove(&id);
                }
                // Written again meanwhile: keep it, but it is on the branch now.
                Some(dirty) => dirty.new = false,
                None => {}
            }
        }
        Ok(())
    }

    /// Commits changes under `path` before it is moved or deleted.
    async fn flush_under(&self, path: &str) -> Result<(), nfsstat3> {
        let under = format!("{path}/");
        let busy = {
            let state = self.lock();
            state.dirty.keys().any(|&id| {
                state
                    .node(id)
                    .is_ok_and(|node| node.path == path || node.path.starts_with(&under))
            })
        };
        if busy { self.flush(true).await } else { Ok(()) }
    }

    fn name(&self, filename: &filename3) -> Result<String, nfsstat3> {
        let name = std::str::from_utf8(filename).map_err(|_| nfsstat3::NFS3ERR_INVAL)?;
        if name.is_empty() || name.contains('/') || name == "." || name == ".." {
            return Err(nfsstat3::NFS3ERR_INVAL);
        }
        Ok(name.to_string())
    }

    fn folder(&self, dirid: fileid3) -> Result<String, nfsstat3> {
        let (path, info) = self.node(dirid)?;
        if info.kind != "folder" {
            return Err(nfsstat3::NFS3ERR_NOTDIR);
        }
        Ok(path)
    }

    /// A new, empty file, kept on this computer until it is flushed.
    async fn new_file(&self, dirid: fileid3, filename: &filename3) -> Result<fileid3, nfsstat3> {
        let dir = self.folder(dirid)?;
        let name = self.name(filename)?;
        let path = child(&dir, &name);
        let local = self.scratch_file();
        std::fs::write(&local, b"").map_err(|_| nfsstat3::NFS3ERR_IO)?;

        let mut state = self.lock();
        let new = !state.ids.contains_key(&path);
        let info = Info {
            name,
            kind: "file".into(),
            size: 0,
            executable: false,
            target: String::new(),
            modified: now(),
        };
        let id = state.register(path, info.clone());
        state.node_mut(id).info = info;
        let old = state.dirty.insert(
            id,
            Dirty {
                local,
                version: 1,
                changed: Instant::now(),
                new,
            },
        );
        if let Some(old) = old {
            let _ = std::fs::remove_file(old.local);
        }
        state.listings.remove(&dir);
        Ok(id)
    }
}

#[async_trait]
impl NFSFileSystem for Drive {
    fn capabilities(&self) -> VFSCapabilities {
        VFSCapabilities::ReadWrite
    }

    fn root_dir(&self) -> fileid3 {
        ROOT
    }

    async fn lookup(&self, dirid: fileid3, filename: &filename3) -> Result<fileid3, nfsstat3> {
        let ids = self.0.list(dirid).await?;
        let state = self.0.lock();
        ids.into_iter()
            .find(|&id| state.nodes[id as usize - 1].info.name.as_bytes() == filename.as_ref())
            .ok_or(nfsstat3::NFS3ERR_NOENT)
    }

    async fn getattr(&self, id: fileid3) -> Result<fattr3, nfsstat3> {
        let (_, info) = self.0.node(id)?;
        Ok(self.0.attr(id, &info))
    }

    async fn setattr(&self, id: fileid3, setattr: sattr3) -> Result<fattr3, nfsstat3> {
        // Only the size matters; owners, modes and times are set by the branch.
        if let set_size3::size(size) = setattr.size {
            let local = self.0.local(id).await?;
            let file = std::fs::OpenOptions::new()
                .write(true)
                .open(&local)
                .map_err(|_| nfsstat3::NFS3ERR_IO)?;
            file.set_len(size).map_err(|_| nfsstat3::NFS3ERR_IO)?;
            return Ok(self.0.touched(id, size));
        }
        self.getattr(id).await
    }

    async fn read(
        &self,
        id: fileid3,
        offset: u64,
        count: u32,
    ) -> Result<(Vec<u8>, bool), nfsstat3> {
        let (path, info) = self.0.node(id)?;
        if offset >= info.size {
            return Ok((Vec::new(), true));
        }
        let local = self
            .0
            .lock()
            .dirty
            .get(&id)
            .map(|dirty| dirty.local.clone());
        let bytes = match local {
            Some(local) => {
                let file = std::fs::File::open(local).map_err(|_| nfsstat3::NFS3ERR_IO)?;
                let mut buffer = vec![0; count.min((info.size - offset) as u32) as usize];
                let read = file
                    .read_at(&mut buffer, offset)
                    .map_err(|_| nfsstat3::NFS3ERR_IO)?;
                buffer.truncate(read);
                buffer
            }
            None => self
                .0
                .get("/files/content")
                .await?
                .query(&[
                    ("path", path),
                    ("offset", offset.to_string()),
                    ("length", count.to_string()),
                ])
                .send()
                .await
                .and_then(|response| response.error_for_status())
                .map_err(|_| nfsstat3::NFS3ERR_IO)?
                .bytes()
                .await
                .map_err(|_| nfsstat3::NFS3ERR_IO)?
                .to_vec(),
        };
        let end = offset + bytes.len() as u64 >= info.size;
        Ok((bytes, end))
    }

    async fn write(&self, id: fileid3, offset: u64, data: &[u8]) -> Result<fattr3, nfsstat3> {
        let local = self.0.local(id).await?;
        let file = std::fs::OpenOptions::new()
            .write(true)
            .open(&local)
            .map_err(|_| nfsstat3::NFS3ERR_IO)?;
        file.write_all_at(data, offset)
            .map_err(|_| nfsstat3::NFS3ERR_IO)?;
        let size = file.metadata().map_err(|_| nfsstat3::NFS3ERR_IO)?.len();
        Ok(self.0.touched(id, size))
    }

    async fn create(
        &self,
        dirid: fileid3,
        filename: &filename3,
        _: sattr3,
    ) -> Result<(fileid3, fattr3), nfsstat3> {
        let id = self.0.new_file(dirid, filename).await?;
        Ok((id, self.getattr(id).await?))
    }

    async fn create_exclusive(
        &self,
        dirid: fileid3,
        filename: &filename3,
    ) -> Result<fileid3, nfsstat3> {
        if self.lookup(dirid, filename).await.is_ok() {
            return Err(nfsstat3::NFS3ERR_EXIST);
        }
        self.0.new_file(dirid, filename).await
    }

    async fn mkdir(
        &self,
        dirid: fileid3,
        dirname: &filename3,
    ) -> Result<(fileid3, fattr3), nfsstat3> {
        let dir = self.0.folder(dirid)?;
        let name = self.0.name(dirname)?;
        let path = child(&dir, &name);
        let message = format!("Made the folder {name} from {}", self.0.device);
        self.0
            .commit(message, vec![json!({ "path": path, "folder": true })])
            .await?;
        self.0.lock().listings.remove(&dir);
        let id = self.lookup(dirid, dirname).await?;
        Ok((id, self.getattr(id).await?))
    }

    async fn remove(&self, dirid: fileid3, filename: &filename3) -> Result<(), nfsstat3> {
        let dir = self.0.folder(dirid)?;
        let name = self.0.name(filename)?;
        let path = child(&dir, &name);
        let local_only = {
            let mut state = self.0.lock();
            let id = state.ids.get(&path).copied();
            let only = id
                .and_then(|id| state.dirty.get(&id))
                .is_some_and(|dirty| dirty.new || finder_file(&name));
            if only && let Some(dirty) = id.and_then(|id| state.dirty.remove(&id)) {
                let _ = std::fs::remove_file(dirty.local);
            }
            only
        };
        if !local_only {
            let message = format!("Deleted {name} from {}", self.0.device);
            self.0
                .commit(message, vec![json!({ "path": path, "delete": true })])
                .await?;
        }
        let mut state = self.0.lock();
        if let Some(id) = state.ids.get(&path).copied()
            && let Some(dirty) = state.dirty.remove(&id)
        {
            let _ = std::fs::remove_file(dirty.local);
        }
        state.forget(&path);
        state.listings.remove(&dir);
        Ok(())
    }

    async fn rename(
        &self,
        from_dirid: fileid3,
        from_filename: &filename3,
        to_dirid: fileid3,
        to_filename: &filename3,
    ) -> Result<(), nfsstat3> {
        let from = child(&self.0.folder(from_dirid)?, &self.0.name(from_filename)?);
        let to_name = self.0.name(to_filename)?;
        let to = child(&self.0.folder(to_dirid)?, &to_name);

        // Editors save by writing a new file and moving it over the old one.
        // A file that is not on the branch yet just moves here, and is
        // committed at its new place.
        {
            let mut state = self.0.lock();
            let id = state
                .ids
                .get(&from)
                .copied()
                .ok_or(nfsstat3::NFS3ERR_NOENT)?;
            if state.dirty.get(&id).is_some_and(|dirty| dirty.new) {
                if let Some(old) = state.ids.get(&to).copied()
                    && let Some(dirty) = state.dirty.remove(&old)
                {
                    let _ = std::fs::remove_file(dirty.local);
                }
                state.repath(&from, &to);
                if let Some(dirty) = state.dirty.get_mut(&id) {
                    dirty.changed = Instant::now();
                }
                return Ok(());
            }
        }

        self.0.flush_under(&from).await?;
        let message = format!(
            "Moved {} to {to_name} from {}",
            name_of(&from),
            self.0.device
        );
        let changes = vec![
            json!({ "path": to, "from": { "path": from } }),
            json!({ "path": from, "delete": true }),
        ];
        self.0.commit(message, changes).await?;
        self.0.lock().repath(&from, &to);
        Ok(())
    }

    async fn readdir(
        &self,
        dirid: fileid3,
        start_after: fileid3,
        max_entries: usize,
    ) -> Result<ReadDirResult, nfsstat3> {
        let ids = self.0.list(dirid).await?;
        let from = match start_after {
            0 => 0,
            after => ids
                .iter()
                .position(|&id| id == after)
                .map_or(ids.len(), |at| at + 1),
        };
        let state = self.0.lock();
        let entries: Vec<DirEntry> = ids[from..]
            .iter()
            .take(max_entries)
            .map(|&id| {
                let info = &state.nodes[id as usize - 1].info;
                DirEntry {
                    fileid: id,
                    name: info.name.as_bytes().into(),
                    attr: self.0.attr(id, info),
                }
            })
            .collect();
        Ok(ReadDirResult {
            end: from + entries.len() >= ids.len(),
            entries,
        })
    }

    async fn symlink(
        &self,
        _: fileid3,
        _: &filename3,
        _: &nfspath3,
        _: &sattr3,
    ) -> Result<(fileid3, fattr3), nfsstat3> {
        Err(nfsstat3::NFS3ERR_NOTSUPP)
    }

    async fn readlink(&self, id: fileid3) -> Result<nfspath3, nfsstat3> {
        let (_, info) = self.0.node(id)?;
        Ok(info.target.as_bytes().into())
    }
}

/// What the NFS server holds. The saver holds the same `Remote`.
struct Drive(Arc<Remote>);

/// How a drive is doing, for the window and the menu bar.
#[derive(Clone, Default)]
struct Health {
    syncing: bool,
    error: Option<String>,
    /// When changes last reached the branch, in milliseconds since 1970.
    saved_at: Option<u64>,
}

#[derive(Clone, Serialize)]
pub struct Status {
    pub disk: String,
    pub branch: String,
    pub path: PathBuf,
    /// `mounted`, `syncing` or `error`.
    pub state: &'static str,
    pub pending: usize,
    pub error: Option<String>,
    pub saved_at: Option<u64>,
}

/// A drive this app has mounted.
struct Mounted {
    disk: String,
    branch: String,
    dir: PathBuf,
    remote: Arc<Remote>,
    saver: tokio::task::AbortHandle,
    server: tokio::task::AbortHandle,
}

impl Mounted {
    fn status(&self) -> Status {
        let health = self.remote.health.lock().unwrap().clone();
        let pending = self.remote.pending();
        let state = match (&health.error, health.syncing || pending > 0) {
            (Some(_), _) => "error",
            (None, true) => "syncing",
            (None, false) => "mounted",
        };
        Status {
            disk: self.disk.clone(),
            branch: self.branch.clone(),
            path: self.dir.clone(),
            state,
            pending,
            error: health.error,
            saved_at: health.saved_at,
        }
    }
}

/// The drives this app has mounted, by `disk@branch`.
#[derive(Default)]
pub struct Drives(tokio::sync::Mutex<HashMap<String, Mounted>>);

pub fn id(disk: &str, branch: &str) -> String {
    format!("{disk}@{branch}")
}

impl Drives {
    /// Mounts a disk's branch at ~/Skywake, unless it already is. Returns where.
    pub async fn mount(
        &self,
        account: Arc<Account>,
        disk: &str,
        branch: &str,
        changed: Arc<dyn Fn() + Send + Sync>,
    ) -> Result<PathBuf, String> {
        let mut mounted = self.0.lock().await;
        let key = id(disk, branch);
        if let Some(drive) = mounted.get(&key) {
            return Ok(drive.dir.clone());
        }
        let drive = mount(account, disk, branch, changed).await?;
        let dir = drive.dir.clone();
        mounted.insert(key, drive);
        Ok(dir)
    }

    pub async fn statuses(&self) -> Vec<Status> {
        let mut all: Vec<Status> = self.0.lock().await.values().map(Mounted::status).collect();
        all.sort_by(|a, b| (&a.disk, &a.branch).cmp(&(&b.disk, &b.branch)));
        all
    }

    /// Saves what is waiting, then unmounts one drive.
    pub async fn unmount(&self, disk: &str, branch: &str) -> Result<(), String> {
        let mut mounted = self.0.lock().await;
        let key = id(disk, branch);
        let Some(drive) = mounted.get(&key) else {
            return Ok(());
        };
        drive
            .remote
            .flush(true)
            .await
            .map_err(|error| format!("Could not save the last changes: {}", describe(error)))?;
        let dir = drive.dir.to_str().unwrap_or_default().to_string();
        // Finder may be looking at it; forcing is safe once everything is saved.
        run("/sbin/umount", &["-f", &dir]).await?;
        if let Some(drive) = mounted.remove(&key) {
            drive.saver.abort();
            drive.server.abort();
            let _ = std::fs::remove_dir_all(&drive.remote.scratch);
            // The empty mount point goes too, so ~/Skywake shows only what is mounted.
            let _ = std::fs::remove_dir(&drive.dir);
        }
        Ok(())
    }

    /// Saves what is waiting and unmounts every drive, so none is left
    /// pointing at a server that is gone.
    pub async fn unmount_all(&self) -> Vec<String> {
        let keys: Vec<(String, String)> = self
            .0
            .lock()
            .await
            .values()
            .map(|drive| (drive.disk.clone(), drive.branch.clone()))
            .collect();
        let mut failed = Vec::new();
        for (disk, branch) in keys {
            if let Err(error) = self.unmount(&disk, &branch).await {
                failed.push(format!("{}: {error}", id(&disk, &branch)));
            }
        }
        failed
    }
}

/// Where a drive appears: `~/Skywake/prod/website`, or `~/Skywake/prod/website@fix-login`.
pub fn folder_for(home: &Path, disk: &str, branch: &str) -> PathBuf {
    let (env, name) = disk.split_once('/').unwrap_or(("", disk));
    let mut leaf = name.replace('/', "-");
    if branch != "main" {
        leaf = format!("{leaf}@{}", branch.replace('/', "-"));
    }
    let base = home.join("Skywake");
    if env.is_empty() {
        base.join(leaf)
    } else {
        base.join(env).join(leaf)
    }
}

async fn mount(
    account: Arc<Account>,
    disk: &str,
    branch: &str,
    changed: Arc<dyn Fn() + Send + Sync>,
) -> Result<Mounted, String> {
    let scratch = std::env::temp_dir().join("skywake-drives").join(format!(
        "{}-{}",
        std::process::id(),
        id(disk, branch).replace('/', "-")
    ));
    std::fs::create_dir_all(&scratch).map_err(|error| error.to_string())?;
    let remote = Arc::new(Remote::new(account, disk, branch, scratch, changed));

    let listener = NFSTcpListener::bind("127.0.0.1:0", Drive(remote.clone()))
        .await
        .map_err(|error| error.to_string())?;
    let port = listener.get_listen_port();
    let server = tokio::spawn(async move { listener.handle_forever().await }).abort_handle();

    // Saves files a moment after they stop changing. Failures are tried again.
    let saving = remote.clone();
    let saver = tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            let _ = saving.flush(false).await;
        }
    })
    .abort_handle();

    let home = std::env::var("HOME").map_err(|error| error.to_string())?;
    let dir = folder_for(Path::new(&home), disk, branch);
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let path = dir.to_str().ok_or("The folder's name is not text.")?;
    // A drive left from a run that did not quit cleanly is in the way.
    let _ = run("/sbin/umount", &["-f", path]).await;
    // `soft`: if the app stops, Finder gets an error instead of hanging.
    // `inet`: the server listens on 127.0.0.1 only.
    let options = format!(
        "nolocks,vers=3,tcp,inet,soft,timeo=10,retrans=2,actimeo=2,port={port},mountport={port}"
    );
    // Finder names the server after this host. Every `.localhost` name is this
    // Mac, so Finder lists the drives under Skywake, not a bare "localhost".
    let source = "skywake.localhost:/";
    if let Err(error) = run("/sbin/mount_nfs", &["-o", &options, source, path]).await {
        server.abort();
        saver.abort();
        return Err(format!("macOS would not mount the folder: {error}"));
    }
    Ok(Mounted {
        disk: disk.to_string(),
        branch: branch.to_string(),
        dir,
        remote,
        saver,
        server,
    })
}

fn describe(error: nfsstat3) -> String {
    match error {
        nfsstat3::NFS3ERR_ACCES => {
            "Skywake refused the change. Check that you may write here.".into()
        }
        nfsstat3::NFS3ERR_NOENT => "The branch is gone.".into(),
        _ => "Could not reach Skywake. Changes are kept and saved once it answers.".into(),
    }
}

async fn run(program: &str, args: &[&str]) -> Result<(), String> {
    let output = tokio::process::Command::new(program)
        .args(args)
        .output()
        .await
        .map_err(|error| error.to_string())?;
    if output.status.success() {
        return Ok(());
    }
    Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
}

fn child(dir: &str, name: &str) -> String {
    if dir.is_empty() {
        name.to_string()
    } else {
        format!("{dir}/{name}")
    }
}

fn parent_of(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(parent, _)| parent)
}

fn name_of(path: &str) -> &str {
    path.rsplit_once('/').map_or(path, |(_, name)| name)
}

/// Files Finder makes for itself. They are kept on this computer only.
fn finder_file(name: &str) -> bool {
    name == ".DS_Store" || name.starts_with("._")
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_or(0, |since| since.as_millis() as u64)
}

/// `saving_through_the_drive` mounts a new disk on a running skywake-api and
/// edits it the way apps do. Run with SKYWAKE_API and SKYWAKE_KEY set:
/// `cargo test -p skywake-desktop -- --ignored --nocapture`.
#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    #[test]
    fn drives_appear_under_their_environment() {
        let home = Path::new("/Users/someone");
        assert_eq!(
            folder_for(home, "prod/website", "main"),
            Path::new("/Users/someone/Skywake/prod/website")
        );
        assert_eq!(
            folder_for(home, "prod/website", "agents/fix-1"),
            Path::new("/Users/someone/Skywake/prod/website@agents-fix-1")
        );
        assert_eq!(
            folder_for(home, "notes", "main"),
            Path::new("/Users/someone/Skywake/notes")
        );
    }

    fn quiet() -> Arc<dyn Fn() + Send + Sync> {
        Arc::new(|| {})
    }

    async fn listed(api: &str, key: &str, name: &str, path: &str) -> Vec<(String, u64)> {
        let url = format!("{api}/v1/namespaces/{}/branches/main/files", encode(name));
        let listing: Listing = reqwest::Client::new()
            .get(url)
            .query(&[("path", path)])
            .bearer_auth(key)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        listing
            .entries
            .into_iter()
            .map(|info| (info.name, info.size))
            .collect()
    }

    fn sh(script: &str, dir: &Path) {
        let status = Command::new("sh")
            .arg("-c")
            .arg(script)
            .current_dir(dir)
            .status()
            .unwrap();
        assert!(status.success(), "{script}");
    }

    #[tokio::test(flavor = "multi_thread")]
    #[ignore = "needs a running skywake-api"]
    async fn saving_through_the_drive() {
        let api = std::env::var("SKYWAKE_API").unwrap_or("http://localhost:8080".into());
        let key = std::env::var("SKYWAKE_KEY").expect("SKYWAKE_KEY");
        let name = format!("qa/drive-test-{}", now());
        reqwest::Client::new()
            .post(format!("{api}/v1/namespaces"))
            .bearer_auth(&key)
            .json(&json!({ "name": name }))
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap();

        let drive = mount(
            Arc::new(Account::with_token(&api, &key)),
            &name,
            "main",
            quiet(),
        )
        .await
        .unwrap();
        let dir = drive.dir.clone();
        let wait = || tokio::time::sleep(Duration::from_secs(4));

        // A new file, a folder, and a file in it. `main` does not exist yet.
        sh(
            "printf 'hello' > notes.txt && mkdir docs && printf 'a plan' > docs/plan.md",
            &dir,
        );
        sh("test \"$(cat notes.txt)\" = hello", &dir);
        wait().await;
        let mut root = listed(&api, &key, &name, "").await;
        root.sort();
        assert_eq!(root, vec![("docs".into(), 0), ("notes.txt".into(), 5)]);
        assert_eq!(
            listed(&api, &key, &name, "docs").await,
            vec![("plan.md".into(), 6)]
        );

        // Saving the way editors do: a new file moved over the old one.
        sh(
            "printf 'hello, world' > .notes.tmp && mv .notes.tmp notes.txt",
            &dir,
        );
        wait().await;
        assert!(
            listed(&api, &key, &name, "")
                .await
                .contains(&("notes.txt".into(), 12))
        );

        // Appending, moving and deleting.
        sh(
            "printf '!' >> notes.txt && mv docs/plan.md plan.md && rm -r docs",
            &dir,
        );
        wait().await;
        let mut root = listed(&api, &key, &name, "").await;
        root.sort();
        assert_eq!(root, vec![("notes.txt".into(), 13), ("plan.md".into(), 6)]);
        sh("test \"$(cat notes.txt)\" = 'hello, world!'", &dir);

        // A big file goes up in several parts and reads back the same.
        sh(
            "head -c 20000000 /dev/urandom > big.bin && shasum big.bin > ../big.sum",
            &dir,
        );
        wait().await;
        assert!(
            listed(&api, &key, &name, "")
                .await
                .contains(&("big.bin".into(), 20_000_000))
        );
        let _ = Command::new("/sbin/umount").arg("-f").arg(&dir).status();
        let drive = mount(
            Arc::new(Account::with_token(&api, &key)),
            &name,
            "main",
            quiet(),
        )
        .await
        .unwrap();
        sh("shasum -c ../big.sum && rm big.bin ../big.sum", &drive.dir);

        // Finder's own files never reach the branch.
        sh("printf x > .DS_Store && printf x > ._notes.txt", &dir);
        wait().await;
        assert_eq!(listed(&api, &key, &name, "").await.len(), 2);

        let _ = Command::new("/sbin/umount").arg("-f").arg(&dir).status();
    }
}
