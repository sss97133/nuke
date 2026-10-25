-- Exact live reader preimages measured 2026-10-25; synthetic contract setup only.
-- Preserve their combined USD/trust behavior when exercising real ordinary roles.
-- vehicle_sale_basis: md5(pg_get_functiondef) 4a648fbaef6ff2f41fb44226a8a68b08 -- gitleaks:allow (verified MD5 of a SQL function definition, not a credential)
CREATE OR REPLACE FUNCTION public.vehicle_sale_basis(p_sale_status text, p_auction_outcome text, p_canonical_platform text, p_listing_url text, p_discovery_url text, p_sale_price numeric, p_notes text, p_import_metadata jsonb, p_created_at timestamp with time zone)
 RETURNS text
 LANGUAGE sql
 STABLE PARALLEL SAFE
AS $function$
  WITH x AS (
    SELECT
      CASE
        WHEN p_listing_url LIKE 'conceptcarz://%' OR p_listing_url LIKE 'https://conceptcarz://%' THEN 'conceptcarz'
        ELSE COALESCE(
          NULLIF(p_canonical_platform, 'unknown'),
          CASE
            WHEN COALESCE(p_listing_url, p_discovery_url, '') ~* 'carsandbids\.com'     THEN 'cars-and-bids'
            WHEN COALESCE(p_listing_url, p_discovery_url, '') ~* 'mecum\.com'           THEN 'mecum'
            WHEN COALESCE(p_listing_url, p_discovery_url, '') ~* 'barrett-jackson\.com' THEN 'barrett-jackson'
            WHEN COALESCE(p_listing_url, p_discovery_url, '') ~* 'goodingco\.com'       THEN 'gooding'
            ELSE NULL
          END)
      END AS plat
  )
  SELECT CASE
    -- contradicting testimony: an explicit no-sale on the row means the sale is not proven (2026-09-27, part 4)
    WHEN p_auction_outcome IN ('reserve_not_met', 'no_sale')
      OR p_sale_status IN ('not_sold', 'unsold', 'bid_to')
      OR (plat = 'mecum' AND p_notes ~ 'Result: bid-goes-on')                                              THEN NULL
    -- the rule: a status says money moved
    WHEN p_sale_status = 'sold' OR p_auction_outcome = 'sold' THEN 'status'
    -- after the cutover nothing but a status counts
    WHEN p_created_at >= '2026-09-27 00:00:00+00'::timestamptz THEN NULL
    -- legacy rows: the platform's own sale marker, left on the row by the writer
    WHEN plat = 'mecum'           AND p_sale_price > 0 AND p_notes ~ 'Result: sold'                       THEN 'mecum_sale_result'
    WHEN plat = 'cars-and-bids'   AND p_sale_price > 0 AND p_import_metadata->>'auction_status' = 'sold'  THEN 'cab_auction_status'
    WHEN plat = 'gooding'         AND p_sale_price > 0                                                    THEN 'gooding_sale_price'
    WHEN plat = 'barrett-jackson' AND p_sale_price > 0
         AND p_auction_outcome IS DISTINCT FROM 'no_sale' AND p_sale_status IS DISTINCT FROM 'not_sold'   THEN 'bj_result_price'
    WHEN plat = 'conceptcarz'     AND p_sale_price > 0 AND p_notes ~ '"status": "sold"'                   THEN 'conceptcarz_sold'
    -- everything else (BaT, pcarmarket, bonhams, rm-sothebys, broad-arrow, hagerty, every classified,
    -- every aggregator, unknown): not a sale until a status proves it
    ELSE NULL
  END
  FROM x;
$function$;

-- vehicle_event_low_trust: md5(pg_get_functiondef) f643520d00beac7d7259ba949d69eda3 -- gitleaks:allow (verified MD5 of a SQL function definition, not a credential)
CREATE OR REPLACE FUNCTION public.vehicle_event_low_trust(p_event_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE PARALLEL SAFE
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from vehicle_event_trust t where t.event_id = p_event_id and t.retired_at is null and t.trust = 'low')
$function$;

-- vehicle_sale_price_untrusted: md5(pg_get_functiondef) c86d59bd086f693f201e7d6f2dc4d863 -- gitleaks:allow (verified MD5 of a SQL function definition, not a credential)
CREATE OR REPLACE FUNCTION public.vehicle_sale_price_untrusted(p_vehicle_id uuid, p_sale_price numeric)
 RETURNS boolean
 LANGUAGE sql
 STABLE PARALLEL SAFE
AS $function$
  select p_sale_price is not null and (
    (exists (select 1 from public.vehicle_events lt where lt.vehicle_id = p_vehicle_id
              and lt.final_price = p_sale_price and public.vehicle_event_low_trust(lt.id))
     and not exists (select 1 from public.vehicle_events ok where ok.vehicle_id = p_vehicle_id
              and ok.final_price = p_sale_price and not public.vehicle_event_low_trust(ok.id)
              and ok.sale_truth_role is distinct from 'duplicate'))
    or
    (exists (select 1 from public.vehicle_events ns where ns.vehicle_id = p_vehicle_id
              and ns.sale_outcome in ('bid_to','no_sale','withdrawn') and ns.final_price = p_sale_price)
     and not exists (select 1 from public.vehicle_events ok where ok.vehicle_id = p_vehicle_id
              and ok.final_price = p_sale_price and ok.sale_outcome = 'sold'))
    or
    exists (select 1 from public.vehicle_sale_price_untrusted_marks mk where mk.vehicle_id = p_vehicle_id
              and mk.retired_at is null and mk.sale_price = p_sale_price)
    or
    (exists (select 1 from public.vehicle_events pv where pv.vehicle_id = p_vehicle_id
              and (pv.price_verification in ('unverified','contradicted') or 'vehicle_id' = any(coalesce(pv.source_suspect, '{}')))
              and pv.final_price = p_sale_price)
     and not exists (select 1 from public.vehicle_events ok where ok.vehicle_id = p_vehicle_id
              and ok.final_price = p_sale_price and (ok.price_verification is null or ok.price_verification = 'verified')
              and ok.sale_truth_role is distinct from 'duplicate'
              and not ('vehicle_id' = any(coalesce(ok.source_suspect, '{}')))))
    or
    (exists (select 1 from public.vehicle_events pv where pv.vehicle_id = p_vehicle_id
              and pv.price_verification = 'verified' and pv.final_price <> p_sale_price
              and not ('vehicle_id' = any(coalesce(pv.source_suspect, '{}'))))
     and not exists (select 1 from public.vehicle_events ok where ok.vehicle_id = p_vehicle_id
              and ok.price_verification = 'verified' and ok.final_price = p_sale_price
              and not ('vehicle_id' = any(coalesce(ok.source_suspect, '{}')))))
  )
$function$;

-- vehicle_price_facts: md5(pg_get_functiondef) eb2c72355cb96c6b7f1604031581c13b -- gitleaks:allow (verified MD5 of a SQL function definition, not a credential)
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
           CASE WHEN public.vehicle_sale_price_untrusted(v.id, v.sale_price) THEN NULL ELSE coalesce(v.sale_price_usd, v.sale_price) END AS sale_price, v.bat_sold_price, v.sold_price, v.winning_bid, v.high_bid,
           v.asking_price, v.sale_date, v.bat_sale_date, v.listing_updated_at, v.listing_posted_at,
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
    SELECT v.*,
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
        AS f_ask_active
    FROM dated v
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
         WHEN f.f_ask_active AND f.f_ask IS NOT NULL  THEN COALESCE(f.listing_updated_at, f.listing_posted_at)
         WHEN f.f_bid IS NOT NULL                     THEN f.auction_end_on::timestamptz
         ELSE f.valuation_calculated_at
    END,
    f.f_live,
    f.f_sold_amount, f.f_sold_on, f.basis, f.f_sold_from,
    f.f_ask, CASE WHEN f.f_ask IS NOT NULL THEN COALESCE(f.listing_updated_at, f.listing_posted_at) END,
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
    f.canonical_platform, f.source_url
  FROM f;
$function$;
