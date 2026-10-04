#!/bin/bash
# Prints every claims circuit's size and fails if any is over 2^17 rows (k=17).
#
# Why: a proof's memory roughly doubles with each step of k. At k=19 the distinct and
# unchanged claims needed about 8 GB on the proof server and could not run back to back
# on a 16 GB laptop (3-4 Oct 2026). A holder must be able to prove a claim on their own
# computer, or they would have to hand their values to someone else to prove for them.
#
# Needs the zkir tool that ships with the Compact compiler (`zkir mock-compile`), on PATH
# or in ZKIR. Uses no proving parameters and no network.
#
#   cd contract && bash scripts/circuit-sizes.sh
set -u
cd "$(dirname "$0")/.." || exit 1
ZKIR="${ZKIR:-zkir}"
MAX_K=17
fail=0
for f in src/managed/veilcore-claims/zkir/*.zkir; do
  line=$("$ZKIR" mock-compile "$f" 2>&1 | grep -o '(k=[0-9]*, rows=[0-9]*)')
  if [ -z "$line" ]; then
    echo "could not measure $f"
    fail=1
    continue
  fi
  k=$(echo "$line" | sed -E 's/\(k=([0-9]+).*/\1/')
  rows=$(echo "$line" | sed -E 's/.*rows=([0-9]+)\)/\1/')
  name=$(basename "$f" .zkir)
  printf '%-16s k=%-3s rows=%s\n' "$name" "$k" "$rows"
  if [ "$k" -gt "$MAX_K" ]; then
    echo "  TOO BIG: over 2^$MAX_K rows"
    fail=1
  fi
done
exit $fail
