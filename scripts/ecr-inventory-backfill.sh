#!/bin/bash
# ECR Collection Inventory Backfill
# Processes unsynced collections one at a time
# Usage: cd /Users/skylar/nuke && bash scripts/ecr-inventory-backfill.sh [max_count]

set -uo pipefail
cd /Users/skylar/nuke

MAX_COUNT=${1:-50}
PROCESSED=0
TOTAL_CARS=0
ERRORS=0

# Load env vars once
eval "$(dotenvx run -- bash -c 'echo "export SB_URL=\"$VITE_SUPABASE_URL\"; export SB_KEY=\"$SUPABASE_SERVICE_ROLE_KEY\""' 2>/dev/null | grep '^export')"

echo "=== ECR Inventory Backfill ==="
echo "Max collections: $MAX_COUNT"
echo "Started: $(date)"
echo ""

# Get unsynced collection IDs
IDS=$(PGPASSWORD="RbzKq32A0uhqvJMQ" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -t -A -c "
SELECT id || '|' || coalesce(business_name, slug) FROM organizations
WHERE entity_type = 'collection'
  AND last_inventory_sync IS NULL
  AND website IS NOT NULL
ORDER BY random()
LIMIT $MAX_COUNT
" 2>/dev/null)

TOTAL=$(echo "$IDS" | wc -l | tr -d ' ')
echo "Found $TOTAL unsynced collections with websites"
echo ""

while IFS='|' read -r BID NAME; do
  [ -z "$BID" ] && continue
  PROCESSED=$((PROCESSED + 1))

  echo -n "[$PROCESSED/$TOTAL] $NAME ... "

  # Call edge function directly (no dotenvx wrapper)
  RESULT=$(curl -s --max-time 150 -X POST "$SB_URL/functions/v1/scrape-ecr-collection-inventory" \
    -H "Authorization: Bearer $SB_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"business_id\": \"$BID\"}" 2>/dev/null)

  # Parse result
  CARS=$(echo "$RESULT" | python3 -c "
import sys, json
try:
    d = json.loads(sys.stdin.read())
    linked = d.get('total_cars_linked', 0)
    found = d.get('total_cars_found', 0)
    errs = sum(len(r.get('errors',[])) for r in d.get('results',[]))
    print(f'{linked}|{found}|{errs}')
except:
    print('ERR')
" 2>/dev/null)

  if [ "$CARS" = "ERR" ] || [ -z "$CARS" ]; then
    echo "TIMEOUT"
    ERRORS=$((ERRORS + 1))
  else
    LINKED=$(echo "$CARS" | cut -d'|' -f1)
    FOUND=$(echo "$CARS" | cut -d'|' -f2)
    ERRS=$(echo "$CARS" | cut -d'|' -f3)
    TOTAL_CARS=$((TOTAL_CARS + LINKED))
    if [ "$ERRS" -gt 0 ] 2>/dev/null; then
      echo "$FOUND found, $LINKED linked ($ERRS errors)"
    else
      echo "$FOUND found, $LINKED linked"
    fi
  fi

  sleep 1
done <<< "$IDS"

echo ""
echo "=== Backfill Complete ==="
echo "Processed: $PROCESSED collections"
echo "Total cars linked: $TOTAL_CARS"
echo "Errors: $ERRORS"
echo "Finished: $(date)"
