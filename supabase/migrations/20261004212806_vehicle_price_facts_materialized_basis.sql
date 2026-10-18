-- Evaluate the existing canonical price basis once; retain lazy legacy dates.
-- No sale rule, source population, result field, grant, row or job changes.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $guard$
DECLARE p record;
BEGIN
  SELECT prosrc,prosecdef,provolatile,proparallel,proconfig INTO STRICT p FROM pg_proc
  WHERE oid='public.vehicle_price_facts(uuid[])'::regprocedure;
  -- Exact old/new SHA-256 bytes in base64 allow a successful migration to retry safely.
  IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'base64')
    NOT IN ('6Cz7Q45wOGaCHhq61KWerYGKTsEf81bJ8Qd3gCmUzSU=','t/DRs757uqoso/uOsBZVf7ZUqSPR/owK2BXDbrG2gc0=')
    OR p.prosecdef IS DISTINCT FROM false OR p.provolatile IS DISTINCT FROM 's'
    OR p.proparallel IS DISTINCT FROM 'u'
    OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[] THEN
    RAISE EXCEPTION 'vehicle_price_facts differs from the reviewed invoker contract';
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.vehicle_price_facts(p_vehicle_ids uuid[])
RETURNS TABLE (
  vehicle_id          uuid,
  price_kind          text,         -- 'sold' | 'bid' | 'ask' | 'estimate' | NULL (nothing known)
  price_amount        numeric,
  price_as_of         timestamptz,  -- NULL while an auction is live (the bid is as of now)
  price_live          boolean,      -- true while an auction is running
  sold_amount         numeric,
  sold_on             date,
  sold_basis          text,         -- why it counts as sold: vehicle_sale_basis()
  sold_amount_from    text,         -- the column the amount came from
  ask_amount          numeric,
  ask_as_of           timestamptz,
  bid_amount          numeric,
  bid_on              date,
  bid_from            text,
  estimate_amount     numeric,
  estimate_confidence integer,
  estimate_as_of      timestamptz,
  outcome             text,
  platform            text,
  source_url          text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  -- Keep the canonical sale basis once per selected vehicle. The SQL helper
  -- returns all twenty fields, so folding this stage repeats its source rule.
  WITH v AS MATERIALIZED (
    SELECT v.id, v.sale_status, v.auction_outcome, v.reserve_status, v.sale_price, v.bat_sold_price, v.sold_price, v.winning_bid, v.high_bid,
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
$$;

-- CREATE OR REPLACE retains the existing owner, exact ACL and comment.
NOTIFY pgrst,'reload schema';
COMMIT;
