import httpx

from ._encode import compact
from ._http import check, send_with_retries
from ._settings import resolve_settings
from .namespace import Namespace
from .search_index import Indexes, SearchIndex


class Skywake:
    def __init__(
        self,
        url=None,
        key=None,
        timeout=60.0,
        retries=3,
        backoff=0.2,
        transport=None,
        environment=None,
        profile=None,
    ):
        """With no arguments, the key comes from SKYWAKE_API_KEY or the
        profile `skywake login` saved, and the URL defaults to the cloud.
        `timeout` is in seconds per try; failed requests are retried up to
        `retries` times when that is safe."""
        settings = resolve_settings(key=key, url=url, environment=environment, profile=profile)
        self.url = settings["url"].rstrip("/").removesuffix("/v1")
        self.environment = settings["environment"]
        self.retries = retries
        self.backoff = backoff
        headers = {"Authorization": f"Bearer {settings['key']}"}
        if self.environment:
            headers["Skywake-Environment"] = self.environment
        self.http = httpx.Client(
            base_url=f"{self.url}/v1",
            headers=headers,
            timeout=timeout,
            transport=transport,
        )
        self.indexes = Indexes(self)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def whoami(self):
        return self.call("GET", "/whoami").json()

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
