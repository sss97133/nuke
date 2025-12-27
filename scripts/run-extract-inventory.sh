#!/bin/bash
# Quick script to extract inventory from organizations missing vehicles

echo "🚀 Starting inventory extraction for organizations..."
echo ""

# Run extraction in batches
echo "Batch 1: First 10 orgs with zero vehicles"
curl -X POST "${SUPABASE_URL}/functions/v1/extract-all-orgs-inventory" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "limit": 10,
    "offset": 0,
    "min_vehicle_threshold": 1,
    "dry_run": false
  }' | jq '.'

echo ""
echo "✅ Extraction started. Check Supabase logs for progress."
echo ""
echo "To continue with more batches, run:"
echo "  curl -X POST \"\${SUPABASE_URL}/functions/v1/extract-all-orgs-inventory\" \\"
echo "    -H \"Authorization: Bearer \${SUPABASE_SERVICE_ROLE_KEY}\" \\"
echo "    -H \"Content-Type: application/json\" \\"
echo "    -d '{\"limit\": 10, \"offset\": 10, \"min_vehicle_threshold\": 1}' | jq '.'"

