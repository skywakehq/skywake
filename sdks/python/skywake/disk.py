import os
from datetime import datetime
from pathlib import Path

from ._changes import INLINE_MAX, PART_MAX, batches, chunks, inline, weight
from ._drive import Item, call, collected, compact, file_path, listing, op, pages, raw, segment
from .errors import NotFound

MAIN = "main"


def clean(path):
    return path.strip("/")


def parent_of(path):
    return path.rpartition("/")[0]


def parsed(stamp):
    return datetime.fromisoformat(stamp.replace("Z", "+00:00"))


class Disk:
    def __init__(self, driver, name, branch=MAIN):
        self._driver = driver
        self.name = name
        self.branch = branch

    def __repr__(self):
        return f"Disk({self.name!r}, branch={self.branch!r})"

    @property
    def _path(self):
        return f"/disks/{segment(self.name)}"

    @property
    def _on(self):
        return {"branch": self.branch}

    def on(self, branch):
        return Disk(self._driver, self.name, branch)

    @op
    def read(self, path, *, at=None, offset=None, length=None, binary=False):
        query = {**self._on, "at": at, "offset": offset, "length": length}
        response = yield from raw("GET", f"{self._path}/files/{file_path(path)}", query)
        return response.content if binary else response.content.decode("utf-8")

    def _change(self, path, content, executable=None):
        data = content.encode("utf-8") if isinstance(content, str) else bytes(content)
        if len(data) <= INLINE_MAX:
            return inline(clean(path), data, executable)
        parts = []
        for chunk in chunks(data):
            parts.append((yield from self._part(chunk)))
        flags = {} if executable is None else {"executable": executable}
        return {"path": clean(path), "parts": parts, **flags}

    def _commit(self, changes, message=None):
        body = compact({"changes": changes, "message": message, **self._on})
        return (yield from call("POST", f"{self._path}/commits", body=body))

    def _part(self, data):
        return (yield from call("POST", f"{self._path}/uploads", content=data))["part"]

    @op
    def write(self, target, content=None, *, message=None, executable=None):
        files = {target: content} if isinstance(target, str) else target
        changes = []
        for path, body in files.items():
            changes.append((yield from self._change(path, body, executable)))
        return (yield from self._commit(changes, message))

    @op
    def commit(self, changes, message=None):
        return (yield from self._commit(changes, message))

    @op
    def part(self, data):
        return (yield from self._part(data))

    @op
    def delete(self, paths, *, message=None):
        names = [paths] if isinstance(paths, str) else paths
        return (yield from self._commit([{"path": clean(p), "delete": True} for p in names], message))

    @op
    def move(self, source, target, *, message=None):
        changes = [
            {"path": clean(target), "from": {"path": clean(source)}},
            {"path": clean(source), "delete": True},
        ]
        return (yield from self._commit(changes, message or f"Move {clean(source)} to {clean(target)}"))

    def _entries(self, path="", recursive=False, at=None):
        query = {"path": clean(path), "recursive": recursive or None, "at": at, "limit": 1000, **self._on}
        return pages(f"{self._path}/files", query)

    @listing
    def entries(self, path="", *, recursive=False, at=None):
        return (yield from self._entries(path, recursive, at))

    @op
    def list(self, path="", *, recursive=False, at=None):
        return (yield from collected(self._entries(path, recursive, at)))

    def _walk(self, path, at):
        found = yield from collected(self._entries(path, at=at))
        for entry in found:
            yield Item(entry)
            if entry["kind"] == "folder":
                yield from self._walk(entry["path"], at)

    def _stat(self, path, at=None):
        target = clean(path)
        if not target:
            return {"path": "", "kind": "folder", "size": 0, "modified": None, "executable": False}
        try:
            found = yield from collected(self._entries(parent_of(target), at=at))
        except NotFound:
            yield from call("GET", self._path)
            return None
        return next((entry for entry in found if entry["path"] == target), None)

    @op
    def stat(self, path, *, at=None):
        return (yield from self._stat(path, at))

    @op
    def exists(self, path, *, at=None):
        return (yield from self._stat(path, at)) is not None

    @op
    def grep(self, pattern, *, path=None, glob=None, ignore_case=None, limit=None, at=None):
        body = compact(dict(pattern=pattern, path=path, glob=glob, ignore_case=ignore_case, limit=limit, at=at))
        return (yield from call("POST", f"{self._path}/grep", body={**body, **self._on}))["data"]

    @op
    def find(self, glob, *, path=None, kind=None, limit=None, at=None):
        body = compact(dict(glob=glob, path=path, kind=kind, limit=limit, at=at))
        return (yield from call("POST", f"{self._path}/find", body={**body, **self._on}))["data"]

    @op
    def query(self, text, *, limit=None, path=None):
        body = compact(dict(text=text, limit=limit, path=path))
        return (yield from call("POST", f"{self._path}/query", body={**body, **self._on}))["data"]

    @op
    def fork(self, name, at=None):
        yield from call("POST", f"{self._path}/branches", body=compact({"name": name, "from": self.branch, "at": at}))
        return self.on(name)

    @op
    def merge_into(self, into=MAIN, *, message=None, dry_run=None, prefer=None):
        body = compact({"from": self.branch, "into": into, "message": message, "dry_run": dry_run, "prefer": prefer})
        return (yield from call("POST", f"{self._path}/merges", body=body))

    @op
    def destroy(self):
        if self.branch == MAIN:
            yield from call("DELETE", self._path)
        else:
            yield from call("DELETE", f"{self._path}/branches/{segment(self.branch)}")

    @op
    def branches(self):
        return (yield from collected(pages(f"{self._path}/branches")))

    def _head(self):
        branch = yield from call("GET", f"{self._path}/branches/{segment(self.branch)}")
        return branch["head"]

    @op
    def head(self):
        return (yield from self._head())

    def _log(self, path=None, limit=None):
        return pages(f"{self._path}/commits", {"path": path, "limit": limit, **self._on})

    @listing
    def log(self, *, path=None, limit=None):
        return (yield from self._log(path, limit))

    @op
    def diff(self, against):
        return (yield from collected(pages(f"{self._path}/diff", {"against": against, **self._on})))

    @op
    def revert(self, commit, *, message=None):
        body = compact({"commit": commit, "message": message, **self._on})
        return (yield from call("POST", f"{self._path}/revert", body=body))

    @op
    def restore(self, to):
        commit = to
        if isinstance(to, datetime):
            when = to.timestamp()
            commits = yield from collected(self._log(limit=1000))
            commit = next((c["id"] for c in commits if parsed(c["created"]).timestamp() <= when), None)
            if commit is None:
                raise ValueError(f"disk `{self.name}` has no commit from {to.isoformat()} or before")
        return (yield from call("POST", f"{self._path}/restore", body={"to": commit, **self._on}))

    @op
    def download(self, directory, *, at=None):
        root = Path(directory).resolve()
        root.mkdir(parents=True, exist_ok=True)
        at = at or (yield from self._head())
        if not at:
            return None
        for entry in (yield from collected(self._walk("", at))):
            local = root.joinpath(*entry["path"].split("/")).resolve()
            if root not in local.parents:
                raise ValueError(f"`{entry['path']}` is outside {root}")
            if entry["kind"] == "folder":
                local.mkdir(parents=True, exist_ok=True)
            elif entry["kind"] == "symlink":
                local.unlink(missing_ok=True)
                local.symlink_to(entry.get("target", ""))
            else:
                response = yield from raw("GET", f"{self._path}/files/{file_path(entry['path'])}", {"at": at})
                local.write_bytes(response.content)
                if entry["executable"]:
                    local.chmod(0o755)
        return at

    @op
    def upload(self, directory, *, message=None):
        files = local_files(Path(directory).resolve())
        head = None
        for batch in batches(files, lambda f: weight(f[0], f[1].stat().st_size)):
            changes = []
            for name, local in batch:
                changes.append((yield from self._local_change(name, local)))
            head = (yield from self._commit(changes, message))["commit"]
        return head or (yield from self._head())

    def _local_change(self, name, local):
        info = local.stat()
        executable = bool(info.st_mode & 0o111)
        if info.st_size <= INLINE_MAX:
            return inline(name, local.read_bytes(), executable)
        parts = []
        with local.open("rb") as handle:
            while chunk := handle.read(PART_MAX):
                parts.append((yield from self._part(chunk)))
        return {"path": name, "parts": parts, "executable": executable}

    @op
    def info(self):
        return (yield from call("GET", self._path))

    @op
    def configure(self, *, search=None, visibility=None):
        return (yield from call("PATCH", self._path, body=compact({"search": search, "visibility": visibility})))


def local_files(root):
    found = []
    for folder, names, files in os.walk(root):
        names[:] = [name for name in names if name != ".git"]
        for file in files:
            local = Path(folder) / file
            if local.is_file() and not local.is_symlink():
                found.append((local.relative_to(root).as_posix(), local))
    return sorted(found)
