"""The Phase 5 exit test: an orchestrator fans out 100 agents on one
codebase, each in its own fork, and merges the good branches into `main`
with no human involved.

Each agent stands in for an LLM with a fixed task, so the result can be
checked:

- Every agent updates its own service file and its own line of a shared
  registry. Text files merge line by line, so these never conflict.
- A few agents also change the same line of `config.toml`. Only one can
  merge as is; the others get a conflict, fork the new `main` and try
  again.
- Every tenth agent writes code that does not compile. The orchestrator's
  check rejects it, and its branch is deleted instead of merged.
- Ten agents work through the MCP server instead of the SDK.

Needs a running API at SKYWAKE_URL. With SKYWAKE_API_ADMIN_TOKEN it makes
a new organization. With SKYWAKE_KEY, an admin key made in the console, it
works in that organization instead, so the swarm can be watched there.
SWARM_NAMESPACE names the namespace it makes (`demo/app` by default).
"""

import asyncio
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import httpx
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from skywake import Skywake

AGENTS = 100
MCP_AGENTS = range(90, 100)
BROKEN = {i for i in range(AGENTS) if i % 10 == 7}
RIVALS = range(40, 45)  # all change the same line of config.toml
TRIES = 10
NAMESPACE = os.environ.get("SWARM_NAMESPACE", "demo/app")


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
    sky = Skywake(url, key)
    namespace = sky.create_namespace(NAMESPACE)
    main = namespace.create_branch("main")
    files = {f"services/service_{i:03}.py": service(i, 1) for i in range(AGENTS)}
    # A blank line between entries, so edits to two entries never touch.
    files["services/registry.txt"] = "".join(f"service {i}: v1\n\n" for i in range(AGENTS))
    files["config.toml"] = 'owner = "nobody"\nretries = 3\n'
    main.write(files, "Start the codebase")
    main.protect()
    return sky, key


def task(i, read):
    """What agent `i` writes, given a way to read the branch it works on."""
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


def passes(branch, i):
    """The orchestrator's check: the agent's file must compile."""
    try:
        compile(branch.read_text(f"services/service_{i:03}.py"), "service", "exec")
        return True
    except SyntaxError:
        return False


def sdk_agent(namespace, i):
    main = namespace.branch("main")
    with namespace.session(f"agent-{i}") as session:
        for attempt in range(TRIES):
            branch = main.fork(f"agents/{i}/try-{attempt}")
            branch.claim(f"services/service_{i:03}.py", session.id)
            branch.write(task(i, branch.read_text), f"Agent {i}: update service {i}", session.id)
            outcome = review(branch, i, session.id)
            if outcome != "conflict":
                return outcome, attempt
    return "gave up", TRIES


def review(branch, i, session):
    """Merges a branch that passes the check. Deletes it otherwise."""
    if not passes(branch, i):
        branch.delete()
        return "rejected"
    merged = branch.merge_into("main", session=session)
    if merged.ok:
        return "merged"
    branch.delete()
    return "conflict"


async def mcp_agent(namespace, url, key, i):
    """The same work, done through the MCP server's tools."""
    for attempt in range(TRIES):
        name = f"agents/{i}/mcp-{attempt}"
        env = {
            **os.environ,
            "SKYWAKE_URL": url,
            "SKYWAKE_KEY": key,
            "SKYWAKE_NAMESPACE": NAMESPACE,
            "SKYWAKE_BRANCH": name,
            "SKYWAKE_FORK_FROM": "main",
        }
        command = StdioServerParameters(command=sys.executable, args=["-m", "skywake.mcp"], env=env)
        async with stdio_client(command) as (read, write), ClientSession(read, write) as mcp:
            await mcp.initialize()

            async def read_file(path):
                result = await mcp.call_tool("read_file", {"path": path})
                return result.content[0].text

            # `task` reads through a function; with MCP each read is a call.
            registry = await read_file("services/registry.txt")
            config = await read_file("config.toml")
            reads = {"services/registry.txt": registry, "config.toml": config}
            files = task(i, reads.__getitem__)
            message = f"Agent {i}: update service {i} (MCP)"
            await mcp.call_tool("write_files", {"files": files, "message": message})
            branch = namespace.branch(name)
            if not passes(branch, i):
                branch.delete()
                return "rejected", attempt
            result = await mcp.call_tool("merge", {"into": "main"})
            if not json.loads(result.content[0].text)["conflicts"]:
                return "merged", attempt
            branch.delete()
    return "gave up", TRIES


def verify(main, outcomes):
    """Checks `main` holds exactly the good agents' work."""
    problems = []
    registry = main.read_text("services/registry.txt")
    for i, (outcome, _) in outcomes.items():
        merged = outcome == "merged"
        if merged == (i in BROKEN):
            problems.append(f"agent {i}: {outcome}")
        code = main.read_text(f"services/service_{i:03}.py")
        if ("'version': 2" in code) != merged:
            problems.append(f"agent {i}: service file does not match `{outcome}`")
        if (f"service {i}: v2\n" in registry) != merged:
            problems.append(f"agent {i}: registry line does not match `{outcome}`")
    owner = main.read_text("config.toml").splitlines()[0]
    if owner not in {f'owner = "agent-{i}"' for i in RIVALS}:
        problems.append(f"config.toml: {owner}")
    return problems


def main():
    url = os.environ.get("SKYWAKE_URL", "http://127.0.0.1:8080")
    sky, key = setup(url)
    namespace = sky.namespace(NAMESPACE)
    started = time.monotonic()

    def run(i):
        if i in MCP_AGENTS:
            return asyncio.run(mcp_agent(namespace, url, key, i))
        return sdk_agent(namespace, i)

    with ThreadPoolExecutor(AGENTS) as pool:
        outcomes = dict(zip(range(AGENTS), pool.map(run, range(AGENTS)), strict=False))
    seconds = time.monotonic() - started

    count = lambda name: sum(outcome == name for outcome, _ in outcomes.values())  # noqa: E731
    retries = sum(tries for _, tries in outcomes.values())
    main = namespace.branch("main")
    merges = sum(commit["merged"] is not None for commit in main.log(limit=1000))
    print(f"{AGENTS} agents in {seconds:.1f} s ({len(MCP_AGENTS)} through MCP)")
    print(f"merged {count('merged')}, rejected by the check {count('rejected')}, gave up {count('gave up')}")
    print(f"conflicts retried on a new fork: {retries}")
    print(f"merge commits on main: {merges}")
    problems = verify(main, outcomes)
    if merges != count("merged"):
        problems.append(f"{merges} merge commits for {count('merged')} merges")
    for problem in problems:
        print(f"FAIL: {problem}")
    print("PASS" if not problems else "FAIL")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
