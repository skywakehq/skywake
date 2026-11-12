#!/usr/bin/env python3
"""Compares two benchmark runs, number by number.

    scripts/compare-benchmarks.sh                 the last two runs of the newest run's benchmark
    scripts/compare-benchmarks.sh OLD NEW         two runs: folder names under benchmarks/results/, or paths

Marks every number that got more than 10% worse and exits with 1 if any did. Times, requests, bytes and waves are
better lower; rates (`/s`, `_per_s`), QPS and recall are better higher. Repeated runs compare their medians. Compare
only runs from the same machine and settings: every difference in either is listed first.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from schema import RESULTS  # noqa: E402

WORSE = 0.10
NOISE = {"ms": 2.0, "requests": 2, "MB": 0.1}
HIGHER = ("/s", "_per_s", "qps", "recall", "mrr10", "ndcg10")
EXPECTED = ("started", "hostname")


def main():
    if len(sys.argv) == 3:
        old, new = (find(name) for name in sys.argv[1:])
    elif len(sys.argv) == 1:
        old, new = latest_two()
    else:
        raise SystemExit(__doc__)
    before, after = load(old), load(new)
    if before["benchmark"] != after["benchmark"]:
        raise SystemExit(f"{old.name} is `{before['benchmark']}` and {new.name} is `{after['benchmark']}`")

    print(f"# {old.name} → {new.name}\n")
    for key in sorted(set(before["context"]) | set(after["context"])):
        a, b = before["context"].get(key), after["context"].get(key)
        if a != b:
            print(f"- note: {key} differs: {a} → {b}")
    regressions = 0
    for table, rows in after["numbers"].items():
        lines = []
        for (label, metric), value in rows.items():
            previous = before["numbers"].get(table, {}).get((label, metric))
            if previous is None:
                continue
            change = (value - previous) / previous if previous else 0.0
            worse = -change if metric.endswith(HIGHER) else change
            flag = ""
            if abs(value - previous) >= noise(metric):
                if worse > WORSE:
                    flag = " **worse**"
                    regressions += 1
                elif worse < -WORSE:
                    flag = " better"
            lines.append(f"| {label} | {metric} | {show(previous)} | {show(value)} | {change:+.0%}{flag} |")
        if lines:
            print(f"\n## {table}\n\n| | | before | after | change |\n|---|---|---:|---:|---:|")
            print("\n".join(lines))
    print(f"\n{regressions} numbers more than {WORSE:.0%} worse.")
    sys.exit(1 if regressions else 0)


def runs():
    return sorted(path for path in RESULTS.iterdir() if (path / "results.json").exists()) if RESULTS.exists() else []


def latest_two():
    found = runs()
    if not found:
        raise SystemExit(f"no runs in {RESULTS}")
    kind = load(found[-1])["benchmark"]
    same = [path for path in found if load(path)["benchmark"] == kind]
    if len(same) < 2:
        raise SystemExit(f"needs two `{kind}` runs in {RESULTS}")
    return same[-2:]


def find(name):
    path = Path(name)
    path = path if path.exists() else RESULTS / name
    if not (path / "results.json").exists():
        raise SystemExit(f"no results.json in {path}")
    return path


def load(path):
    data = json.loads((path / "results.json").read_text())
    numbers = {
        table["name"]: {
            (row["label"], metric): value["median"] if isinstance(value, dict) and "median" in value else value
            for row in table["rows"]
            for metric, value in row["metrics"].items()
        }
        for table in data["tables"]
    }
    numbers = {
        table: {key: value for key, value in rows.items() if is_number(value)} for table, rows in numbers.items()
    }
    context = flatten({"environment": data["environment"], "settings": data["settings"]})
    context = {key: value for key, value in context.items() if key.split(".")[-1] not in EXPECTED}
    return {"benchmark": data["benchmark"], "numbers": numbers, "context": context}


def flatten(value, prefix=""):
    if isinstance(value, dict):
        found = {}
        for key, inner in value.items():
            found.update(flatten(inner, f"{prefix}.{key}" if prefix else key))
        return found
    return {prefix: value}


def is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def show(value):
    return f"{value:,.1f}" if abs(value) >= 10 else f"{value:.3g}"


def noise(metric):
    return next((floor for unit, floor in NOISE.items() if unit in metric), 0)


if __name__ == "__main__":
    main()
