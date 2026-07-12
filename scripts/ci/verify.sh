#!/usr/bin/env bash
# Nuke local CI gate — the merge/deploy check. There is NO GitHub Actions in this repo;
# the real gate is: local typecheck + build + the ratcheted guardrails, then push → Vercel.
# This script IS that gate. Run it before you push, or let the pre-push hook run it.
#
#   scripts/ci/verify.sh                 # warn mode: reports, never blocks (default)
#   CI_ENFORCE=1 scripts/ci/verify.sh    # enforce mode: exit 1 on any regression/secret/typefail
#   CI_WRITE_BASELINE=1 scripts/ci/verify.sh   # (re)seed baseline.json from current counts
#   CI_BUILD=1 scripts/ci/verify.sh      # also run the full vite build (slower)
#
# Ratchet philosophy: pre-existing violations are the baseline floor; the gate fails only when a
# count EXCEEDS it (i.e. you ADDED a violation). Burn violations down, then lower the floor.
set -uo pipefail
ROOT="/Users/skylar/nuke"
GD="$ROOT/scripts/guardrails"
BASE="$ROOT/scripts/ci/baseline.json"
ENFORCE="${CI_ENFORCE:-0}"
fail=0
red(){ printf '\033[31m%s\033[0m\n' "$*"; }
grn(){ printf '\033[32m%s\033[0m\n' "$*"; }
ylw(){ printf '\033[33m%s\033[0m\n' "$*"; }

# --- count functions (used for BOTH baseline capture and checking, so they can't disagree) ---
count_ghost()     { node "$GD/no-dead-asset-references.mjs" --json >/tmp/ci_ghost.json 2>/dev/null; python3 -c "import json;print(json.load(open('/tmp/ci_ghost.json'))['errors'])" 2>/dev/null || echo 0; }
count_rawfetch()  { bash "$GD/no-raw-fetch.sh" 2>/dev/null | grep -cE ':[0-9]+:' || true; }
count_testimony() { node "$GD/no-raw-testimony-insert.mjs" 2>/dev/null | grep -c '^VIOLATION' || true; }
count_labels()    { node "$GD/no-schema-baked-labels.mjs" --all 2>/dev/null | grep -oE '[0-9]+ baked-label' | grep -oE '^[0-9]+' || echo 0; }
secrets_ok()      { bash "$GD/no-committed-secrets.sh" >/tmp/ci_sec.out 2>&1; }

# --- baseline capture mode ---
if [ "${CI_WRITE_BASELINE:-0}" = 1 ]; then
  g=$(count_ghost); rf=$(count_rawfetch); ti=$(count_testimony); sl=$(count_labels)
  cat > "$BASE" <<JSON
{
  "generated": "2026-07-12",
  "note": "Ratchet floor for scripts/ci/verify.sh. The gate fails only when a count EXCEEDS these. Ratchet DOWN as violations are burned; never raise.",
  "guardrails": {
    "no-dead-asset-references": { "errors": $g, "note": "ghost-table refs on live paths. 12 = webhooks (pending strip, NEEDS_SKYLAR #2); 6 = vehicle_transactions (guarded crash-safe, half-built)." },
    "no-raw-fetch":             { "violations": $rf, "note": "external fetches bypassing archiveFetch. Burn down opportunistically." },
    "no-raw-testimony-insert":  { "violations": $ti, "note": "raw writes to testimony tables. Should trend to 0." },
    "no-committed-secrets":     { "violations": 0, "note": "HARD zero — any hit blocks regardless of mode." },
    "no-schema-baked-labels":   { "violations": $sl, "advisory": true, "note": "label-as-projection doctrine. Advisory — never blocks." }
  }
}
JSON
  grn "Wrote baseline: ghost=$g raw-fetch=$rf testimony=$ti labels=$sl (secrets hard-zero)"
  exit 0
fi

b(){ python3 -c "import json;print(json.load(open('$BASE'))['guardrails']['$1'].get('$2',0))" 2>/dev/null || echo 0; }
ratchet(){ # name current baseline
  local name=$1 cur=$2 base=$3
  if [ "${cur:-0}" -gt "${base:-0}" ]; then red "  ✗ $name REGRESSED: $cur > baseline $base (you added $((cur-base)))"; fail=1
  else grn "  ✓ $name $cur (baseline $base)"; fi
}

echo "── Nuke CI gate ($([ "$ENFORCE" = 1 ] && echo ENFORCE || echo warn) mode) ──"

echo "• frontend typecheck…"
if (cd "$ROOT/nuke_frontend" && npm run type-check >/tmp/ci_tc.out 2>&1); then grn "  ✓ typecheck clean"
else red "  ✗ typecheck FAILED"; tail -15 /tmp/ci_tc.out; fail=1; fi

if [ "${CI_BUILD:-0}" = 1 ]; then
  echo "• frontend build…"
  if (cd "$ROOT/nuke_frontend" && npm run build >/tmp/ci_build.out 2>&1); then grn "  ✓ build clean"; else red "  ✗ build FAILED"; tail -20 /tmp/ci_build.out; fail=1; fi
fi

echo "• guardrails (ratchet)…"
ratchet "ghost-refs"       "$(count_ghost)"     "$(b no-dead-asset-references errors)"
ratchet "raw-fetch"        "$(count_rawfetch)"  "$(b no-raw-fetch violations)"
ratchet "testimony-insert" "$(count_testimony)" "$(b no-raw-testimony-insert violations)"
if secrets_ok; then grn "  ✓ secrets clean"; else red "  ✗ SECRET DETECTED"; cat /tmp/ci_sec.out; fail=1; fi
ylw "  • schema-baked-labels $(count_labels) (advisory, non-blocking)"

echo "──"
if [ "$fail" = 1 ]; then
  if [ "$ENFORCE" = 1 ]; then red "CI GATE FAILED — fix regressions or, if intentional, ratchet the baseline."; exit 1
  else ylw "CI regressions found (warn mode — NOT blocking). Set CI_ENFORCE=1 to make this block."; exit 0; fi
else grn "CI GATE PASS"; exit 0; fi
