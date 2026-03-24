#!/bin/bash
# Backfill field_evidence from vehicle columns
# Usage: ./scripts/backfill-field-evidence.sh <field_name> <vehicle_column> <source_type> <confidence> [batch_size]
# Example: ./scripts/backfill-field-evidence.sh vin vin listing_data 85 1000

set -euo pipefail

FIELD_NAME="${1:?Usage: $0 <field_name> <vehicle_column> <source_type> <confidence> [batch_size]}"
VEHICLE_COL="${2:?Usage: $0 <field_name> <vehicle_column> <source_type> <confidence> [batch_size]}"
SOURCE_TYPE="${3:?Usage: $0 <field_name> <vehicle_column> <source_type> <confidence> [batch_size]}"
CONFIDENCE="${4:?Usage: $0 <field_name> <vehicle_column> <source_type> <confidence> [batch_size]}"
BATCH_SIZE="${5:-1000}"
SLEEP_SECS="0.2"

# Extra filter for specific fields
EXTRA_FILTER=""
if [ "$FIELD_NAME" = "vin" ]; then
  EXTRA_FILTER="AND length(v.${VEHICLE_COL}::text) >= 10"
elif [ "$FIELD_NAME" = "description" ]; then
  EXTRA_FILTER="AND length(v.${VEHICLE_COL}::text) > 20"
fi

export PGPASSWORD="RbzKq32A0uhqvJMQ"
PG="psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres"

echo "[$(date)] Field evidence backfill: ${FIELD_NAME} from ${VEHICLE_COL} (confidence=${CONFIDENCE})"

TOTAL=0

while true; do
  AFFECTED=$($PG -t -A -c "
    WITH inserted AS (
      INSERT INTO field_evidence (vehicle_id, field_name, proposed_value, source_type, source_confidence, status)
      SELECT
        v.id,
        '${FIELD_NAME}',
        v.${VEHICLE_COL}::text,
        COALESCE(v.source, 'unknown') || '_${SOURCE_TYPE}',
        ${CONFIDENCE},
        'accepted'
      FROM vehicles v
      WHERE v.deleted_at IS NULL
        AND v.${VEHICLE_COL} IS NOT NULL
        ${EXTRA_FILTER}
        AND NOT EXISTS (
          SELECT 1 FROM field_evidence fe
          WHERE fe.vehicle_id = v.id AND fe.field_name = '${FIELD_NAME}'
        )
      LIMIT ${BATCH_SIZE}
      ON CONFLICT (vehicle_id, field_name, source_type, proposed_value) DO NOTHING
      RETURNING 1
    )
    SELECT count(*) FROM inserted;
  " 2>&1)

  AFFECTED=$(echo "$AFFECTED" | tr -d '[:space:]')
  if [ "$AFFECTED" = "0" ] || [ -z "$AFFECTED" ]; then
    break
  fi

  TOTAL=$((TOTAL + AFFECTED))
  if [ $((TOTAL % 10000)) -lt $BATCH_SIZE ]; then
    echo "[$(date)] ${FIELD_NAME}: ${TOTAL} rows"
  fi

  sleep $SLEEP_SECS
done

echo "[$(date)] Done. ${FIELD_NAME} field_evidence: ${TOTAL} rows created"
