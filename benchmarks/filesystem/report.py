"""Combines a suite's repeated runs and renders the report: medians with their spread, and pass/fail checks."""

import statistics

from lib import Suite, p95

MIN_REPEAT = 5
COLUMNS = [
    "local ms", "cold ms", "warm ms", "warm ÷ local %", "ms", "p50 ms", "p95 ms", "p99 ms",
    "slowest ms", "MB/s", "count",
]  # fmt: skip


def combine(runs):
    first = runs[0]
    samples = {}
    for suite in runs:
        for label, metrics in suite.rows:
            row = samples.setdefault(label, {})
            for key, value in metrics.items():
                row.setdefault(key, []).append(value)
    rows = [(label, {key: spread(values) for key, values in row.items()}) for label, row in samples.items()]
    passed = {}
    for suite in runs:
        for name, ok in suite.checks:
            passed.setdefault(name, []).append(ok)
    checks = [
        (f"{name} ({sum(oks)} of {len(oks)} runs)", all(oks) and len(oks) == len(runs)) for name, oks in passed.items()
    ]
    notes = list(dict.fromkeys(note for suite in runs for note in suite.notes))
    error = "\n".join(f"run {i + 1}:\n{suite.error}" for i, suite in enumerate(runs) if suite.error)
    settings = next((suite.settings for suite in runs if suite.settings), {})
    return Suite(first.name, first.title, first.about, rows, checks, notes, error, settings)


def spread(values):
    numbers = [value for value in values if isinstance(value, (int, float)) and not isinstance(value, bool)]
    if len(numbers) != len(values):
        return values[0]
    return {"median": statistics.median(numbers), "min": min(numbers), "p95": p95(numbers), "samples": numbers}


def header(run, about, settings):
    machine = about["machine"]
    store = settings["store"]
    commit = about["commit"] + (
        " **WITH UNCOMMITTED CHANGES: these numbers match no commit**" if about["dirty"] else ""
    )
    runs = f"{settings['repeat']}; each number is the median, with (fastest – 95th percentile)"
    if settings["repeat"] < MIN_REPEAT:
        runs += f" **under {MIN_REPEAT} runs: the spread means little**"
    rows = {
        "commit": commit,
        "runs": runs,
        "client": about.get("client") or f"{machine['hostname']}, next to the store",
        "store region": store["region"],
        "machine": f"{machine['cores']} CPUs ({machine['cpu']}), {machine['memory_bytes'] / 1e9:.0f} GB memory",
        "kernel": machine["kernel"],
        "store": store["location"]
        + (f" at {store['endpoint']}" if store["endpoint"] else "")
        + ("" if store["counted"] or not store["endpoint"] else ", requests not counted"),
        "added S3 latency": latency(store),
        "datasets": f"{'quick (small)' if settings['quick'] else 'full'}, seed {settings['seed']}",
        "note": settings["note"],
    }
    lines = [f"# Benchmarks {run}", ""]
    if about["dirty"]:
        lines += ["> **Dirty tree.** These numbers come from uncommitted code; do not quote them.", ""]
    lines += ["| | |", "|---|---|"]
    lines += [f"| {key} | {value} |" for key, value in rows.items() if value]
    return "\n".join(lines) + "\n\n"


def latency(store):
    write = store.get("write_latency_ms")
    if write is None or write == store["latency_ms"]:
        return f"{store['latency_ms']} ms per request"
    return f"{store['latency_ms']} ms per read, {write} ms per write"


def render(suite):
    lines = [f"## {suite.title}", ""]
    if suite.about:
        lines += [suite.about, ""]
    if suite.rows:
        columns = list(dict.fromkeys(key for _, metrics in suite.rows for key in metrics))
        columns.sort(key=lambda key: COLUMNS.index(key) if key in COLUMNS else len(COLUMNS))
        lines += ["| | " + " | ".join(columns) + " |", "|---|" + "---:|" * len(columns)]
        for label, metrics in suite.rows:
            cells = [number(key, metrics[key]) if key in metrics else "" for key in columns]
            lines.append(f"| {label} | " + " | ".join(cells) + " |")
        lines.append("")
    lines += [f"- {note}" for note in suite.notes]
    if suite.notes:
        lines.append("")
    lines += [f"- {'PASS' if ok else 'FAIL'}: {name}" for name, ok in suite.checks]
    if suite.error:
        lines += ["```", suite.error.strip(), "```"]
    return "\n".join(lines) + "\n"


def number(key, value):
    if isinstance(value, dict):
        middle = number(key, value["median"])
        low, high = number(key, value["min"]), number(key, value["p95"])
        return middle if low == high else f"{middle} ({low} – {high})"
    if isinstance(value, str):
        return value
    if key.startswith("MB") and not key.endswith("/s"):
        return f"{value:,.1f}" if value >= 0.1 or value == 0 else f"{value:.3f}"
    if isinstance(value, float) and value < 10 and not key.endswith("/s"):
        return f"{value:.1f}"
    return f"{value:,.0f}"


def tables(suites):
    return [
        {
            "name": suite.name,
            "title": suite.title,
            "about": suite.about,
            "rows": [{"label": label, "metrics": metrics} for label, metrics in suite.rows],
            "checks": [{"name": name, "passed": ok} for name, ok in suite.checks],
            "notes": suite.notes,
            "error": suite.error,
        }
        for suite in suites
    ]


def summary(suites):
    checks = [ok for suite in suites for _, ok in suite.checks]
    errors = [suite.name for suite in suites if suite.error]
    text = f"{sum(checks)} of {len(checks)} checks passed."
    return text + (f" Failed to run: {', '.join(errors)}." if errors else "")
