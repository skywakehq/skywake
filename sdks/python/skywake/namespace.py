from dataclasses import dataclass, field

from ._encode import name_in_url
from ._http import check
from ._paging import every, page
from .branch import Branch
from .session import Session


@dataclass
class Merge:
    """What a merge did. `conflicts` is empty when it landed."""

    head: str | None
    conflicts: list = field(default_factory=list)

    @property
    def ok(self):
        return not self.conflicts


class Namespace:
    def __init__(self, sky, name):
        self.sky = sky
        self.name = name
        self.path = f"/namespaces/{name_in_url(name)}"

    def branch(self, name):
        return Branch(self, name)

    def branches(self, limit=None, after=None):
        """One page of branches, in name order."""
        return self.sky.call("GET", f"{self.path}/branches", params=page(limit, after)).json()

    def iter_branches(self):
        """Every branch, a page at a time."""
        return every(self.branches, lambda branch: branch["name"])

    def create_branch(self, name):
        """Creates an empty branch."""
        self.sky.call("POST", f"{self.path}/branches", json={"name": name})
        return self.branch(name)

    def merge(self, source, into, message=None, session=None, resolve=None, dry_run=None):
        """Merges `source` into `into`. Merges into one branch run one at a
        time. On a conflict nothing is saved, and the paths are listed.

        `resolve` settles conflicts by path. Each is `{"path"}` with one of
        `"take": "ours" | "theirs"`, `"text"`, `"base64"`, `"parts"` or
        `"delete": True`. Paths it leaves open are listed as conflicts.
        `dry_run=True` saves nothing and only lists the conflicts."""
        body = {
            "from": source,
            "into": into,
            "message": message,
            "session": session,
            "resolve": resolve,
            "dry_run": dry_run,
        }
        response = self.sky.send("POST", f"{self.path}/merges", json=body)
        if response.status_code == 409:
            return Merge(None, response.json()["conflicts"])
        merged = check(response).json()
        return Merge(merged["head"], merged.get("conflicts", []))

    def credentials(self, access="write"):
        """Short-lived S3 credentials that reach only this namespace's data.
        The server answers 501 when it has no STS role to mint them with."""
        return self.sky.call("POST", f"{self.path}/credentials", json={"access": access}).json()

    def session(self, label="", seconds=60):
        """Starts a session. Use it in `with`, or call `heartbeat` yourself."""
        body = {"label": label, "seconds": seconds}
        session = self.sky.call("POST", f"{self.path}/sessions", json=body).json()
        return Session(self, session["id"], seconds)

    def sessions(self, limit=None, after=None):
        """One page of the live sessions."""
        return self.sky.call("GET", f"{self.path}/sessions", params=page(limit, after)).json()

    def iter_sessions(self):
        """Every live session, a page at a time."""
        return every(self.sessions, lambda session: session["id"])
