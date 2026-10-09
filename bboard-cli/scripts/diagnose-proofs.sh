#!/bin/bash
# Runs the local standalone tool while recording what the proof server does: its memory
# every two seconds, its own log, and how it stopped (Docker's die/oom events). Nothing
# here holds a secret: the standalone wallet is the public local-development one.
#
#   cd bboard-cli && bash scripts/diagnose-proofs.sh
#
# At the menu type 3, then y. When it ends, a summary is printed. Paste that.
set -u
cd "$(dirname "$0")/.." || exit 1
OUT="logs/diagnose-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"

docker events --filter event=die --filter event=oom \
  --format '{{.Time}} {{.Status}} {{.Actor.Attributes.name}} exitCode={{.Actor.Attributes.exitCode}}' \
  > "$OUT/events.txt" 2>&1 &
EV=$!

(
  while true; do
    docker stats --no-stream --format '{{.Name}} {{.MemUsage}} cpu={{.CPUPerc}}' 2>/dev/null \
      | grep '^proof-server' | sed "s/^/$(date +%H:%M:%S) /"
    sleep 1
  done
) > "$OUT/memory.txt" &
ST=$!

(
  while true; do
    c=$(docker ps --format '{{.Names}}' | grep '^proof-server' | head -1)
    if [ -n "$c" ]; then
      docker logs -f --timestamps "$c" > "$OUT/proof-server.log" 2>&1
      break
    fi
    sleep 1
  done
) &
LG=$!

npm run standalone

sleep 3
kill "$EV" "$ST" "$LG" 2>/dev/null
wait 2>/dev/null

echo
echo "================ PASTE FROM HERE ================"
echo "Docker memory limit: $(docker info --format '{{.MemTotal}}' 2>/dev/null | awk '{printf "%.1f GB", $1/1073741824}')"
echo "Mac memory: $(sysctl -n hw.memsize 2>/dev/null | awk '{printf "%.0f GB", $1/1073741824}')"
echo "--- how containers stopped ---"
grep -i 'proof' "$OUT/events.txt" || echo "(no proof-server stop recorded)"
echo "--- proof server memory, last 25 readings ---"
tail -25 "$OUT/memory.txt"
echo "--- proof server log, last 40 lines ---"
tail -40 "$OUT/proof-server.log" 2>/dev/null || echo "(no log captured)"
echo "================ TO HERE ================"
echo "(Full files are in bboard-cli/$OUT)"
