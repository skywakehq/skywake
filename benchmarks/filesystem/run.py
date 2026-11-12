#!/usr/bin/env python3
"""The filesystem benchmarks: the `skywake` command and the mount, driven end to end over FUSE.

    scripts/bench.sh filesystem                 every suite, in the Linux container
    scripts/bench.sh filesystem save --quick    one suite, small datasets
    scripts/compare-benchmarks.sh               the last two runs, side by side

Suites: store, mount, save, daemon, fleet (all by default), and latency (only when named). A proxy counts every request to the bucket, so each
number also shows how many requests it took; against a bucket over HTTPS (benchmarks/cloud/r2) the numbers are
times alone. Each run is saved to benchmarks/results/<run>/ as report.md and results.json.

--quick uses small datasets. --s3-latency-ms N delays every request by N ms (real object storage is about 20);
--s3-write-latency-ms N gives writes (PUT, POST) their own delay.
--repeat N runs every suite N times (5 by default); each number is the median, with the fastest and the 95th
percentile beside it. --seed fixes the shape of every dataset (file sizes and counts); contents stay random, so
nothing dedupes against an earlier run. --client says where this machine runs, needed with a bucket that is not
local. Runs refuse a tree with uncommitted changes unless --allow-dirty, and then the report says so at the top.
"""

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parent)]

import schema  # noqa: E402
from lib import BIN, Context, Suite  # noqa: E402
from proxy import Proxy  # noqa: E402
from report import MIN_REPEAT, combine, header, render, summary, tables  # noqa: E402
from suites import daemon, fleet, latency, mount, save, store  # noqa: E402

SUITES = {"store": store, "mount": mount, "save": save, "daemon": daemon, "fleet": fleet, "latency": latency}
DEFAULT = ["store", "mount", "save", "daemon", "fleet"]
LOCAL_HOSTS = ("localhost", "127.0.0.1", "s3", "host.docker.internal")


def main():
    parser = argparse.ArgumentParser(description="Skywake filesystem benchmarks")
    parser.add_argument("suites", nargs="*", metavar="suite", help=", ".join(SUITES))
    parser.add_argument("--quick", action="store_true", help="small datasets, a few minutes in all")
    parser.add_argument("--s3-latency-ms", type=int, default=0, help="added to every request to the bucket")
    parser.add_argument("--s3-write-latency-ms", type=int, help="added to writes instead (PUT, POST)")
    parser.add_argument("--note", default="", help="a line saved with the results")
    parser.add_argument("--repeat", type=int, default=MIN_REPEAT, help=f"runs of every suite ({MIN_REPEAT})")
    parser.add_argument("--seed", type=int, default=1, help="fixes every dataset's file sizes and counts (1)")
    parser.add_argument("--client", default="", help="where this machine runs: cloud, instance type, region")
    parser.add_argument("--allow-dirty", action="store_true", help="run with uncommitted changes, marked in the report")
    parser.add_argument("--out", type=Path, help="the results folder; by default benchmarks/results/<run>")
    args = parser.parse_args()
    if args.repeat < 1:
        parser.error("--repeat needs at least 1")
    names = args.suites or DEFAULT
    unknown = set(names) - set(SUITES)
    if unknown:
        parser.error(f"no suite {', '.join(sorted(unknown))}; there are {', '.join(SUITES)}")
    if sys.platform != "linux" and {"mount", "save", "daemon", "fleet", "latency"} & set(names):
        raise SystemExit("the mount suites need Linux: run them with scripts/bench.sh filesystem")
    missing = [name for name in ("skywake", "skywaked", "skywake-cache", "s3-proxy") if not (BIN / name).exists()]
    if missing:
        raise SystemExit(f"missing {', '.join(missing)} in {BIN}: build them first (scripts/bench.sh does)")

    run = schema.run_id("filesystem")
    env = dict(os.environ)
    proxy = None
    s3 = env.get("SKYWAKE_STORE", "").startswith("s3://")
    if s3:
        env["SKYWAKE_STORE"] = f"{env['SKYWAKE_STORE'].rstrip('/')}/bench-{run}"
    if s3 and env.get("AWS_ENDPOINT", "").startswith("http://"):
        proxy = Proxy(env["AWS_ENDPOINT"], args.s3_latency_ms, f"bench-{run}/", args.s3_write_latency_ms)
        env["AWS_ENDPOINT"] = proxy.url
    about = schema.environment(args.client)
    if about["dirty"] and not args.allow_dirty:
        raise SystemExit(
            "the tree has uncommitted changes, so no commit matches the numbers: commit them first,"
            " or pass --allow-dirty and the report says so"
        )
    remote = s3 and not local_endpoint(os.environ.get("AWS_ENDPOINT", ""))
    if remote and not args.client:
        raise SystemExit(
            "the bucket is not local: say where this machine runs with --client, such as 'aws c7g.2xlarge us-east-1'"
        )
    settings = {
        "suites": names,
        "quick": args.quick,
        "repeat": args.repeat,
        "seed": args.seed,
        "store": {
            "location": env.get("SKYWAKE_STORE", ".skywake"),
            "endpoint": os.environ.get("AWS_ENDPOINT", ""),
            "region": os.environ.get("AWS_REGION", ""),
            "counted": proxy is not None,
            "latency_ms": args.s3_latency_ms,
            "write_latency_ms": args.s3_write_latency_ms,
        },
        "note": args.note,
    }
    print(header(run, about, settings))

    suites = []
    with tempfile.TemporaryDirectory(prefix="skywake-bench-", ignore_cleanup_errors=True) as scratch:
        for name in names:
            runs = []
            for i in range(args.repeat):
                ctx = Context(f"{run}-{i}", Path(scratch) / f"{name}-{i}", env, args.quick, args.seed, proxy)
                ctx.scratch.mkdir()
                started = time.monotonic()
                try:
                    runs.append(SUITES[name].run(ctx))
                except Exception:
                    runs.append(Suite(name, name, "", error=traceback.format_exc()))
                print(f"{name}: run {i + 1} of {args.repeat} took {time.monotonic() - started:.0f} s", flush=True)
                shutil.rmtree(ctx.scratch, ignore_errors=True)
            suite = combine(runs)
            suites.append(suite)
            print(render(suite), flush=True)
    if proxy:
        proxy.stop()
    if s3:
        clean(env, run, args.repeat)

    settings["payload"] = {suite.name: suite.settings for suite in suites if suite.settings}
    report = header(run, about, settings) + "\n".join(render(suite) for suite in suites)
    out = schema.save(run, "filesystem", about, settings, tables(suites), report, args.out)
    failed = [name for suite in suites for name, ok in suite.checks if not ok]
    errors = [suite.name for suite in suites if suite.error]
    print(f"Saved to {out}. {summary(suites)}")
    sys.exit(1 if failed or errors else 0)


def clean(env, run, repeat):
    """Deletes what the run wrote to the bucket, so a paid or free-tier bucket does not keep it."""
    if not shutil.which("aws"):
        print("Not cleaned: the aws CLI is missing.")
        return
    bucket = env["SKYWAKE_STORE"].removeprefix("s3://").split("/")[0]
    endpoint = os.environ.get("AWS_ENDPOINT")
    for folder in [f"bench-{run}"] + [f"baseline-{run}-{i}" for i in range(repeat)]:
        subprocess.run(
            ["aws", "s3", "rm", "--recursive", "--only-show-errors", f"s3://{bucket}/{folder}/"]
            + (["--endpoint-url", endpoint] if endpoint else []),
        )


def local_endpoint(endpoint):
    host = endpoint.split("://", 1)[-1].split("/", 1)[0].rsplit(":", 1)[0]
    return endpoint.startswith("http://") and host in LOCAL_HOSTS


if __name__ == "__main__":
    main()
