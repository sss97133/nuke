#!/usr/bin/env bash
# valuation-driver.sh — keeps the pricing engine ON. One paced batch per fire.
# Drives compute-vehicle-valuation over the unpriced backlog + new inflow so every vehicle gets a
# nuke_estimate. With pricing live, deal_score / price_is_outlier recompute and good deals surface
# as a byproduct across ALL sources. Paced (small parallel/batch) so it never overloads the backend
# (the Jun-13 522s were overload). Runs in the login shell (network OK).
set -u
cd "$(dirname "$0")/.." || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin:$PATH"
LOG="/Users/skylar/nuke/logs/valuation-driver.log"; mkdir -p "$(dirname "$LOG")"
LOCK="/tmp/valuation-driver.lock"
log(){ echo "$(date '+%F %T') | $*" | tee -a "$LOG"; }
if [ -f "$LOCK" ]; then pid=$(cat "$LOCK" 2>/dev/null); if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then log "already running ($pid) — skip"; exit 0; fi; fi
echo $$ > "$LOCK"; trap 'rm -f "$LOCK"' EXIT
log "valuation batch start"
# small batch is mandatory: batch 25 times out (522), batch 6 computes clean. ~645/hr.
dotenvx run -- node scripts/valuation-burndown.mjs --parallel 2 --batch 6 --max 150 2>&1 | tail -4 | tee -a "$LOG"
log "valuation batch done"
