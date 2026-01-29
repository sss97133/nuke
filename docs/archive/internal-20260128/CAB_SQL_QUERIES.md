# C&B Structured Data SQL Queries

Data is stored in `external_listings.metadata` as JSONB arrays.

## Equipment Analysis

```sql
-- Expand equipment items for analysis
SELECT
  v.id,
  v.listing_url,
  e.item as equipment_item
FROM external_listings v,
LATERAL jsonb_array_elements_text(v.metadata->'equipment') as e(item)
WHERE v.platform = 'cars_and_bids';

-- Count most common equipment items
SELECT
  e.item as equipment,
  count(*) as vehicle_count
FROM external_listings v,
LATERAL jsonb_array_elements_text(v.metadata->'equipment') as e(item)
WHERE v.platform = 'cars_and_bids'
GROUP BY 1
ORDER BY 2 DESC
LIMIT 20;
```

## Known Flaws Analysis

```sql
-- Vehicles with flaws
SELECT
  v.id,
  v.current_bid,
  f.item as flaw
FROM external_listings v,
LATERAL jsonb_array_elements_text(v.metadata->'known_flaws') as f(item)
WHERE v.platform = 'cars_and_bids';

-- Common flaw patterns
SELECT
  CASE
    WHEN lower(f.item) LIKE '%chip%' THEN 'Paint chips'
    WHEN lower(f.item) LIKE '%scratch%' THEN 'Scratches'
    WHEN lower(f.item) LIKE '%dent%' THEN 'Dents'
    WHEN lower(f.item) LIKE '%curb%' THEN 'Curb rash'
    WHEN lower(f.item) LIKE '%seat%' THEN 'Seat wear'
    WHEN lower(f.item) LIKE '%crack%' THEN 'Cracks'
    ELSE 'Other'
  END as flaw_category,
  count(*) as occurrences
FROM external_listings v,
LATERAL jsonb_array_elements_text(v.metadata->'known_flaws') as f(item)
WHERE v.platform = 'cars_and_bids'
GROUP BY 1
ORDER BY 2 DESC;
```

## Auction Results

```sql
-- Breakdown by auction result
SELECT
  metadata->'auction_result'->>'status' as status,
  count(*) as vehicles,
  avg(current_bid) as avg_price,
  max(current_bid) as max_price
FROM external_listings
WHERE platform = 'cars_and_bids'
  AND metadata->'auction_result' IS NOT NULL
GROUP BY 1;

-- Reserve not met analysis
SELECT
  metadata->>'make' as make,
  metadata->>'model' as model,
  metadata->'auction_result'->>'high_bid' as high_bid,
  current_bid
FROM external_listings
WHERE platform = 'cars_and_bids'
  AND metadata->'auction_result'->>'status' = 'reserve_not_met'
ORDER BY current_bid DESC;
```

## Comments Analysis

```sql
-- Comment engagement by vehicle
SELECT
  el.listing_url,
  el.current_bid,
  (el.metadata->>'comment_count')::int as comments,
  (el.metadata->>'view_count')::int as views,
  count(ac.id) as stored_comments
FROM external_listings el
LEFT JOIN auction_comments ac ON ac.vehicle_id = el.vehicle_id
WHERE el.platform = 'cars_and_bids'
GROUP BY el.id
ORDER BY comments DESC
LIMIT 20;

-- Seller comment count
SELECT
  count(*) filter (where is_seller = true) as seller_comments,
  count(*) filter (where is_seller = false) as other_comments,
  count(*) as total
FROM auction_comments
WHERE platform = 'cars_and_bids';

-- Questions in comments
SELECT
  author_username,
  comment_text,
  vehicle_id
FROM auction_comments
WHERE platform = 'cars_and_bids'
  AND has_question = true
ORDER BY created_at DESC
LIMIT 20;
```

## Quick Facts / Specs

```sql
-- Transmission distribution
SELECT
  metadata->>'transmission' as transmission,
  count(*) as vehicles
FROM external_listings
WHERE platform = 'cars_and_bids'
GROUP BY 1
ORDER BY 2 DESC;

-- Mileage analysis by make
SELECT
  metadata->>'make' as make,
  avg(replace(metadata->>'mileage', ',', '')::numeric) as avg_mileage,
  count(*) as vehicles
FROM external_listings
WHERE platform = 'cars_and_bids'
  AND metadata->>'mileage' IS NOT NULL
GROUP BY 1
HAVING count(*) > 5
ORDER BY 2;
```

## Service History

```sql
-- Vehicles with most service records
SELECT
  listing_url,
  jsonb_array_length(metadata->'service_history') as service_items,
  current_bid
FROM external_listings
WHERE platform = 'cars_and_bids'
  AND jsonb_array_length(metadata->'service_history') > 0
ORDER BY 2 DESC
LIMIT 20;
```
