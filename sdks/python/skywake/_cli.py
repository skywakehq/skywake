import os
import shutil
import sys
from importlib.metadata import PackageNotFoundError, version


def _version():
    try:
        return version("skywake")
    except PackageNotFoundError:
        return "latest"


def main():
    npx = shutil.which("npx")
    if npx is None:
        sys.exit("skywake: the skywake command and its MCP server run on Node.js; install Node 18 or later")
    os.execv(npx, [npx, "--yes", f"skywake@{_version()}", *sys.argv[1:]])
