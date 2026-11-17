import json
import os
import re
from pathlib import Path

DEFAULT_URL = "https://api.skywake.dev"
FIELDS = ("key", "url", "environment")
TABLE = re.compile(r"^\[\s*([^\]]+?)\s*\]$")
PAIR = re.compile(r'^([A-Za-z_]+)\s*=\s*"((?:[^"\\]|\\.)*)"$')


def credentials_path():
    if os.name == "nt" and os.environ.get("APPDATA"):
        return Path(os.environ["APPDATA"]) / "skywake" / "credentials.toml"
    base = os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config"
    return Path(base) / "skywake" / "credentials.toml"


def parse_credentials(text):
    profiles = {}
    current = None
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        table = TABLE.match(line)
        if table:
            current = profiles.setdefault(table.group(1), {})
            continue
        pair = PAIR.match(line)
        if pair and current is not None and pair.group(1) in FIELDS:
            current[pair.group(1)] = json.loads(f'"{pair.group(2)}"')
    return profiles


def read_profile(name):
    try:
        return parse_credentials(credentials_path().read_text()).get(name, {})
    except OSError:
        return {}


def env(name):
    return os.environ.get(name) or None


def resolve_settings(key=None, url=None, environment=None, profile=None):
    given = key or env("SKYWAKE_API_KEY") or env("SKYWAKE_KEY")
    stored = {} if given else read_profile(profile or env("SKYWAKE_PROFILE") or "default")
    key = given or stored.get("key")
    if not key:
        raise ValueError("no Skywake API key: run `skywake login`, set SKYWAKE_API_KEY, or pass key=")
    return {
        "key": key,
        "url": url or env("SKYWAKE_URL") or stored.get("url") or DEFAULT_URL,
        "environment": environment or env("SKYWAKE_ENV") or stored.get("environment"),
    }
