#!/bin/sh
# Runs pjdfstest, the POSIX filesystem test suite, on a FUSE mount of an
# empty in-memory branch. Runs in the dev container (see shell.sh).
#
#   scripts/pjdfstest.sh            all tests
#   scripts/pjdfstest.sh rename     one group, such as rename or chmod
#
set -e
cd "$(dirname "$0")/.."
if [ ! -e /.dockerenv ]; then
  exec scripts/shell.sh scripts/pjdfstest.sh "$@"
fi

suite=/target/pjdfstest
if [ ! -x "$suite/pjdfstest" ]; then
  rm -rf "$suite"
  git clone -q --depth 1 https://github.com/pjd/pjdfstest "$suite"
  (cd "$suite" && autoreconf -ifs >/dev/null 2>&1 && ./configure -q && make -s pjdfstest)
fi
echo "pjdfstest $(git -C "$suite" rev-parse --short HEAD)"

cargo build -q -p skywake-mount --example memory_mount
mnt=/mnt/pjdfstest
mkdir -p "$mnt"
/target/debug/examples/memory_mount "$mnt" &
server=$!
trap 'cd /; kill -INT $server; wait $server' EXIT
while ! mountpoint -q "$mnt"; do sleep 0.1; done

cd "$mnt"
prove -r "$suite/tests/$1" || true
