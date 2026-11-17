import asyncio
import random
import time
from dataclasses import dataclass, field

import httpx

IDEMPOTENT = {"GET", "HEAD", "PUT", "DELETE", "OPTIONS"}
MAX_WAIT = 60.0


@dataclass
class Request:
    method: str
    path: str
    query: dict = field(default_factory=dict)
    json: object = None
    content: bytes | None = None
    headers: dict = field(default_factory=dict)

    def build(self, http):
        query = {name: _plain(value) for name, value in self.query.items() if value is not None}
        headers = dict(self.headers)
        if self.content is not None:
            headers["content-type"] = "application/octet-stream"
        json = self.json if self.content is None else None
        return http.build_request(
            self.method, self.path, params=query, json=json, content=self.content, headers=headers
        )


@dataclass
class Response:
    status: int
    headers: httpx.Headers
    content: bytes


def _plain(value):
    if isinstance(value, bool):
        return "true" if value else "false"
    return value


def _backoff(attempt, base):
    return random.uniform(0, min(MAX_WAIT, base * 2**attempt))


def _retry_after(response):
    try:
        seconds = float(response.headers.get("retry-after", ""))
    except ValueError:
        return None
    return seconds if seconds > 0 else None


class _Policy:
    def __init__(self, retries, backoff):
        self.retries = retries
        self.backoff = backoff

    def attempts(self, method):
        idempotent = method in IDEMPOTENT
        for attempt in range(self.retries + 1):
            yield attempt, attempt == self.retries, idempotent

    def wait_after(self, response, attempt):
        return min(_retry_after(response) or _backoff(attempt, self.backoff), MAX_WAIT)

    @staticmethod
    def again(response, idempotent):
        return response.status_code == 429 or (idempotent and response.status_code >= 500)


def _gone(method, may_have_landed, response):
    return may_have_landed and method == "DELETE" and response.status_code == 404


class SyncTransport:
    def __init__(self, http, retries, backoff):
        self.http = http
        self.policy = _Policy(retries, backoff)

    def send(self, request):
        landed = False
        for attempt, last, idempotent in self.policy.attempts(request.method):
            try:
                response = self.http.send(request.build(self.http))
            except httpx.TransportError:
                if last or not idempotent:
                    raise
                landed = True
                time.sleep(_backoff(attempt, self.policy.backoff))
                continue
            if _gone(request.method, landed, response):
                return Response(204, response.headers, b"")
            if last or not self.policy.again(response, idempotent):
                return Response(response.status_code, response.headers, response.content)
            landed = landed or response.status_code >= 500
            time.sleep(self.policy.wait_after(response, attempt))
        raise AssertionError("unreachable")

    def close(self):
        self.http.close()


class AsyncTransport:
    def __init__(self, http, retries, backoff):
        self.http = http
        self.policy = _Policy(retries, backoff)

    async def send(self, request):
        landed = False
        for attempt, last, idempotent in self.policy.attempts(request.method):
            try:
                response = await self.http.send(request.build(self.http))
            except httpx.TransportError:
                if last or not idempotent:
                    raise
                landed = True
                await asyncio.sleep(_backoff(attempt, self.policy.backoff))
                continue
            if _gone(request.method, landed, response):
                return Response(204, response.headers, b"")
            if last or not self.policy.again(response, idempotent):
                return Response(response.status_code, response.headers, response.content)
            landed = landed or response.status_code >= 500
            await asyncio.sleep(self.policy.wait_after(response, attempt))
        raise AssertionError("unreachable")

    async def close(self):
        await self.http.aclose()
