#!/bin/sh
# Puts two benchmark runs side by side and flags every number more than 10% worse; exits 1 if any is.
#
#   scripts/compare-benchmarks.sh               the last two runs of the newest run's benchmark
#   scripts/compare-benchmarks.sh OLD NEW       folder names under benchmarks/results/, or paths
exec python3 "$(dirname "$0")/../benchmarks/compare.py" "$@"
