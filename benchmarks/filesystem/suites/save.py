"""Save: the cost of one save, for each kind of change."""

import os
import shutil

from lib import Daemon, Suite, make_source, text, timed, write

ABOUT = (
    "A mounted source tree, saved with `skywake commit` after one kind of change"
    " at a time (the timer is off, so nothing else saves). The time includes"
    " the command and the round trip to the daemon. Median and slowest of the"
    " runs; requests and bytes are the median run's."
)


def run(ctx):
    suite = Suite("save", "Save: one save, by kind of change", ABOUT)
    files = ctx.size(20_000, 2_000)
    write(ctx.scratch / "base" / "pkg-18" / "appended.log", text(100_000))
    size, files = make_source(ctx.scratch / "base", files, ctx.seed)
    suite.note(f"The tree: {size / 1e6:,.0f} MB in {files:,} files, in 20 top-level folders.")
    suite.setting("tree", {"bytes": size, "files": files})
    branch = f"{ctx.run}-save"
    ctx.skywake("new", branch, root=ctx.scratch / "no-daemon")
    ctx.skywake("commit", branch, ctx.scratch / "base", "-m", "base", root=ctx.scratch / "no-daemon")
    runs = ctx.size(5, 3)
    suite.setting("saves per change", runs)
    mnt = ctx.scratch / "mnt"

    def small_files(count, folders):
        return lambda i: [
            write(mnt / f"new-{count}-{i}" / f"d{j % folders}" / f"f{j}.txt", text(2000)) for j in range(count)
        ]

    def delete(i):
        doomed = sorted(path for path in (mnt / f"pkg-{i}").rglob("*") if path.is_file())[:100]
        for path in doomed:
            path.unlink()

    scenarios = [
        ("nothing changed", lambda i: None),
        ("1 small file rewritten", lambda i: (mnt / "pkg-19" / "mod-19" / "file-19.txt").write_bytes(text(3000))),
        ("1 line appended to a 100 KB file", lambda i: append(mnt / "pkg-18" / "appended.log", f"line {i}\n")),
        ("100 new small files, one folder", small_files(100, 1)),
        ("1,000 new small files, 100 folders", small_files(1000, 100)),
        ("1 new 64 MB file", lambda i: write(mnt / f"large-{i}.bin", os.urandom(64 << 20))),
        ("100 files deleted", delete),
        ("a top-level folder renamed", lambda i: os.rename(mnt / f"pkg-{10 + i}", mnt / f"renamed-{i}")),
    ]
    results = {}
    with Daemon(ctx, ctx.scratch / "host", save_every_ms=3_600_000) as daemon:
        daemon.mount(branch, mnt)
        for label, change in scenarios:
            measured = []
            for i in range(runs):
                change(i)
                with ctx.requests() as requests:
                    seconds = timed(lambda: daemon.call("commit", branch, mnt, "-m", label))
                measured.append((seconds, requests.summary()))
            measured.sort(key=lambda result: result[0])
            seconds, requests = measured[len(measured) // 2]
            results[label] = suite.row(label, {"ms": seconds * 1000, "slowest ms": measured[-1][0] * 1000, **requests})

    suite.check("1 small file: saved in under 100 ms", results["1 small file rewritten"]["ms"] < 100)
    if ctx.proxy:
        suite.check(
            # 200 KB of files. The first 64 KiB are stored inside the
            # folder's tree; each file after that is its own chunk.
            "100 small files in one folder: one request per file past the folder's 64 KiB inline budget (under 75)",
            results["100 new small files, one folder"]["requests"] < 75,
        )
        suite.check(
            "1,000 small files in 100 folders: about one request per folder (under 120)",
            results["1,000 new small files, 100 folders"]["requests"] < 120,
        )
        suite.check(
            "a rename uploads no file data (under 0.1 MB)", results["a top-level folder renamed"]["MB up"] < 0.1
        )
    shutil.rmtree(ctx.scratch / "base")
    return suite


def append(path, line):
    with open(path, "a") as log:
        log.write(line)
