#!/bin/sh
# Kills skywaked with SIGKILL while a writer appends to a mounted file,
# again and again. After each restart it checks that the branch holds a
# clean prefix of what was written (nothing corrupt), and that at most the
# last save interval of writes (2 s, plus a little for the save itself) is
# missing. Run it in the dev container:
#
#   scripts/shell.sh scripts/crash-loop.sh [rounds]
set -eu
rounds=${1:-10}
cd "$(dirname "$0")/.."
cargo build -q -p skywake-daemon -p skywake-cli
bin=${CARGO_TARGET_DIR:-target}/debug
work=$(mktemp -d)
export SKYWAKE_STORE="$work/store" SKYWAKE_ROOT="$work/root" SKYWAKE_LOG=warn
mkdir -p "$SKYWAKE_STORE" "$work/mnt"
"$bin/skywake" new crash >/dev/null

daemon=
start_daemon() {
  rm -f "$SKYWAKE_ROOT/skywaked.sock" # left by the killed daemon
  "$bin/skywaked" 2>>"$work/daemon.log" &
  daemon=$!
  while [ ! -S "$SKYWAKE_ROOT/skywaked.sock" ]; do sleep 0.05; done
  "$bin/skywake" mount crash "$work/mnt"
}

round=1
while [ "$round" -le "$rounds" ]; do
  start_daemon
  # Append numbered lines, and note outside the mount when each was
  # written, until the mount dies.
  python3 - "$work/mnt/log-$round" "$work/journal-$round" <<'EOF' &
import os, sys, time
out = os.open(sys.argv[1], os.O_WRONLY | os.O_CREAT | os.O_APPEND)
with open(sys.argv[2], "w") as journal:
    for i in range(10**9):
        try:
            os.write(out, f"{i} {'x' * 100}\n".encode())
        except OSError:
            break
        journal.write(f"{i} {time.time()}\n")
        journal.flush()
        time.sleep(0.002)
EOF
  writer=$!
  sleep "$(python3 -c 'import random; print(random.uniform(2.5, 6))')"
  killed=$(python3 -c 'import time; print(time.time())')
  kill -9 "$daemon"
  wait "$daemon" 2>/dev/null || true
  # The kernel's cache takes writes even with the daemon gone, so stop
  # the writer too. Writes after the kill don't count.
  kill -9 "$writer" 2>/dev/null || true
  wait "$writer" 2>/dev/null || true

  start_daemon
  "$bin/skywake" unmount "$work/mnt"
  kill "$daemon"
  wait "$daemon" 2>/dev/null || true
  rm -rf "$work/check"
  "$bin/skywake" checkout crash "$work/check"
  python3 - "$work/check" "$work" "$round" "$killed" <<'EOF'
import os, sys
check, work, last, killed = sys.argv[1], sys.argv[2], int(sys.argv[3]), float(sys.argv[4])
for r in range(1, last + 1):
    path = os.path.join(check, f"log-{r}")
    data = open(path, "rb").read() if os.path.exists(path) else b""
    lines = data.split(b"\n")
    for i, line in enumerate(lines[:-1]):
        assert line == f"{i} {'x' * 100}".encode(), f"log-{r}: line {i} is corrupt"
    expected = f"{len(lines) - 1} {'x' * 100}".encode()
    assert expected.startswith(lines[-1]), f"log-{r}: the last line is corrupt"
    if r == last:
        written = [line.split() for line in open(os.path.join(work, f"journal-{r}"))]
        saved = len(lines) - 1
        at = {int(i): float(t) for i, t in written}
        newest = at[saved - 1] if saved else at[0] - 1
        lost = max(0.0, killed - newest)
        print(f"round {r}: {saved} of {len(written)} lines saved, newest {lost:.2f} s before the kill")
        assert lost < 3.0, f"lost {lost:.2f} s of writes"
EOF
  round=$((round + 1))
done
echo "ok: $rounds rounds"
grep -i "unsaved\|stopped without saving" "$work/daemon.log" | head -5 || true
