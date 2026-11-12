"""Store: a folder to the bucket and back with the `skywake` command, with
no mount or daemon."""

import shutil

from lib import Suite, make_mixed, make_source, median, p95, text, timed

ABOUT = (
    "Commit, checkout and fork straight against the bucket. *Mixed* is a project"
    " with its build artifacts, 90% of it in large binaries; *source* is a"
    " repository's worth of small files. The data is random on every run, so"
    " nothing dedupes against earlier runs."
)


def run(ctx):
    suite = Suite("store", "Store: commit, checkout, fork", ABOUT)
    no_daemon = ctx.scratch / "no-daemon"  # no skywaked here, so commits run locally
    datasets = {
        "mixed": lambda path: make_mixed(path, ctx.size(1024, 128), ctx.seed),
        "source": lambda path: make_source(path, ctx.size(20_000, 2_000), ctx.seed),
    }
    rates = {}
    for name, make in datasets.items():
        data = ctx.scratch / name
        size, files = make(data)
        suite.note(f"{name}: {size / 1e6:,.0f} MB in {files:,} files")
        suite.setting(name, {"bytes": size, "files": files})
        branch = f"{ctx.run}-{name}"
        ctx.skywake("new", branch, root=no_daemon)

        def op(label, *command, rate=True):
            with ctx.requests() as requests:
                seconds = timed(lambda: ctx.skywake(*command, root=no_daemon))
            metrics = {"ms": seconds * 1000, "MB/s": size / seconds / 1e6 if rate else None}
            return suite.row(f"{name}: {label}", {**metrics, **requests.summary()})

        rates[name] = op("commit", "commit", branch, data, "-m", "base")
        unchanged = op("commit, nothing changed", "commit", branch, data, "-m", "same", rate=False)
        suite.check(f"{name}: a commit with nothing changed takes under 1 s", unchanged["ms"] < 1000)
        edited = edit(data, every=100)
        op(f"commit, {edited:,} small files changed", "commit", branch, data, "-m", "edit", rate=False)
        op("checkout", "checkout", branch, ctx.scratch / f"{name}-checkout")

        forks = ctx.size(100, 20)
        suite.setting("forks", forks)
        with ctx.requests() as requests:
            times = [
                timed(lambda i=i: ctx.skywake("new", f"{branch}-fork-{i}", "--from", branch, root=no_daemon))
                for i in range(forks)
            ]
        per_fork = {key: value / forks for key, value in requests.summary().items()}
        suite.row(
            f"{name}: fork (`new --from`, {forks} times)",
            {"ms": median(times) * 1000, "p95 ms": p95(times) * 1000, **per_fork},
        )
        suite.check(f"{name}: a fork takes under 50 ms", median(times) < 0.05)

    if shutil.which("aws") and ctx.env.get("SKYWAKE_STORE", "").startswith("s3://"):
        bucket = ctx.env["SKYWAKE_STORE"].removeprefix("s3://").split("/")[0]
        data = ctx.scratch / "mixed"
        size = sum(path.stat().st_size for path in data.rglob("*") if path.is_file())
        # AWS itself needs no endpoint; the local store and R2 do.
        endpoint = ["--endpoint-url", ctx.env["AWS_ENDPOINT"]] if "AWS_ENDPOINT" in ctx.env else []
        command = [
            "aws", "s3", "cp", "--recursive", "--only-show-errors", *endpoint,
            str(data), f"s3://{bucket}/baseline-{ctx.run}/",
        ]  # fmt: skip
        with ctx.requests() as requests:
            seconds = timed(command, env=ctx.env)
        baseline = suite.row(
            "mixed: `aws s3 cp --recursive` (baseline)",
            {"ms": seconds * 1000, "MB/s": size / seconds / 1e6, **requests.summary()},
        )
        suite.check("mixed: commit at 80% or more of `aws s3 cp`", rates["mixed"]["MB/s"] >= 0.8 * baseline["MB/s"])
    else:
        suite.note("No `aws s3 cp` baseline: needs the aws CLI and an S3 store.")
    return suite


def edit(root, every):
    """Rewrites every `every`th file under 1 MB with new content of the
    same size. Returns how many it rewrote."""
    small = sorted(path for path in root.rglob("*") if path.is_file() and path.stat().st_size < 1 << 20)
    for path in small[::every]:
        path.write_bytes(text(path.stat().st_size))
    return len(small[::every])
