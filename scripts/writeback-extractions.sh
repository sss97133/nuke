#!/bin/bash
# writeback-extractions.sh — Write extraction results to DB via psql
# More reliable than Supabase JS client when DNS is flaky.
# Usage: dotenvx run -- bash scripts/writeback-extractions.sh

set -euo pipefail

RESULTS_FILE="/Users/skylar/nuke/data/descriptions-results.jsonl"
WRITTEN_FILE="/Users/skylar/nuke/data/descriptions-written-ids.txt"
# Use direct IP to bypass flaky DNS
PGCONN="postgresql://postgres.qkgaybvrernstplzjaam:${SUPABASE_DB_PASSWORD}@54.177.55.191:6543/postgres?sslmode=require"

# Track what we've already written
touch "$WRITTEN_FILE"
written_count=$(wc -l < "$WRITTEN_FILE" | tr -d ' ')
total=$(wc -l < "$RESULTS_FILE" | tr -d ' ')
echo "Results: $total, Already written: $written_count"

CONDITION_MAP='{"excellent":9,"very-good":7,"good":5,"fair":3,"poor":1,"project":0}'

count=0
errors=0
fills=0

while IFS= read -r line; do
  id=$(echo "$line" | jq -r '.id')

  # Skip if already written
  if grep -q "$id" "$WRITTEN_FILE" 2>/dev/null; then
    continue
  fi

  # Build UPDATE SET clause from fills
  fill_keys=$(echo "$line" | jq -r '.fills | keys[]' 2>/dev/null)
  if [ -z "$fill_keys" ]; then
    echo "$id" >> "$WRITTEN_FILE"
    continue
  fi

  # Build SQL update
  set_clause=""
  for key in $fill_keys; do
    val=$(echo "$line" | jq -r ".fills[\"$key\"]" 2>/dev/null)
    if [ "$val" = "null" ] || [ -z "$val" ]; then continue; fi

    case "$key" in
      horsepower|torque|mileage|doors|condition_rating)
        # Numeric
        set_clause="${set_clause}${key} = ${val}, "
        ;;
      is_modified)
        set_clause="${set_clause}${key} = ${val}, "
        ;;
      modifications)
        # JSONB array
        json_val=$(echo "$line" | jq -c ".fills.modifications")
        set_clause="${set_clause}${key} = '${json_val}'::jsonb, "
        ;;
      *)
        # Text — escape single quotes
        val_escaped=$(echo "$val" | sed "s/'/''/g")
        set_clause="${set_clause}${key} = '${val_escaped}', "
        ;;
    esac
  done

  if [ -z "$set_clause" ]; then
    echo "$id" >> "$WRITTEN_FILE"
    continue
  fi

  # Remove trailing comma+space
  set_clause="${set_clause%, }"

  sql="UPDATE vehicles SET ${set_clause} WHERE id = '${id}' AND status = 'active';"

  if psql "$PGCONN" -c "$sql" 2>/dev/null; then
    ((count++))
    fills=$((fills + $(echo "$fill_keys" | wc -w)))
    echo "$id" >> "$WRITTEN_FILE"
  else
    ((errors++))
    if [ $errors -ge 20 ]; then
      echo "Too many errors ($errors), stopping. Network may be down."
      break
    fi
  fi

  # Also write discovery row
  non_null=$(echo "$line" | jq -r '.non_null')
  extraction=$(echo "$line" | jq -c '.extraction' | sed "s/'/''/g")
  discovery_sql="INSERT INTO description_discoveries (vehicle_id, discovered_at, model_used, prompt_version, raw_extraction, keys_found, total_fields)
    VALUES ('${id}', now(), 'qwen2.5:7b', 'local-v1', '${extraction}'::jsonb, ${non_null}, 30)
    ON CONFLICT (vehicle_id) DO UPDATE SET raw_extraction = EXCLUDED.raw_extraction, discovered_at = EXCLUDED.discovered_at, keys_found = EXCLUDED.keys_found;"
  psql "$PGCONN" -c "$discovery_sql" 2>/dev/null || true

  if [ $((count % 10)) -eq 0 ]; then
    echo "  Written $count vehicles, $fills column fills, $errors errors"
  fi

done < "$RESULTS_FILE"

echo ""
echo "=== WRITEBACK COMPLETE ==="
echo "Written: $count vehicles"
echo "Column fills: $fills"
echo "Errors: $errors"
