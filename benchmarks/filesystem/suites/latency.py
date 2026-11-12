"""Latency: branch operations, small reads and writes, and everyday workloads, on a mount."""

import contextlib
import json
import os
import random
import shutil
import sqlite3
import subprocess
import time
import traceback
from pathlib import Path

from lib import CacheNode, Daemon, Suite, at_once, empty, free_address, heads_env, make_source, median, timed, write

ABOUT = (
    "Branch operations, 4 KiB reads and O_SYNC writes, and everyday workloads, each repeated (40 times unless the"
    " row says otherwise). The client is this machine and the local object storage behind the counting proxy, with"
    " the added latency in the header. Branch operations go through skywaked, timed from the `skywake` command"
    " starting to it returning. *Warm* is a second run on the same mount. *Client-cold* is a fresh daemon with an"
    " empty chunk cache while the cache tier already holds the data. *Fully cold* also starts an empty tier, so"
    " every miss goes to the bucket; *tier off* runs without a tier. fio uses `--bs=4k --direct=1 --iodepth=1`;"
    " writes add `--sync=1` (O_SYNC)."
)
RUNS = 40
FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"
MODES = [
    ("warm", "warm"),
    ("client-cold", "client-cold, tier warm"),
    ("fully-cold", "fully cold, tier empty"),
    ("tier-off", "cold, tier off"),
]


def run(ctx):
    suite = Suite("latency", "Latency", ABOUT)
    if not shutil.which("fio"):
        suite.note("fio is missing, so the 4 KiB rows are skipped: rebuild the dev image (docker/dev).")
    bench = Bench(ctx, suite)
    sections = [bench.branches, bench.npm, bench.git, bench.sqlite]
    if shutil.which("fio"):
        sections[1:1] = [bench.random_reads, bench.sync_writes]
    errors = []
    for section in sections:
        started = time.monotonic()
        try:
            section()
            print(f"  latency: {section.__name__} took {time.monotonic() - started:.0f} s", flush=True)
        except Exception:
            errors.append(f"{section.__name__}:\n{traceback.format_exc()}")
    suite.error = "\n".join(errors)
    return suite


class Bench:
    def __init__(self, ctx, suite):
        self.ctx, self.suite = ctx, suite
        self.runs = ctx.size(RUNS, 10)
        self.store = ctx.scratch / "no-daemon"
        self.made = 0
        # What `skywake` commands run without a daemon add to their environment.
        self.cli_env = {}

    def name(self, what):
        self.made += 1
        return f"{self.ctx.run}-{what}-{self.made}"

    def commit(self, folder, what):
        """A branch holding `folder`, made without a daemon."""
        branch = self.name(what)
        self.ctx.skywake("new", branch, root=self.store, env=self.cli_env)
        self.ctx.skywake("commit", branch, folder, "-m", what, root=self.store, env=self.cli_env)
        return branch

    def fork(self, branch):
        return self.forks(branch, 1)[0]

    def forks(self, branch, count):
        forks = [self.name("fork") for _ in range(count)]
        at_once(lambda fork: self.ctx.skywake("new", fork, "--from", branch, root=self.store, env=self.cli_env), forks)
        return forks

    def latency_row(self, label, samples, extra=None):
        p50, p95, p99 = percentiles(samples)
        metrics = {"p50 ms": p50, "p95 ms": p95, "p99 ms": p99}
        metrics["count"] = len(samples)
        self.suite.row(label, {**metrics, **(extra or {})})

    # Create, mount, checkpoint and branch: how long each takes, size aside.

    def branches(self):
        with Daemon(self.ctx, self.ctx.scratch / "host") as daemon:
            self.branch_ops(daemon, "")
        place = self.ctx.scratch / "heads"
        with contextlib.ExitStack() as stack:
            nodes = heads_tier(stack, self.ctx, place)
            self.cli_env = heads_env(nodes)
            daemon = stack.enter_context(Daemon(self.ctx, place / "host", cache_nodes=nodes, heads=True))
            # The servers hand slots to each other in their first few seconds.
            time.sleep(6)
            try:
                self.branch_ops(daemon, ", heads on the tier")
            finally:
                self.cli_env = {}
        shutil.rmtree(place, ignore_errors=True)

    def branch_ops(self, daemon, label):
        ctx = self.ctx
        tree = ctx.scratch / "tree"
        size, files = make_source(tree, ctx.size(20_000, 2_000), ctx.seed)
        self.suite.setting("branch tree", {"bytes": size, "files": files})
        base = self.commit(tree, "tree")
        shutil.rmtree(tree)

        samples = [timed(lambda i=i: daemon.call("new", f"{base}-new-{i}")) * 1000 for i in range(self.runs)]
        self.latency_row(f"create a branch (`skywake new`){label}", samples)

        forks = self.forks(base, self.runs)
        samples = []
        for i, fork in enumerate(forks):
            mnt = ctx.scratch / f"mount-{i}"
            samples.append(timed(lambda: mount_and_list(daemon, fork, mnt)) * 1000)
            daemon.call("unmount", mnt)
        self.latency_row(f"mount a fork ({files:,} files) and list it{label}", samples)

        mnt = ctx.scratch / "work"
        mount_and_list(daemon, forks[0], mnt)
        commits, branches = [], []
        for i in range(self.runs):
            write(mnt / "notes" / f"change-{i}.txt", f"change {i}\n".encode())
            commits.append(timed(lambda i=i: daemon.call("commit", forks[0], mnt, "-m", f"change {i}")) * 1000)
            branches.append(timed(lambda i=i: daemon.call("new", f"{forks[0]}-b{i}", "--from", forks[0])) * 1000)
        daemon.call("unmount", mnt)
        self.latency_row(f"checkpoint: change a file, `skywake commit`{label}", commits)
        self.latency_row(f"branch from that checkpoint (`new --from`){label}", branches)

        if not label:
            samples = [timed(lambda: daemon.call("mounts")) * 1000 for _ in range(self.runs)]
            self.latency_row("`skywake mounts`: the command and daemon alone", samples)

    # 4 KiB reads and O_SYNC writes with fio.

    def random_reads(self):
        ctx = self.ctx
        data = ctx.scratch / "data"
        mb = ctx.size(1024, 128)
        data.mkdir()
        with open(data / "data.bin", "wb") as file:
            for _ in range(mb // 16):
                file.write(os.urandom(16 << 20))
        base = self.commit(data, "data")
        shutil.rmtree(data)
        ios = self.runs
        # Reads spread evenly, one per chunk at most. A first small read of a chunk fetches only its bytes and no read-ahead, so each one misses.
        gap = (mb << 20) // ios - 4096
        for mode, label in MODES:
            with self.mounted(base, mode, warm_read=["data.bin"]) as (mnt, _):
                with ctx.requests() as requests:
                    latencies = fio(mnt, "data.bin", f"read:{gap}", f"{mb}m", ios)
            extra = {"GET": requests.count("GET")} if mode != "warm" else {}
            self.latency_row(f"4 KiB read, {label} ({ios} reads across {mb} MB)", latencies, extra)
        self.suite.note(
            "The first small read of a chunk fetches only its bytes and reads nothing ahead, and the reads are"
            " spread evenly, so each one misses."
        )

    def sync_writes(self):
        ctx = self.ctx
        for label, with_tier in [("write log in 3 zones", True), ("bucket only", False)]:
            place = ctx.scratch / f"writer-{with_tier}"
            with contextlib.ExitStack() as stack:
                nodes = tier(stack, ctx, place) if with_tier else []
                daemon = stack.enter_context(Daemon(ctx, place / "daemon", cache_nodes=nodes))
                mnt = place / "writes"
                mount_and_list(daemon, self.fork(self.empty()), mnt, wait=False)
                for size in ["4m", "64m"]:
                    subprocess.run(["fio", *layout(mnt, f"w-{size}.bin", size)], check=True, capture_output=True)
                    daemon.call("sync", mnt)
                    with ctx.requests() as requests:
                        latencies = fio(mnt, f"w-{size}.bin", "randwrite", size, ctx.size(RUNS, 10), sync=True)
                    summary = requests.summary()
                    extra = {"PUT": summary.get("PUT"), "MB up": summary.get("MB up")}
                    name = f"4 KiB O_SYNC random write, {size[:-1]} MB file, {label}"
                    self.latency_row(name, latencies, extra)
                daemon.call("unmount", mnt)
            shutil.rmtree(place, ignore_errors=True)

    def empty(self):
        branch = self.name("empty")
        self.ctx.skywake("new", branch, root=self.store)
        return branch

    # Workloads: npm ci, git clone and status, SQLite.

    def npm(self):
        ctx = self.ctx
        if not shutil.which("npm"):
            self.suite.note("npm is missing, so `npm ci` is skipped.")
            return
        project = ctx.scratch / "npm-local"
        shutil.copytree(FIXTURES / "npm-600", project)
        cache = ctx.scratch / "npm-cache"
        env = {**ctx.env, "npm_config_cache": str(cache)}
        filled = subprocess.run(["npm", "ci", "--no-audit", "--no-fund"], cwd=project, env=env, capture_output=True)
        if filled.returncode:
            self.suite.note("`npm ci` skipped: couldn't fill the npm cache (no network?).")
            return
        packages = len(json.loads((project / "package-lock.json").read_text())["packages"]) - 1
        command = ["npm", "ci", "--offline", "--no-audit", "--no-fund"]
        local = []
        for _ in range(3):
            empty(project / "node_modules")
            local.append(timed(command, cwd=project, env=env))
        with self.mounted(self.empty(), "warm") as (mnt, _):
            for name in ["package.json", "package-lock.json"]:
                shutil.copy(project / name, mnt / name)
            with ctx.requests() as requests:
                first = timed(command, cwd=mnt, env=env)
            again = []
            for _ in range(2):
                empty(mnt / "node_modules")
                again.append(timed(command, cwd=mnt, env=env))
        self.suite.row(
            f"`npm ci`, {packages} packages from the npm cache",
            {
                "local ms": median(local) * 1000,
                "ms": median([first, *again]) * 1000,
                "PUT": requests.count("PUT"),
            },
        )
        self.suite.note("`npm ci` reads the npm cache on local disk, so it measures the filesystem.")
        shutil.rmtree(cache, ignore_errors=True)
        shutil.rmtree(project, ignore_errors=True)

    def git(self):
        ctx = self.ctx
        source = ctx.scratch / "git-source"
        files = make_git_repo(source, ctx.size(30_000, 3_000), ctx.seed)
        url = f"file://{source}"
        local = ctx.scratch / "git-local"
        local.mkdir()
        clone = ["git", "clone", "-q", url, "clone"]
        local_clone = timed(clone, cwd=local)
        local_status = median([timed(["git", "status", "--porcelain"], cwd=local / "clone") for _ in range(3)])
        with self.mounted(self.empty(), "warm") as (mnt, daemon):
            with ctx.requests() as requests:
                seconds = timed(clone, cwd=mnt)
            daemon.call("sync", mnt)
            cloned = daemon_branch(daemon, mnt)
        self.suite.row(
            f"`git clone`, {files:,} files",
            {"local ms": local_clone * 1000, "ms": seconds * 1000, "PUT": requests.count("PUT")},
        )
        for mode, label in MODES:
            with self.mounted(cloned, mode, warm_read=["clone"]) as (mnt, _):
                with ctx.requests() as requests:
                    seconds = timed(["git", "status", "--porcelain"], cwd=mnt / "clone")
            self.suite.row(
                f"`git status`, {files:,} files, {label}",
                {"local ms": local_status * 1000, "ms": seconds * 1000, "GET": requests.count("GET")},
            )
        shutil.rmtree(local, ignore_errors=True)

    def sqlite(self):
        ctx = self.ctx
        rows = ctx.size(200_000, 20_000)
        local = ctx.scratch / "sqlite-local"
        local.mkdir()
        local_insert, _ = sqlite_insert(local / "app.db", rows)
        with self.mounted(self.empty(), "warm") as (mnt, daemon):
            with ctx.requests() as requests:
                insert, commits = sqlite_insert(mnt / "app.db", rows, autocommits=ctx.size(RUNS, 10))
            self.suite.row(
                f"SQLite: insert {rows:,} rows in one transaction",
                {"local ms": local_insert * 1000, "ms": insert * 1000, "PUT": requests.count("PUT")},
            )
            self.latency_row("SQLite: one-row insert, its own transaction", commits)
            daemon.call("sync", mnt)
            stored = daemon_branch(daemon, mnt)
        reads = ctx.size(2_000, 200)
        local_reads = sqlite_reads(local / "app.db", rows, reads, ctx.seed)
        self.latency_row("SQLite: point read, local disk", local_reads)
        for mode, label in MODES:
            with self.mounted(stored, mode, warm_read=["app.db"]) as (mnt, _):
                with ctx.requests() as requests:
                    samples = sqlite_reads(mnt / "app.db", rows, reads, ctx.seed)
            self.latency_row(f"SQLite: point read, {label}", samples, {"GET": requests.count("GET")})
        shutil.rmtree(local, ignore_errors=True)

    @contextlib.contextmanager
    def mounted(self, branch, mode, warm_read=()):
        """A fork of `branch` mounted on a fresh daemon, in one of MODES. For a cold mode the paths in
        `warm_read` are read once first through the tier (client-cold), or not at all."""
        ctx = self.ctx
        self.made += 1
        place = ctx.scratch / f"m-{self.made}"
        with contextlib.ExitStack() as stack:
            nodes = []
            if mode != "tier-off":
                nodes = tier(stack, ctx, place)
            if mode == "client-cold":
                with Daemon(ctx, place / "warmer", cache_nodes=nodes) as warmer:
                    mnt = place / "warmer-mnt"
                    mount_and_list(warmer, self.fork(branch), mnt, wait=False)
                    for path in warm_read:
                        read_all(mnt / path)
                    warmer.call("unmount", mnt)
            daemon = stack.enter_context(Daemon(ctx, place / "daemon", cache_nodes=nodes))
            mnt = place / "mnt"
            mount_and_list(daemon, self.fork(branch), mnt, wait=False)
            if mode == "warm":
                for path in warm_read:
                    read_all(mnt / path)
            yield mnt, daemon
            daemon.call("unmount", mnt, check=False)
        shutil.rmtree(place, ignore_errors=True)


def tier(stack, ctx, place):
    """Three cache nodes, one per zone: the chunk cache, and three copies of the write log."""
    return [stack.enter_context(CacheNode(ctx, place / f"tier-{zone}", zone)).url for zone in "abc"]


def heads_tier(stack, ctx, place):
    """Three cache nodes, one per zone, that also keep branch heads."""
    addresses = [free_address() for _ in "abc"]
    peers = [f"http://{address}" for address in addresses]
    for zone, address in zip("abc", addresses):
        stack.enter_context(CacheNode(ctx, place / f"tier-{zone}", zone, address, peers))
    return peers


def mount_and_list(daemon, branch, mnt, wait=True):
    daemon.mount(branch, mnt)
    while wait and not os.listdir(mnt):
        time.sleep(0.001)


def daemon_branch(daemon, mnt):
    for line in daemon.call("mounts").splitlines():
        if str(mnt) in line:
            return line.split()[0]
    raise RuntimeError(f"no mount at {mnt}")


def read_all(path):
    if path.is_dir():
        subprocess.run(["sh", "-c", "find . -type f -exec cat {} + > /dev/null"], cwd=path, check=True)
    else:
        with open(path, "rb") as file:
            while file.read(1 << 20):
                pass


def layout(mnt, name, size):
    return ["--name=layout", f"--filename={mnt / name}", f"--size={size}", "--rw=write", "--bs=1m"]


def fio(mnt, name, rw, size, ios, sync=False):
    """Per-operation completion latencies in ms from fio's log, 4 KiB, direct, one at a time."""
    log = mnt.parent / f"fio-{rw.split(':')[0]}"
    command = [
        "fio",
        "--name=latency",
        f"--filename={mnt / name}",
        f"--rw={rw}",
        "--bs=4k",
        "--direct=1",
        "--iodepth=1",
        "--ioengine=psync",
        f"--size={size}",
        f"--number_ios={ios}",
        "--randrepeat=0",
        f"--write_lat_log={log}",
        "--log_avg_msec=0",
        "--output-format=json",
    ] + (["--sync=1"] if sync else [])
    subprocess.run(command, check=True, capture_output=True, text=True)
    samples = []
    for path in log.parent.glob(f"{log.name}_clat.*.log"):
        samples += [int(line.split(",")[1]) / 1e6 for line in path.read_text().splitlines() if line.strip()]
        path.unlink()
    for path in log.parent.glob(f"{log.name}_*lat.*.log"):
        path.unlink()
    return samples


def make_git_repo(folder, files, seed):
    """A repository with `files` source files and 20 commits of history."""
    rng = random.Random(seed)
    _, count = make_source(folder, files, seed)
    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "bench",
        "GIT_AUTHOR_EMAIL": "bench@example.com",
        "GIT_COMMITTER_NAME": "bench",
        "GIT_COMMITTER_EMAIL": "bench@example.com",
    }
    git = lambda *args: subprocess.run(["git", *args], cwd=folder, env=env, check=True, capture_output=True)  # noqa: E731
    git("init", "-q", "-b", "main")
    git("config", "gc.auto", "0")  # a background gc would hold the lock the final `git gc` needs
    git("add", "-A")
    git("commit", "-q", "-m", "start")
    paths = sorted(str(path.relative_to(folder)) for path in folder.rglob("*.txt"))
    for i in range(19):
        for path in rng.sample(paths, min(100, len(paths))):
            with open(folder / path, "ab") as file:
                file.write(f"edit {i}\n".encode())
        git("commit", "-q", "-am", f"edit {i}")
    git("gc", "-q")
    return count


def sqlite_insert(path, rows, autocommits=0):
    """Seconds for one transaction of `rows` inserts, then ms for each of `autocommits` one-row commits."""
    db = sqlite3.connect(path, isolation_level=None)
    db.execute("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, body TEXT)")
    started = time.perf_counter()
    db.execute("BEGIN")
    db.executemany(
        "INSERT INTO items (id, name, body) VALUES (?, ?, ?)",
        ((i, f"item {i}", "x" * 200) for i in range(rows)),
    )
    db.execute("COMMIT")
    seconds = time.perf_counter() - started
    commits = []
    for i in range(autocommits):
        started = time.perf_counter()
        db.execute("INSERT INTO items (id, name, body) VALUES (?, ?, ?)", (rows + i, "late", "y" * 200))
        commits.append((time.perf_counter() - started) * 1000)
    db.close()
    return seconds, commits


def sqlite_reads(path, rows, reads, seed):
    rng = random.Random(seed)
    db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    samples = []
    for _ in range(reads):
        key = rng.randrange(rows)
        started = time.perf_counter()
        db.execute("SELECT body FROM items WHERE id = ?", (key,)).fetchone()
        samples.append((time.perf_counter() - started) * 1000)
    db.close()
    return samples


def percentiles(samples):
    ordered = sorted(samples)
    at = lambda share: ordered[min(len(ordered) - 1, round(share * (len(ordered) - 1)))]  # noqa: E731
    return at(0.50), at(0.95), at(0.99)
