import functools
import json
from dataclasses import dataclass
from urllib.parse import quote

from ._transport import Request
from .errors import error_of


@dataclass
class Item:
    value: object


def segment(name):
    return quote(str(name), safe="")


def file_path(path):
    return "/".join(quote(part, safe="") for part in path.lstrip("/").split("/"))


def compact(fields):
    return {name: value for name, value in fields.items() if value is not None}


def raw(method, path, query=None, json=None, content=None):
    response = yield Request(method, path, compact(query or {}), json, content)
    if response.status >= 400:
        raise error_of(response.status, response.headers, response.content)
    return response


def call(method, path, query=None, body=None, content=None):
    response = yield from raw(method, path, query, body, content)
    return json.loads(response.content) if response.content else None


def pages(path, query=None):
    cursor = None
    while True:
        page = yield from call("GET", path, {**(query or {}), "cursor": cursor})
        for item in page["data"]:
            yield Item(item)
        if not page["next"]:
            return
        cursor = page["next"]


def collected(steps):
    found = []
    reply = None
    while True:
        try:
            step = steps.send(reply)
        except StopIteration:
            return found
        if isinstance(step, Item):
            found.append(step.value)
            reply = None
        else:
            reply = yield step


class SyncDriver:
    def __init__(self, transport, headers=None):
        self.transport = transport
        self.headers = headers or {}

    def within(self, environment):
        return SyncDriver(self.transport, {**self.headers, "skywake-environment": environment})

    def _dressed(self, request):
        request.headers = {**self.headers, **request.headers}
        return request

    def run(self, steps):
        reply = None
        while True:
            try:
                request = steps.send(reply)
            except StopIteration as done:
                return done.value
            reply = self.transport.send(self._dressed(request))

    def items(self, steps):
        reply = None
        while True:
            try:
                step = steps.send(reply)
            except StopIteration:
                return
            if isinstance(step, Item):
                reply = None
                yield step.value
            else:
                reply = self.transport.send(self._dressed(step))


class AsyncDriver:
    def __init__(self, transport, headers=None):
        self.transport = transport
        self.headers = headers or {}

    def within(self, environment):
        return AsyncDriver(self.transport, {**self.headers, "skywake-environment": environment})

    def _dressed(self, request):
        request.headers = {**self.headers, **request.headers}
        return request

    async def run(self, steps):
        reply = None
        while True:
            try:
                request = steps.send(reply)
            except StopIteration as done:
                return done.value
            reply = await self.transport.send(self._dressed(request))

    async def items(self, steps):
        reply = None
        while True:
            try:
                step = steps.send(reply)
            except StopIteration:
                return
            if isinstance(step, Item):
                reply = None
                yield step.value
            else:
                reply = await self.transport.send(self._dressed(step))


def op(method):
    @functools.wraps(method)
    def run(self, *args, **kwargs):
        return self._driver.run(method(self, *args, **kwargs))

    return run


def listing(method):
    @functools.wraps(method)
    def items(self, *args, **kwargs):
        return self._driver.items(method(self, *args, **kwargs))

    return items
