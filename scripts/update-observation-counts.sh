#!/bin/bash
# Update vehicles.observation_count from actual vehicle_observations counts
set -euo pipefail

BATCH_SIZE="${1:-500}"
export PGPASSWORD="RbzKq32A0uhqvJMQ"
PG="psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres"

echo "[$(date)] Fetching vehicle IDs needing observation_count update..."

# Get IDs of vehicles that have observations but null or zero observation_count
TMPFILE=$(mktemp /tmp/obs-count-update-XXXXX.txt)
$PG -t -A -c "
  SELECT DISTINCT vo.vehicle_id
  FROM vehicle_observations vo
  JOIN vehicles v ON v.id = vo.vehicle_id
  WHERE v.deleted_at IS NULL AND (v.observation_count IS NULL OR v.observation_count = 0)
  ORDER BY vo.vehicle_id;
" > "$TMPFILE"

TOTAL_NEEDED=$(wc -l < "$TMPFILE" | tr -d '[:space:]')
echo "[$(date)] Found ${TOTAL_NEEDED} vehicles to update"

TOTAL=0
OFFSET=0

while [ $OFFSET -lt $TOTAL_NEEDED ]; do
  IDS=$(sed -n "$((OFFSET + 1)),$((OFFSET + BATCH_SIZE))p" "$TMPFILE" | paste -sd "," -)
  [ -z "$IDS" ] && break
  ID_ARRAY=$(echo "$IDS" | sed "s/,/','/g")

  $PG -t -A -c "
    UPDATE vehicles SET observation_count = sub.cnt
    FROM (
      SELECT vo.vehicle_id, count(*) as cnt
      FROM vehicle_observations vo
      WHERE vo.vehicle_id IN ('${ID_ARRAY}')
      GROUP BY vo.vehicle_id
    ) sub
    WHERE vehicles.id = sub.vehicle_id;
  " > /dev/null 2>&1

  OFFSET=$((OFFSET + BATCH_SIZE))
  TOTAL=$((TOTAL + BATCH_SIZE))
  if [ $TOTAL -gt $TOTAL_NEEDED ]; then TOTAL=$TOTAL_NEEDED; fi

  if [ $((TOTAL % 10000)) -lt $BATCH_SIZE ] || [ $OFFSET -ge $TOTAL_NEEDED ]; then
    echo "[$(date)] Updated: ${TOTAL}/${TOTAL_NEEDED}"
  fi
  sleep 0.2
done

echo "[$(date)] Done. Updated observation_count for ${TOTAL_NEEDED} vehicles"
rm -f "$TMPFILE"
