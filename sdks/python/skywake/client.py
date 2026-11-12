import httpx

from ._encode import compact
from ._http import check, send_with_retries
from .namespace import Namespace
from .search_index import Indexes, SearchIndex


class Skywake:
    def __init__(self, url, key, timeout=60.0, retries=3, backoff=0.2, transport=None):
        """`key` is an API key (`sw_...`) or a console token. `timeout` is
        in seconds: how long one try may wait to connect, and then for each
        piece of the answer. A large file that keeps arriving is never cut
        off. Failed requests are tried up to `retries` more times when that
        is safe, waiting about `backoff` seconds, doubled each time, or as
        long as the server asks (at most 60 seconds)."""
        # Every route lives under /v1.
        url = url.rstrip("/").removesuffix("/v1")
        self.retries = retries
        self.backoff = backoff
        self.http = httpx.Client(
            base_url=f"{url}/v1",
            headers={"Authorization": f"Bearer {key}"},
            timeout=timeout,
            transport=transport,
        )
        # Make, list, read and delete search indexes.
        self.indexes = Indexes(self)

    def send(self, method, path, json=None, **kwargs):
        """Sends a request and returns the response, even an error. Fields
        set to None are left out, so the server uses its defaults."""
        if isinstance(json, dict):
            json = compact(json)
        return send_with_retries(self.http, method, path, self.retries, self.backoff, json=json, **kwargs)

    def call(self, method, path, **kwargs):
        """Like `send`, but raises the API's error."""
        return check(self.send(method, path, **kwargs))

    def namespace(self, name):
        return Namespace(self, name)

    def index(self, name):
        """A search index, on its `main` branch."""
        return SearchIndex(self, name)

    def namespaces(self):
        return self.call("GET", "/namespaces").json()

    def create_namespace(self, name, region=None):
        self.call("POST", "/namespaces", json={"name": name, "region": region})
        return self.namespace(name)

    def regions(self):
        return self.call("GET", "/regions").json()

    def environments(self):
        return self.call("GET", "/environments").json()

    def create_environment(self, name):
        """An environment has no region; each namespace picks its own."""
        return self.call("POST", "/environments", json={"name": name}).json()

    def close(self):
        self.http.close()
