import json

from ._encode import compact, encryption, name_in_url, pinned
from ._http import check_or_close, iter_closing
from ._paging import every, page

# The most documents or ids the API takes in one request.
BATCH = 1000


class Results(list):
    """What a read returns: a list, with how long it took and where its
    reads came from in `performance`, such as {"server_ms": 3,
    "cache_temperature": "warm", "cache_hit_ratio": 0.5}, and what it
    counted toward the bill in `billing`, such as {"queries": 1}."""

    def __init__(self, items, performance=None, billing=None):
        super().__init__(items)
        self.performance = performance
        self.billing = billing


def _results(answer, field):
    return Results(answer[field], answer.get("performance"), answer.get("billing"))


def _batched(items, send):
    """Sends `items` BATCH at a time and sums what each answer counts."""
    return sum(send(items[start : start + BATCH]) for start in range(0, len(items), BATCH))


# `update` leaves the retention as it is unless given one, as None clears it.
_UNSET = object()


class SearchIndex:
    """One branch of a search index: `main` unless `at` picked another."""

    def __init__(self, sky, name, branch="main"):
        self.sky = sky
        self.name = name
        self.branch = branch
        self.path = f"/indexes/{name_in_url(name)}"
        self.branch_path = f"{self.path}/branches/{name_in_url(branch)}"

    def at(self, branch):
        """The same index on another branch."""
        return SearchIndex(self.sky, self.name, branch)

    def upsert(self, documents):
        """Writes documents, 1000 to a request. Each replaces any earlier one
        with its id. A document is {"id", "vectors": {column: [...]},
        "attributes": {...}}. A vector may be text, or {"image": url}, when
        its column has "embed": the server embeds it."""
        return _batched(documents, lambda part: self._post("documents", {"documents": part})["count"])

    def delete(self, ids):
        """Deletes documents by id. Ids that are not there are ignored."""
        return _batched(ids, lambda part: self._post("documents/delete", {"ids": part})["count"])

    def write(
        self,
        upserts=None,
        patches=None,
        deletes=None,
        upsert_if=None,
        patch_if=None,
        delete_if=None,
        delete_by=None,
        patch_by=None,
        return_affected_ids=False,
    ):
        """Upserts, patches and deletes as one change, in this order:
        `delete_by`, `patch_by`, `upserts`, `patches`, `deletes`. A patch is
        {"id", "attributes"}, where None removes an attribute; `patch_by` is
        {"filter", "attributes"}. A condition is a filter checked against each
        document as it was, whose values may be {"$ref_new": attribute}, such
        as {"version": {"lt": {"$ref_new": "version"}}}. Returns
        {"upserted", "patched", "deleted"}, and with `return_affected_ids`
        also "upserted_ids", "patched_ids" and "deleted_ids"."""
        body = {
            "upserts": upserts,
            "patches": patches,
            "deletes": deletes,
            "upsertIf": upsert_if,
            "patchIf": patch_if,
            "deleteIf": delete_if,
            "deleteBy": delete_by,
            "patchBy": patch_by,
            "returnAffectedIds": return_affected_ids or None,
        }
        return self._post("write", body)

    def patch(self, patches):
        """Sets attributes of documents, 1000 to a request; None removes one.
        Missing documents are skipped. Returns how many were patched."""
        return _batched(patches, lambda part: self.write(patches=part)["patched"])

    def delete_by(self, filter):
        """Deletes every document that passes `filter`; returns how many."""
        return self.write(delete_by=filter)["deleted"]

    def order(
        self,
        by,
        descending=False,
        top_k=10,
        offset=None,
        filter=None,
        include=None,
        exclude=None,
        consistency=None,
    ):
        """Documents in the order of an attribute, or of "id"; those without
        it come last."""
        body = {
            "by": by,
            "descending": descending,
            "topK": top_k,
            "offset": offset,
            "filter": filter,
            "include": include,
            "exclude": exclude,
            "consistency": consistency,
        }
        return self._read("order", "rows", body)

    def rank(self, score, top_k=10, offset=None, filter=None, include=None, exclude=None, consistency=None):
        """Every document that passes `filter`, best first by an exact score,
        such as {"dot": {"attribute", "indices", "values"}} for sparse vectors
        or {"max_sim": {"attribute", "vectors"}} for late interaction. Those
        scoring 0 are left out. Returns [{"id", "score", "attributes"}]."""
        body = {
            "score": score,
            "topK": top_k,
            "offset": offset,
            "filter": filter,
            "include": include,
            "exclude": exclude,
            "consistency": consistency,
        }
        return self._read("rank", "hits", body)

    def aggregate(self, measures, group_by=None, filter=None, consistency=None):
        """Measures over the documents that pass `filter`, in one group or a
        group per set of `group_by` values. Each measure is named, such as
        {"total": ["count"], "revenue": ["sum", "price"]}; the others are
        "avg", "min" and "max". Returns [{"key", "values"}]."""
        body = {"measures": measures, "groupBy": group_by, "filter": filter, "consistency": consistency}
        return self._read("aggregate", "groups", body)

    def multi(self, requests, consistency=None):
        """Several requests on one snapshot, each one of {"query": ...},
        {"search": ...}, {"hybrid": ...}, {"order": ...}, {"rank": ...} or {"aggregate": ...}
        with the API's request body. Each result is in the field it was asked in."""
        body = {"requests": requests, "consistency": consistency}
        return self._read("multi", "results", body)

    def export(self):
        """Every document as it is now, streamed, in no set order."""
        response = self._export()
        yield from iter_closing(response, (json.loads(line) for line in response.iter_lines() if line))

    def export_parquet(self):
        """Every document as it is now, as the bytes of a Parquet file, streamed."""
        response = self._export({"format": "parquet"})
        yield from iter_closing(response, response.iter_bytes())

    def copy(self, name, region=None, kms_key_id=None):
        """Copies this branch to a new index `name`, as its `main`."""
        body = {"name": name, "branch": self.branch, "region": region, "encryption": encryption(kms_key_id)}
        self.sky.call("POST", f"{self.path}/copy", json=body)
        return SearchIndex(self.sky, name)

    def query(
        self,
        column,
        vector,
        top_k=10,
        probe=None,
        filter=None,
        include=None,
        recall=None,
        offset=None,
        rerank=None,
        exclude=None,
        per=None,
        consistency=None,
    ):
        """The `top_k` nearest documents to `vector` in `column` that pass
        `filter`, nearest first. A filter is keyword objects, such as
        {"and": [{"tag": {"eq": "billing"}}, {"price": {"lt": 10}}]};
        {"id": {"in": [...]}} filters by id. `include` names the attributes
        to return, or `exclude` those to leave out. `per`, such as
        {"attributes": ["file"], "limit": 3}, keeps at most `limit` hits for
        each value. `consistency="eventual"` may read what the server saw up
        to a minute ago, which is faster. The hits carry `performance`.
        `recall` is the share of the true nearest to find, from 0 to 1
        (0.95 by default; 1 reads every cluster and returns exactly the true
        nearest by the column's metric); `probe` overrides it with a number
        of clusters to read. `vector` may be text when the column has
        "embed". `rerank`, such as {"model": "rerank-v3.5", "field": "body",
        "query": "...", "topN": 5}, orders the hits again with a rerank
        model and gives each a "rerank_score"; it ranks by the vector's
        text when it names no "query"."""
        body = {
            "vector": {"column": column, "value": vector if isinstance(vector, str) else list(vector)},
            "topK": top_k,
            "recall": recall,
            "probe": probe,
            "filter": filter,
            "include": include,
            "exclude": exclude,
            "offset": offset,
            "per": per,
            "consistency": consistency,
            "rerank": rerank,
        }
        return self._read("query", "hits", body)

    def search(
        self,
        query,
        top_k=10,
        fields=None,
        boosts=None,
        k1=None,
        b=None,
        filter=None,
        include=None,
        highlight=None,
        offset=None,
        rerank=None,
        exclude=None,
        per=None,
        consistency=None,
        fuzzy=None,
        last_as_prefix=None,
    ):
        """The `top_k` documents that best match `query` by BM25, best first,
        each with its `score`. `fields` are the text attributes to search
        (every one by default) and `boosts` a weight per field, such as
        {"title": 2}. `k1` and `b` override BM25's parameters. A filter may
        also hold {"body": {"phrase": "reset password"}}, {"prefix": ...},
        {"contains_all_tokens": ...} or {"contains_any_token": ...} at the
        top or inside "and". `highlight` names text attributes to
        return the best fragment of, with marks as [start, end) offsets.
        `rerank` orders the hits again, as in `query`, by `query` unless it
        names its own. `fuzzy` (1 or 2) also matches words that many typos
        away. `last_as_prefix=True` lets the last word match longer words, so
        "red sho" finds "red shoes". `exclude`, `per` and `consistency` are
        as in `query`."""
        body = {
            "query": query,
            "topK": top_k,
            "fields": fields,
            "boosts": boosts,
            "k1": k1,
            "b": b,
            "filter": filter,
            "include": include,
            "exclude": exclude,
            "highlight": highlight,
            "fuzzy": fuzzy,
            "lastAsPrefix": last_as_prefix,
            "offset": offset,
            "per": per,
            "consistency": consistency,
            "rerank": rerank,
        }
        return self._read("search", "hits", body)

    def hybrid(
        self, searches, top_k=10, k=None, weights=None, offset=None, rerank=None, per=None, consistency=None, rank=None
    ):
        """Named searches on one snapshot, fused by reciprocal rank. Each
        search is a query body (with "vector") or a search body (with
        "query"), such as {"meaning": {"vector": {"column": "embedding",
        "value": [...]}, "topK": 50}, "words": {"query": "reset", "topK": 50}}.
        A hit scores the sum of weight / (k + rank); `k` is 60 and weights
        are 1 by default. `rerank` orders the fused hits again, as in
        `query`, by the first text search's words unless it names a "query".
        `per` and `consistency` are as in `query`. `rank` scores the hits by
        an expression instead, such as {"sum": [{"search": "title"},
        {"search": "body"}]}; see the API's Score."""
        body = {
            "searches": searches,
            "topK": top_k,
            "fuse": compact({"k": k, "weights": weights}),
            "offset": offset,
            "per": per,
            "consistency": consistency,
            "rank": rank,
            "rerank": rerank,
        }
        return self._read("hybrid", "hits", body)

    def get(self, id):
        """The document with `id`. A missing one raises SkywakeError with
        status 404, as a missing index or branch does."""
        return self.sky.call("GET", f"{self.branch_path}/documents/{name_in_url(str(id))}").json()

    def documents(self, limit=None, cursor=None):
        """One page of documents by id, number ids first: {"documents", "next"}.
        Pass `next` as `cursor` for the next page. It reads every segment, so
        it is for browsing."""
        params = compact({"limit": limit, "cursor": cursor})
        return self.sky.call("GET", f"{self.branch_path}/documents", params=params).json()

    def iter_documents(self):
        """Every document, a page at a time."""
        cursor = None
        while True:
            answer = self.documents(limit=1000, cursor=cursor)
            yield from answer["documents"]
            cursor = answer["next"]
            if not cursor:
                return

    def fork(self, name, version=None):
        """Forks this branch as `name`, at its head or at an older `version`.
        Nothing is copied."""
        body = {"name": name, "from": self.branch}
        if version is not None:
            body["at"] = version
        self.sky.call("POST", f"{self.path}/branches", json=body)
        return self.at(name)

    def versions(self, limit=None, after=None):
        """One page of this branch's versions, newest first: one for every change."""
        return self.sky.call("GET", f"{self.branch_path}/versions", params=page(limit, after)).json()

    def restore(self, version):
        """Moves this branch back to an older version, as a new version, which it returns."""
        return self._post("restore", {"version": version})

    def collect(self):
        """Starts deleting the data of the whole index that no branch uses, nor
        any version within its `retention_days`. Returns the operation."""
        return self.sky.call("POST", f"{self.path}/collect").json()

    def stats(self):
        """This branch's counts, or None while the server cannot count them."""
        return self.sky.call("GET", self.branch_path).json()["stats"]

    def build(self):
        """Starts clustering this branch's rows. It answers before the build
        ends, with an operation `operation(id)` follows."""
        return self._post("build")

    def merge(self, branch):
        """Adds the writes of `branch` since it forked, or was last merged
        here, to this branch, and returns how many it added. Where both
        wrote one document, `branch`'s write wins."""
        return self._post("merge", {"from": branch})["rows"]

    def warm(self):
        """Starts reading this branch into the cache, so the next queries
        are fast. Returns the operation."""
        return self._post("warm")

    def operation(self, id):
        """A build or warming of this index, and how it went."""
        return self.sky.call("GET", f"{self.path}/operations/{name_in_url(id)}").json()

    def recall(self, column=None, queries=None, top_k=None, recall=None, filter=None):
        """How many of the true nearest documents queries find: queries with
        the vectors of `queries` documents picked at random, as asked and
        exactly, and compares them."""
        return self._post(
            "recall", {"column": column, "queries": queries, "topK": top_k, "recall": recall, "filter": filter}
        )

    def branches(self, limit=None, after=None):
        """One page of the index's branches, in name order."""
        return self.sky.call("GET", f"{self.path}/branches", params=page(limit, after)).json()

    def iter_branches(self):
        """Every branch, a page at a time."""
        return every(self.branches, lambda branch: branch["name"])

    def delete_branch(self):
        """Deletes this branch. `main` stays while the index does."""
        self.sky.call("DELETE", self.branch_path)

    def _post(self, route, body=None):
        return self.sky.call("POST", f"{self.branch_path}/{route}", json=body).json()

    def _read(self, route, field, body):
        return _results(self._post(route, body), field)

    def _export(self, params=None):
        response = self.sky.send("GET", f"{self.branch_path}/export", params=params, stream=True)
        return check_or_close(response)


class Indexes:
    """The organization's indexes."""

    def __init__(self, sky):
        self.sky = sky

    def create(
        self, name, vectors=(), attributes=(), region=None, shards=None, kms_key_id=None, id_type=None, replicas=None
    ):
        """Makes an index with an empty `main` branch. `vectors` is a list of
        {"name", "dims", "metric", "element"}, plus {"embed": {"model": "..."}}
        to give that vector as text; `attributes` of {"name", "type"}. A
        "text" attribute is searched by BM25 and may set "k1" and "b", the
        "language" it is stemmed in ("english" by default, or "none") and
        "stopwords": True to drop that language's stopwords. Any attribute
        may set "filter_index": True to keep its rows sorted by value, so a
        filter on it that passes few rows reads only those.
        `shards` splits the documents (1 by default); `kms_key_id` is a key
        in your cloud's key service that encrypts the index. `id_type="uuid"`
        makes every id a UUID, returned lowercase with dashes; by default an
        id is a string or a whole number. `replicas` pins the index to that
        many servers, billed per GB-hour instead of per query."""
        schema = {"vectors": list(vectors), "attributes": list(attributes)}
        if id_type is not None:
            schema["id"] = id_type
        body = {
            "name": name,
            "schema": schema,
            "region": region,
            "shards": shards,
            "encryption": encryption(kms_key_id),
            "pinned": pinned(replicas),
        }
        self.sky.call("POST", "/indexes", json=body)
        return SearchIndex(self.sky, name)

    def list(self, limit=None, after=None):
        """One page of indexes, in name order."""
        return self.sky.call("GET", "/indexes", params=page(limit, after)).json()

    def __iter__(self):
        """Every index, a page at a time."""
        return every(self.list, lambda index: index["name"])

    def get(self, name):
        """The schema, and the counts of `main`."""
        return self.sky.call("GET", f"/indexes/{name_in_url(name)}").json()

    def usage(self, name, days=None):
        """Queries, writes and size per day over the last `days` days (14 by
        default), oldest first."""
        params = {} if days is None else {"days": days}
        return self.sky.call("GET", f"/indexes/{name_in_url(name)}/usage", params=params).json()["days"]

    def update(self, name, attributes=None, read_only=None, retention_days=_UNSET, replicas=_UNSET):
        """Adds `attributes` ({"name", "type"} each), or makes the index
        read-only or writable again, on every branch. An attribute it has
        must keep its type. `retention_days` is how long older versions
        stay after they were replaced; None keeps every one. `replicas`
        pins the index to that many servers; None unpins it."""
        body = compact({"attributes": attributes, "read_only": read_only})
        if retention_days is not _UNSET:
            body["retention_days"] = retention_days
        if replicas is not _UNSET:
            body["pinned"] = pinned(replicas)
        # As text, since `call` leaves out fields set to None.
        headers = {"content-type": "application/json"}
        path = f"/indexes/{name_in_url(name)}"
        return self.sky.call("PATCH", path, content=json.dumps(body), headers=headers).json()

    def delete(self, name):
        """Deletes the index, every branch and all its data."""
        self.sky.call("DELETE", f"/indexes/{name_in_url(name)}")
