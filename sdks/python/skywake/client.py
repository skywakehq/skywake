import httpx

from ._drive import AsyncDriver, SyncDriver, call, compact, listing, op, pages, segment
from ._settings import resolve_settings
from ._transport import AsyncTransport, SyncTransport
from .index import MAIN, Index


def _headers(key, environment):
    headers = {"authorization": f"Bearer {key}", "user-agent": "skywake-python"}
    if environment:
        headers["skywake-environment"] = environment
    return headers


def _base(url):
    base = url.rstrip("/")
    for old in ("/v1", "/v2"):
        if base.endswith(old):
            base = base[: -len(old)]
    return base


class _Client:
    def __init__(self, driver, url, environment):
        self._driver = driver
        self.url = url
        self.environment = environment

    def index(self, name, branch=None):
        return Index(self._driver, name, branch or MAIN)

    @op
    def create_index(self, name, *, schema=None, region=None, embed=None):
        yield from call(
            "POST", "/indexes", body=compact({"name": name, "schema": schema, "region": region, "embed": embed})
        )
        return self.index(name)

    @listing
    def list_indexes(self):
        return (yield from pages("/indexes"))

    @op
    def create_key(self, name, role, *, environment=None, only=None, expires_in_days=None):
        body = compact({"name": name, "role": role, "only": only, "expires_in_days": expires_in_days})
        body["environment"] = environment
        return (yield from call("POST", "/keys", body=body))

    @listing
    def list_keys(self):
        return (yield from pages("/keys"))

    @op
    def revoke_key(self, id):
        yield from call("DELETE", f"/keys/{segment(id)}")

    @listing
    def list_environments(self):
        return (yield from pages("/environments"))

    @op
    def create_environment(self, name):
        return (yield from call("POST", "/environments", body={"name": name}))

    @op
    def whoami(self):
        return (yield from call("GET", "/whoami"))


class Skywake(_Client):
    def __init__(
        self,
        *,
        key=None,
        url=None,
        environment=None,
        profile=None,
        timeout=60.0,
        retries=3,
        backoff=0.2,
        transport=None,
    ):
        settings = resolve_settings(key, url, environment, profile)
        base = _base(settings["url"])
        http = httpx.Client(
            base_url=f"{base}/v2",
            headers=_headers(settings["key"], settings["environment"]),
            timeout=timeout,
            transport=transport,
        )
        super().__init__(SyncDriver(SyncTransport(http, retries, backoff)), base, settings["environment"])

    def close(self):
        self._driver.transport.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


class AsyncSkywake(_Client):
    def __init__(
        self,
        *,
        key=None,
        url=None,
        environment=None,
        profile=None,
        timeout=60.0,
        retries=3,
        backoff=0.2,
        transport=None,
    ):
        settings = resolve_settings(key, url, environment, profile)
        base = _base(settings["url"])
        http = httpx.AsyncClient(
            base_url=f"{base}/v2",
            headers=_headers(settings["key"], settings["environment"]),
            timeout=timeout,
            transport=transport,
        )
        super().__init__(AsyncDriver(AsyncTransport(http, retries, backoff)), base, settings["environment"])

    async def close(self):
        await self._driver.transport.close()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        await self.close()
