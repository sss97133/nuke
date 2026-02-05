#!/bin/bash
# Export training data for yono in batches
# Usage: ./export-training-data.sh [type] [total_records] [batch_size]

set -e
cd /Users/skylar/nuke

TYPE=${1:-image_vehicle}
TOTAL=${2:-100000}
BATCH=${3:-1000}

OUTPUT_DIR="training-data"
if [ "$TYPE" = "image_vehicle" ]; then
  OUTPUT_DIR="training-data/images"
elif [ "$TYPE" = "comment_context" ]; then
  OUTPUT_DIR="training-data/comments"
fi

echo "Exporting $TOTAL $TYPE records in batches of $BATCH..."
echo "Output: $OUTPUT_DIR"

# Load env vars once (suppress dotenvx output)
eval $(dotenvx run -- printenv 2>/dev/null | grep -E '^(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=')

CURSOR=""
EXPORTED=0
BATCH_NUM=1

while [ $EXPORTED -lt $TOTAL ]; do
  OUTPUT_FILE="$OUTPUT_DIR/batch_$(printf '%04d' $BATCH_NUM).jsonl"

  if [ -z "$CURSOR" ]; then
    PAYLOAD="{\"type\": \"$TYPE\", \"limit\": $BATCH, \"format\": \"jsonl\"}"
  else
    PAYLOAD="{\"type\": \"$TYPE\", \"limit\": $BATCH, \"format\": \"jsonl\", \"cursor\": \"$CURSOR\"}"
  fi

  echo -n "Batch $BATCH_NUM: "

  # Export batch with retry
  RETRIES=3
  while [ $RETRIES -gt 0 ]; do
    HTTP_CODE=$(curl -s -X POST "$VITE_SUPABASE_URL/functions/v1/export-training-batch" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Content-Type: application/json" \
      -d "$PAYLOAD" \
      -o "$OUTPUT_FILE" \
      -w '%{http_code}' \
      -D /tmp/headers.txt)

    if [ "$HTTP_CODE" = "200" ]; then
      break
    fi

    RETRIES=$((RETRIES - 1))
    if [ $RETRIES -gt 0 ]; then
      echo -n "retry... "
      sleep 2
    else
      echo "FAILED after retries (HTTP $HTTP_CODE)"
      cat "$OUTPUT_FILE"
      exit 1
    fi
  done

  # Get cursor and count from headers (more reliable than wc -l)
  CURSOR=$(grep -i "x-next-cursor" /tmp/headers.txt 2>/dev/null | cut -d' ' -f2 | tr -d '\r\n')
  HAS_MORE=$(grep -i "x-has-more" /tmp/headers.txt 2>/dev/null | cut -d' ' -f2 | tr -d '\r\n')
  COUNT=$(grep -i "x-record-count" /tmp/headers.txt 2>/dev/null | cut -d' ' -f2 | tr -d '\r\n')
  SIZE=$(stat -f%z "$OUTPUT_FILE" 2>/dev/null || stat -c%s "$OUTPUT_FILE" 2>/dev/null)

  EXPORTED=$((EXPORTED + COUNT))
  echo "$COUNT records ($SIZE bytes) -> $OUTPUT_FILE [total: $EXPORTED]"

  # Check has_more header
  if [ "$HAS_MORE" != "true" ]; then
    echo "No more records."
    break
  fi

  # Safety check - no cursor means we can't continue
  if [ -z "$CURSOR" ]; then
    echo "No cursor returned."
    break
  fi

  BATCH_NUM=$((BATCH_NUM + 1))
  sleep 0.2
done

echo ""
echo "Export complete!"
echo "Total records: $EXPORTED"
echo "Files:"
ls -lh $OUTPUT_DIR/*.jsonl 2>/dev/null | head -20
