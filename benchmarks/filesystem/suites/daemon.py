"""Daemon: crashes, moving a branch between machines, and the cost of an
idle mount."""

import errno
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from lib import Daemon, Suite, median, p95, text, timed

ABOUT = (
    "Two daemons with separate roots and caches stand in for two machines."
    " Crash: an agent writes a file every 20 ms, the daemon is killed with"
    " SIGKILL, and a new one mounts the branch again. Synced: 64 writers"
    " append and `fsync` at once, with timed saves off, then the daemon is"
    " killed: every synced write must be in the bucket. Move: a branch is"
    " unmounted on one machine and mounted on the other; then it is claimed"
    " back while still mounted, and the old machine must turn read-only."
    " Readers: a branch is mounted read-only and as a fork next to its writer."
)
SAVE_EVERY_MS = 2000
# A change waits at most one interval for the next save, plus the save
# itself (tens of milliseconds here).
SLACK_S = 0.5


def run(ctx):
    suite = Suite("daemon", "Daemon: crashes, moves, idling", ABOUT)
    crash(ctx, suite)
    synced(ctx, suite)
    move(ctx, suite)
    readers(ctx, suite)
    idle(ctx, suite)
    return suite


def crash(ctx, suite):
    branch, mnt, host = f"{ctx.run}-crash", ctx.scratch / "crash", ctx.scratch / "crash-host"
    ctx.skywake("new", branch)
    daemon = Daemon(ctx, host, SAVE_EVERY_MS)
    daemon.mount(branch, mnt)
    writer = Writer(mnt)
    writer.start()
    time.sleep(ctx.size(8, 5))
    crashed_at = time.monotonic()
    daemon.kill()
    writer.join()

    with Daemon(ctx, host, SAVE_EVERY_MS) as daemon:
        started = time.monotonic()
        daemon.mount(branch, mnt)
        remount = time.monotonic() - started
        survived, oldest_lost = 0, None
        for i, written_at in writer.written:
            path = mnt / f"f{i}.txt"
            if path.exists() and path.read_text() == content(i):
                survived += 1
            elif oldest_lost is None:
                oldest_lost = crashed_at - written_at
        daemon.call("unmount", mnt)
        reported = "unsaved changes" in daemon.log()

    lost = len(writer.written) - survived
    suite.row("crash: files written before `kill -9` (one every 20 ms)", {"count": len(writer.written)})
    suite.row("crash: files there after the restart", {"count": survived})
    suite.row("crash: files lost", {"count": lost})
    suite.row("crash: oldest lost write, before the crash", {"ms": oldest_lost * 1000 if oldest_lost else 0})
    suite.row("crash: restart, then mount again", {"ms": remount * 1000})
    window = SAVE_EVERY_MS / 1000
    suite.check(
        f"kill -9: nothing older than the save window ({window:.0f} s) lost",
        oldest_lost is None or oldest_lost <= window + SLACK_S,
    )
    suite.check("kill -9: the restarted daemon reports the unsaved changes it found", reported)


def synced(ctx, suite):
    branch, mnt, host = f"{ctx.run}-synced", ctx.scratch / "synced", ctx.scratch / "synced-host"
    writers, rounds = 64, ctx.size(20, 5)
    suite.setting("synced", {"writers": writers, "rounds": rounds})
    ctx.skywake("new", branch)
    daemon = Daemon(ctx, host, save_every_ms=3_600_000)  # only fsync saves
    daemon.mount(branch, mnt)

    def write(i):
        times = []
        for round in range(rounds):
            fd = os.open(mnt / f"w{i}.txt", os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
            os.write(fd, synced_line(i, round))
            times.append(timed(lambda: os.fsync(fd)))
            os.close(fd)
        return times

    with ctx.requests() as requests, ThreadPoolExecutor(writers) as pool:
        times = [t for each in pool.map(write, range(writers)) for t in each]
    daemon.kill()

    with Daemon(ctx, host) as daemon:
        daemon.mount(branch, mnt)
        intact = all(
            (mnt / f"w{i}.txt").read_bytes() == b"".join(synced_line(i, round) for round in range(rounds))
            for i in range(writers)
        )
        daemon.call("unmount", mnt)

    per_fsync = {key: value / len(times) for key, value in requests.summary().items()}
    suite.row(
        f"synced: `fsync`, {writers} writers at once",
        {"ms": median(times) * 1000, "p95 ms": p95(times) * 1000, **per_fsync},
    )
    suite.check("fsync: every synced write survives `kill -9`", intact)


def synced_line(i, round):
    return f"writer {i}, round {round}\n".encode() * 100


def move(ctx, suite):
    branch = f"{ctx.run}-move"
    m1, m2 = ctx.scratch / "m1", ctx.scratch / "m2"
    ctx.skywake("new", branch)
    with (
        Daemon(ctx, ctx.scratch / "host1", SAVE_EVERY_MS) as host1,
        Daemon(ctx, ctx.scratch / "host2", SAVE_EVERY_MS) as host2,
    ):
        # Planned move: unmount on one machine, mount on the other.
        host1.mount(branch, m1)
        for i in range(200):
            (m1 / f"f{i}.txt").write_text(content(i))
        with ctx.requests() as requests:
            seconds = timed(lambda: (host1.call("unmount", m1), host2.mount(branch, m2)))
        suite.row(
            "move: unmount, then mount on the other machine (200 new files)",
            {"ms": seconds * 1000, **requests.summary()},
        )
        suite.check("planned move: every write arrives on the new machine", intact(m2, 200))

        # Takeover: host1 takes the branch while host2 still has it mounted.
        for i in range(200, 250):
            (m2 / f"f{i}.txt").write_text(content(i))
        time.sleep(SAVE_EVERY_MS / 1000 + SLACK_S)  # host2 saves these
        seconds = timed(lambda: host1.mount(branch, m1))
        suite.row("move: take over a branch still mounted elsewhere", {"ms": seconds * 1000})
        suite.check("takeover: every saved write arrives on the new machine", intact(m1, 250))
        # host2 does not know yet. It accepts the next write locally, but its
        # next save finds the branch taken and fails.
        (m2 / "late.txt").write_text("written after the takeover")
        time.sleep(SAVE_EVERY_MS / 1000 + SLACK_S)
        try:
            (m2 / "later.txt").write_text("written after host2 found out")
            refused = False
        except OSError as error:
            refused = error.errno == errno.EROFS
        suite.check(
            "takeover: the old machine's next save fails, so it can't overwrite the new owner",
            not (m1 / "late.txt").exists(),
        )
        suite.check("takeover: after that, the old machine refuses writes", refused)
        suite.check("takeover: the old machine reports that the branch moved", "moved" in host2.call("mounts"))
        host1.call("unmount", m1)
        host2.call("unmount", m2, check=False)


def readers(ctx, suite):
    """Readers mount a branch read-only beside its writer. A fork mount
    gets its own copy."""
    branch = f"{ctx.run}-readers"
    writer, reader, forked = ctx.scratch / "writer", ctx.scratch / "reader", ctx.scratch / "forked"
    ctx.skywake("new", branch)
    with Daemon(ctx, ctx.scratch / "readers-host", SAVE_EVERY_MS) as host:
        host.mount(branch, writer)
        (writer / "a.txt").write_text("first")
        host.call("sync", writer)
        for path in (reader, forked):
            path.mkdir(parents=True, exist_ok=True)
        host.call("mount", branch, reader, "--read-only")
        host.call("mount", branch, forked, "--fork", f"{branch}-fork")
        suite.check("read-only: a reader sees the saved files", (reader / "a.txt").read_text() == "first")
        try:
            (reader / "b.txt").write_text("no")
            refused = False
        except OSError as error:
            refused = error.errno == errno.EROFS
        suite.check("read-only: a reader cannot write", refused)

        (writer / "b.txt").write_text("second")
        try:
            host.call("sync", writer)
            synced = True
        except RuntimeError:
            synced = False
        suite.check("read-only: readers do not take the branch from its writer", synced)
        suite.check("read-only: a reader stays at the commit it mounted", not (reader / "b.txt").exists())

        (forked / "c.txt").write_text("fork")
        host.call("sync", forked)
        suite.check(
            "fork: the forked mount starts with the files, and its writes stay in the fork",
            (forked / "a.txt").exists() and not (writer / "c.txt").exists(),
        )
        for path in (writer, reader, forked):
            host.call("unmount", path)


def idle(ctx, suite):
    """A mount that nobody uses should cost nothing."""
    branch, mnt = f"{ctx.run}-idle", ctx.scratch / "idle"
    ctx.skywake("new", branch)
    with Daemon(ctx, ctx.scratch / "idle-host", SAVE_EVERY_MS) as daemon:
        daemon.mount(branch, mnt)
        (mnt / "file.txt").write_bytes(text(1000))
        time.sleep(SAVE_EVERY_MS / 1000 + SLACK_S)  # saved; idle from here
        seconds = ctx.size(10, 5)
        with ctx.requests() as requests:
            time.sleep(seconds)
        suite.row(f"idle mount, {seconds} s", requests.summary() or {"requests": "not counted"})
        if ctx.proxy:
            suite.check("an idle mount makes no requests", requests.summary()["requests"] == 0)


class Writer(threading.Thread):
    """Writes a new file every 20 ms until the mount stops working."""

    def __init__(self, mnt):
        super().__init__()
        self.mnt = mnt
        self.written = []

    def run(self):
        for i in range(100_000):
            try:
                (self.mnt / f"f{i}.txt").write_text(content(i))
            except OSError:
                return
            self.written.append((i, time.monotonic()))
            time.sleep(0.02)


def content(i):
    return f"file {i}\n" * 10


def intact(mnt, count):
    return all((mnt / f"f{i}.txt").read_text() == content(i) for i in range(count))
