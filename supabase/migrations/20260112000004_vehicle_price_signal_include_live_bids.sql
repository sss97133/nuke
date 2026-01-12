-- ============================================================================
-- vehicle_price_signal: include live auction bids from external_listings
-- ============================================================================
-- Goal: professional semantics in the "primary price" signal:
-- SOLD > LIVE BID > ASK > EST > PAID > MSRP
--
-- This makes price analysis (PriceAnalysisPanel + VehicleHeader RPC cache) reflect
-- active auctions across *any* platform, not just BaT.

CREATE OR REPLACE FUNCTION public.vehicle_price_signal(vehicle_ids uuid[])
RETURNS TABLE (
  vehicle_id uuid,
  primary_label text,
  primary_value numeric,
  anchor_label text,
  anchor_value numeric,
  delta_amount numeric,
  delta_pct numeric,
  confidence integer,
  sources text[],
  missing_fields text[],
  updated_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
WITH v AS (
  SELECT
    id AS vehicle_id,
    NULLIF(msrp, 0) AS msrp,
    NULLIF(current_value, 0) AS current_value,
    NULLIF(purchase_price, 0) AS purchase_price,
    NULLIF(asking_price, 0) AS asking_price,
    NULLIF(sale_price, 0) AS sale_price,
    is_for_sale,
    updated_at
  FROM vehicles
  WHERE id = ANY(vehicle_ids)
),
sale AS (
  SELECT DISTINCT ON (vehicle_id)
    vehicle_id,
    COALESCE(
      NULLIF(NULLIF((metadata->'what'->>'sold_price')::numeric, 0), NULL),
      NULLIF(NULLIF((metadata->'what'->>'sale_price')::numeric, 0), NULL)
    ) AS sold_price,
    event_date::timestamptz AS sold_date
  FROM vehicle_timeline_events
  WHERE vehicle_id = ANY(vehicle_ids)
    AND (event_type IN ('ownership_transfer','auction_sale','sold') OR title ILIKE 'Sold%')
    AND ((metadata->'what' ? 'sold_price') OR (metadata->'what' ? 'sale_price'))
  ORDER BY vehicle_id, event_date DESC
),
live AS (
  SELECT DISTINCT ON (vehicle_id)
    vehicle_id,
    platform,
    listing_url,
    current_bid,
    end_date,
    COALESCE(updated_at, created_at) AS ts
  FROM external_listings
  WHERE vehicle_id = ANY(vehicle_ids)
    AND listing_status = 'active'
    AND current_bid IS NOT NULL
    AND current_bid > 0
    AND (end_date IS NULL OR end_date > NOW())
  ORDER BY
    vehicle_id,
    -- Prefer auctions ending sooner (most actionable), else freshest update
    COALESCE(end_date, 'infinity'::timestamptz) ASC,
    COALESCE(updated_at, created_at) DESC
),
base AS (
  SELECT
    v.vehicle_id,
    v.msrp,
    v.current_value,
    v.purchase_price,
    v.asking_price,
    COALESCE(v.sale_price, sale.sold_price) AS sale_price,
    v.is_for_sale,
    sale.sold_date,
    live.current_bid AS live_bid,
    live.platform AS live_platform,
    live.listing_url AS live_listing_url,
    (v.sale_price IS NOT NULL) AS vehicle_sale_exists,
    (sale.sold_price IS NOT NULL) AS event_sale_exists,
    (live.current_bid IS NOT NULL) AS live_bid_exists,
    v.updated_at
  FROM v
  LEFT JOIN sale ON sale.vehicle_id = v.vehicle_id
  LEFT JOIN live ON live.vehicle_id = v.vehicle_id
),
picked AS (
  SELECT
    b.*,
    CASE
      WHEN b.sale_price IS NOT NULL THEN 'SOLD'
      WHEN b.live_bid IS NOT NULL THEN 'BID'
      WHEN b.is_for_sale IS TRUE AND b.asking_price IS NOT NULL THEN 'ASK'
      WHEN b.current_value IS NOT NULL THEN 'EST'
      WHEN b.purchase_price IS NOT NULL THEN 'PAID'
      WHEN b.msrp IS NOT NULL THEN 'MSRP'
      ELSE NULL
    END AS primary_label,
    CASE
      WHEN b.sale_price IS NOT NULL THEN b.sale_price
      WHEN b.live_bid IS NOT NULL THEN b.live_bid
      WHEN b.is_for_sale IS TRUE AND b.asking_price IS NOT NULL THEN b.asking_price
      WHEN b.current_value IS NOT NULL THEN b.current_value
      WHEN b.purchase_price IS NOT NULL THEN b.purchase_price
      WHEN b.msrp IS NOT NULL THEN b.msrp
      ELSE NULL
    END AS primary_value,
    CASE
      WHEN b.purchase_price IS NOT NULL THEN 'PURCHASE'
      WHEN b.msrp IS NOT NULL THEN 'MSRP'
      ELSE NULL
    END AS anchor_label,
    CASE
      WHEN b.purchase_price IS NOT NULL THEN b.purchase_price
      WHEN b.msrp IS NOT NULL THEN b.msrp
      ELSE NULL
    END AS anchor_value
  FROM base b
)
SELECT
  p.vehicle_id,
  p.primary_label,
  p.primary_value,
  p.anchor_label,
  p.anchor_value,
  CASE WHEN p.primary_value IS NOT NULL AND p.anchor_value IS NOT NULL THEN p.primary_value - p.anchor_value END AS delta_amount,
  CASE WHEN p.primary_value IS NOT NULL AND p.anchor_value IS NOT NULL AND p.anchor_value <> 0 THEN ((p.primary_value - p.anchor_value)/p.anchor_value)*100 END AS delta_pct,
  GREATEST(
    0,
    (CASE
      WHEN p.primary_label = 'SOLD' THEN 40
      WHEN p.primary_label = 'BID' THEN 30
      WHEN p.primary_label IN ('ASK','EST') THEN 25
      ELSE 0
    END)
    + (CASE WHEN p.purchase_price IS NOT NULL THEN 10 ELSE 0 END)
    + (CASE WHEN p.msrp IS NOT NULL THEN 5 ELSE 0 END)
    + (CASE WHEN p.sold_date IS NOT NULL AND p.sold_date > NOW() - INTERVAL '365 days' THEN 10 ELSE 0 END)
  ) AS confidence,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN p.vehicle_sale_exists THEN 'vehicles.sale_price'::text END,
    CASE WHEN p.event_sale_exists THEN 'vehicle_timeline_events.sale'::text END,
    CASE WHEN p.live_bid_exists THEN 'external_listings.current_bid'::text END,
    CASE WHEN p.is_for_sale IS TRUE AND p.asking_price IS NOT NULL THEN 'vehicles.asking_price'::text END,
    CASE WHEN p.current_value IS NOT NULL THEN 'vehicles.current_value'::text END,
    CASE WHEN p.purchase_price IS NOT NULL THEN 'vehicles.purchase_price'::text END,
    CASE WHEN p.msrp IS NOT NULL THEN 'vehicles.msrp'::text END
  ], NULL) AS sources,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN p.purchase_price IS NULL THEN 'purchase_price'::text END,
    CASE WHEN p.msrp IS NULL THEN 'msrp'::text END,
    CASE WHEN p.live_bid IS NULL THEN 'live_bid'::text END,
    CASE WHEN p.is_for_sale IS TRUE AND p.asking_price IS NULL THEN 'asking_price'::text END,
    CASE WHEN p.current_value IS NULL THEN 'current_value'::text END
  ], NULL) AS missing_fields,
  COALESCE(p.updated_at, NOW()) AS updated_at
FROM picked p;
$function$;

