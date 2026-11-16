import asyncio
import os
import shutil
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from skywake import MergeConflict, Skywake

AGENTS = 100
MCP_AGENTS = range(90, 100)
BROKEN = {i for i in range(AGENTS) if i % 10 == 7}
RIVALS = range(40, 45)
TRIES = 10
DISK = os.environ.get("SWARM_DISK", "app")
WRAPPER = Path(__file__).resolve().parents[2] / "packages" / "skywake" / "bin" / "skywake.cjs"


def service(i, version):
    return f"def handle_{i}(request):\n    return {{'service': {i}, 'version': {version}}}\n"


def new_org(url, admin_token):
    answer = httpx.post(
        f"{url}/v1/orgs",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"name": f"swarm-{time.time_ns()}"},
    )
    answer.raise_for_status()
    return answer.json()["key"]


def setup(url):
    key = os.environ.get("SKYWAKE_KEY") or new_org(url, os.environ["SKYWAKE_API_ADMIN_TOKEN"])
    sky = Skywake(url=url, key=key)
    files = {f"services/service_{i:03}.py": service(i, 1) for i in range(AGENTS)}
    files["services/registry.txt"] = "".join(f"service {i}: v1\n\n" for i in range(AGENTS))
    files["config.toml"] = 'owner = "nobody"\nretries = 3\n'
    sky.disk(DISK).write(files, message="Start the codebase")
    return sky, key


def task(i, read):
    code = service(i, 2)
    if i in BROKEN:
        code = code.replace("(request):", "(request:")
    registry = read("services/registry.txt").replace(f"service {i}: v1\n", f"service {i}: v2\n")
    files = {f"services/service_{i:03}.py": code, "services/registry.txt": registry}
    if i in RIVALS:
        config = read("config.toml").splitlines(keepends=True)
        config[0] = f'owner = "agent-{i}"\n'
        files["config.toml"] = "".join(config)
    return files


def passes(work, i):
    try:
        compile(work.read(f"services/service_{i:03}.py"), "service", "exec")
        return True
    except SyntaxError:
        return False


def review(work, i):
    if not passes(work, i):
        work.destroy()
        return "rejected"
    try:
        work.merge_into("main")
    except MergeConflict:
        work.destroy()
        return "conflict"
    return "merged"


def sdk_agent(app, i):
    for attempt in range(TRIES):
        work = app.fork(f"agents/{i}/try-{attempt}")
        work.write(task(i, work.read), message=f"Agent {i}: update service {i}")
        outcome = review(work, i)
        if outcome != "conflict":
            return outcome, attempt
    return "gave up", TRIES


async def mcp_agent(app, url, key, i):
    for attempt in range(TRIES):
        work = app.fork(f"agents/{i}/mcp-{attempt}")
        env = {
            **os.environ,
            "SKYWAKE_URL": url,
            "SKYWAKE_API_KEY": key,
            "SKYWAKE_DISK": DISK,
            "SKYWAKE_BRANCH": work.branch,
        }
        command = StdioServerParameters(command=shutil.which("node"), args=[str(WRAPPER), "mcp"], env=env)
        async with stdio_client(command) as (read, write), ClientSession(read, write) as mcp:
            await mcp.initialize()

            async def read_file(path):
                return (await mcp.call_tool("read", {"path": path})).content[0].text

            reads = {path: await read_file(path) for path in ("services/registry.txt", "config.toml")}
            files = task(i, reads.__getitem__)
            await mcp.call_tool("write", {"files": files, "message": f"Agent {i}: update service {i} (MCP)"})
            if not passes(work, i):
                work.destroy()
                return "rejected", attempt
            merged = await mcp.call_tool("merge", {"into": "main"})
            if not merged.is_error:
                return "merged", attempt
            work.destroy()
    return "gave up", TRIES


def verify(app, outcomes):
    problems = []
    registry = app.read("services/registry.txt")
    for i, (outcome, _) in outcomes.items():
        merged = outcome == "merged"
        if merged == (i in BROKEN):
            problems.append(f"agent {i}: {outcome}")
        code = app.read(f"services/service_{i:03}.py")
        if ("'version': 2" in code) != merged:
            problems.append(f"agent {i}: service file does not match `{outcome}`")
        if (f"service {i}: v2\n" in registry) != merged:
            problems.append(f"agent {i}: registry line does not match `{outcome}`")
    owner = app.read("config.toml").splitlines()[0]
    if owner not in {f'owner = "agent-{i}"' for i in RIVALS}:
        problems.append(f"config.toml: {owner}")
    return problems


def main():
    url = os.environ.get("SKYWAKE_URL", "http://127.0.0.1:8080")
    sky, key = setup(url)
    app = sky.disk(DISK)
    started = time.monotonic()

    def run(i):
        if i in MCP_AGENTS:
            return asyncio.run(mcp_agent(app, url, key, i))
        return sdk_agent(app, i)

    with ThreadPoolExecutor(AGENTS) as pool:
        outcomes = dict(zip(range(AGENTS), pool.map(run, range(AGENTS)), strict=False))
    seconds = time.monotonic() - started

    count = lambda name: sum(outcome == name for outcome, _ in outcomes.values())  # noqa: E731
    retries = sum(tries for _, tries in outcomes.values())
    merges = sum(commit["merged"] is not None for commit in app.log(limit=1000))
    print(f"{AGENTS} agents in {seconds:.1f} s ({len(MCP_AGENTS)} through MCP)")
    print(f"merged {count('merged')}, rejected by the check {count('rejected')}, gave up {count('gave up')}")
    print(f"conflicts retried on a new fork: {retries}")
    print(f"merge commits on main: {merges}")
    problems = verify(app, outcomes)
    if merges != count("merged"):
        problems.append(f"{merges} merge commits for {count('merged')} merges")
    for problem in problems:
        print(f"FAIL: {problem}")
    print("PASS" if not problems else "FAIL")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
