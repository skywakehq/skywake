"""Mount: typical agent work in a folder, on a mounted fork and on local
disk."""

import json
import os
import shutil
import subprocess
import tarfile
import time

from lib import ROOT, Daemon, Suite, empty, make_mixed, make_source, median, timed

ABOUT = (
    "This repository, committed, forked and mounted, against the same files on"
    " local disk. *Cold* is the first run on a fresh daemon with an empty chunk"
    " cache (a fresh one for each workload); *warm* runs again once the cache is"
    " full. Local and warm are the median of 3 runs, taken in turn. Writes have no cold run. Requests are those of the cold"
    " run. The daemon saves every 2 s throughout, as it would for an agent."
)
RUNS = 3
# A small set of npm packages, like a typical web app uses. Installs offline.
NPM_PACKAGES = {"express": "4.21.1", "lodash": "4.17.21", "typescript": "5.6.3", "zod": "3.23.8"}


def run(ctx):
    suite = Suite("mount", "Mount: agent workloads", ABOUT)
    no_daemon = ctx.scratch / "no-daemon"
    repo = ctx.scratch / "local"
    shutil.copytree(
        ROOT,
        repo,
        symlinks=True,
        ignore=shutil.ignore_patterns("target", ".skywake", "results", ".claude", "node_modules", ".next"),
    )
    big = ctx.scratch / "big"
    big_size, big_files = make_mixed(big, ctx.size(1024, 256), ctx.seed)
    suite.setting("big tree", {"bytes": big_size, "files": big_files})
    for name, tree in [("repo", repo), ("big", big)]:
        ctx.skywake("new", f"{ctx.run}-{name}", root=no_daemon)
        ctx.skywake("commit", f"{ctx.run}-{name}", tree, "-m", "base", root=no_daemon)
        ctx.skywake("new", f"{ctx.run}-{name}-fork", "--from", f"{ctx.run}-{name}", root=no_daemon)

    mount_ms = []
    for name, label in [("repo", "this repository"), ("big", f"{big_size / 1e9:.1f} GB tree")]:
        mnt = ctx.scratch / f"mnt-{name}"
        with Daemon(ctx, ctx.scratch / f"host-{name}") as daemon, ctx.requests() as requests:
            seconds = timed(lambda: mount_and_list(daemon, f"{ctx.run}-{name}-fork", mnt))
        mount_ms.append(seconds * 1000)
        suite.row(f"mount a fork ({label}) and list it", {"cold ms": seconds * 1000, **requests.summary()})
    suite.check("a fork is usable in under 100 ms, whatever its size", max(mount_ms) < 100)

    tarball = ctx.scratch / "source.tar"
    make_source(ctx.scratch / "source", 2_000, ctx.seed)
    with tarfile.open(tarball, "w") as tar:
        tar.add(ctx.scratch / "source", arcname="unpacked")
    npm_ready = prepare_npm(ctx.scratch / "npm")
    if not npm_ready:
        suite.note("npm install skipped: couldn't fill the npm cache (no network?).")

    # (label, command, what to undo after each run, whether it only reads)
    workloads = [
        ("`git status`", ["git", "status", "--porcelain"], None, True),
        ("stat every file (`find`)", ["find", ".", "-printf", "%s\n"], None, True),
        # Not `tar cf /dev/null`: GNU tar skips reading when it writes there.
        ("read every file (`cat`)", ["sh", "-c", "find . -type f -exec cat {} + > /dev/null"], None, True),
        ("search every file (`grep -r`)", ["grep", "-rc", "fn ", "."], None, True),
        ("unpack 2,000 small files (`tar x`)", ["tar", "xf", str(tarball)], lambda d: shutil.rmtree(d / "unpacked"), False),
        ("write a 256 MB file (`dd`, then `fsync`)", ["dd", "if=/dev/zero", "of=out.bin", "bs=1M", "count=256", "conv=fsync"], lambda d: (d / "out.bin").unlink(), False),
        ("`cargo build` + tests, from scratch", ["cargo", "test", "-q", "-p", "skywake-core", "--no-run"], lambda d: empty(d / "target"), True),
    ]  # fmt: skip
    if npm_ready:
        workloads.append(
            (
                "`npm ci` (offline, from the npm cache)",
                ["npm", "ci", "--offline", "--no-audit", "--no-fund"],
                undo_npm,
                False,
            )
        )
        for path in ["package.json", "package-lock.json"]:
            shutil.copy(ctx.scratch / "npm" / path, repo / path)
    # Builds use the folder's own target directory, like an agent's build.
    env = {key: value for key, value in ctx.env.items() if key != "CARGO_TARGET_DIR"}

    mnt = ctx.scratch / "mnt"
    with Daemon(ctx, ctx.scratch / "host") as daemon:
        mount_and_list(daemon, f"{ctx.run}-repo-fork", mnt)
        if npm_ready:
            for path in ["package.json", "package-lock.json"]:
                shutil.copy(ctx.scratch / "npm" / path, mnt / path)

        def once(command, folder, undo):
            seconds = timed(command, cwd=folder, env=env)
            if undo:
                undo(folder)
            return seconds

        timings = {}
        for k, (label, command, undo, reads) in enumerate(workloads):
            metrics = {}
            if reads:
                # A new fork and daemon each time, so every workload starts
                # with an empty cache.
                fork, cold_mnt = f"{ctx.run}-repo-cold-{k}", ctx.scratch / f"cold-{k}"
                ctx.skywake("new", fork, "--from", f"{ctx.run}-repo", root=no_daemon)
                with Daemon(ctx, ctx.scratch / f"cold-host-{k}") as cold:
                    mount_and_list(cold, fork, cold_mnt)
                    with ctx.requests() as requests:
                        metrics["cold ms"] = once(command, cold_mnt, undo) * 1000
            local, warm = [], []
            for _ in range(RUNS):  # alternate, so slow periods affect both the same
                local.append(once(command, repo, undo))
                warm.append(once(command, mnt, undo))
            local, warm = median(local), median(warm)
            metrics = {
                "local ms": local * 1000,
                **metrics,
                "warm ms": warm * 1000,
                "warm ÷ local %": warm / local * 100,
            }
            if reads:
                metrics.update({"GET": requests.count("GET"), "MB down": requests.summary().get("MB down")})
            timings[label] = suite.row(label, metrics)

    suite.check("`git status`: under 20 ms warm", timings["`git status`"]["warm ms"] < 20)
    suite.check("read every file: under 20 ms warm", timings["read every file (`cat`)"]["warm ms"] < 20)
    build = timings["`cargo build` + tests, from scratch"]
    suite.check("`cargo build`: warm within 20% of local disk", build["warm ms"] <= build["local ms"] * 1.2)
    return suite


def mount_and_list(daemon, branch, mnt):
    daemon.mount(branch, mnt)
    while not os.listdir(mnt):
        time.sleep(0.001)


def prepare_npm(folder):
    """Writes a package.json and fills the npm cache once from the network.
    Timed installs then read only the local cache."""
    if not shutil.which("npm"):
        return False
    folder.mkdir()
    (folder / "package.json").write_text(json.dumps({"name": "app", "version": "1.0.0", "dependencies": NPM_PACKAGES}))
    result = subprocess.run(["npm", "install", "--no-audit", "--no-fund"], cwd=folder, capture_output=True)
    return result.returncode == 0


def undo_npm(folder):
    empty(folder / "node_modules")
