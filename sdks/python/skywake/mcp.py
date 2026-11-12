"""An MCP server, so any MCP-capable agent can work in its own branch of
files, and search, write and fork search indexes.

Settings come from the environment:

- `SKYWAKE_URL` and `SKYWAKE_KEY`: the API and a key for it.
- `SKYWAKE_NAMESPACE`: the namespace to work in. Without it, only the
  index tools are offered.
- `SKYWAKE_BRANCH`: the branch file tools use when none is given. With
  `SKYWAKE_FORK_FROM`, it is first forked from that branch, unless it is
  already there, so a server that stopped can start again on its work.

With a namespace, the server is one session: it starts one when it starts,
keeps it alive, and every commit it makes records it. A key that can only
read gets no session, and no write tools.

If it can't start, it still answers, and every tool says why.
"""

import functools
import logging
import os
import sys
from typing import Annotated, Any

import httpx
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations
from pydantic import BaseModel, Field

from ._encode import compact
from .client import Skywake
from .errors import SkywakeError

server = MCPServer("skywake")
state = {}

FILE_TOOLS = ["fork", "list_files", "read_file", "search", "write_files", "delete_files", "diff", "log", "merge"]
WRITE_TOOLS = [
    "fork",
    "write_files",
    "delete_files",
    "merge",
    "upsert_documents",
    "delete_documents",
    "fork_index_branch",
]

READ = ToolAnnotations(read_only_hint=True, open_world_hint=False)


def _api_errors(tool):
    """Shows the API's error to the agent, such as `filter.price.lt: must be
    number`, so it can fix its call. Other errors reach it only as
    `Error executing tool`."""

    @functools.wraps(tool)
    def call(*args, **kwargs):
        if "startup_error" in state:
            raise ToolError(state["startup_error"])
        try:
            return tool(*args, **kwargs)
        except SkywakeError as error:
            raise ToolError(str(error)) from error

    return call


def _branch(branch):
    return state["namespace"].branch(branch or state["branch"])


@server.tool()
@_api_errors
def fork(name: str, source: str = "") -> str:
    """Fork a branch (the working branch by default) as `name`. No data is
    copied. Returns the new branch name."""
    _branch(source).fork(name)
    return name


@server.tool(annotations=READ)
@_api_errors
def list_files(path: str = "", branch: str = "") -> dict:
    """Describe a path. For a folder, `entries` lists what it holds."""
    return _branch(branch).list(path)


@server.tool(annotations=READ)
@_api_errors
def read_file(path: str, offset: int = 0, length: int = 1_000_000, branch: str = "") -> str:
    """Read a text file, or part of it."""
    return _branch(branch).read(path, offset, length).decode(errors="replace")


@server.tool(annotations=READ)
@_api_errors
def search(pattern: str, path: str = "", branch: str = "") -> list:
    """Find lines that match a regular expression, like `grep -rn`."""
    return _branch(branch).search(pattern, path)


@server.tool()
@_api_errors
def write_files(files: dict[str, str], message: str, branch: str = "") -> str:
    """Write text files (path to content) as one commit. Returns the commit."""
    return _branch(branch).write(files, message, state["session"].id)


@server.tool()
@_api_errors
def delete_files(paths: list[str], message: str, branch: str = "") -> str:
    """Delete files or folders as one commit. Returns the commit."""
    return _branch(branch).remove(paths, message, state["session"].id)


@server.tool(annotations=READ)
@_api_errors
def diff(source: str, branch: str = "") -> list:
    """What changed from the branch `source` to this one."""
    return _branch(branch).diff(source)


@server.tool(annotations=READ)
@_api_errors
def log(limit: int = 20, branch: str = "") -> list:
    """The newest commits, newest first."""
    return _branch(branch).log(limit)


@server.tool()
@_api_errors
def merge(into: str, branch: str = "", message: str = "") -> dict:
    """Merge a branch (the working branch by default) into `into`. On a
    conflict nothing is saved and the paths are listed."""
    result = _branch(branch).merge_into(into, message or None, state["session"].id)
    return {"head": result.head, "conflicts": result.conflicts}


# Search indexes. Names are like `prod/products`; every index has a `main`
# branch, and forks of it.

IndexName = Annotated[str, Field(min_length=1, description="The index, such as `prod/products`.")]
BranchName = Annotated[str, Field(min_length=1, description="A branch of the index.")]
DocId = Annotated[str | int, Field(description="A string, or a whole number from 0.")]
AttributeValue = str | float | bool | list[str]


class Document(BaseModel):
    id: DocId
    vectors: dict[str, list[float]] = Field(
        description='A vector for every vector column, by column name, such as {"embedding": [0.1, 0.2]}.'
    )
    attributes: dict[str, AttributeValue] = Field(
        default_factory=dict, description="Values for attribute columns, by name."
    )


def _index(name, branch="main"):
    return state["sky"].index(name).at(branch)


def _schema(name):
    """The index's schema. It can't change, so it is asked for once."""
    schemas = state.setdefault("schemas", {})
    if name not in schemas:
        schemas[name] = state["sky"].indexes.get(name)["schema"]
    return schemas[name]


@server.tool(annotations=READ)
@_api_errors
def list_indexes() -> list[dict]:
    """List the search indexes you can reach, with their vector and attribute
    columns. Start here to find an index to query."""
    return [{"name": index["name"], **index["schema"]} for index in state["sky"].indexes]


@server.tool(annotations=READ)
@_api_errors
def describe_index(index: IndexName, branch: BranchName = "main") -> dict:
    """The columns of an index (vector columns with dims and metric,
    attributes with types, which filters can use), its branches, and the row
    counts of one branch."""
    sky_index = _index(index, branch)
    return {
        "name": index,
        "schema": _schema(index),
        "branches": [b["name"] for b in sky_index.iter_branches()],
        "stats": sky_index.stats(),
    }


Filter = Annotated[
    dict[str, Any] | None,
    Field(
        description=(
            "Only documents that pass. `{attr: {op: value}}` with op eq, in, lt, lte, gt or gte; "
            "combine with {and: [..]}, {or: [..]}, {not: ..}. Such as "
            '{"and": [{"tag": {"eq": "billing"}}, {"price": {"lt": 10}}]}. '
            "On a `strings` attribute, eq and in match any of its values."
        )
    ),
]
TopK = Annotated[int, Field(ge=1, le=1000, description="How many hits.")]
Include = Annotated[list[str] | None, Field(description="Attributes to return with each hit. Default: all of them.")]
Fields = Annotated[list[str] | None, Field(description="The `text` attributes to search. Default: every one.")]
Highlight = Annotated[
    list[str] | None,
    Field(max_length=8, description="`text` attributes to return the best matching fragment of, words marked."),
]
VectorColumn = Annotated[
    str | None, Field(description="The vector column. Needed only when the index has more than one.")
]


def _column(index, column, text=False):
    """The vector column to use: the one asked for, or the only one. Text
    needs a column that embeds it."""
    vectors = _schema(index)["vectors"]
    if column is None:
        if text:
            vectors = [c for c in vectors if c.get("embed")]
        if len(vectors) != 1:
            if not vectors and text:
                raise ToolError(f"{index} has no vector column that embeds text; give a vector of numbers")
            if not vectors:
                raise ToolError(f"{index} has no vector column")
            names = ", ".join(c["name"] for c in vectors)
            raise ToolError(f"{index} has vector columns {names}; pick one with `column`")
        return vectors[0]["name"]
    if text and not any(c["name"] == column and c.get("embed") for c in vectors):
        raise ToolError(f"`{column}` does not embed text; give a vector of numbers")
    return column


def _include(index, include):
    if include is None:
        return [c["name"] for c in _schema(index)["attributes"]] or None
    return include or None


@server.tool(annotations=READ)
@_api_errors
def query_index(
    index: IndexName,
    vector: Annotated[
        Annotated[list[float], Field(min_length=1, max_length=4096)] | Annotated[str, Field(min_length=1)],
        Field(description="The query vector, or text when the column has `embed` (the server embeds it)."),
    ],
    column: VectorColumn = None,
    filter: Filter = None,
    top_k: TopK = 10,
    include: Include = None,
    branch: BranchName = "main",
) -> list[dict]:
    """Find the documents nearest to a vector or text, nearest first,
    optionally only those that pass a filter. Each hit has `id`, `distance`
    (smaller is closer) and `attributes`."""
    column = _column(index, column, text=isinstance(vector, str))
    return _index(index, branch).query(column, vector, top_k=top_k, filter=filter, include=_include(index, include))


@server.tool(annotations=READ)
@_api_errors
def search_index(
    index: IndexName,
    query: Annotated[str, Field(min_length=1, description="Words to search for, such as `reset password`.")],
    fields: Fields = None,
    filter: Filter = None,
    highlight: Highlight = None,
    top_k: TopK = 10,
    include: Include = None,
    branch: BranchName = "main",
) -> list[dict]:
    """Full-text search (BM25) over `text` attributes, best first. Each hit
    has `id`, `score` (larger is better), `attributes` and `highlights`. The
    filter may also hold {"body": {"phrase": "reset password"}} or
    {"body": {"prefix": "pass"}}."""
    found = _index(index, branch).search(
        query, top_k=top_k, fields=fields, filter=filter, include=_include(index, include), highlight=highlight
    )
    return list(found)


@server.tool(annotations=READ)
@_api_errors
def hybrid_search_index(
    index: IndexName,
    query: Annotated[str, Field(min_length=1, description="Words to search for.")],
    vector: Annotated[
        list[float] | None,
        Field(
            min_length=1,
            max_length=4096,
            description="The query vector. Default: `query`, embedded by a column with `embed`.",
        ),
    ] = None,
    column: VectorColumn = None,
    fields: Fields = None,
    filter: Filter = None,
    highlight: Highlight = None,
    top_k: TopK = 10,
    include: Include = None,
    branch: BranchName = "main",
) -> list[dict]:
    """Search by words (BM25) and by meaning (vectors) at once, and fuse the
    two rankings. Each hit has `id`, `score` (larger is better), `ranks` and
    `scores` in the `words` and `meaning` searches, `attributes` and
    `highlights`."""
    column = _column(index, column, text=vector is None)
    include = _include(index, include)
    # Each side looks deeper than `top_k`, so fusing has enough to pick from.
    shared = {"topK": min(1000, max(50, top_k)), "filter": filter, "include": include}
    words = {"query": query, "fields": fields, "highlight": highlight, **shared}
    meaning = {"vector": {"column": column, "value": query if vector is None else vector}, **shared}
    searches = {"words": compact(words), "meaning": compact(meaning)}
    return list(_index(index, branch).hybrid(searches, top_k=top_k))


@server.tool(annotations=ToolAnnotations(idempotent_hint=True, destructive_hint=False, open_world_hint=False))
@_api_errors
def upsert_documents(
    index: IndexName,
    documents: Annotated[list[Document], Field(min_length=1, max_length=1000)],
    branch: BranchName = "main",
) -> dict:
    """Write documents to an index. Each replaces any earlier one with the
    same id. Use a fork (`fork_index_branch`) to try changes without
    touching `main`. Returns how many were written."""
    docs = [doc.model_dump() for doc in documents]
    return {"count": _index(index, branch).upsert(docs)}


@server.tool(annotations=ToolAnnotations(destructive_hint=True, idempotent_hint=True, open_world_hint=False))
@_api_errors
def delete_documents(
    index: IndexName,
    ids: Annotated[list[DocId], Field(min_length=1, max_length=1000)],
    branch: BranchName = "main",
) -> dict:
    """Delete documents from an index by id. Ids that are not there are
    ignored."""
    return {"count": _index(index, branch).delete(ids)}


@server.tool(annotations=ToolAnnotations(destructive_hint=False, open_world_hint=False))
@_api_errors
def fork_index_branch(
    index: IndexName,
    name: Annotated[str, Field(min_length=1, description="The new branch, such as `agents/try-1`.")],
    source: Annotated[str, Field(min_length=1, description="The branch to fork.")] = "main",
) -> dict:
    """Fork a branch of an index. Nothing is copied, so it is instant; from
    then on each branch sees only its own writes. Pass the new name as
    `branch` to the other index tools to use it."""
    _index(index, source).fork(name)
    return {"index": index, "branch": name, "forked_from": source}


def _start(env):
    """Connects, and picks the tools the key can use. Returns the session
    to keep alive, or None."""
    url, key = env.get("SKYWAKE_URL"), env.get("SKYWAKE_KEY")
    if not (url and key):
        raise ValueError("set SKYWAKE_URL and SKYWAKE_KEY")
    sky = Skywake(url, key)
    state["sky"] = sky
    name = env.get("SKYWAKE_NAMESPACE")
    if not name:
        _remove(FILE_TOOLS)
        return None
    namespace = sky.namespace(name)
    branch = env.get("SKYWAKE_BRANCH", "main")
    state.update(namespace=namespace, branch=branch)
    try:
        session = namespace.session(f"mcp:{branch}")
    except SkywakeError as error:
        if error.status != 403:
            raise
        # Starting a session needs the write role. If the key can still read
        # the namespace, run read-only; a key has one role, so index writes go too.
        namespace.branches(limit=1)
        _remove(WRITE_TOOLS)
        print("skywake-mcp: this key can only read, so the write tools are off", file=sys.stderr)
        session = None
    state["session"] = session
    if source := env.get("SKYWAKE_FORK_FROM"):
        try:
            _fork_unless_there(namespace, source, branch, writable=session is not None)
        except BaseException:
            if session:
                session.end()
            raise
    return session


def _fork_unless_there(namespace, source, branch, writable):
    """Forks `branch` from `source`, or keeps it if it is there already, so
    an agent that stopped can carry on where it was."""
    if not writable:
        try:
            namespace.branch(branch).info()
        except SkywakeError as error:
            if error.status != 404:
                raise
            raise ValueError(f"branch `{branch}` does not exist, and a read-only key can't fork it") from error
        return
    try:
        namespace.branch(source).fork(branch)
    except SkywakeError as error:
        if error.status != 409:
            raise


def _remove(tools):
    for tool in tools:
        server.remove_tool(tool)


def main():
    logging.getLogger("httpx").setLevel(logging.WARNING)  # one line per request is noise
    try:
        session = _start(os.environ)
    except Exception as error:
        # Before the handshake a traceback only shows as a dead server, so
        # answer anyway, and let every tool give the reason.
        reason = f"can't reach SKYWAKE_URL ({error})" if isinstance(error, httpx.TransportError) else error
        state["startup_error"] = f"skywake-mcp could not start: {reason}"
        print(state["startup_error"], file=sys.stderr)
        session = None
    if session is None:
        server.run()
        return
    with session:
        server.run()


if __name__ == "__main__":
    main()
