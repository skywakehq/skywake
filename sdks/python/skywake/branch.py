import base64

from ._encode import compact, name_in_url
from ._http import check, check_or_close, iter_closing
from ._paging import every, page


class Branch:
    def __init__(self, namespace, name):
        self.namespace = namespace
        self.name = name
        self.path = f"{namespace.path}/branches/{name_in_url(name)}"

    def _call(self, method, route, **kwargs):
        return self.namespace.sky.call(method, f"{self.path}{route}", **kwargs)

    def fork(self, name, at=None):
        """Forks this branch as `name`, at its head or at an older commit
        `at`. No data is copied."""
        body = {"name": name, "from": self.name}
        if at is not None:
            body["at"] = at
        self.namespace.sky.call("POST", f"{self.namespace.path}/branches", json=body)
        return self.namespace.branch(name)

    def info(self):
        return self._call("GET", "").json()

    def delete(self):
        self._call("DELETE", "")

    def protect(self, protected=True):
        """A protected branch changes only by merge. Needs an admin key."""
        self._call("PATCH", "", json={"protected": protected})

    def list(self, path="", limit=None, after=None):
        """Describes a path. For a folder, `entries` lists one page of what it
        holds, in name order."""
        return self._call("GET", "/files", params={"path": path} | page(limit, after)).json()

    def iter_entries(self, path=""):
        """Everything a folder holds, a page at a time."""
        return every(lambda limit, after: self.list(path, limit, after)["entries"], lambda entry: entry["name"])

    def read(self, path, offset=0, length=None, at=None):
        """Reads a file as bytes, or `length` bytes of it from `offset`.
        `at` reads it as it was in an older commit."""
        params = {"path": path, "offset": offset}
        if length is not None:
            params["length"] = length
        if at is not None:
            params["at"] = at
        return self._call("GET", "/files/content", params=params).content

    def read_stream(self, path, offset=0, length=None, at=None):
        """Like `read`, but gives the file in pieces as they arrive, so a
        large file need not fit in memory. Errors such as a missing file are
        raised here, before the first piece."""
        params = compact({"path": path, "offset": offset, "length": length, "at": at})
        response = self.namespace.sky.send("GET", f"{self.path}/files/content", params=params, stream=True)
        check_or_close(response)
        return iter_closing(response, response.iter_bytes())

    def read_text(self, path):
        return self.read(path).decode()

    def search(self, pattern, path="", limit=100):
        """Lines that match a regular expression, like `grep -rn`."""
        params = {"pattern": pattern, "path": path, "limit": limit}
        return self._call("GET", "/search", params=params).json()

    def commit(self, message, changes, session=None):
        """Applies changes as one commit and returns the new head. Each
        change is `{"path", "text"}`, `{"path", "base64"}` or
        `{"path", "delete": True}`."""
        body = {"message": message, "changes": changes, "session": session}
        return self._call("POST", "/commits", json=body).json()["head"]

    def write(self, files, message, session=None):
        """Writes files (text or bytes), as one commit."""
        changes = []
        for path, content in files.items():
            if isinstance(content, bytes):
                changes.append({"path": path, "base64": base64.b64encode(content).decode()})
            else:
                changes.append({"path": path, "text": content})
        return self.commit(message, changes, session)

    def remove(self, paths, message, session=None):
        return self.commit(message, [{"path": path, "delete": True} for path in paths], session)

    def log(self, limit=50):
        return self._call("GET", "/commits", params={"limit": limit}).json()

    def history(self, path, limit=None, after=None):
        """One page of the versions of one file, newest first. Read one with
        `read(path, at=...)`."""
        return self._call("GET", "/files/history", params={"path": path} | page(limit, after)).json()

    def iter_history(self, path):
        """Every version of one file, a page at a time."""
        return every(lambda limit, after: self.history(path, limit, after), lambda version: version["hash"])

    def changes(self, since=None, limit=50):
        """What each commit after `since` changed, oldest first."""
        params = {"limit": limit} | ({"since": since} if since else {})
        return self._call("GET", "/changes", params=params).json()

    def diff(self, source, limit=None, after=None, against=None):
        """One page of what changed from the branch `source` to this one, in
        path order. `against="base"` shows only what this branch changed
        since the two last shared a commit, like `git diff source...branch`."""
        params = {"from": source} | compact({"against": against}) | page(limit, after)
        return self._call("GET", "/diff", params=params).json()

    def iter_diff(self, source, against=None):
        """Everything that changed from the branch `source`, a page at a time."""
        return every(lambda limit, after: self.diff(source, limit, after, against), lambda change: change["path"])

    def revert(self, commit, message=None, session=None):
        """Undoes one commit with a new commit that puts back what it
        changed. Returns `{"head", "changed"}`. If the branch changed any of
        those paths since, nothing is saved and it raises a SkywakeError
        (409) whose `conflicts` lists them."""
        body = {"commit": commit, "message": message, "session": session}
        return self._call("POST", "/revert", json=body).json()

    def reset(self, to, message=None, session=None):
        """Makes the branch's files what they were at commit `to`, as one
        new commit on top. Returns `{"head", "changed"}`."""
        body = {"to": to, "message": message, "session": session}
        return self._call("POST", "/reset", json=body).json()

    def merge_into(self, into, message=None, session=None, resolve=None, dry_run=None):
        return self.namespace.merge(self.name, into, message, session, resolve, dry_run)

    def claim(self, path, session):
        """Claims a path for a session. Returns False if another live
        session holds it, a folder above it, or a path below it."""
        response = self.namespace.sky.send("POST", f"{self.path}/claims", json={"path": path, "session": session})
        if response.status_code == 409:
            return False
        check(response)
        return True

    def release(self, path, session):
        self._call("DELETE", "/claims", params={"path": path, "session": session})

    def claims(self, limit=None, after=None):
        """One page of the paths claimed by live sessions, in path order."""
        return self._call("GET", "/claims", params=page(limit, after)).json()

    def iter_claims(self):
        """Every claimed path, a page at a time."""
        return every(self.claims, lambda claim: claim["path"])
