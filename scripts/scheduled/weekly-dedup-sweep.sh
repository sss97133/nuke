#!/usr/bin/env bash
#
# weekly-dedup-sweep.sh — Automated weekly duplicate detection
#
# Runs normalized URL dedup, VIN duplicate detection, and generates a report.
# Target: Sunday 3am via cron
#
# Usage:
#   dotenvx run -- bash scripts/scheduled/weekly-dedup-sweep.sh
#
# Cron entry:
#   0 3 * * 0 cd /Users/skylar/nuke && dotenvx run -- bash scripts/scheduled/weekly-dedup-sweep.sh >> /tmp/weekly-dedup.log 2>&1

set -euo pipefail
cd /Users/skylar/nuke

REPORT_FILE=".claude/DEDUP_REPORT.md"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
SUPABASE_URL="${VITE_SUPABASE_URL}"
SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY}"

echo "[$TIMESTAMP] Starting weekly dedup sweep..."

# Initialize report
cat > "$REPORT_FILE" << EOF
# Weekly Dedup Report — $TIMESTAMP

## URL-Based Duplicates (normalized)
EOF

# 1. Run normalized URL dedup via edge function
echo "  [1/3] Running normalized URL dedup..."
DEDUP_RESULT=$(curl -s -X POST "$SUPABASE_URL/functions/v1/dedup-vehicles" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"mode":"normalized","dry_run":true,"limit":500}' 2>/dev/null || echo '{"error":"function call failed"}')

echo "$DEDUP_RESULT" | jq -r '
  if .groups then
    "Found \(.groups | length) duplicate groups with \(.total_vehicles // 0) total vehicles"
  elif .error then
    "Error: \(.error)"
  else
    "No duplicates found (or unexpected response format)"
  end
' >> "$REPORT_FILE"

echo "" >> "$REPORT_FILE"
echo "### Top 10 Duplicate Groups" >> "$REPORT_FILE"
echo "$DEDUP_RESULT" | jq -r '
  if .groups then
    .groups[:10][] | "- **\(.canonical_id // "unknown")**: \(.count // 0) records"
  else
    "No groups to display"
  end
' >> "$REPORT_FILE" 2>/dev/null || echo "Could not parse groups" >> "$REPORT_FILE"

# 2. VIN-based duplicate detection
echo "  [2/3] Running VIN duplicate detection..."
cat >> "$REPORT_FILE" << 'EOF'

## VIN-Based Duplicates
EOF

VIN_DUPES=$(curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/execute_sql" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "apikey: $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "SELECT upper(trim(vin)) as norm_vin, count(*) as cnt FROM vehicles WHERE vin IS NOT NULL AND length(trim(vin)) >= 11 AND status NOT IN ('"'"'merged'"'"','"'"'deleted'"'"','"'"'archived'"'"') GROUP BY upper(trim(vin)) HAVING count(*) > 1 ORDER BY count(*) DESC LIMIT 20"
  }' 2>/dev/null || echo '[]')

# Use the Supabase execute_sql endpoint directly
VIN_COUNT=$(psql "$DATABASE_URL" -t -c "
  SELECT count(DISTINCT upper(trim(vin)))
  FROM vehicles
  WHERE vin IS NOT NULL
    AND length(trim(vin)) >= 11
    AND status NOT IN ('merged','deleted','archived')
  HAVING count(*) > 1
" 2>/dev/null | tr -d ' ' || echo "?")

echo "VIN duplicate groups: scanning..." >> "$REPORT_FILE"

# Simpler approach: use psql if available
if command -v psql &>/dev/null && [ -n "${DATABASE_URL:-}" ]; then
  psql "$DATABASE_URL" -t -A -F'|' -c "
    SELECT upper(trim(vin)) as norm_vin, count(*) as cnt
    FROM vehicles
    WHERE vin IS NOT NULL AND length(trim(vin)) >= 11
      AND status NOT IN ('merged','deleted','archived')
    GROUP BY upper(trim(vin))
    HAVING count(*) > 1
    ORDER BY count(*) DESC
    LIMIT 20
  " 2>/dev/null | while IFS='|' read -r vin cnt; do
    echo "- **$vin**: $cnt records" >> "$REPORT_FILE"
  done
else
  echo "(psql not available for VIN scan — use Supabase dashboard)" >> "$REPORT_FILE"
fi

# 3. Summary stats
echo "  [3/3] Generating summary stats..."
cat >> "$REPORT_FILE" << 'EOF'

## Database Health
EOF

if command -v psql &>/dev/null && [ -n "${DATABASE_URL:-}" ]; then
  ACTIVE_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT count(*) FROM vehicles WHERE status='active'" 2>/dev/null | tr -d ' ')
  TOTAL_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT count(*) FROM vehicles" 2>/dev/null | tr -d ' ')
  FINGERPRINT_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT count(*) FROM vehicle_hero_fingerprints" 2>/dev/null | tr -d ' ')

  cat >> "$REPORT_FILE" << EOF
- Active vehicles: $ACTIVE_COUNT
- Total vehicles: $TOTAL_COUNT
- Hero fingerprints: $FINGERPRINT_COUNT
EOF
fi

echo "" >> "$REPORT_FILE"
echo "---" >> "$REPORT_FILE"
echo "*Generated automatically by weekly-dedup-sweep.sh*" >> "$REPORT_FILE"

echo "[$TIMESTAMP] Dedup sweep complete. Report: $REPORT_FILE"
cat "$REPORT_FILE"
