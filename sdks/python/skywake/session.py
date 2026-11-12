import threading

import httpx

from .errors import SkywakeError


class Session:
    """One agent at work. In a `with` block, a thread sends heartbeats and
    the session ends when the block does."""

    def __init__(self, namespace, id, seconds=60):
        self.namespace = namespace
        self.id = id
        self.seconds = seconds
        self._stop = threading.Event()

    def heartbeat(self):
        path = f"{self.namespace.path}/sessions/{self.id}"
        self.namespace.sky.call("PUT", path, json={"seconds": self.seconds})

    def end(self):
        self._stop.set()
        self.namespace.sky.call("DELETE", f"{self.namespace.path}/sessions/{self.id}")

    def __enter__(self):
        def beat():
            while not self._stop.wait(self.seconds / 3):
                try:
                    self.heartbeat()
                except (SkywakeError, httpx.HTTPError):
                    pass  # try again at the next beat

        threading.Thread(target=beat, daemon=True).start()
        return self

    def __exit__(self, *_):
        self.end()
