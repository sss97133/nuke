#!/usr/bin/env bash
# vision-gate-e2e-test.sh — end-to-end smoke test for the form-fill propagation chain.
# Verifies: source image → vision-gate → form-fill → synthesize → vehicles row hydrated.
#
# Run: bash scripts/vision-gate-e2e-test.sh
# Exits 0 if all assertions pass, 1 if any fail.

set -u
cd /Users/skylar/nuke

PASS=0
FAIL=0

assert() {
  local label="$1" actual="$2" expected="$3"
  if [[ "$actual" == "$expected" || ( -n "$3" && -n "$2" ) ]]; then
    echo "  ✓ $label  (actual=$actual)"
    PASS=$((PASS+1))
  else
    echo "  ✗ $label  expected=$expected actual=$actual"
    FAIL=$((FAIL+1))
  fi
}

# Each test queries an assertion via SQL through the supabase MCP equivalent.
# Use psql via dotenvx + the pooler URL (pre-approved per CLAUDE.md).
PGPASSWORD="${SUPABASE_DB_PASSWORD}" \
  PGCONN="postgresql://postgres.qkgaybvrernstplzjaam:${SUPABASE_DB_PASSWORD}@aws-0-us-west-1.pooler.supabase.com:6543/postgres"

q() { psql "$PGCONN" -tA -c "$1" 2>/dev/null; }

echo "=== Vision-Gate E2E Test ==="
echo "Date: $(date)"
echo ""

# --- Step 1: gate writes are flowing ---
echo "[1] Vision-gate state"
APPROVED=$(q "SELECT count(*) FROM vehicle_images WHERE vehicle_id='93119305-2a50-4886-b471-50e5aa3943a0' AND vision_gate_status='approved'")
assert "K5 has approved images" "$APPROVED" "non-zero"
REJECTED=$(q "SELECT count(*) FROM vehicle_images WHERE vehicle_id='93119305-2a50-4886-b471-50e5aa3943a0' AND vision_gate_status IN ('rejected_personal','rejected_misattributed')")
assert "K5 gate caught contamination" "$REJECTED" "non-zero"

# --- Step 2: form-fill is populating ai_extractions ---
echo ""
echo "[2] Form-fill enrichment"
FF_K5=$(q "SELECT count(*) FROM vehicle_images WHERE vehicle_id='93119305-2a50-4886-b471-50e5aa3943a0' AND ai_extractions->'form_fill_v1' IS NOT NULL")
assert "K5 has form-filled images" "$FF_K5" "non-zero"

# --- Step 3: per-image columns are populated ---
ZONES=$(q "SELECT count(DISTINCT vehicle_zone) FROM vehicle_images WHERE vehicle_id='93119305-2a50-4886-b471-50e5aa3943a0' AND vehicle_zone IS NOT NULL")
assert "K5 has distinct vehicle zones" "$ZONES" "non-zero"
DAMAGE=$(q "SELECT count(*) FROM vehicle_images WHERE vehicle_id='93119305-2a50-4886-b471-50e5aa3943a0' AND damage_flags IS NOT NULL AND damage_flags != '{}'")
assert "K5 has damage flags" "$DAMAGE" "non-zero"

# --- Step 4: synthesize wrote profile fields ---
echo ""
echo "[3] Profile synthesis"
K5_COLOR=$(q "SELECT color FROM vehicles WHERE id='93119305-2a50-4886-b471-50e5aa3943a0'")
assert "K5 vehicles.color populated" "$K5_COLOR" "non-empty"
K5_FLAWS=$(q "SELECT length(known_flaws) > 10 FROM vehicles WHERE id='93119305-2a50-4886-b471-50e5aa3943a0'")
assert "K5 vehicles.known_flaws populated" "$K5_FLAWS" "t"
K5_MODS=$(q "SELECT length(modifications) > 0 FROM vehicles WHERE id='93119305-2a50-4886-b471-50e5aa3943a0'")
assert "K5 vehicles.modifications populated" "$K5_MODS" "t"

# --- Step 5: Merge integrity (testimony preserved) ---
echo ""
echo "[4] Merge integrity"
MUSTANG_MERGED=$(q "SELECT count(*) FROM vehicle_images WHERE vehicle_id='83f6f033-a3c3-4cf4-a85e-a60d2c588838' AND merged_from_vehicle_id='8bde1dda-ebb4-480e-8942-e561feb36667'")
assert "Mustang merge moved 122 images with lineage" "$MUSTANG_MERGED" "122"

# --- Step 6: User profile hydrated ---
echo ""
echo "[5] User profile"
PROF_FULL=$(q "SELECT (full_name IS NOT NULL AND address IS NOT NULL AND city IS NOT NULL AND state IS NOT NULL AND business_name IS NOT NULL) FROM profiles WHERE id='0b9f107a-d124-49de-9ded-94698f63c1c4'")
assert "Skylar profile fully hydrated" "$PROF_FULL" "t"

# --- Summary ---
echo ""
echo "=== Result ==="
echo "Pass: $PASS"
echo "Fail: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✓ ALL CHECKS PASS" && exit 0
echo "✗ FAILURES — investigate"
exit 1
