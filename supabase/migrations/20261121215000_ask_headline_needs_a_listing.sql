-- vehicle_price_facts: an asking price is the headline 'ask' only when a listing stands behind it.
--
-- Consumers (live, 2026-11-21): vehicle_profile_read (the profile header and the garage card's price, web and iOS),
-- vehicle_price, valuation_by_ymm, popup_vehicle_intel, vehicle_sale_price_untrusted_read.
--
-- What was wrong: f_ask_active was "sale_status is not terminal", so any vehicles.asking_price became the headline
-- "Asking" with no listing, no clock and no for-sale mark. Measured on the 138 garage vehicles of the class price store
-- (scripts/data/q.sh): 10 cards headline "asking"; none has a listing URL or a listing date; 6 of them are also marked
-- not for sale (is_for_sale = false), among them a truck whose asking amount came from a bulk profile import
-- (profile_origin dropbox_import, description written at import). Two of the 10 are Craigslist rows, which the profile
-- reader labels "currency unrecorded".
-- Rule (ask_needs_offer_v1): the ask is the current offer only with a source URL, a listing clock (posted, updated or
-- the native seller quote's observed_at), or is_for_sale = true. Otherwise the amount stays in ask_amount / ask_as_of
-- and the headline falls through to bid, then estimate, as before; vehicle_profile_read shows no headline price then
-- and the garage card falls back to the class price when one is stored.
-- Effect: on the 138, 6 cards lose "asking" (4 keep it: marked for sale). Fleet-wide, a 3% TABLESAMPLE of vehicles with
-- a non-terminal asking price found 120 of 6,978 affected, about 1.7% (estimate, about 4,000 vehicles).
-- Body: the live definition (20261031074000_native_listing_profile_evidence.sql and later) with is_for_sale selected
-- and the one condition added. Signature, columns and grants unchanged.

SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.vehicle_price_facts(p_vehicle_ids uuid[])
 RETURNS TABLE(vehicle_id uuid, price_kind text, price_amount numeric, price_as_of timestamp with time zone, price_live boolean, sold_amount numeric, sold_on date, sold_basis text, sold_amount_from text, ask_amount numeric, ask_as_of timestamp with time zone, bid_amount numeric, bid_on date, bid_from text, estimate_amount numeric, estimate_confidence integer, estimate_as_of timestamp with time zone, outcome text, platform text, source_url text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Keep the canonical sale basis once per selected vehicle. The SQL helper
  -- returns all twenty fields, so folding this stage repeats its source rule.
  WITH v AS MATERIALIZED (
    SELECT v.id, v.sale_status, v.auction_outcome, v.reserve_status,
           CASE WHEN public.vehicle_sale_price_untrusted_read(v.id) THEN NULL ELSE coalesce(v.sale_price_usd, v.sale_price) END AS sale_price, v.bat_sold_price, v.sold_price, v.winning_bid, v.high_bid,
           v.asking_price, v.is_for_sale, v.sale_date, v.bat_sale_date, v.listing_updated_at, v.listing_posted_at,
           v.nuke_estimate, v.nuke_estimate_confidence, v.valuation_calculated_at,
           v.canonical_outcome, v.canonical_platform,
           COALESCE(v.listing_url, v.bat_auction_url, v.platform_url) AS source_url,
           vehicle_sale_basis(v.sale_status, v.auction_outcome, v.canonical_platform, v.listing_url,
                              v.discovery_url, v.sale_price::numeric, v.notes, v.import_metadata,
                              v.created_at) AS basis,
           v.auction_end_date
    FROM vehicles v
    WHERE v.id = ANY (p_vehicle_ids)
      AND v.deleted_at IS NULL
  ),
  dated AS (
    -- Leave date parsing inline: an unused malformed legacy date must retain
    -- the old lazy CASE behavior rather than becoming a new reader exception.
    SELECT v.*, CASE WHEN v.auction_end_date ~ '^\d{4}-\d{2}-\d{2}'
      THEN left(v.auction_end_date, 10)::date END AS auction_end_on
    FROM v
  ),
  f AS (
    SELECT v.*, native_ask.observed_at AS native_ask_at, native_ask.source_url AS native_ask_url, native_ask.platform AS native_ask_platform,
      CASE WHEN v.basis IS NOT NULL THEN COALESCE(NULLIF(v.sale_price, 0)::numeric, NULLIF(v.winning_bid, 0)::numeric,
                                                  NULLIF(v.bat_sold_price, 0)::numeric, NULLIF(v.sold_price, 0)::numeric)
      END AS f_sold_amount,
      CASE WHEN v.basis IS NOT NULL THEN
        CASE WHEN v.sale_price > 0 THEN 'sale_price' WHEN v.winning_bid > 0 THEN 'winning_bid'
             WHEN v.bat_sold_price > 0 THEN 'bat_sold_price' WHEN v.sold_price > 0 THEN 'sold_price' END
      END AS f_sold_from,
      CASE WHEN v.basis IS NOT NULL THEN COALESCE(v.sale_date, v.bat_sale_date, v.auction_end_on) END AS f_sold_on,
      NULLIF(v.asking_price, 0) AS f_ask,
      COALESCE(NULLIF(v.high_bid, 0), NULLIF(v.winning_bid, 0))::numeric AS f_bid,
      CASE WHEN v.high_bid > 0 THEN 'high_bid' WHEN v.winning_bid > 0 THEN 'winning_bid' END AS f_bid_from,
      NULLIF(v.nuke_estimate, 0) AS f_estimate,
      COALESCE(v.sale_status = 'auction_live', false) AS f_live,
      COALESCE(v.sale_status, '') NOT IN ('sold', 'ended', 'not_sold', 'unsold', 'bid_to', 'auction_live', 'upcoming')
        -- ask_needs_offer_v1: an asking price is the current offer only with a listing behind it (a source URL or a
        -- listing clock) or the record marking the car for sale; an unsourced, undated amount stays ask_amount only.
        AND (v.source_url IS NOT NULL OR v.listing_posted_at IS NOT NULL OR v.listing_updated_at IS NOT NULL
             OR native_ask.observed_at IS NOT NULL OR COALESCE(v.is_for_sale, false))
        AS f_ask_active
    FROM dated v
    -- native_listing_price_clock_v1: bind an existing scalar to its own retained
    -- seller quote. Amounts and sold/bid/estimate priority remain unchanged.
    LEFT JOIN LATERAL (
      SELECT o.observed_at, o.source_url,
             CASE WHEN o.extraction_method='gateway_jsonld_v1' THEN 'gateway_classics'
                  ELSE o.structured_data->>'platform' END AS platform
      FROM public.vehicle_observations o
      WHERE v.source_url ~ '^https?://(www[.])?(gatewayclassiccars|streetsideclassics|grautogallery)[.]com/'
        AND o.vehicle_id=v.id AND o.kind='listing' AND o.is_superseded=false
        AND o.extraction_method IN ('gateway_jsonld_v1','dealer_microdata_v1','dealer_microdata_v2')
        AND o.structured_data->>'source_claims_only'='true'
        AND o.structured_data->>'price_currency'='USD'
        AND jsonb_typeof(o.structured_data->'asking_price')='number'
        AND (o.structured_data->>'asking_price')::numeric=v.asking_price
        AND o.raw_source_ref='listing_page_snapshots:'||(o.extraction_metadata->>'snapshot_id')
        AND o.extraction_metadata->>'source_capture_sha256' ~ '^[a-f0-9]{64}$'
        AND regexp_replace(rtrim(o.source_url,'/'),'^https?://(www[.])?','')=
            regexp_replace(rtrim(v.source_url,'/'),'^https?://(www[.])?','')
      ORDER BY o.observed_at DESC NULLS LAST,o.ingested_at DESC LIMIT 1
    ) native_ask ON true
  )
  SELECT
    f.id,
    CASE WHEN f.basis IS NOT NULL                     THEN 'sold'
         WHEN f.f_live AND f.f_bid IS NOT NULL        THEN 'bid'
         WHEN f.f_ask_active AND f.f_ask IS NOT NULL  THEN 'ask'
         WHEN f.f_bid IS NOT NULL                     THEN 'bid'
         WHEN f.f_estimate IS NOT NULL                THEN 'estimate'
    END,
    CASE WHEN f.basis IS NOT NULL                     THEN f.f_sold_amount
         WHEN f.f_live AND f.f_bid IS NOT NULL        THEN f.f_bid
         WHEN f.f_ask_active AND f.f_ask IS NOT NULL  THEN f.f_ask
         WHEN f.f_bid IS NOT NULL                     THEN f.f_bid
         ELSE f.f_estimate
    END,
    CASE WHEN f.basis IS NOT NULL                     THEN f.f_sold_on::timestamptz
         WHEN f.f_live AND f.f_bid IS NOT NULL        THEN NULL
         WHEN f.f_ask_active AND f.f_ask IS NOT NULL  THEN COALESCE(f.native_ask_at, f.listing_updated_at, f.listing_posted_at)
         WHEN f.f_bid IS NOT NULL                     THEN f.auction_end_on::timestamptz
         ELSE f.valuation_calculated_at
    END,
    f.f_live,
    f.f_sold_amount, f.f_sold_on, f.basis, f.f_sold_from,
    f.f_ask, CASE WHEN f.f_ask IS NOT NULL THEN COALESCE(f.native_ask_at, f.listing_updated_at, f.listing_posted_at) END,
    f.f_bid, CASE WHEN f.f_bid IS NOT NULL THEN f.auction_end_on END, f.f_bid_from,
    f.f_estimate, CASE WHEN f.f_estimate IS NOT NULL THEN f.nuke_estimate_confidence END,
    CASE WHEN f.f_estimate IS NOT NULL THEN f.valuation_calculated_at END,
    CASE WHEN f.basis IS NOT NULL THEN 'sold'
         WHEN f.sale_status IN ('not_sold', 'unsold', 'bid_to') OR f.reserve_status = 'reserve_not_met'
              OR f.auction_outcome IN ('reserve_not_met', 'no_sale')                          THEN 'reserve_not_met'
         WHEN f.sale_status IN ('auction_live', 'upcoming')                                   THEN 'active'
         WHEN f.sale_status = 'for_sale'
              OR (COALESCE(f.asking_price, 0) > 0 AND COALESCE(f.sale_status, 'available') NOT IN ('ended'))
                                                                                              THEN 'for_sale'
         WHEN f.sale_status = 'ended'                                                         THEN 'ended'
         WHEN f.sale_status = 'available' AND (COALESCE(f.high_bid, 0) > 0 OR COALESCE(f.winning_bid, 0) > 0)
                                                                                              THEN 'ended'
         ELSE 'unknown'
    END,
    CASE WHEN f.basis IS NULL AND NOT (f.f_live AND f.f_bid IS NOT NULL) AND f.f_ask_active AND f.f_ask IS NOT NULL THEN coalesce(f.native_ask_platform,f.canonical_platform) ELSE f.canonical_platform END,
    CASE WHEN f.basis IS NULL AND NOT (f.f_live AND f.f_bid IS NOT NULL) AND f.f_ask_active AND f.f_ask IS NOT NULL THEN coalesce(f.native_ask_url,f.source_url) ELSE f.source_url END
  FROM f;
$function$;

