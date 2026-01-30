#!/bin/bash
# Quick contact discovery stats

cd /Users/skylar/nuke

echo "═══════════════════════════════════════════════════════════"
echo "  CONTACT DISCOVERY STATS"
echo "═══════════════════════════════════════════════════════════"

# Total person contacts
TOTAL=$(dotenvx run -- bash -c 'curl -s "${VITE_SUPABASE_URL}/rest/v1/discovery_leads?lead_type=eq.person&select=count" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"' 2>/dev/null | grep -o '[0-9]*')

echo "Total person contacts: $TOTAL"

# By status
echo ""
echo "By Status:"
for status in pending validated invalid converted; do
  COUNT=$(dotenvx run -- bash -c "curl -s \"\${VITE_SUPABASE_URL}/rest/v1/discovery_leads?lead_type=eq.person&status=eq.${status}&select=count\" \
    -H \"apikey: \${SUPABASE_SERVICE_ROLE_KEY}\" \
    -H \"Authorization: Bearer \${SUPABASE_SERVICE_ROLE_KEY}\"" 2>/dev/null | grep -o '[0-9]*')
  printf "  %-12s %s\n" "$status:" "${COUNT:-0}"
done

# Recent additions (last 24h)
echo ""
RECENT=$(dotenvx run -- bash -c 'curl -s "${VITE_SUPABASE_URL}/rest/v1/discovery_leads?lead_type=eq.person&created_at=gte.$(date -v-1d +%Y-%m-%dT%H:%M:%S)&select=count" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"' 2>/dev/null | grep -o '[0-9]*')
echo "Added last 24h: ${RECENT:-0}"

echo "═══════════════════════════════════════════════════════════"
