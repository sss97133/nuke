-- vehicle_price_facts() and vehicle_price(): one meaning per price fact, one reader.
-- Steps 1-2 of the vehicle price plan (Skylar, 2026-09-28: "go").
--
-- WHY (measured 2026-09-28 on 656,738 live vehicles): the price lives in six columns with overlapping
-- meanings. canonical_sold_price holds a sale, an ask or a high bid (its own comment says so) under a
-- name that says "sold": 299,611 of its 497,679 values are on cars that are not sold, 110,967 of them
-- equal to the ask. sale_price disagrees with price on 10,405 cars, winning_bid on 1,231, sold_price on
-- 242 and bat_sold_price on 30. 414,603 cars have two or more of the six filled.
--
-- WHAT: a read model that keeps the facts apart (sold, ask, bid, estimate, each with its date and the
-- column it came from) and gives one answer to "what is this car's price" as (kind, amount, as_of).
-- A sale is only a sale when vehicle_sale_basis() says so. No data changes; the only other change is
-- column comments that say what each column means and point readers here.
--
-- SCHEMA_LAW pre-mint checklist:
--  1. Search 2026-09-28: no vehicle_price* function exists. Nearest: canonical_sold_price (the mixed
--     column), vehicle_sale_basis() (the sold rule, reused), clean_vehicle_prices (the comps matview).
--  2. Not a fact class: a read model over existing columns.
--  3. Writes no testimony.  4. Functions only, zero storage.  5. Read-only.  6. No writers.
--  7. CI-applied. Web reader: EXECUTE granted to anon and authenticated explicitly (P0.4 rule).
--     SECURITY INVOKER, so row security decides which vehicles a caller sees (anon: public only).

SET statement_timeout = '60s';
SET lock_timeout = '10s';

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
  WITH v AS (
    SELECT v.id, v.sale_status, v.sale_price, v.bat_sold_price, v.sold_price, v.winning_bid, v.high_bid,
           v.asking_price, v.sale_date, v.bat_sale_date, v.listing_updated_at, v.listing_posted_at,
           v.nuke_estimate, v.nuke_estimate_confidence, v.valuation_calculated_at,
           v.canonical_outcome, v.canonical_platform,
           COALESCE(v.listing_url, v.bat_auction_url, v.platform_url) AS source_url,
           vehicle_sale_basis(v.sale_status, v.auction_outcome, v.canonical_platform, v.listing_url,
                              v.discovery_url, v.sale_price::numeric, v.notes, v.import_metadata,
                              v.created_at) AS basis,
           CASE WHEN v.auction_end_date ~ '^\d{4}-\d{2}-\d{2}' THEN left(v.auction_end_date, 10)::date END
             AS auction_end_on
    FROM vehicles v
    WHERE v.id = ANY (p_vehicle_ids)
      AND v.deleted_at IS NULL
  ),
  f AS (
    SELECT v.*,
      CASE WHEN v.basis IS NOT NULL THEN COALESCE(NULLIF(v.sale_price, 0)::numeric, NULLIF(v.bat_sold_price, 0)::numeric,
                                                  NULLIF(v.sold_price, 0)::numeric, NULLIF(v.winning_bid, 0)::numeric)
      END AS f_sold_amount,
      CASE WHEN v.basis IS NOT NULL THEN
        CASE WHEN v.sale_price > 0 THEN 'sale_price' WHEN v.bat_sold_price > 0 THEN 'bat_sold_price'
             WHEN v.sold_price > 0 THEN 'sold_price' WHEN v.winning_bid > 0 THEN 'winning_bid' END
      END AS f_sold_from,
      CASE WHEN v.basis IS NOT NULL THEN COALESCE(v.sale_date, v.bat_sale_date, v.auction_end_on) END AS f_sold_on,
      NULLIF(v.asking_price, 0) AS f_ask,
      COALESCE(NULLIF(v.high_bid, 0), NULLIF(v.winning_bid, 0))::numeric AS f_bid,
      CASE WHEN v.high_bid > 0 THEN 'high_bid' WHEN v.winning_bid > 0 THEN 'winning_bid' END AS f_bid_from,
      NULLIF(v.nuke_estimate, 0) AS f_estimate,
      COALESCE(v.sale_status = 'auction_live', false) AS f_live,
      COALESCE(v.sale_status, '') NOT IN ('sold', 'ended', 'not_sold', 'unsold', 'bid_to', 'auction_live', 'upcoming')
        AS f_ask_active
    FROM v
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
    f.canonical_outcome, f.canonical_platform, f.source_url
  FROM f;
$$;

COMMENT ON FUNCTION public.vehicle_price_facts(uuid[]) IS
  'The price facts of each vehicle, kept apart: sold (only when vehicle_sale_basis() says so), ask, bid and Nuke estimate, each with its date and source column; plus one answer (price_kind, price_amount, price_as_of, price_live) chosen sold > live bid > active ask > final bid > estimate. Read this instead of canonical_sold_price, price, sold_price, bat_sold_price or winning_bid. Row security applies. 2026-09-28.';

CREATE OR REPLACE FUNCTION public.vehicle_price(p_vehicle_id uuid)
RETURNS TABLE (kind text, amount numeric, as_of timestamptz, live boolean, source_url text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT price_kind, price_amount, price_as_of, price_live, source_url
  FROM public.vehicle_price_facts(ARRAY[p_vehicle_id]);
$$;

COMMENT ON FUNCTION public.vehicle_price(uuid) IS
  'One vehicle''s price as (kind, amount, as_of, live, source_url): kind is sold, bid, ask or estimate. See vehicle_price_facts(). 2026-09-28.';

REVOKE ALL ON FUNCTION public.vehicle_price_facts(uuid[]), public.vehicle_price(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_price_facts(uuid[]), public.vehicle_price(uuid)
  TO anon, authenticated, service_role;

-- What each price column means. Readers should use vehicle_price_facts() / vehicle_price().
COMMENT ON COLUMN public.vehicles.sale_price IS
  'Transaction amount. A sale only when vehicle_sale_basis() is not null (lock 1 refuses a price without a sold status). Written only through correct_vehicle_sale_provenance_batch. For display read vehicle_price().';
COMMENT ON COLUMN public.vehicles.canonical_sold_price IS
  'MIXED, despite its name: the sale if sold, else the ask, else the high bid (trg_resolve_canonical_columns). Not a sold price. Read vehicle_price_facts() instead; scheduled for retirement.';
COMMENT ON COLUMN public.vehicles.price IS
  'Legacy mixed value (an ask or a sale, set by older importers). Not a sold price. Read vehicle_price_facts() instead.';
COMMENT ON COLUMN public.vehicles.sold_price IS
  'Legacy copy of a hammer price from older importers. sale_price is authoritative when vehicle_sale_basis() says sold. Read vehicle_price_facts().';
COMMENT ON COLUMN public.vehicles.bat_sold_price IS
  'Bring a Trailer sale price as the BaT importer recorded it. sale_price is authoritative after the 2026-09-27 correction. Read vehicle_price_facts().';
COMMENT ON COLUMN public.vehicles.winning_bid IS
  'Final bid recorded by an importer; a sale only when vehicle_sale_basis() says sold. Read vehicle_price_facts().';
COMMENT ON COLUMN public.vehicles.high_bid IS
  'Highest bid seen: the live bid while sale_status = auction_live, the final bid on an unsold auction. Never a sale by itself.';
COMMENT ON COLUMN public.vehicles.asking_price IS
  'The seller''s ask, as of listing_updated_at (else listing_posted_at). An ask, not a sale.';
COMMENT ON COLUMN public.vehicles.nuke_estimate IS
  'Nuke''s own estimate; confidence in nuke_estimate_confidence, computed at valuation_calculated_at. Never a sale or an ask.';
