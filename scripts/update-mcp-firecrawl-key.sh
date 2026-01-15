#!/bin/bash
# Update Firecrawl API key in Cursor MCP configuration
#
# Usage:
#   1. Get your Firecrawl API key from: https://www.firecrawl.dev/app/api-keys
#   2. Run: ./scripts/update-mcp-firecrawl-key.sh YOUR_API_KEY
#
# The script will update ~/.cursor/mcp.json with the correct key

if [ -z "$1" ]; then
  echo "Usage: $0 <firecrawl-api-key>"
  echo ""
  echo "Get your API key from: https://www.firecrawl.dev/app/api-keys"
  exit 1
fi

API_KEY="$1"
MCP_CONFIG="$HOME/.cursor/mcp.json"

if [ ! -f "$MCP_CONFIG" ]; then
  echo "Error: MCP config not found at $MCP_CONFIG"
  exit 1
fi

# Backup the config
cp "$MCP_CONFIG" "$MCP_CONFIG.backup"

# Update the API key using sed (macOS compatible)
if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS
  sed -i '' "s|\"FIRECRAWL_API_KEY\": \"[^\"]*\"|\"FIRECRAWL_API_KEY\": \"$API_KEY\"|g" "$MCP_CONFIG"
else
  # Linux
  sed -i "s|\"FIRECRAWL_API_KEY\": \"[^\"]*\"|\"FIRECRAWL_API_KEY\": \"$API_KEY\"|g" "$MCP_CONFIG"
fi

echo "✓ Updated Firecrawl API key in $MCP_CONFIG"
echo "✓ Backup saved to $MCP_CONFIG.backup"
echo ""
echo "Next step: Restart Cursor to apply the changes"
