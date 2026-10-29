#!/usr/bin/env bash
# Nuke local CI gate — typecheck + build + the ratcheted guardrails in this checkout.
# GitHub workflows validate and deploy after the required local checks pass.
# This script IS that gate. Run it before you push, or let the pre-push hook run it.
#
#   scripts/ci/verify.sh                 # warn mode: reports, never blocks (default)
#   CI_ENFORCE=1 scripts/ci/verify.sh    # enforce mode: exit 1 on any regression/secret/typefail
#   CI_WRITE_BASELINE=1 scripts/ci/verify.sh   # (re)seed baseline.json from current counts
#   CI_BUILD=1 scripts/ci/verify.sh      # also run the full vite build and the per-route JS budget (slower)
#
# Ratchet philosophy: pre-existing violations are the baseline floor; the gate fails only when a
# count EXCEEDS it (i.e. you ADDED a violation). Burn violations down, then lower the floor.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GD="$ROOT/scripts/guardrails"
BASE="$ROOT/scripts/ci/baseline.json"
CI_TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/nuke-ci.XXXXXX")" || {
  echo "CI gate: cannot create private scratch directory" >&2
  exit 1
}
[[ "$CI_TMP_DIR" = /* ]] || CI_TMP_DIR="$PWD/$CI_TMP_DIR"
trap 'rm -rf -- "$CI_TMP_DIR"' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
ENFORCE="${CI_ENFORCE:-0}"
fail=0
red(){ printf '\033[31m%s\033[0m\n' "$*"; }
grn(){ printf '\033[32m%s\033[0m\n' "$*"; }
ylw(){ printf '\033[33m%s\033[0m\n' "$*"; }

# --- count functions (used for BOTH baseline capture and checking, so they can't disagree) ---
count_ghost()     { node "$GD/no-dead-asset-references.mjs" --json >"$CI_TMP_DIR/ci_ghost.json" 2>/dev/null; python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['errors'])" "$CI_TMP_DIR/ci_ghost.json" 2>/dev/null || echo 0; }
count_rawfetch()  { bash "$GD/no-raw-fetch.sh" 2>/dev/null | grep -cE ':[0-9]+:' || true; }
count_testimony() { node "$GD/no-raw-testimony-insert.mjs" 2>/dev/null | grep -c '^VIOLATION' || true; }
count_swallowed(){ node "$GD/no-swallowed-write-errors.mjs" --all 2>/dev/null | grep -cE ': (dropped|log-only): ' || true; }
count_labels()    { node "$GD/no-schema-baked-labels.mjs" --all 2>/dev/null | grep -oE '[0-9]+ baked-label' | grep -oE '^[0-9]+' || echo 0; }
secrets_ok()      { bash "$GD/no-committed-secrets.sh" >"$CI_TMP_DIR/ci_sec.out" 2>&1; }
# design-system counts come from one eslint pass (scripts/guardrails/design-violations.mjs); read per rule
DESIGN_RULES="no-inline-style no-font-props no-hardcoded-colors no-border-radius no-box-shadow no-gradient no-banned-fonts"
design_prepare() { node "$GD/design-violations.mjs" --json >"$CI_TMP_DIR/ci_design.json" 2>/dev/null || echo '{}' >"$CI_TMP_DIR/ci_design.json"; }
count_design()    { python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get('$1',0))" "$CI_TMP_DIR/ci_design.json" 2>/dev/null || echo 0; }

# --- baseline capture mode ---
if [ "${CI_WRITE_BASELINE:-0}" = 1 ]; then
  g=$(count_ghost); rf=$(count_rawfetch); ti=$(count_testimony); sl=$(count_labels); sw=$(count_swallowed)
  design_prepare
  design_json=$(python3 -c "import json,sys;d=json.load(open(sys.argv[1]));print(', '.join('\"%s\": %d' % (k, d.get(k,0)) for k in '$DESIGN_RULES'.split()))" "$CI_TMP_DIR/ci_design.json")
  cat > "$BASE" <<JSON
{
  "generated": "$(date -u +%F)",
  "note": "Ratchet floor for scripts/ci/verify.sh. The gate fails only when a count EXCEEDS these. Ratchet DOWN as violations are burned; never raise.",
  "guardrails": {
    "no-dead-asset-references": { "errors": $g, "note": "ghost-table refs on live paths. 12 = webhooks (pending strip, NEEDS_SKYLAR #2); 6 = vehicle_transactions (guarded crash-safe, half-built)." },
    "no-raw-fetch":             { "violations": $rf, "note": "external fetches bypassing archiveFetch. Burn down opportunistically." },
    "no-raw-testimony-insert":  { "violations": $ti, "note": "raw writes to testimony tables. Should trend to 0." },
    "no-swallowed-write-errors": { "violations": $sw, "note": "supabase-js writes in edge functions whose { error } is dropped or only logged. Burn down; never raise." },
    "no-committed-secrets":     { "violations": 0, "note": "HARD zero — any hit blocks regardless of mode." },
    "no-schema-baked-labels":   { "violations": $sl, "advisory": true, "note": "label-as-projection doctrine. Advisory — never blocks." },
    "design-system":            { $design_json, "note": "eslint design-system rules over nuke_frontend/src (src/kit exempt), counted by scripts/guardrails/design-violations.mjs. Each rule ratchets on its own." }
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
if (cd "$ROOT/nuke_frontend" && npm run type-check >"$CI_TMP_DIR/ci_tc.out" 2>&1); then grn "  ✓ typecheck clean (no file gained errors against scripts/ci/typecheck-baseline.json)"
else red "  ✗ typecheck FAILED"; tail -15 "$CI_TMP_DIR/ci_tc.out"; fail=1; fi

if [ "${CI_BUILD:-0}" = 1 ]; then
  echo "• frontend build…"
  if (cd "$ROOT/nuke_frontend" && npm run build >"$CI_TMP_DIR/ci_build.out" 2>&1); then grn "  ✓ build clean"; else red "  ✗ build FAILED"; tail -20 "$CI_TMP_DIR/ci_build.out"; fail=1; fi
  if node "$ROOT/scripts/ci/route-js-budget.mjs" >"$CI_TMP_DIR/ci_routejs.out" 2>&1; then grn "  ✓ route JS budget (scripts/ci/route-js-budget.json)"
  else red "  ✗ route JS budget REGRESSED"; tail -12 "$CI_TMP_DIR/ci_routejs.out"; fail=1; fi
fi

echo "• guardrails (ratchet)…"
if node --test "$GD/no-swallowed-write-errors.test.mjs" >"$CI_TMP_DIR/ci_swallowed_tests.out" 2>&1; then grn "  ✓ swallowed-write-error detector contract"
else red "  ✗ swallowed-write-error detector contract FAILED"; cat "$CI_TMP_DIR/ci_swallowed_tests.out"; fail=1; fi
if node --test "$ROOT/scripts/check-image-observation-health.test.mjs" >"$CI_TMP_DIR/ci_image_health_tests.out" 2>&1; then grn "  ✓ image-health failure assays"
else red "  ✗ image-health failure assays FAILED"; cat "$CI_TMP_DIR/ci_image_health_tests.out"; fail=1; fi
if node --experimental-vm-modules --test "$ROOT/scripts/ci/logged-out-live.test.mjs" >"$CI_TMP_DIR/ci_logged_out_tests.out" 2>&1; then grn "  ✓ logged-out navigation and access failure assays"
else red "  ✗ logged-out failure assays FAILED"; cat "$CI_TMP_DIR/ci_logged_out_tests.out"; fail=1; fi
if node --test "$GD/no-raw-fetch.test.mjs" >"$CI_TMP_DIR/ci_rawfetch_tests.out" 2>&1; then grn "  ✓ raw-fetch regression tests"
else red "  ✗ raw-fetch regression tests FAILED"; cat "$CI_TMP_DIR/ci_rawfetch_tests.out"; fail=1; fi
if node --test "$ROOT/scripts/data/declared-source-reader.test.mjs" >"$CI_TMP_DIR/ci_declared_reader_tests.out" 2>&1; then grn "  ✓ declared-source reader mapping"
else red "  ✗ declared-source reader mapping FAILED"; cat "$CI_TMP_DIR/ci_declared_reader_tests.out"; fail=1; fi
if node --test "$ROOT/scripts/books/expense-footprints.test.mjs" >"$CI_TMP_DIR/ci_expense_footprints_tests.out" 2>&1; then grn "  ✓ expense-footprints collector contract"
else red "  ✗ expense-footprints collector contract FAILED"; cat "$CI_TMP_DIR/ci_expense_footprints_tests.out"; fail=1; fi
if node --test "$ROOT/scripts/ci/invalid-indexes.test.mjs" >"$CI_TMP_DIR/ci_invalid_indexes_tests.out" 2>&1; then grn "  ✓ invalid-index detector contract"
else red "  ✗ invalid-index detector contract FAILED"; cat "$CI_TMP_DIR/ci_invalid_indexes_tests.out"; fail=1; fi
if node --test "$ROOT/scripts/ci/owner-writable-views.test.mjs" >"$CI_TMP_DIR/ci_owner_writable_views_tests.out" 2>&1; then grn "  ✓ owner-writable view detector contract"
else red "  ✗ owner-writable view detector contract FAILED"; cat "$CI_TMP_DIR/ci_owner_writable_views_tests.out"; fail=1; fi
if node --test "$GD/no-pii-exposure.test.mjs" >"$CI_TMP_DIR/ci_pii_exposure_tests.out" 2>&1; then grn "  ✓ pii-exposure detector contract"
else red "  ✗ pii-exposure detector contract FAILED"; cat "$CI_TMP_DIR/ci_pii_exposure_tests.out"; fail=1; fi
if node "$GD/no-pii-exposure.mjs" >"$CI_TMP_DIR/ci_pii_exposure.out" 2>&1; then grn "  ✓ no new migration opens personal columns to anon/authenticated"
else red "  ✗ a migration opens personal columns to anon/authenticated (scripts/guardrails/pii-exposure-allowlist.json)"; cat "$CI_TMP_DIR/ci_pii_exposure.out"; fail=1; fi
if node --test "$ROOT/scripts/ci/pr-title-check.test.mjs" >"$CI_TMP_DIR/ci_pr_title_tests.out" 2>&1; then grn "  ✓ PR title check contract"
else red "  ✗ PR title check contract FAILED"; cat "$CI_TMP_DIR/ci_pr_title_tests.out"; fail=1; fi
# Hint only, never fails: the branch's open PR title against the pre-deploy-check.yml gate. Skipped in Actions, which runs the gate.
if [[ -z "${GITHUB_ACTIONS:-}" ]] && command -v gh >/dev/null 2>&1; then
  title_hint="$(cd "$ROOT" && node scripts/ci/pr-title-check.mjs --warn 2>/dev/null || true)"
  [[ -z "$title_hint" ]] || ylw "  ! $title_hint"
fi
if node --test "$ROOT/scripts/ci/flake-report.test.mjs" >"$CI_TMP_DIR/ci_flake_report_tests.out" 2>&1; then grn "  ✓ flake report contract"
else red "  ✗ flake report contract FAILED"; cat "$CI_TMP_DIR/ci_flake_report_tests.out"; fail=1; fi
if node --test "$ROOT/scripts/ci/typecheck-ratchet.test.mjs" >"$CI_TMP_DIR/ci_typecheck_ratchet_tests.out" 2>&1; then grn "  ✓ typecheck ratchet contract"
else red "  ✗ typecheck ratchet contract FAILED"; cat "$CI_TMP_DIR/ci_typecheck_ratchet_tests.out"; fail=1; fi
if node --test "$ROOT/scripts/discovery/buying-evidence.test.mjs" "$ROOT/scripts/discovery/buying-evidence-matching.test.mjs" "$ROOT/scripts/discovery/buying-evidence-plan.test.mjs" >"$CI_TMP_DIR/ci_buying_evidence_tests.out" 2>&1; then grn "  ✓ buying-evidence source, matching, plan and refusal contracts"
else red "  ✗ buying-evidence source and refusal contracts FAILED"; cat "$CI_TMP_DIR/ci_buying_evidence_tests.out"; fail=1; fi
ratchet "ghost-refs"       "$(count_ghost)"     "$(b no-dead-asset-references errors)"
ratchet "raw-fetch"        "$(count_rawfetch)"  "$(b no-raw-fetch violations)"
ratchet "testimony-insert" "$(count_testimony)" "$(b no-raw-testimony-insert violations)"
ratchet "swallowed-write-errors" "$(count_swallowed)" "$(b no-swallowed-write-errors violations)"
design_prepare
for rule in $DESIGN_RULES; do ratchet "design/$rule" "$(count_design $rule)" "$(b design-system $rule)"; done
if secrets_ok; then grn "  ✓ secrets clean"; else red "  ✗ SECRET DETECTED"; cat "$CI_TMP_DIR/ci_sec.out"; fail=1; fi
if bash "$ROOT/scripts/ci/migration-versions-unique.sh" >"$CI_TMP_DIR/ci_migration_versions.out" 2>&1; then grn "  ✓ migration versions unique"
else red "  ✗ two migration files share a version"; cat "$CI_TMP_DIR/ci_migration_versions.out"; fail=1; fi
if bash "$ROOT/scripts/ci/migration-versions-vs-main.sh" origin/main >"$CI_TMP_DIR/ci_migration_vs_main.out" 2>&1; then grn "  ✓ migration versions unique against latest origin/main"
else red "  ✗ a migration version collides with origin/main as merged"; cat "$CI_TMP_DIR/ci_migration_vs_main.out"; fail=1; fi
ylw "  • schema-baked-labels $(count_labels) (advisory, non-blocking)"

echo "──"
if [ "$fail" = 1 ]; then
  if [ "$ENFORCE" = 1 ]; then red "CI GATE FAILED — fix regressions or, if intentional, ratchet the baseline."; exit 1
  else ylw "CI regressions found (warn mode — NOT blocking). Set CI_ENFORCE=1 to make this block."; exit 0; fi
else grn "CI GATE PASS"; exit 0; fi
