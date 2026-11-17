import json
from datetime import datetime

from ._drive import Item, call, collected, compact, listing, op, pages, segment
from .errors import NotFound

MAIN = "main"
UPSERT_ROWS = 10_000
UPSERT_BYTES = 24 * 1024 * 1024
PAGE = 1000


def target_of(target):
    if isinstance(target, (str, int)):
        return {"id": target}
    if isinstance(target, (list, tuple)):
        return {"ids": list(target)}
    if set(target) == {"filter"}:
        return {"filter": target["filter"]}
    return {"filter": target}


def batches(rows):
    batch, size = [], 0
    for row in rows:
        weight = len(json.dumps(row, separators=(",", ":")).encode())
        if len(batch) == UPSERT_ROWS or (batch and size + weight > UPSERT_BYTES):
            yield batch
            batch, size = [], 0
        batch.append(row)
        size += weight
    if batch:
        yield batch


def as_time(value):
    return value.isoformat() if isinstance(value, datetime) else value


class Index:
    def __init__(self, driver, name, branch=MAIN):
        self._driver = driver
        self.name = name
        self.branch = branch

    def __repr__(self):
        return f"Index({self.name!r}, branch={self.branch!r})"

    @property
    def _path(self):
        return f"/indexes/{segment(self.name)}"

    @property
    def _on(self):
        return {"branch": self.branch}

    def on(self, branch):
        return Index(self._driver, self.name, branch)

    @op
    def upsert(self, rows):
        done = {"ids": [], "count": 0}
        for batch in batches([rows] if isinstance(rows, dict) else rows):
            written = yield from call("POST", f"{self._path}/rows", self._on, batch)
            done["ids"] += written["ids"]
            done["count"] += written["count"]
        return done

    @op
    def update(self, target, fields):
        body = {**target_of(target), "fields": fields}
        return (yield from call("PATCH", f"{self._path}/rows", self._on, body))["count"]

    @op
    def delete(self, target):
        return (yield from call("POST", f"{self._path}/rows/delete", self._on, target_of(target)))["count"]

    @op
    def get(self, id):
        try:
            return (yield from call("GET", f"{self._path}/rows/{segment(id)}", self._on))
        except NotFound as error:
            if error.path == "id":
                return None
            raise

    def _query(self, text=None, *, vector=None, filter=None, limit=None, mode=None, sort=None, fields=None):
        body = compact(dict(text=text, vector=vector, filter=filter, limit=limit, mode=mode, sort=sort, fields=fields))
        page = yield from call("POST", f"{self._path}/query", body={**body, **self._on})
        return page["data"]

    @op
    def query(self, text=None, **options):
        return (yield from self._query(text, **options))

    @op
    def count(self, filter=None):
        body = compact({"filter": filter, **self._on})
        return (yield from call("POST", f"{self._path}/count", body=body))["count"]

    @op
    def aggregate(self, *, group_by=None, count=None, sum=None, avg=None, min=None, max=None, filter=None):
        body = compact(dict(group_by=group_by, count=count, sum=sum, avg=avg, min=min, max=max, filter=filter))
        return (yield from call("POST", f"{self._path}/aggregate", body={**body, **self._on}))["data"]

    @listing
    def rows(self, filter=None):
        if filter is None:
            yield from pages(f"{self._path}/rows", {**self._on, "limit": PAGE})
            return
        after = None
        while True:
            where = filter if after is None else {"and": [filter, {"id": {"gt": after}}]}
            hits = yield from self._query(filter=where, limit=PAGE)
            for hit in hits:
                hit.pop("score", None)
                yield Item(hit)
            if len(hits) < PAGE:
                return
            after = hits[-1]["id"]

    @op
    def fork(self, name, at=None):
        yield from call("POST", f"{self._path}/branches", body=compact({"name": name, "from": self.branch, "at": at}))
        return self.on(name)

    @op
    def merge_into(self, into=MAIN):
        return (yield from call("POST", f"{self._path}/merges", body={"from": self.branch, "into": into}))

    @op
    def destroy(self):
        if self.branch == MAIN:
            yield from call("DELETE", self._path)
        else:
            yield from call("DELETE", f"{self._path}/branches/{segment(self.branch)}")

    @op
    def branches(self):
        return (yield from collected(pages(f"{self._path}/branches")))

    @op
    def versions(self):
        return (yield from collected(pages(f"{self._path}/versions", self._on)))

    @op
    def restore(self, to):
        return (yield from call("POST", f"{self._path}/restore", body={"to": as_time(to), **self._on}))

    @op
    def copy(self, name, environment=None):
        yield from call("POST", f"{self._path}/copy", body=compact({"name": name, "environment": environment}))
        driver = self._driver.within(environment) if environment else self._driver
        return Index(driver, name)

    @op
    def info(self):
        return (yield from call("GET", self._path))

    @op
    def configure(self, *, read_only=None, retention_days=None, pinned=None, attributes=None, drop_attributes=None):
        body = compact(
            dict(
                read_only=read_only,
                retention_days=retention_days,
                pinned=pinned,
                attributes=attributes,
                drop_attributes=drop_attributes,
            )
        )
        return (yield from call("PATCH", self._path, body=body))
