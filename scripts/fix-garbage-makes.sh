#!/bin/bash
# Fix garbage make fields using batched SQL via psql (session pooler, port 5432)
# Step 1: Dump IDs + parsed make/model to a temp file
# Step 2: Batch UPDATE by ID

export PGPASSWORD="RbzKq32A0uhqvJMQ"
PSQL="psql -h aws-0-us-west-1.pooler.supabase.com -p 5432 -U postgres.qkgaybvrernstplzjaam -d postgres"
TMPFILE="/tmp/garbage-makes-ids.csv"

echo "[$(date +%H:%M:%S)] Phase 1: Extracting garbage-make vehicle IDs..."

# Dump IDs + model field for parsing
$PSQL -t -A -F '|' -c "
SET statement_timeout = '180s';
SELECT id, model FROM vehicles
WHERE (make ~ '^\d+k-Mile\$' OR make ~ '-Powered\$'
  OR make IN ('Modified','Original-Owner','Supercharged','Euro',
              'One-Family-Owned','No-Reserve','Illuminated'))
  AND model ~ '^\d{4}\s+'
;" > "$TMPFILE" 2>&1

count=$(wc -l < "$TMPFILE" | tr -d ' ')
echo "  Extracted $count vehicle IDs to fix"

if [ "$count" = "0" ]; then
  echo "  Nothing to fix!"
  exit 0
fi

# Now generate UPDATE SQL in batches of 50
echo "[$(date +%H:%M:%S)] Phase 1: Writing updates in batches of 50..."

total=0
errors=0
batch_sql=""
batch_count=0

# Two-word makes (lowercase prefix → proper make name)
is_two_word_make() {
  local lower="$1"
  case "$lower" in
    "land rover "*|"alfa romeo "*|"aston martin "*|"de tomaso "*|"austin healey "*|"rolls royce "*) return 0 ;;
    *) return 1 ;;
  esac
}

while IFS='|' read -r vid model_raw; do
  [ -z "$vid" ] && continue

  # Strip year prefix (first 4 digits + space)
  trimmed=$(echo "$model_raw" | sed 's/^[0-9]\{4\} *//')
  [ -z "$trimmed" ] && continue

  lower_trimmed=$(echo "$trimmed" | tr '[:upper:]' '[:lower:]')

  # Parse make and model
  new_make=""
  new_model=""
  if [[ "$lower_trimmed" == "land rover "* ]]; then
    new_make="Land Rover"; new_model="${trimmed:11}"
  elif [[ "$lower_trimmed" == "alfa romeo "* ]]; then
    new_make="Alfa Romeo"; new_model="${trimmed:11}"
  elif [[ "$lower_trimmed" == "aston martin "* ]]; then
    new_make="Aston Martin"; new_model="${trimmed:13}"
  elif [[ "$lower_trimmed" == "de tomaso "* ]]; then
    new_make="De Tomaso"; new_model="${trimmed:9}"
  elif [[ "$lower_trimmed" == "austin healey "* ]]; then
    new_make="Austin Healey"; new_model="${trimmed:14}"
  elif [[ "$lower_trimmed" == "rolls royce "* ]]; then
    new_make="Rolls Royce"; new_model="${trimmed:12}"
  else
    # Single-word make = first word, model = rest
    new_make="${trimmed%% *}"
    new_model="${trimmed#* }"
    [ "$new_make" = "$new_model" ] && new_model=""
  fi

  [ -z "$new_make" ] && continue
  [ -z "$new_model" ] && continue

  # Escape single quotes for SQL
  esc_make=$(echo "$new_make" | sed "s/'/''/g")
  esc_model=$(echo "$new_model" | sed "s/'/''/g")

  batch_sql="${batch_sql}UPDATE vehicles SET make='${esc_make}', model='${esc_model}', updated_at=now() WHERE id='${vid}';
"
  batch_count=$((batch_count + 1))

  if [ "$batch_count" -ge 50 ]; then
    result=$($PSQL -t -A -c "SET statement_timeout = '60s'; ${batch_sql} SELECT 1;" 2>&1) || true
    if echo "$result" | grep -qi "error\|timeout\|FATAL"; then
      errors=$((errors + 1))
      if [ $errors -le 10 ]; then
        echo "  Error ($errors) at $total: $(echo "$result" | grep -i 'error\|timeout' | head -1)"
      fi
      sleep 2
      # Retry once
      result=$($PSQL -t -A -c "SET statement_timeout = '60s'; ${batch_sql} SELECT 1;" 2>&1) || true
      if echo "$result" | grep -qi "error\|timeout\|FATAL"; then
        errors=$((errors + 1))
        sleep 3
      else
        total=$((total + batch_count))
      fi
    else
      total=$((total + batch_count))
    fi
    batch_sql=""
    batch_count=0
    if [ $((total % 2000)) -lt 50 ]; then
      echo "  ... $total written ($errors errors)"
    fi
  fi
done < "$TMPFILE"

# Flush remaining
if [ "$batch_count" -gt 0 ]; then
  result=$($PSQL -t -A -c "SET statement_timeout = '60s'; ${batch_sql} SELECT 1;" 2>&1) || true
  if ! echo "$result" | grep -qi "error\|timeout\|FATAL"; then
    total=$((total + batch_count))
  fi
fi

echo "  ... $total written ($errors errors)"
echo "[$(date +%H:%M:%S)] Phase 1 done: $total garbage makes fixed"

# Phase 2: Direct renames
echo ""
echo "[$(date +%H:%M:%S)] Phase 2: Direct make renames..."

run_rename() {
  local old_make="$1" new_make="$2" extra_set="${3:-}" batch_size="${4:-200}"
  local rename_total=0
  while true; do
    local result
    result=$($PSQL -t -A -c "
      SET statement_timeout = '60s';
      WITH batch AS (
        SELECT id FROM vehicles WHERE make = '$old_make' LIMIT $batch_size
      ),
      updated AS (
        UPDATE vehicles v SET make = '$new_make'$extra_set, updated_at = now()
        FROM batch b WHERE v.id = b.id
        RETURNING v.id
      )
      SELECT count(*) FROM updated;
    " 2>&1) || true
    if echo "$result" | grep -qi "error\|timeout\|FATAL"; then
      sleep 3; continue
    fi
    local c=$(echo "$result" | tr -d ' \n\r')
    [ -z "$c" ] || [ "$c" = "0" ] && break
    rename_total=$((rename_total + c))
  done
  echo "  '$old_make' → '$new_make': $rename_total vehicles"
}

run_rename "porsche" "Porsche"
run_rename "Land" "Land Rover" ", model = 'Rover ' || COALESCE(model, '')"
run_rename "Alfa" "Alfa Romeo" ", model = 'Romeo ' || COALESCE(model, '')"

echo ""
echo "[$(date +%H:%M:%S)] All done!"
rm -f "$TMPFILE"
