"""Shared by all suites: run settings, daemons, test data, timing, and the rows and checks each suite reports."""

import errno
import os
import random
import shutil
import signal
import socket
import statistics
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BIN = Path(os.environ.get("CARGO_TARGET_DIR", ROOT / "target")) / "release"
# Shared by the cache nodes and daemons of a run; the tier refuses requests without it.
CACHE_TOKEN = "bench-cache-token"


@dataclass
class Context:
    run: str
    scratch: Path
    env: dict
    quick: bool
    seed: int
    proxy: object

    def size(self, full, quick):
        return quick if self.quick else full

    def requests(self):
        """`with ctx.requests() as r:` records the block's S3 requests in
        `r`. Without a proxy, `r.summary()` is empty."""
        if self.proxy:
            return self.proxy.measure()
        return _NoRequests()

    def skywake(self, *command, root=None, check=True, env=None):
        env = {**self.env, **(env or {})}
        if root is not None:
            env["SKYWAKE_ROOT"] = str(root)
        result = subprocess.run([str(BIN / "skywake"), *map(str, command)], env=env, capture_output=True, text=True)
        if check and result.returncode != 0:
            raise RuntimeError(f"skywake {' '.join(map(str, command))}: {result.stderr.strip()}")
        return result.stdout


class _NoRequests:
    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass

    def summary(self):
        return {}

    def count(self, *_, **__):
        return None


@dataclass
class Suite:
    """One suite's results: a table of rows, and pass/fail checks."""

    name: str
    title: str
    about: str
    rows: list = field(default_factory=list)
    checks: list = field(default_factory=list)
    notes: list = field(default_factory=list)
    error: str = ""
    settings: dict = field(default_factory=dict)

    def row(self, label, metrics):
        metrics = {key: value for key, value in metrics.items() if value is not None}
        self.rows.append((label, metrics))
        return metrics

    def check(self, name, passed):
        self.checks.append((name, bool(passed)))

    def note(self, text):
        self.notes.append(text)

    def setting(self, key, value):
        self.settings[key] = value


def free_address():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return f"127.0.0.1:{probe.getsockname()[1]}"


def heads_env(nodes):
    """What a `skywake` command needs to read and write branch heads on the cache tier."""
    return {"SKYWAKE_HEADS": "tier", "SKYWAKE_CACHE_NODES": ",".join(nodes), "SKYWAKE_CACHE_TOKEN": CACHE_TOKEN}


class CacheNode:
    """One skywake-cache (a node of the shared cache tier) on a free port."""

    def __init__(self, ctx, root, zone=None, address=None, peers=()):
        root = Path(root)
        root.mkdir(parents=True, exist_ok=True)
        address = address or free_address()
        env = {
            **ctx.env,
            "SKYWAKE_CACHE_LISTEN": address,
            "SKYWAKE_CACHE_DIR": str(root / "chunks"),
            "SKYWAKE_CACHE_LOG_DIR": str(root / "log"),
            "SKYWAKE_CACHE_TOKEN": CACHE_TOKEN,
            "SKYWAKE_CACHE_ZONE": zone or "",
            "SKYWAKE_CACHE_URL": f"http://{address}",
            "SKYWAKE_CACHE_PEERS": ",".join(peers),
        }
        with open(root / "skywake-cache.log", "a") as log:
            self.process = subprocess.Popen([str(BIN / "skywake-cache")], env=env, stderr=log)
        self.url = f"http://{address}"
        host, port = address.split(":")
        while True:
            try:
                socket.create_connection((host, int(port)), timeout=1).close()
                break
            except OSError:
                if self.process.poll() is not None:
                    raise RuntimeError(f"skywake-cache exited:\n{(root / 'skywake-cache.log').read_text()}") from None
                time.sleep(0.005)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.process.terminate()
        self.process.wait()


class Daemon:
    """One skywaked with its own root folder: socket, chunk cache and local
    files. It acts like one machine."""

    def __init__(self, ctx, root, save_every_ms=2000, cache_nodes=(), heads=False):
        self.ctx, self.root = ctx, Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        # Commands that skip the daemon must find branch heads where it does.
        self.cli_env = heads_env(cache_nodes) if heads else {}
        env = {
            **ctx.env,
            "SKYWAKE_ROOT": str(self.root),
            "SKYWAKE_SAVE_EVERY_MS": str(save_every_ms),
            "SKYWAKE_CACHE_NODES": ",".join(cache_nodes),
            "SKYWAKE_CACHE_TOKEN": CACHE_TOKEN,
            "SKYWAKE_HEADS": "tier" if heads else "bucket",
        }
        with open(self.root / "skywaked.log", "a") as log:
            self.process = subprocess.Popen([str(BIN / "skywaked")], env=env, stderr=log)
        # A killed daemon leaves its socket file, so wait for a reply.
        while not self.listening():
            if self.process.poll() is not None:
                raise RuntimeError(f"skywaked exited:\n{self.log()}")
            time.sleep(0.005)

    def listening(self):
        with socket.socket(socket.AF_UNIX) as client:
            try:
                client.connect(str(self.root / "skywaked.sock"))
                return True
            except OSError:
                return False

    def call(self, *command, check=True):
        return self.ctx.skywake(*command, root=self.root, check=check, env=self.cli_env)

    def mount(self, branch, path):
        try:
            Path(path).mkdir(parents=True, exist_ok=True)
        except OSError as error:
            if error.errno != errno.ENOTCONN:  # dead mount from a killed daemon; skywaked clears it
                raise
        self.call("mount", branch, path)

    def kill(self):
        self.process.send_signal(signal.SIGKILL)
        self.process.wait()

    def stop(self):
        """Saves and unmounts everything, then exits."""
        self.process.terminate()
        self.process.wait()

    def log(self):
        path = self.root / "skywaked.log"
        return path.read_text() if path.exists() else ""

    def __enter__(self):
        return self

    def __exit__(self, *_):
        if self.process.poll() is None:
            self.stop()


def at_once(work, items, workers=16):
    """Runs `work` on every item on a pool of threads, for setup that isn't timed."""
    with ThreadPoolExecutor(workers) as pool:
        return list(pool.map(work, items))


def timed(command, cwd=None, env=None):
    """Seconds to run `command`, a list of arguments or a function."""
    start = time.perf_counter()
    if callable(command):
        command()
    else:
        done = subprocess.run(command, cwd=cwd, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        if done.returncode:
            # The end of its error output says why; the report shows it.
            raise RuntimeError(f"{command} exited with {done.returncode}:\n{done.stderr[-3000:]}")
    return time.perf_counter() - start


def median(values):
    return statistics.median(values)


def p95(values):
    values = sorted(values)
    return values[min(len(values) - 1, round(0.95 * (len(values) - 1)))]


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def text(size):
    """Random hex. It compresses about 2x, like source code."""
    return os.urandom(size // 2 + 1).hex().encode()[:size]


def make_mixed(root, size_mb, seed):
    """A project with build output: 90% is in eight large binaries, the
    rest in source-like files of 1–20 KB."""
    rng = random.Random(seed)
    big = size_mb * 9 // 10
    for i in range(8):
        write(root / "artifacts" / f"blob-{i}.bin", os.urandom(big * (1 << 20) // 8))
    left, i = (size_mb - big) << 20, 0
    while left > 0:
        size = rng.randint(1024, 20 * 1024)
        write(root / "src" / f"module-{i % 50}" / f"file-{i}.txt", text(size))
        left -= size
        i += 1
    return measure(root)


def make_source(root, files, seed):
    """A source tree like a typical repository: many small files (median
    about 3 KB) in folders three levels deep."""
    rng = random.Random(seed)
    for i in range(files):
        size = int(min(rng.lognormvariate(8, 1), 200_000))
        write(root / f"pkg-{i % 20}" / f"mod-{i % 200}" / f"file-{i}.txt", text(size))
    return measure(root)


def measure(root):
    """(bytes, files) under `root`."""
    sizes = [path.stat().st_size for path in Path(root).rglob("*") if path.is_file()]
    return sum(sizes), len(sizes)


def empty(path):
    """Deletes everything inside `path`, but not `path` itself. It may be
    a symlink to local disk."""
    for child in Path(path).iterdir() if Path(path).exists() else []:
        shutil.rmtree(child) if child.is_dir() and not child.is_symlink() else child.unlink()
