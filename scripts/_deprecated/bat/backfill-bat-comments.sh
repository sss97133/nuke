#!/bin/bash
#
# BACKFILL BAT COMMENTS
#
# Extracts comments for BaT vehicles imported in the last N days
# that are missing comment data.
#
# Usage:
#   ./backfill-bat-comments.sh          # Last 2 days (default)
#   ./backfill-bat-comments.sh 7        # Last 7 days
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DAYS="${1:-2}"

# Load environment from multiple possible files
for envfile in "$PROJECT_DIR/.env.local" "$PROJECT_DIR/.env.supabase" "$PROJECT_DIR/.env"; do
  if [[ -f "$envfile" ]]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
      if [[ "$line" =~ ^(SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)= ]]; then
        export "$line"
      fi
    done < "$envfile"
  fi
done

if [[ -z "${SUPABASE_URL:-}" ]] || [[ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  echo "ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
  exit 1
fi

echo "=============================================="
echo "BACKFILL BAT COMMENTS"
echo "=============================================="
echo "Looking for BaT vehicles from the last $DAYS days..."
echo ""

# Calculate date threshold
if [[ "$(uname)" == "Darwin" ]]; then
  DATE_THRESHOLD=$(date -u -v-${DAYS}d +%Y-%m-%dT%H:%M:%SZ)
else
  DATE_THRESHOLD=$(date -u -d "$DAYS days ago" +%Y-%m-%dT%H:%M:%SZ)
fi

echo "Date threshold: $DATE_THRESHOLD"

# Find BaT vehicles imported recently that have bat_comments > 0
VEHICLES_JSON=$(curl -sS "${SUPABASE_URL}/rest/v1/vehicles?select=id,bat_auction_url,bat_comments,created_at&bat_auction_url=not.is.null&bat_comments=gt.0&created_at=gte.${DATE_THRESHOLD}&order=created_at.desc&limit=600" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json")

# Save to temp file for processing
TEMP_FILE=$(mktemp)
echo "$VEHICLES_JSON" > "$TEMP_FILE"

TOTAL=$(jq 'length' "$TEMP_FILE")
echo "Found $TOTAL BaT vehicles with comments from the last $DAYS days"
echo ""

if [[ "$TOTAL" -eq 0 ]]; then
  echo "No vehicles to process."
  rm -f "$TEMP_FILE"
  exit 0
fi

EXTRACTED=0
SKIPPED=0
FAILED=0

# Process each vehicle
for i in $(seq 0 $((TOTAL - 1))); do
  VEHICLE_ID=$(jq -r ".[$i].id" "$TEMP_FILE")
  BAT_URL=$(jq -r ".[$i].bat_auction_url" "$TEMP_FILE")
  BAT_COMMENT_COUNT=$(jq -r ".[$i].bat_comments // 0" "$TEMP_FILE")

  echo "[$((i + 1))/$TOTAL] Vehicle: $VEHICLE_ID"
  echo "  URL: $BAT_URL"
  echo "  BaT comments: $BAT_COMMENT_COUNT"

  # Check existing comments in auction_comments
  EXISTING_RESPONSE=$(curl -sS -I "${SUPABASE_URL}/rest/v1/auction_comments?vehicle_id=eq.${VEHICLE_ID}&select=id" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Prefer: count=exact" \
    -H "Range: 0-0" 2>/dev/null)

  EXISTING_COMMENTS=$(echo "$EXISTING_RESPONSE" | grep -i "content-range" | sed 's/.*\///' | tr -d '\r\n ' || echo "0")
  EXISTING_COMMENTS=${EXISTING_COMMENTS:-0}

  if [[ "$EXISTING_COMMENTS" -gt 0 ]]; then
    echo "  SKIP: Already has $EXISTING_COMMENTS comments"
    SKIPPED=$((SKIPPED + 1))
  else
    echo "  Extracting comments..."

    RESULT=$(curl -sS -X POST "${SUPABASE_URL}/functions/v1/extract-auction-comments" \
      -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
      -H "Content-Type: application/json" \
      -d "{\"auction_url\": \"$BAT_URL\", \"vehicle_id\": \"$VEHICLE_ID\"}" \
      --max-time 90 2>/dev/null || echo '{"error": "curl timeout or failed"}')

    SUCCESS=$(echo "$RESULT" | jq -r '.success // false')
    COMMENTS_EXTRACTED=$(echo "$RESULT" | jq -r '.comments_extracted // 0')

    if [[ "$SUCCESS" == "true" ]]; then
      echo "  SUCCESS: Extracted $COMMENTS_EXTRACTED comments"
      EXTRACTED=$((EXTRACTED + 1))
    else
      ERROR=$(echo "$RESULT" | jq -r '.error // "unknown error"' | head -c 100)
      echo "  FAILED: $ERROR"
      FAILED=$((FAILED + 1))
    fi

    # Delay between requests
    sleep 3
  fi
  echo ""
done

rm -f "$TEMP_FILE"

echo "=============================================="
echo "SUMMARY"
echo "=============================================="
echo "Total checked: $TOTAL"
echo "Extracted: $EXTRACTED"
echo "Skipped (already done): $SKIPPED"
echo "Failed: $FAILED"
echo ""
