#!/bin/bash

# Delete Unused Edge Functions
# 
# This script deletes edge functions that are:
# - Experimental/test functions
# - Research functions not used in production
# - One-off admin scripts that have completed their purpose
# - One-off scrapers for specific sites (if data is already imported)
#
# WARNING: Review the cleanup-analysis.json file before running!

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPORT_FILE="$SCRIPT_DIR/../test-results/edge-functions/cleanup-analysis.json"

if [ ! -f "$REPORT_FILE" ]; then
  echo "❌ Error: cleanup-analysis.json not found. Run analyze-unused-edge-functions.js first."
  exit 1
fi

# Extract candidates for deletion from JSON
CANDIDATES=$(cat "$REPORT_FILE" | jq -r '.candidates_for_deletion[]' 2>/dev/null)

if [ -z "$CANDIDATES" ]; then
  echo "❌ No candidates found in report"
  exit 1
fi

echo "🗑️  EDGE FUNCTION CLEANUP"
echo "=========================="
echo ""
echo "This will delete the following functions:"
echo ""

COUNT=0
for func in $CANDIDATES; do
  COUNT=$((COUNT + 1))
  echo "  $COUNT. $func"
done

echo ""
echo "Total: $COUNT functions"
echo ""
read -p "⚠️  Are you sure you want to delete these functions? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
  echo "❌ Cancelled"
  exit 0
fi

echo ""
echo "🗑️  Deleting functions..."
echo ""

DELETED=0
FAILED=0

for func in $CANDIDATES; do
  echo -n "Deleting $func... "
  
  if supabase functions delete "$func" --project-ref qkgaybvrernstplzjaam 2>/dev/null; then
    echo "✅"
    DELETED=$((DELETED + 1))
  else
    echo "❌ (may not exist or already deleted)"
    FAILED=$((FAILED + 1))
  fi
  
  # Small delay to avoid rate limiting
  sleep 0.5
done

echo ""
echo "=========================="
echo "✅ Deleted: $DELETED"
echo "❌ Failed: $FAILED"
echo ""
echo "💾 Log saved to: test-results/edge-functions/deletion-log-$(date +%Y%m%d-%H%M%S).txt"


