"""Fleet: many agents' forks on one machine, sharing one daemon and one
chunk cache."""

import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from lib import CacheNode, Daemon, Suite, at_once, make_source, median, text, timed, write

ABOUT = (
    "Forks of one base tree, all mounted on one daemon, as on a machine running"
    " many agents. Reads go through one shared chunk cache, so each chunk"
    " should come from the bucket once, however many agents read it. Writes are"
    " saved by one timer that saves every mount in turn. Then the same agents"
    " split across two machines, each with its own daemon and cache, reading"
    " through one node of the shared cache tier: still about one read per chunk."
    " Garbage collection runs over and over while the agents write, and every"
    " branch must check out byte-for-byte afterwards."
)
SAVE_EVERY_MS = 2000


def run(ctx):
    agents = ctx.size(20, 5)
    suite = Suite("fleet", f"Fleet: {agents} agents on one machine", ABOUT)
    base = ctx.scratch / "base"
    make_source(base / "src", ctx.size(2_000, 500), ctx.seed)
    write(base / "data" / "model.bin", os.urandom(ctx.size(256, 64) << 20))
    size = sum(path.stat().st_size for path in base.rglob("*") if path.is_file())
    suite.note(f"The base tree: {size / 1e6:,.0f} MB, mostly one large file.")
    suite.setting("base tree bytes", size)
    suite.setting("agents", agents)
    branch = f"{ctx.run}-fleet"
    ctx.skywake("new", branch, root=ctx.scratch / "no-daemon")
    ctx.skywake("commit", branch, base, "-m", "base", root=ctx.scratch / "no-daemon")
    forks = [f"{branch}-{i}" for i in range(agents)]
    at_once(lambda fork: ctx.skywake("new", fork, "--from", branch, root=ctx.scratch / "no-daemon"), forks)
    mounts = [ctx.scratch / f"agent-{i}" for i in range(agents)]

    with Daemon(ctx, ctx.scratch / "host", SAVE_EVERY_MS) as daemon, ThreadPoolExecutor(agents) as pool:

        def each(work):
            return list(pool.map(work, range(agents)))

        started = time.perf_counter()
        times = each(lambda i: timed(lambda: daemon.mount(forks[i], mounts[i])))
        suite.row(
            f"mount {agents} forks at once",
            {"ms": (time.perf_counter() - started) * 1000, "slowest ms": max(times) * 1000},
        )

        with ctx.requests() as requests:
            seconds = timed(
                lambda: each(lambda i: timed(["sh", "-c", "find . -type f -exec cat {} + > /dev/null"], cwd=mounts[i]))
            )
        chunk_gets = requests.count("GET", "chunks/")
        if ctx.proxy:
            chunks = len({r.path for r in requests.requests if r.method == "GET" and r.path.startswith("chunks/")})
            suite.row(
                f"{agents} agents read every file at once",
                {
                    "ms": seconds * 1000,
                    "MB/s": size * agents / seconds / 1e6,
                    "chunk GETs": chunk_gets,
                    "distinct chunks": chunks,
                    "MB down": requests.summary()["MB down"],
                },
            )
            suite.check("each chunk is read from the bucket about once (within 5%)", chunk_gets <= chunks * 1.05)
        else:
            suite.row(f"{agents} agents read every file at once", {"ms": seconds * 1000})

        # Each agent writes, then stops. So the last save of a branch is the
        # one that has the agent's last write.
        written = {i: [text(2000) for _ in range(50)] for i in range(agents)}
        collecting = Collector(ctx)
        with ctx.requests() as requests:
            collecting.start()
            each(lambda i: [write(mounts[i] / "out" / f"f{j}.txt", data) for j, data in enumerate(written[i])])
            done = time.monotonic()
            time.sleep(3 * SAVE_EVERY_MS / 1000)
            collecting.stop()
        if ctx.proxy:
            lags = [max(0, last_save(requests.requests, fork) - done) for fork in forks]
            suite.row(
                f"{agents} agents write 50 files each: until saved (median; requests per agent)",
                {
                    "ms": median(lags) * 1000,
                    "slowest ms": max(lags) * 1000,
                    "requests": requests.summary()["requests"] / agents,
                },
            )
            suite.check(
                f"every agent's writes reach the bucket within one save window and 1 s ({SAVE_EVERY_MS / 1000 + 1:.0f} s)",
                max(lags) <= SAVE_EVERY_MS / 1000 + 1,
            )
        suite.row(f"daemon memory with {agents} mounts", {"MB resident": resident_mb(daemon.process.pid)})

    intact = True
    for i, fork in enumerate(forks):
        out = ctx.scratch / f"check-{i}"
        ctx.skywake("checkout", fork, out, root=ctx.scratch / "no-daemon")
        intact &= all((out / "out" / f"f{j}.txt").read_bytes() == data for j, data in enumerate(written[i]))
    suite.row(f"garbage collections while {agents} agents wrote", {"count": collecting.runs})
    suite.check("gc while writing: every branch checks out byte-for-byte", intact and collecting.runs > 0)

    two_machines(ctx, suite, branch, agents, size)
    return suite


def two_machines(ctx, suite, branch, agents, size):
    forks = [f"{branch}-apart-{i}" for i in range(agents)]
    at_once(lambda fork: ctx.skywake("new", fork, "--from", branch, root=ctx.scratch / "no-daemon"), forks)
    mounts = [ctx.scratch / f"apart-{i}" for i in range(agents)]
    with (
        CacheNode(ctx, ctx.scratch / "cache-node") as node,
        Daemon(ctx, ctx.scratch / "machine-a", cache_nodes=[node.url]) as a,
        Daemon(ctx, ctx.scratch / "machine-b", cache_nodes=[node.url]) as b,
        ThreadPoolExecutor(agents) as pool,
    ):
        machines = [a if i % 2 == 0 else b for i in range(agents)]
        list(pool.map(lambda i: machines[i].mount(forks[i], mounts[i]), range(agents)))
        read = ["sh", "-c", "find . -type f -exec cat {} + > /dev/null"]
        with ctx.requests() as requests:
            seconds = timed(lambda: list(pool.map(lambda i: timed(read, cwd=mounts[i]), range(agents))))
        if not ctx.proxy:
            return
        chunk_gets = requests.count("GET", "chunks/")
        chunks = len({r.path for r in requests.requests if r.method == "GET" and r.path.startswith("chunks/")})
        suite.row(
            f"{agents} agents on two machines, one cache node, read every file at once",
            {
                "ms": seconds * 1000,
                "MB/s": size * agents / seconds / 1e6,
                "chunk GETs": chunk_gets,
                "distinct chunks": chunks,
            },
        )
        suite.check(
            "two machines: each chunk is read from the bucket about once (within 5%)", chunk_gets <= chunks * 1.05
        )


class Collector(threading.Thread):
    """Runs `skywake gc` in a loop until stopped."""

    def __init__(self, ctx):
        super().__init__()
        self.ctx, self.runs, self.done = ctx, 0, threading.Event()

    def run(self):
        while not self.done.is_set():
            self.ctx.skywake("gc", "--grace-minutes", "1", root=self.ctx.scratch / "no-daemon")
            self.runs += 1

    def stop(self):
        self.done.set()
        self.join()


def last_save(requests, branch):
    """When the last write to the branch head (`refs/<branch>`) arrived."""
    saves = [r.at for r in requests if r.method == "PUT" and r.path == f"refs/{branch}"]
    return max(saves) if saves else float("inf")


def resident_mb(pid):
    for line in Path(f"/proc/{pid}/status").read_text().splitlines():
        if line.startswith("VmRSS:"):
            return int(line.split()[1]) / 1000
    return None
