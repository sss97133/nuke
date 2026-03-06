#!/usr/bin/env bash
# Fix ConceptCarz fabricated prices — shell loop, each batch = own transaction.
# Usage: dotenvx run -- bash scripts/fix-conceptcarz-prices.sh
set -e

if [ -z "${SUPABASE_DB_PASSWORD:-}" ]; then
  echo "Need SUPABASE_DB_PASSWORD (use dotenvx run --)" >&2; exit 1
fi

PSQL="psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -q"
export PGPASSWORD="$SUPABASE_DB_PASSWORD"
BATCH=5000

echo "=== STEP 1: Tag fabricated prices (mod 100 != 0) ==="
total=0
while true; do
  affected=$($PSQL -t -A -c "
    WITH batch AS (
      SELECT id FROM vehicles
      WHERE listing_url LIKE 'conceptcarz://%'
        AND sale_price IS NOT NULL
        AND sale_price % 100 != 0
        AND price_confidence IS NULL
      LIMIT $BATCH
    )
    UPDATE vehicles v
    SET price_confidence = 'fabricated',
        cz_estimated_value = v.sale_price,
        sale_price = NULL
    FROM batch WHERE v.id = batch.id
    RETURNING v.id;
  " | wc -l | tr -d ' ')
  total=$((total + affected))
  echo "  Batch: $affected rows (total: $total)"
  [ "$affected" -eq 0 ] && break
  sleep 0.2
done
echo "  Done: $total fabricated prices tagged"

echo ""
echo "=== STEP 2: Strip Chassis# from model names ==="
total=0
while true; do
  affected=$($PSQL -t -A -c "
    WITH batch AS (
      SELECT id FROM vehicles
      WHERE listing_url LIKE 'conceptcarz://%' AND model ILIKE '%chassis#%'
      LIMIT $BATCH
    )
    UPDATE vehicles v
    SET model = trim(regexp_replace(v.model, '\s*[Cc]hassis#:?.*$', ''))
    FROM batch WHERE v.id = batch.id
    RETURNING v.id;
  " | wc -l | tr -d ' ')
  total=$((total + affected))
  echo "  Batch: $affected rows (total: $total)"
  [ "$affected" -eq 0 ] && break
  sleep 0.2
done
echo "  Done: $total models cleaned"

echo ""
echo "=== STEP 3: Map auction_source from event_name ==="
total=0
while true; do
  affected=$($PSQL -t -A -c "
    WITH batch AS (
      SELECT id FROM vehicles
      WHERE listing_url LIKE 'conceptcarz://%'
        AND (auction_source IN ('conceptcarz','Unknown Source') OR auction_source IS NULL)
        AND notes IS NOT NULL
      LIMIT $BATCH
    )
    UPDATE vehicles v
    SET auction_source = CASE
      WHEN v.notes::jsonb->>'event_name' ILIKE '%barrett%jackson%' THEN 'barrett-jackson'
      WHEN v.notes::jsonb->>'event_name' ILIKE '%mecum%' THEN 'mecum'
      WHEN v.notes::jsonb->>'event_name' ILIKE '%bonham%' THEN 'bonhams'
      WHEN v.notes::jsonb->>'event_name' ILIKE '%gooding%' THEN 'gooding'
      WHEN v.notes::jsonb->>'event_name' ILIKE '%rm sotheby%' OR v.notes::jsonb->>'event_name' ILIKE '%rm auction%' THEN 'rm-sothebys'
      WHEN v.notes::jsonb->>'event_name' ILIKE '%russo%steele%' OR v.notes::jsonb->>'event_name' ILIKE '%russo and steele%' THEN 'russo-and-steele'
      WHEN v.notes::jsonb->>'event_name' ILIKE '%silver auction%' OR v.notes::jsonb->>'event_name' ILIKE '%silver -%' THEN 'silver-auctions'
      WHEN v.notes::jsonb->>'event_name' ILIKE '%leake%' THEN 'leake'
      WHEN v.notes::jsonb->>'event_name' ILIKE '%carlisle%' THEN 'carlisle'
      WHEN v.notes::jsonb->>'event_name' ILIKE '%artcurial%' THEN 'artcurial'
      WHEN v.notes::jsonb->>'event_name' ILIKE '%kruse%' THEN 'kruse'
      WHEN v.notes::jsonb->>'event_name' ILIKE '%worldwide%' THEN 'worldwide-auctioneers'
      WHEN v.notes::jsonb->>'event_name' ILIKE '%auctions america%' THEN 'auctions-america'
      WHEN v.notes::jsonb->>'event_name' ILIKE '%dorotheum%' THEN 'dorotheum'
      WHEN v.notes::jsonb->>'event_name' ILIKE '%coys%' THEN 'coys'
      WHEN v.notes::jsonb->>'event_name' ILIKE '%h & h%' OR v.notes::jsonb->>'event_name' ILIKE '%h&h%' THEN 'h-and-h'
      WHEN v.notes::jsonb->>'event_name' ILIKE '%shannons%' THEN 'shannons'
      WHEN v.notes::jsonb->>'event_name' ILIKE '%brightwells%' THEN 'brightwells'
      WHEN v.notes::jsonb->>'event_name' ILIKE '%mccormick%' THEN 'mccormicks'
      WHEN v.notes::jsonb->>'event_name' ILIKE '%gaa%' THEN 'gaa-classic-cars'
      WHEN v.notes::jsonb->>'event_name' ILIKE '%gpk%' THEN 'gpk-auctions'
      WHEN v.notes::jsonb->>'event_name' ILIKE '%palm spring%exotic%' THEN 'palm-springs-exotic'
      WHEN v.notes::jsonb->>'event_name' ILIKE '%dan kruse%' THEN 'dan-kruse-classics'
      WHEN v.notes::jsonb->>'event_name' ILIKE '%branson%' THEN 'branson-auctions'
      WHEN v.notes::jsonb->>'event_name' ILIKE '%midamerica%' THEN 'midamerica'
      WHEN v.notes::jsonb->>'event_name' ILIKE '%petersen%' THEN 'petersen'
      WHEN v.notes::jsonb->>'event_name' ILIKE '%hollywood car%' THEN 'hollywood-car-auction'
      ELSE 'other'
    END
    FROM batch WHERE v.id = batch.id
    RETURNING v.id;
  " | wc -l | tr -d ' ')
  total=$((total + affected))
  echo "  Batch: $affected rows (total: $total)"
  [ "$affected" -eq 0 ] && break
  sleep 0.2
done
echo "  Done: $total rows mapped to auction houses"

echo ""
echo "=== STEP 4: Delete garbage-make rows ==="
total=0
while true; do
  affected=$($PSQL -t -A -c "
    WITH batch AS (
      SELECT id FROM vehicles
      WHERE listing_url LIKE 'conceptcarz://%'
        AND (
          make IN ('Rm','Bonhams','Barrett-Jackson','Gooding','Mecum','Worldwide',
                   'Artcurial','Barrett','Auctions','Dorotheum','Kruse',
                   'Silverstone','Coys','Shannons','Brightwells','Russo','Leake',
                   'Rm Sothebys','Rm Auctions','RM','An',
                   'Scottsdale,','-1/2','-45','Bordeaux,','Barrett-Jackson,')
          OR make IN ('Bonhams,','c.','C.','S.','J.','**','**Regretfully')
          OR make = E'''s'
          OR make ILIKE '%auction%'
          OR make ILIKE '%sotheby%'
          OR make ILIKE '%christie%'
        )
      LIMIT 2000
    )
    DELETE FROM vehicles WHERE id IN (SELECT id FROM batch)
    RETURNING id;
  " | wc -l | tr -d ' ')
  total=$((total + affected))
  echo "  Batch: $affected rows (total: $total)"
  [ "$affected" -eq 0 ] && break
  sleep 0.2
done
echo "  Done: $total garbage rows deleted"

echo ""
echo "=== STEP 5: Fix make names ==="
$PSQL -c "UPDATE vehicles SET make = 'Aston Martin' WHERE listing_url LIKE 'conceptcarz://%' AND make = 'Aston-Martin';"
$PSQL -c "UPDATE vehicles SET make = 'DeSoto' WHERE listing_url LIKE 'conceptcarz://%' AND make = 'Desoto';"
$PSQL -c "UPDATE vehicles SET make = 'Aston Martin', model = trim(regexp_replace(model, '^Martin\s*', '')) WHERE listing_url LIKE 'conceptcarz://%' AND make = 'Aston' AND model ILIKE 'Martin%';"
$PSQL -c "UPDATE vehicles SET make = 'Alfa Romeo', model = trim(regexp_replace(model, '^Romeo\s*', '')) WHERE listing_url LIKE 'conceptcarz://%' AND make = 'Alfa' AND model ILIKE 'Romeo%';"
echo "  Done: make names fixed"

echo ""
echo "=== STEP 6: Backfill discovery_url from notes ==="
total=0
while true; do
  affected=$($PSQL -t -A -c "
    WITH batch AS (
      SELECT id FROM vehicles
      WHERE listing_url LIKE 'conceptcarz://%'
        AND (discovery_url IS NULL OR discovery_url = '')
        AND notes IS NOT NULL
        AND notes::jsonb->>'source_url' IS NOT NULL
      LIMIT $BATCH
    )
    UPDATE vehicles v
    SET discovery_url = v.notes::jsonb->>'source_url',
        discovery_source = 'conceptcarz'
    FROM batch WHERE v.id = batch.id
    RETURNING v.id;
  " | wc -l | tr -d ' ')
  total=$((total + affected))
  echo "  Batch: $affected rows (total: $total)"
  [ "$affected" -eq 0 ] && break
  sleep 0.2
done
echo "  Done: $total discovery_urls backfilled"

echo ""
echo "=== FINAL STATS ==="
$PSQL -c "
SELECT
  count(*) as total,
  count(*) FILTER (WHERE price_confidence = 'fabricated') as fabricated,
  count(*) FILTER (WHERE sale_price IS NOT NULL AND sale_price >= 500) as has_real_price,
  count(*) FILTER (WHERE cz_estimated_value IS NOT NULL) as has_cz_estimate,
  count(*) FILTER (WHERE model ILIKE '%chassis#%') as dirty_models,
  count(*) FILTER (WHERE discovery_url IS NOT NULL) as has_discovery_url,
  count(DISTINCT auction_source) as distinct_auction_sources
FROM vehicles
WHERE listing_url LIKE 'conceptcarz://%';
"
