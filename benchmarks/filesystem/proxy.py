"""Runs `s3-proxy` (benchmarks/src/proxy) and collects the requests it reports."""

import contextlib
import http.client
import subprocess
import threading
import time
import urllib.parse
from dataclasses import dataclass

from lib import BIN


@dataclass
class Request:
    at: float  # time.monotonic() when the proxy got it
    method: str  # GET, PUT, HEAD, DELETE, POST, or LIST
    path: str  # the key, without the bucket
    sent: int  # body bytes, client to S3
    received: int  # body bytes, S3 to client
    status: int


class Proxy:
    def __init__(self, upstream, latency_ms=0, prefix="", write_latency_ms=None):
        """`prefix` is the store's folder in the bucket. It is removed from
        reported keys. Writes wait `write_latency_ms`, or `latency_ms` if unset."""
        write_latency_ms = latency_ms if write_latency_ms is None else write_latency_ms
        self.prefix = prefix
        upstream = urllib.parse.urlsplit(upstream)
        self.process = subprocess.Popen(
            [
                str(BIN / "s3-proxy"),
                f"{upstream.hostname}:{upstream.port or 80}",
                str(latency_ms),
                str(write_latency_ms),
            ],
            stdout=subprocess.PIPE,
            text=True,
        )
        self.port = int(self.process.stdout.readline().split()[1])
        self.url = f"http://127.0.0.1:{self.port}"
        self.requests = []
        self.marks = 0
        self.seen = threading.Condition()
        threading.Thread(target=self.collect, daemon=True).start()

    def collect(self):
        for line in self.process.stdout:
            at, method, path, sent, received, status = line.split()
            path = path.removeprefix(self.prefix)
            with self.seen:
                self.requests.append(Request(float(at), method, path, int(sent), int(received), int(status)))
                self.seen.notify_all()

    def stop(self):
        self.process.terminate()
        self.process.wait()

    def sync(self):
        """Waits until all finished requests are collected. It sends a
        marker request and waits for it. Returns how many requests came
        before the marker."""
        self.marks += 1
        mark = f"bench-mark-{self.marks}"
        connection = http.client.HTTPConnection("127.0.0.1", self.port)
        connection.request("HEAD", f"/bench-marks/{mark}")
        connection.getresponse().read()
        connection.close()
        with self.seen:
            self.seen.wait_for(lambda: any(r.path == mark for r in self.requests[-64:]))
            index = next(i for i in range(len(self.requests) - 1, -1, -1) if self.requests[i].path == mark)
            return index

    @contextlib.contextmanager
    def measure(self):
        """`with proxy.measure() as w:` collects the block's requests in `w`."""
        window = Window([])
        start = self.sync() + 1
        window.started = time.monotonic()
        yield window
        end = self.sync()
        window.requests = [r for r in self.requests[start:end] if not r.path.startswith("bench-mark-")]

    def since(self, at):
        """All requests that arrived after `at`."""
        self.sync()
        return [r for r in self.requests if r.at >= at and not r.path.startswith("bench-mark-")]


@dataclass
class Window:
    """The requests made during one measurement."""

    requests: list
    started: float = 0.0

    def count(self, method=None, prefix=""):
        return sum(1 for r in self.requests if (method is None or r.method == method) and r.path.startswith(prefix))

    def summary(self):
        """The columns a benchmark reports for one operation."""
        return {
            "requests": len(self.requests),
            "PUT": self.count("PUT"),
            "GET": self.count("GET"),
            "MB up": sum(r.sent for r in self.requests) / 1e6,
            "MB down": sum(r.received for r in self.requests) / 1e6,
        }
