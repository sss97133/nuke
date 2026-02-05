#!/bin/bash
#
# Use Ollama to analyze inventory page HTML and extract vehicle data
# Since direct link discovery is hard on JS sites, analyze what's visible
#

set -euo pipefail

cd "$(dirname "$0")/.."

OLLAMA_URL="${OLLAMA_URL:-http://localhost:11434}"
BUILDER_URL="$1"

echo "🤖 Using Ollama to analyze inventory page"
echo "=========================================="
echo "URL: $BUILDER_URL"
echo ""

# Try multiple fetch methods
echo "📥 Attempting to fetch page..."

# Method 1: Basic curl
HTML=$(curl -sf -L "$BUILDER_URL" \
  -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36" \
  -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8" \
  -H "Accept-Language: en-US,en;q=0.5" \
  --compressed \
  2>/dev/null || echo "")

if [ -z "$HTML" ]; then
  echo "❌ Failed to fetch with curl"
  exit 1
fi

HTML_LENGTH=$(echo "$HTML" | wc -c | xargs)
echo "✅ Fetched ${HTML_LENGTH} characters"
echo ""

# Extract visible text and links
echo "🔍 Extracting content..."
VISIBLE_TEXT=$(echo "$HTML" | \
  sed 's/<script[^>]*>.*<\/script>//g' | \
  sed 's/<style[^>]*>.*<\/style>//g' | \
  sed 's/<[^>]*>//g' | \
  sed 's/&nbsp;/ /g' | \
  sed 's/&amp;/\&/g' | \
  tr -s ' \n' | \
  head -c 15000)

echo "Extracted text (first 500 chars):"
echo "$VISIBLE_TEXT" | head -c 500
echo ""
echo "..."
echo ""

# Build prompt for Ollama
PROMPT="You are analyzing an automotive dealer/builder inventory page. Extract all vehicle listings you can find.

Website: $BUILDER_URL

Page content:
$VISIBLE_TEXT

Task: Extract individual vehicle listings with as much detail as possible.

For each vehicle found, extract:
- Year (if visible)
- Make (if visible)
- Model (if visible)
- Price (if visible)
- Any identifying description

Format your response as JSON array:
[
  {\"year\": 1967, \"make\": \"Ford\", \"model\": \"Bronco\", \"price\": 249900, \"description\": \"Classic restored\"},
  ...
]

If no vehicles found, return: []

JSON:"

# Call Ollama
echo "🤖 Asking Ollama to extract vehicle data..."
RESPONSE=$(curl -sf "$OLLAMA_URL/api/generate" \
  -X POST \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"llama3.1:8b\",
    \"prompt\": $(echo "$PROMPT" | jq -Rs .),
    \"stream\": false,
    \"options\": {
      \"temperature\": 0.1,
      \"num_predict\": 2000
    }
  }" 2>/dev/null | jq -r '.response' 2>/dev/null)

if [ -z "$RESPONSE" ]; then
  echo "❌ Ollama failed to respond"
  exit 1
fi

echo ""
echo "📋 Ollama's analysis:"
echo "$RESPONSE"
echo ""

# Try to parse JSON
VEHICLES=$(echo "$RESPONSE" | grep -oE '\[.*\]' | head -1)

if [ -n "$VEHICLES" ]; then
  COUNT=$(echo "$VEHICLES" | jq 'length' 2>/dev/null || echo "0")
  echo "✅ Found $COUNT vehicles"
  echo ""
  echo "$VEHICLES" | jq '.' 2>/dev/null || echo "$VEHICLES"
else
  echo "⚠️  No structured vehicle data extracted"
fi
