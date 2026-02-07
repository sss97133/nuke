#!/bin/bash
# Normalize model case for all vehicles via direct psql
# This is faster than REST API because it avoids per-row timeouts
#
# Usage: ./scripts/normalize-models-psql.sh
# Or:    dotenvx run -- ./scripts/normalize-models-psql.sh

set -euo pipefail

LOGFILE="/Users/skylar/nuke/reports/normalize-models-$(date +%Y%m%d-%H%M).log"
STATUS_FILE="/Users/skylar/nuke/docs/agents/MODEL_NORMALIZATION_STATUS.md"
export PGPASSWORD="${SUPABASE_DB_PASSWORD:-RbzKq32A0uhqvJMQ}"
PSQL_HOST="aws-0-us-west-1.pooler.supabase.com"
PSQL_USER="postgres.qkgaybvrernstplzjaam"

run_sql() {
  psql -h "$PSQL_HOST" -p 6543 -U "$PSQL_USER" -d postgres -t -A -c "$1" 2>/dev/null
}

echo "=== Model Normalization (psql) ===" | tee "$LOGFILE"
echo "Started: $(date)" | tee -a "$LOGFILE"

# Get top makes by count
MAKES=$(run_sql "
  SELECT make FROM (
    SELECT make, COUNT(*) as cnt 
    FROM vehicles 
    WHERE status = 'active' AND listing_kind = 'vehicle' AND make IS NOT NULL AND make != ''
    GROUP BY make HAVING COUNT(*) >= 2
    ORDER BY cnt DESC
  ) sub;
")

TOTAL_MAKES=$(echo "$MAKES" | wc -l | tr -d ' ')
echo "Processing $TOTAL_MAKES makes" | tee -a "$LOGFILE"

MAKE_NUM=0
TOTAL_UPDATED=0

for MAKE in $MAKES; do
  MAKE_NUM=$((MAKE_NUM + 1))
  
  # For each make: find model groups where lowercase matches but case differs
  # Update all variants to match the most common properly-cased version
  # Escape single quotes in make name
  ESCAPED_MAKE=$(echo "$MAKE" | sed "s/'/''/g")
  
  # Normalize in small batches per model group to work within trigger overhead
  # First: get the model groups that need normalizing
  GROUPS=$(psql -h "$PSQL_HOST" -p 6543 -U "$PSQL_USER" -d postgres -t -A -F'|' -c "
    SET statement_timeout = '30s';
    SELECT lower(model) as lm, mode() WITHIN GROUP (ORDER BY model) as canonical, COUNT(*) - COUNT(*) FILTER (WHERE model = mode() WITHIN GROUP (ORDER BY model)) as to_fix
    FROM vehicles
    WHERE make = '$ESCAPED_MAKE' AND status = 'active' AND listing_kind = 'vehicle' AND model IS NOT NULL
    GROUP BY lower(model)
    HAVING COUNT(DISTINCT model) > 1
    ORDER BY to_fix DESC
    LIMIT 200;
  " 2>/dev/null || echo "")
  
  UPDATED=0
  if [ -n "$GROUPS" ]; then
    while IFS='|' read -r lm canonical to_fix; do
      [ -z "$lm" ] && continue
      # Escape for SQL
      escaped_lm=$(echo "$lm" | sed "s/'/''/g")
      escaped_canonical=$(echo "$canonical" | sed "s/'/''/g")
      
      result=$(psql -h "$PSQL_HOST" -p 6543 -U "$PSQL_USER" -d postgres -t -A -c "
        SET statement_timeout = '30s';
        WITH updated AS (
          UPDATE vehicles SET model = '$escaped_canonical'
          WHERE make = '$ESCAPED_MAKE' AND status = 'active' AND listing_kind = 'vehicle'
            AND lower(model) = '$escaped_lm' AND model != '$escaped_canonical'
          RETURNING id
        ) SELECT COUNT(*) FROM updated;
      " 2>/dev/null || echo "0")
      
      n=$(echo "$result" | tr -d ' ' | grep -E '^[0-9]+$' | head -1)
      n=${n:-0}
      UPDATED=$((UPDATED + n))
    done <<< "$GROUPS"
  fi
  
  if [ "$UPDATED" != "0" ] && [ -n "$UPDATED" ]; then
    echo "[$MAKE_NUM/$TOTAL_MAKES] $MAKE: $UPDATED records normalized" | tee -a "$LOGFILE"
    TOTAL_UPDATED=$((TOTAL_UPDATED + UPDATED))
  fi
  
  # Print progress every 50 makes even if no updates
  if [ $((MAKE_NUM % 50)) -eq 0 ]; then
    echo "[$MAKE_NUM/$TOTAL_MAKES] Progress: $TOTAL_UPDATED total updated so far" | tee -a "$LOGFILE"
  fi
done

echo "" | tee -a "$LOGFILE"
echo "=== Complete ===" | tee -a "$LOGFILE"
echo "Makes processed: $MAKE_NUM" | tee -a "$LOGFILE"
echo "Total records updated: $TOTAL_UPDATED" | tee -a "$LOGFILE"
echo "Finished: $(date)" | tee -a "$LOGFILE"

# Update status file
cat > "$STATUS_FILE" << EOF
# Model Normalization Status

> **Last run:** $(date)
> **Result:** $TOTAL_UPDATED records normalized across $MAKE_NUM makes

## Status: COMPLETE

Script: \`scripts/normalize-models-psql.sh\`
Log: \`$LOGFILE\`

## To re-run:
\`\`\`bash
cd /Users/skylar/nuke
dotenvx run -- ./scripts/normalize-models-psql.sh
\`\`\`
EOF
