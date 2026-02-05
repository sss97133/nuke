#!/bin/bash
#
# Use Ollama to discover vehicle listing URLs from inventory pages
# Ollama acts as the "eyes" to analyze HTML and extract links
#

set -euo pipefail

cd "$(dirname "$0")/.."

OLLAMA_URL="${OLLAMA_URL:-http://localhost:11434}"
BUILDER_URL="$1"

echo "🔍 Using Ollama to discover listings from: $BUILDER_URL"
echo ""

# Fetch the page
echo "📥 Fetching page content..."
HTML=$(curl -sf "$BUILDER_URL" -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" 2>/dev/null || echo "")

if [ -z "$HTML" ]; then
  echo "❌ Failed to fetch page"
  exit 1
fi

HTML_LENGTH=$(echo "$HTML" | wc -c | xargs)
echo "✅ Fetched ${HTML_LENGTH} characters"
echo ""

# Extract links and text for Ollama to analyze
echo "🔗 Extracting links..."
LINKS=$(echo "$HTML" | grep -oE 'href="[^"]*"' | sed 's/href="//g' | sed 's/"//g' | grep -v "javascript:" | grep -v "^#" | head -100)
echo "Found $(echo "$LINKS" | wc -l | xargs) links"
echo ""

# Build Ollama prompt
PROMPT="You are analyzing an automotive dealer/builder website to find individual vehicle listing URLs.

Website: $BUILDER_URL

Here are the links found on this page:
$LINKS

Task: Identify which links are individual vehicle listings (not navigation, not generic pages).

Vehicle listing URLs typically:
- Contain vehicle-specific info (year, make, model, build number, VIN)
- Examples: /vehicles/1967-bronco, /builds/23456, /inventory/item-123, /listing/1971-mustang
- NOT: /about, /contact, /models, /configurator, /blog, /for-sale (without specific vehicle)

Return ONLY the vehicle listing URLs, one per line, as full URLs. If path is relative, prepend the domain.
Return 'NONE' if no vehicle listings found.

Vehicle listing URLs:"

# Call Ollama
echo "🤖 Asking Ollama to identify vehicle listings..."
RESPONSE=$(curl -sf "$OLLAMA_URL/api/generate" \
  -X POST \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"llama3.1:8b\",
    \"prompt\": $(echo "$PROMPT" | jq -Rs .),
    \"stream\": false,
    \"options\": {
      \"temperature\": 0.1,
      \"num_predict\": 1000
    }
  }" 2>/dev/null | jq -r '.response' 2>/dev/null)

if [ -z "$RESPONSE" ]; then
  echo "❌ Ollama failed to respond"
  exit 1
fi

echo ""
echo "📋 Ollama's response:"
echo "$RESPONSE"
echo ""

# Extract URLs from response
LISTING_URLS=$(echo "$RESPONSE" | grep -oE 'https?://[^\s]+' | head -20)

if [ -z "$LISTING_URLS" ]; then
  echo "⚠️  No vehicle listing URLs found"
  echo ""
  echo "Let me try extracting from visible text..."

  # Fallback: extract text and look for patterns
  VISIBLE_TEXT=$(echo "$HTML" | sed 's/<script[^>]*>.*<\/script>//g' | sed 's/<style[^>]*>.*<\/style>//g' | sed 's/<[^>]*>//g' | sed 's/&nbsp;/ /g' | head -c 10000)

  echo "$VISIBLE_TEXT" | grep -oE '(19[0-9]{2}|20[0-9]{2}).*[Bb]ronco|[Mm]ustang|[Ff]ord|[Cc]hev' | head -10

  exit 0
fi

echo "✅ Found vehicle listings:"
echo "$LISTING_URLS"
echo ""

# Save to file
OUTPUT_FILE="/tmp/discovered-listings-$(date +%s).txt"
echo "$LISTING_URLS" > "$OUTPUT_FILE"
echo "💾 Saved to: $OUTPUT_FILE"
