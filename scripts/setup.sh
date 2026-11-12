#!/bin/sh
# Makes the repository's .env from .env.example and fills in every empty
# secret. Safe to run again: it never changes a value already set.
set -e
cd "$(dirname "$0")/.."

[ -f .env ] || cp .env.example .env

fill() {
  if grep -q "^$1=$" .env; then
    value=$(openssl rand -hex "$2")
    sed -i.bak "s/^$1=$/$1=$value/" .env && rm .env.bak
    echo "set $1"
  fi
}

for key in SKYWAKE_API_ADMIN_TOKEN BETTER_AUTH_SECRET POSTGRES_PASSWORD API_DB_PASSWORD \
  CONSOLE_DB_PASSWORD ZERO_DB_PASSWORD ZERO_ADMIN_PASSWORD; do
  fill "$key" 32
done
# Keys for the bundled S3 server; with your own bucket, set yours instead.
if grep -q "^SKYWAKE_STORE=$" .env; then
  fill AWS_ACCESS_KEY_ID 10
  fill AWS_SECRET_ACCESS_KEY 32
fi
echo ".env is ready. Self-host: scripts/start.sh. Develop: scripts/dev.sh."
