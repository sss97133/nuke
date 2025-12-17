#!/bin/bash
# =====================================================
# BaT Repair Loop Monitor
# =====================================================
# Quick monitoring script to check the status of
# the BaT "make profiles correct" repair loop.

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if Supabase CLI is available
if ! command -v supabase &> /dev/null; then
  echo -e "${RED}Error: supabase CLI not found. Install it first.${NC}"
  exit 1
fi

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}BaT Repair Loop Monitor${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Get project database URL
DB_URL="${SUPABASE_DB_URL:-}"
if [ -z "$DB_URL" ]; then
  echo -e "${YELLOW}Warning: SUPABASE_DB_URL not set. Using supabase db url...${NC}"
  DB_URL=$(supabase status --output json 2>/dev/null | jq -r '.DB_URL // empty' || echo "")
  if [ -z "$DB_URL" ]; then
    echo -e "${RED}Error: Could not determine database URL.${NC}"
    echo "Set SUPABASE_DB_URL or run 'supabase start' first."
    exit 1
  fi
fi

echo -e "${GREEN}✓ Connected to database${NC}"
echo ""

# Query 1: Quick Health Check
echo -e "${BLUE}[1] Quick Health Check${NC}"
echo "----------------------------------------"
QUERY1="
SELECT 
  'Successful: ' || COUNT(*) FILTER (WHERE (origin_metadata->'bat_repair'->>'last_ok')::boolean = true),
  'Failed: ' || COUNT(*) FILTER (WHERE (origin_metadata->'bat_repair'->>'last_ok')::boolean = false),
  'Total Attempted: ' || COUNT(*)
FROM vehicles
WHERE origin_metadata->'bat_repair' IS NOT NULL;
"
psql "$DB_URL" -t -c "$QUERY1" 2>/dev/null || echo "Error querying health check"
SELECT 
  'Successful: ' || COUNT(*) FILTER (WHERE (origin_metadata->'bat_repair'->>'last_ok')::boolean = true),
  'Failed: ' || COUNT(*) FILTER (WHERE (origin_metadata->'bat_repair'->>'last_ok')::boolean = false),
  'Total Attempted: ' || COUNT(*)
FROM vehicles
WHERE origin_metadata->'bat_repair' IS NOT NULL;
" 2>/dev/null || echo "Error querying health check"
echo ""

# Query 2: Recent Repair Attempts (last 10)
echo -e "${BLUE}[2] Recent Repair Attempts (Last 10)${NC}"
echo "----------------------------------------"
QUERY2="
SELECT 
  LEFT(year::text || ' ' || make || ' ' || model, 40) as vehicle,
  (origin_metadata->'bat_repair'->>'last_attempt_at')::timestamp as last_attempt,
  (origin_metadata->'bat_repair'->>'last_ok')::boolean as success,
  CASE 
    WHEN (origin_metadata->'bat_repair'->>'last_ok')::boolean = false 
    THEN LEFT((origin_metadata->'bat_repair'->>'last_error')::text, 50)
    ELSE NULL
  END as error
FROM vehicles
WHERE origin_metadata->'bat_repair'->>'last_attempt_at' IS NOT NULL
ORDER BY (origin_metadata->'bat_repair'->>'last_attempt_at')::timestamp DESC
LIMIT 10;
"
psql "$DB_URL" -c "$QUERY2" 2>/dev/null || echo "Error querying recent attempts"
SELECT 
  LEFT(year::text || ' ' || make || ' ' || model, 40) as vehicle,
  (origin_metadata->'bat_repair'->>'last_attempt_at')::timestamp as last_attempt,
  (origin_metadata->'bat_repair'->>'last_ok')::boolean as success,
  CASE 
    WHEN (origin_metadata->'bat_repair'->>'last_ok')::boolean = false 
    THEN LEFT((origin_metadata->'bat_repair'->>'last_error')::text, 50)
    ELSE NULL
  END as error
FROM vehicles
WHERE origin_metadata->'bat_repair'->>'last_attempt_at' IS NOT NULL
ORDER BY (origin_metadata->'bat_repair'->>'last_attempt_at')::timestamp DESC
LIMIT 10;
" 2>/dev/null || echo "Error querying recent attempts"
echo ""

# Query 3: Incomplete Vehicles (Candidates)
echo -e "${BLUE}[3] Incomplete Vehicles (Repair Candidates)${NC}"
echo "----------------------------------------"
QUERY3="
SELECT 
  COUNT(*) as incomplete_count,
  COUNT(*) FILTER (WHERE (SELECT COUNT(*) FROM vehicle_images vi WHERE vi.vehicle_id = v.id) = 0) as missing_images,
  COUNT(*) FILTER (WHERE LENGTH(COALESCE(v.description, '')) < 80) as short_description,
  COUNT(*) FILTER (WHERE v.listing_location IS NULL OR v.listing_location = '') as missing_location,
  COUNT(*) FILTER (WHERE (SELECT COUNT(*) FROM auction_comments ac WHERE ac.vehicle_id = v.id) = 0) as missing_comments
FROM vehicles v
WHERE 
  (
    v.profile_origin = 'bat_import'
    OR v.discovery_source = 'bat_import'
    OR v.listing_url ILIKE '%bringatrailer.com/listing/%'
    OR v.discovery_url ILIKE '%bringatrailer.com/listing/%'
  )
  AND v.updated_at <= NOW() - INTERVAL '6 hours'
  AND (
    (SELECT COUNT(*) FROM vehicle_images vi WHERE vi.vehicle_id = v.id) = 0
    OR LENGTH(COALESCE(v.description, '')) < 80
    OR v.listing_location IS NULL
    OR v.listing_location = ''
    OR (SELECT COUNT(*) FROM auction_comments ac WHERE ac.vehicle_id = v.id) = 0
  );
"
psql "$DB_URL" -c "$QUERY3" 2>/dev/null || echo "Error querying incomplete vehicles"
SELECT 
  COUNT(*) as incomplete_count,
  COUNT(*) FILTER (WHERE (SELECT COUNT(*) FROM vehicle_images vi WHERE vi.vehicle_id = v.id) = 0) as missing_images,
  COUNT(*) FILTER (WHERE LENGTH(COALESCE(v.description, '')) < 80) as short_description,
  COUNT(*) FILTER (WHERE v.listing_location IS NULL OR v.listing_location = '') as missing_location,
  COUNT(*) FILTER (WHERE (SELECT COUNT(*) FROM auction_comments ac WHERE ac.vehicle_id = v.id) = 0) as missing_comments
FROM vehicles v
WHERE 
  (
    v.profile_origin = 'bat_import'
    OR v.discovery_source = 'bat_import'
    OR v.listing_url ILIKE '%bringatrailer.com/listing/%'
    OR v.discovery_url ILIKE '%bringatrailer.com/listing/%'
  )
  AND v.updated_at <= NOW() - INTERVAL '6 hours'
  AND (
    (SELECT COUNT(*) FROM vehicle_images vi WHERE vi.vehicle_id = v.id) = 0
    OR LENGTH(COALESCE(v.description, '')) < 80
    OR v.listing_location IS NULL
    OR v.listing_location = ''
    OR (SELECT COUNT(*) FROM auction_comments ac WHERE ac.vehicle_id = v.id) = 0
  );
" 2>/dev/null || echo "Error querying incomplete vehicles"
echo ""

# Query 4: Image Ordering Status
echo -e "${BLUE}[4] Image Ordering Status${NC}"
echo "----------------------------------------"
QUERY4="
SELECT 
  COUNT(DISTINCT v.id) FILTER (WHERE COUNT(vi.id) > 0 AND COUNT(vi.position) = COUNT(vi.id)) as fully_positioned,
  COUNT(DISTINCT v.id) FILTER (WHERE COUNT(vi.id) > 0 AND COUNT(vi.position) < COUNT(vi.id) AND COUNT(vi.position) > 0) as partially_positioned,
  COUNT(DISTINCT v.id) FILTER (WHERE COUNT(vi.id) > 0 AND COUNT(vi.position) = 0) as not_positioned
FROM vehicles v
LEFT JOIN vehicle_images vi ON vi.vehicle_id = v.id
WHERE 
  (v.profile_origin = 'bat_import' OR v.discovery_source = 'bat_import')
GROUP BY v.id
HAVING COUNT(vi.id) > 0;
"
psql "$DB_URL" -c "$QUERY4" 2>/dev/null || echo "Error querying image ordering"
SELECT 
  COUNT(DISTINCT v.id) FILTER (WHERE COUNT(vi.id) > 0 AND COUNT(vi.position) = COUNT(vi.id)) as fully_positioned,
  COUNT(DISTINCT v.id) FILTER (WHERE COUNT(vi.id) > 0 AND COUNT(vi.position) < COUNT(vi.id) AND COUNT(vi.position) > 0) as partially_positioned,
  COUNT(DISTINCT v.id) FILTER (WHERE COUNT(vi.id) > 0 AND COUNT(vi.position) = 0) as not_positioned
FROM vehicles v
LEFT JOIN vehicle_images vi ON vi.vehicle_id = v.id
WHERE 
  (v.profile_origin = 'bat_import' OR v.discovery_source = 'bat_import')
GROUP BY v.id
HAVING COUNT(vi.id) > 0;
" 2>/dev/null || echo "Error querying image ordering"
echo ""

# Query 5: Last 24 Hours Activity
echo -e "${BLUE}[5] Activity in Last 24 Hours${NC}"
echo "----------------------------------------"
QUERY5="
SELECT 
  DATE_TRUNC('hour', (origin_metadata->'bat_repair'->>'last_attempt_at')::timestamp) as hour,
  COUNT(*) as attempts,
  COUNT(*) FILTER (WHERE (origin_metadata->'bat_repair'->>'last_ok')::boolean = true) as successful
FROM vehicles
WHERE 
  origin_metadata->'bat_repair'->>'last_attempt_at' IS NOT NULL
  AND (origin_metadata->'bat_repair'->>'last_attempt_at')::timestamp >= NOW() - INTERVAL '24 hours'
GROUP BY DATE_TRUNC('hour', (origin_metadata->'bat_repair'->>'last_attempt_at')::timestamp)
ORDER BY hour DESC;
"
psql "$DB_URL" -c "$QUERY5" 2>/dev/null || echo "Error querying recent activity"
SELECT 
  DATE_TRUNC('hour', (origin_metadata->'bat_repair'->>'last_attempt_at')::timestamp) as hour,
  COUNT(*) as attempts,
  COUNT(*) FILTER (WHERE (origin_metadata->'bat_repair'->>'last_ok')::boolean = true) as successful
FROM vehicles
WHERE 
  origin_metadata->'bat_repair'->>'last_attempt_at' IS NOT NULL
  AND (origin_metadata->'bat_repair'->>'last_attempt_at')::timestamp >= NOW() - INTERVAL '24 hours'
GROUP BY DATE_TRUNC('hour', (origin_metadata->'bat_repair'->>'last_attempt_at')::timestamp)
ORDER BY hour DESC;
" 2>/dev/null || echo "Error querying recent activity"
echo ""

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Monitor complete${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "For detailed queries, see: database/queries/MONITOR_BAT_REPAIR_LOOP.sql"

