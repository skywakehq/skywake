#!/bin/sh
# Formats everything: Rust with rustfmt, Python with ruff, and Markdown,
# HTML, JSON and YAML with Prettier. With --check it changes nothing and
# fails if something is not formatted.
#
# Needs cargo, uv (for ruff) and node (for Prettier). Tool versions are
# fixed here, so every machine formats the same way.
set -e
cd "$(dirname "$0")/.."
RUFF="uvx ruff@0.8.4"
PRETTIER="npx --yes prettier@3.3.3"

if [ "$1" = "--check" ]; then
  cargo fmt --all --check
  $RUFF format --check .
  $RUFF check .
  $PRETTIER --check --log-level warn .
else
  cargo fmt --all
  $RUFF format .
  $RUFF check --fix .
  $PRETTIER --write --log-level warn .
fi
