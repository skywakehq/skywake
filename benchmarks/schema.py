"""The results schema every benchmark writes, in Rust (`src/results.rs`) and here: what ran, where, with which
settings, and its tables."""

import datetime
import json
import os
import platform
import socket
import subprocess
import sys
from pathlib import Path

SCHEMA = 1
ROOT = Path(__file__).resolve().parent.parent
RESULTS = ROOT / "benchmarks" / "results"


def run_id(benchmark):
    return f"{datetime.datetime.now().strftime('%Y%m%d-%H%M%S')}-{benchmark}"


def environment(client=""):
    def git(*args):
        return command("git", "-c", "safe.directory=*", "-C", str(ROOT), *args)

    found = {
        "commit": git("rev-parse", "--short", "HEAD"),
        "dirty": bool(git("status", "--porcelain", "--untracked-files=no")),
        "started": datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "machine": {
            "hostname": socket.gethostname(),
            "os": {"darwin": "macos"}.get(sys.platform, sys.platform),
            "kernel": f"{platform.system()} {platform.release()}",
            "arch": {"arm64": "aarch64", "AMD64": "x86_64"}.get(platform.machine(), platform.machine()),
            "cpu": cpu(),
            "cores": os.cpu_count(),
            "memory_bytes": memory(),
        },
    }
    if client:
        found["client"] = client
    return found


def save(run, benchmark, environment, settings, tables, report, out=None):
    out = Path(out) if out else RESULTS / run
    out.mkdir(parents=True, exist_ok=True)
    document = {
        "schema": SCHEMA,
        "benchmark": benchmark,
        "run": run,
        "environment": environment,
        "settings": settings,
        "tables": tables,
    }
    (out / "results.json").write_text(json.dumps(document, indent=1))
    (out / "report.md").write_text(report)
    return out


def command(*args):
    try:
        return subprocess.run(args, capture_output=True, text=True).stdout.strip()
    except OSError:
        return ""


def proc_field(path, key):
    try:
        lines = Path(path).read_text().splitlines()
    except OSError:
        return ""
    return next((line.split(":", 1)[1].strip() for line in lines if line.startswith(key)), "")


def cpu():
    if sys.platform == "darwin":
        found = command("sysctl", "-n", "machdep.cpu.brand_string")
    else:
        found = proc_field("/proc/cpuinfo", "model name")
    return found or platform.machine()


def memory():
    if sys.platform == "darwin":
        return int(command("sysctl", "-n", "hw.memsize") or 0)
    kb = proc_field("/proc/meminfo", "MemTotal").removesuffix("kB").strip()
    return int(kb or 0) * 1024
