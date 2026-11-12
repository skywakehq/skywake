"""Skywake client. It follows the API's OpenAPI document
(`packages/contract/generated/openapi.json`):
each method is one route.

    sky = Skywake("http://localhost:8080", key)
    main = sky.namespace("prod/app").branch("main")
    fork = main.fork("agents/42")
    fork.write({"notes.md": "hello"}, "add notes")
    fork.merge_into("main")

    products = sky.index("prod/products")
    products.upsert([{"id": 1, "vectors": {"embedding": [0.1, 0.2]}}])
    products.query("embedding", [0.1, 0.2], top_k=5)
"""

from .branch import Branch
from .client import Skywake
from .errors import SkywakeError
from .namespace import Merge, Namespace
from .search_index import Indexes, SearchIndex
from .session import Session

__all__ = ["Skywake", "SkywakeError", "Branch", "Indexes", "Merge", "Namespace", "SearchIndex", "Session"]
