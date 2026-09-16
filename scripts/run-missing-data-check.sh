#!/bin/bash
# Quick script to check missing profile data via Supabase REST API

SUPABASE_URL="${SUPABASE_URL:-https://qkgaybvrernstplzjaam.supabase.co}"
SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY:?Missing env: SUPABASE_SERVICE_ROLE_KEY (run via dotenvx)}"

echo "═══════════════════════════════════════════════════════"
echo "   Missing Profile Data Check"
echo "═══════════════════════════════════════════════════════"
echo ""

# Query 1: Overview
echo "📊 1. Overview - What Complete Profiles Have:"
echo ""

# Get complete profiles with vehicle data
curl -s -X POST "${SUPABASE_URL}/rest/v1/rpc/exec_sql" \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -H "apikey: ${SERVICE_KEY}" \
  -d '{"sql": "SELECT v.id, v.year, v.make, v.model, v.vin, v.mileage, v.color, v.transmission, v.engine FROM vehicles v INNER JOIN bat_extraction_queue q ON v.id = q.vehicle_id WHERE q.status = '\''complete'\'' ORDER BY v.created_at DESC LIMIT 20;"}' | jq -r 'if type == "array" then .[] else . end' 2>/dev/null || echo "   (Query execution via API not available - use Supabase Dashboard SQL Editor)"

echo ""
echo "💡 To see full results, run these queries in Supabase Dashboard → SQL Editor:"
echo "   File: scripts/check-missing-profile-data.sql"
echo ""

