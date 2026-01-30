#!/bin/bash
# Register discovered auctions from all platforms via Playwright
# Usage: ./register-discovered-auctions.sh [limit_per_platform]

LIMIT=${1:-15}
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Discovering and Registering Auctions ==="
echo "Limit per platform: $LIMIT"
echo ""

# Load environment
cd "$SCRIPT_DIR/.."
source <(dotenvx run -- env | grep -E '^(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' | sed 's/^/export /')

if [ -z "$VITE_SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
    echo "Error: Missing Supabase credentials"
    exit 1
fi

TOTAL_REGISTERED=0
TOTAL_SKIPPED=0
TOTAL_FAILED=0

for PLATFORM in cars-and-bids pcarmarket collecting-cars; do
    echo ""
    echo "=== $PLATFORM ==="

    # Discover auctions using Playwright
    URLS=$(node "$SCRIPT_DIR/discover-auctions-playwright.js" "$PLATFORM" "$LIMIT" 2>/dev/null)

    if [ -z "$URLS" ]; then
        echo "No auctions discovered for $PLATFORM"
        continue
    fi

    # Parse JSON array and register each
    echo "$URLS" | jq -r '.[]' | while read URL; do
        RESULT=$(curl -s -X POST "$VITE_SUPABASE_URL/functions/v1/register-auction-monitor" \
            -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
            -H "Content-Type: application/json" \
            -d "{\"auction_url\": \"$URL\", \"platform\": \"$PLATFORM\"}")

        SUCCESS=$(echo "$RESULT" | jq -r '.success')
        MESSAGE=$(echo "$RESULT" | jq -r '.message // .error // "unknown"')

        if [ "$SUCCESS" = "true" ]; then
            if echo "$MESSAGE" | grep -q "already"; then
                echo "  SKIP: $(basename "$URL")"
            else
                echo "  NEW:  $(basename "$URL")"
            fi
        else
            echo "  FAIL: $(basename "$URL") - $MESSAGE"
        fi

        # Small delay
        sleep 0.3
    done
done

echo ""
echo "=== Done ==="
