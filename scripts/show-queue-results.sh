#!/bin/bash
# Quick script to show BaT queue processing results

SUPABASE_URL="https://qkgaybvrernstplzjaam.supabase.co"
SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczODM2OTAyMSwiZXhwIjoyMDUzOTQ1MDIxfQ.NEbqSnSamR5f7Fqon25ierv5yJgdDy_o2nrixOej_Xg"

echo "═══════════════════════════════════════════════════════"
echo "   BaT Queue Status & Results"
echo "═══════════════════════════════════════════════════════"
echo ""

echo "📊 Queue Status:"
echo ""

# Get queue status
curl -s -X GET "${SUPABASE_URL}/rest/v1/bat_extraction_queue?select=status" \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  -H "apikey: ${SERVICE_KEY}" | \
  jq -r 'group_by(.status) | map({status: .[0].status, count: length}) | sort_by(.status) | .[] | "   \(.status): \(.count)"'

echo ""
echo "✅ Recently Completed (Last Hour):"
echo ""

# Get recently processed items
curl -s -X GET "${SUPABASE_URL}/rest/v1/bat_extraction_queue?select=id,bat_url,status,attempts,processed_at&status=eq.complete&processed_at=gte.$(date -u -v-1H +%Y-%m-%dT%H:%M:%S)&order=processed_at.desc&limit=10" \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  -H "apikey: ${SERVICE_KEY}" | \
  jq -r '.[] | "   \(.bat_url) - Processed: \(.processed_at)"'

echo ""
echo "🔄 Currently Processing:"
echo ""

# Get processing items
curl -s -X GET "${SUPABASE_URL}/rest/v1/bat_extraction_queue?select=id,bat_url,status,attempts,locked_at&status=eq.processing&order=locked_at.desc&limit=10" \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  -H "apikey: ${SERVICE_KEY}" | \
  jq -r '.[] | "   \(.bat_url) - Locked: \(.locked_at) (Attempt: \(.attempts))"'

echo ""
echo "⏳ Next Pending (Top 10):"
echo ""

# Get pending items
curl -s -X GET "${SUPABASE_URL}/rest/v1/bat_extraction_queue?select=id,bat_url,priority,created_at&status=eq.pending&order=priority.desc,created_at.asc&limit=10" \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  -H "apikey: ${SERVICE_KEY}" | \
  jq -r '.[] | "   \(.bat_url) - Priority: \(.priority // 0), Created: \(.created_at)"'

echo ""
echo "═══════════════════════════════════════════════════════"
echo ""

