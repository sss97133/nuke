#!/bin/bash
# Parallel batch migration of organization_vehicles links
# Uses xargs for parallel processing

set -e
cd /Users/skylar/nuke

# Load env vars
eval "$(dotenvx run -- printenv | grep -E '^(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' | sed 's/^/export /')"

migrate_org() {
  local from_org="$1"
  local to_org="$2"
  local name="$3"

  echo "[$name] Starting migration..."

  # Get all IDs
  local offset=0
  local batch_size=100
  local total=0

  while true; do
    # Get batch of IDs
    ids=$(curl -s "$VITE_SUPABASE_URL/rest/v1/organization_vehicles?organization_id=eq.$from_org&select=id&limit=$batch_size&offset=$offset" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
      -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" 2>/dev/null | jq -r '.[].id' 2>/dev/null)

    if [ -z "$ids" ]; then
      break
    fi

    count=$(echo "$ids" | wc -l | tr -d ' ')
    if [ "$count" = "0" ]; then
      break
    fi

    # Update each ID (in parallel, 10 at a time)
    echo "$ids" | xargs -P 10 -I {} curl -s -X PATCH "$VITE_SUPABASE_URL/rest/v1/organization_vehicles?id=eq.{}" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
      -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"organization_id\": \"$to_org\"}" > /dev/null

    total=$((total + count))
    echo "[$name] Migrated $total records..."

    # Move to next batch
    offset=$((offset + batch_size))
  done

  echo "[$name] Complete: $total total"
}

echo "=== Parallel Organization Migration ==="
echo "Started: $(date)"
echo ""

# Cars and Bids
migrate_org "c124e282-a99c-4c9a-971d-65a0ddc03224" "4dac1878-b3fc-424c-9e92-3cf552f1e053" "CarsAndBids-1"
migrate_org "822cae29-f80e-4859-9c48-a1485a543152" "4dac1878-b3fc-424c-9e92-3cf552f1e053" "CarsAndBids-2"

# PCarMarket remaining
migrate_org "f7c80592-6725-448d-9b32-2abf3e011cf8" "2a2494ae-cc22-4300-accb-24ed9a054663" "PCarMarket-remaining"

# BaT (biggest one)
migrate_org "222375e1-901e-4a2c-a254-4e412f0e2a56" "d2bd6370-11d1-4af0-8dd2-3de2c3899166" "BaT-main"
migrate_org "bd035ea4-75f0-4b17-ad02-aee06283343f" "d2bd6370-11d1-4af0-8dd2-3de2c3899166" "BaT-secondary"

echo ""
echo "=== Final Verification ==="
for entry in "Bring a Trailer:d2bd6370-11d1-4af0-8dd2-3de2c3899166" \
             "PCarMarket:2a2494ae-cc22-4300-accb-24ed9a054663" \
             "Cars and Bids:4dac1878-b3fc-424c-9e92-3cf552f1e053" \
             "SBX Cars:a35b59b1-0e64-437c-953d-24a6f5bb17c6"; do
  name="${entry%%:*}"
  org_id="${entry##*:}"
  count=$(curl -s "$VITE_SUPABASE_URL/rest/v1/organization_vehicles?organization_id=eq.$org_id&select=id" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Prefer: count=exact" -I 2>/dev/null | grep -i content-range | sed "s/.*\///" | tr -d "\r")
  echo "  $name: $count vehicles"
done

echo ""
echo "Completed: $(date)"
