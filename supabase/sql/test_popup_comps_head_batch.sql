-- Disposable PG17 contract for 20261125234500_popup_comps_head_batch.sql (popup_vehicle_intel comps head batch).
-- Run: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_popup_comps_head -f supabase/sql/test_popup_comps_head_batch.sql
-- Installs the deployed 20261116054500 body, records its output as anon for each case vehicle, applies the new
-- migration (twice) and requires the same jsonb for every case, including the ones where the head batch of 48 is
-- not enough and the full pass must run. Helpers are production's definitions read 2026-11-25 (pg_get_functiondef):
-- vehicle_price_facts, vehicle_sale_basis, public_vehicles_by_model_year; the rest are stubs the cases do not reach.
-- Synthetic ids, dates and amounts only. Never run against the project DB.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable dm_refinement_* database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', current_user::text)
$$;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub', '')::uuid
$$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;

-- Live column types (information_schema, 2026-11-25) for every column the body and its helpers read.
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, uploaded_by uuid, make text, model text, year integer, mileage integer, is_public boolean,
  notes text, created_at timestamptz DEFAULT now(), sale_price integer, auction_end_date text, bat_auction_url text,
  bat_sold_price numeric, bat_sale_date date, discovery_url text, sale_status text, sale_date date, is_for_sale boolean,
  deleted_at timestamptz, import_metadata jsonb, asking_price numeric, user_id uuid, owner_id uuid,
  primary_image_url text, platform_url text, sold_price integer, auction_outcome text, high_bid integer,
  winning_bid integer, listing_url text, listing_posted_at timestamptz, listing_updated_at timestamptz,
  reserve_status text, listing_kind text, nuke_estimate numeric, nuke_estimate_confidence integer, deal_score numeric,
  heat_score numeric, valuation_calculated_at timestamptz, canonical_platform text, canonical_outcome text,
  sale_price_usd numeric
);
CREATE TABLE public.canonical_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), make text, canonical_model text, year_start integer, year_end integer,
  aliases text[]
);
CREATE TABLE public.make_model_profiles (
  subject_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), canonical_make text, canonical_model text, grain text,
  year_start integer, year_end integer, comparison_scope_status text, comparison_scope_basis text
);
CREATE TABLE public.vehicle_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid REFERENCES public.vehicles(id), kind text,
  source_comment_id uuid, content_text text, structured_data jsonb, confidence_score numeric, observed_at timestamptz,
  ingested_at timestamptz, agent_model text, extraction_method text, is_superseded boolean DEFAULT false,
  raw_source_ref text, extraction_metadata jsonb, source_url text
);
CREATE TABLE public.auction_events_canonical (id uuid PRIMARY KEY, vehicle_id uuid REFERENCES public.vehicles(id));
CREATE TABLE public.auction_comments (
  id uuid PRIMARY KEY, auction_event_id uuid, vehicle_id uuid REFERENCES public.vehicles(id), posted_at timestamptz,
  is_seller boolean, comment_type text, external_identity_id uuid, source_url text, comment_text text, bid_amount numeric
);
CREATE TABLE public.comment_claims_progress (
  comment_id uuid PRIMARY KEY, llm_processed boolean, extraction_version text, processed_at timestamptz
);
CREATE TABLE public.comment_discoveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid REFERENCES public.vehicles(id), raw_extraction jsonb,
  overall_sentiment text, sentiment_score numeric, comment_count integer, discovered_at timestamptz,
  model_used text, prompt_version text
);
CREATE TABLE public.description_discoveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid REFERENCES public.vehicles(id), raw_extraction jsonb,
  discovered_at timestamptz
);
CREATE TABLE public.vehicle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid REFERENCES public.vehicles(id), source_platform text,
  source_url text, event_type text, sold_at timestamptz, ended_at timestamptz, started_at timestamptz,
  final_price numeric, current_price numeric
);
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;

-- Stubs: no registry scope exists in this fixture, so cohort_scope_rule and cohort_members_public are never reached;
-- the cases exercise the same-year fallback (public_vehicles_by_model_year). The untrusted-price reader answers false.
CREATE FUNCTION public.cohort_scope_rule(p_subject_id uuid)
  RETURNS TABLE(canonical_make text, grain text, year integer, year_start integer, year_end integer, pattern text)
  LANGUAGE sql STABLE AS $$ SELECT NULL::text, NULL::text, NULL::int, NULL::int, NULL::int, NULL::text WHERE false $$;
CREATE FUNCTION public.cohort_members_public(p_subject_id uuid) RETURNS TABLE(vehicle_id uuid)
  LANGUAGE sql STABLE AS $$ SELECT NULL::uuid WHERE false $$;
CREATE FUNCTION public.vehicle_sale_price_untrusted_read(p_vehicle_id uuid) RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT false $$;

-- Production definitions.
CREATE OR REPLACE FUNCTION public.public_vehicles_by_model_year(p_make text, p_year integer, p_models text[])
 RETURNS TABLE(id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- p_models are lower-cased model names; a vehicle matches when lower(model) is one of them.
  -- EXECUTE with the values written in, on purpose: a SQL function (and a plpgsql statement after its fifth call) runs a
  -- generic plan, and the generic plan for this lookup does not know the year, so it read every year of the model through
  -- (lower(make), lower(model)). Ford Mustang 1966 on production: 18,729 buffers touched, 14,413 read, 6.6 s cold with the
  -- generic plan; 2,636 touched, 219 read, 144 ms cold with the values in the statement.
  RETURN QUERY EXECUTE format(
    'SELECT v.id FROM public.vehicles v
      WHERE lower(v.make) = lower(%L) AND v.year = %L::integer AND lower(v.model) = ANY (%L::text[])
        AND v.is_public AND v.deleted_at IS NULL',
    p_make, p_year, p_models);
END
$function$;

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
           v.asking_price, v.is_for_sale, v.discovery_url, v.sale_date, v.bat_sale_date, v.listing_updated_at, v.listing_posted_at,
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
        -- ask_needs_offer_v1: an asking price is the current offer only with a listing behind it (a source URL, the
        -- discovery URL a scraped classified was found at, or a listing clock) or the record marking the car for sale;
        -- an unsourced, undated amount stays ask_amount only.
        AND (v.source_url IS NOT NULL OR v.discovery_url IS NOT NULL
             OR v.listing_posted_at IS NOT NULL OR v.listing_updated_at IS NOT NULL
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


GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

-- The deployed body.
\ir ../migrations/20261116054500_popup_vehicle_intel_comment_provenance.sql
DO $$ BEGIN
  IF (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') FROM pg_proc
      WHERE oid = 'public.popup_vehicle_intel(uuid)'::regprocedure) <> 'Ien2B4Ar6p3Y5+5Ra4MiALsQngpf7jOqjcDGrhJzK9U=' THEN
    RAISE EXCEPTION 'fixture: the before body is not the deployed one';
  END IF;
END $$;

-- Cases. Each make is its own same-year cohort; the subject is a member with no sale of its own.
-- uid(c, n): a deterministic id per case and member, so ties on the sold date are broken by a known id order.
CREATE FUNCTION pg_temp.uid(c int, n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
  $$ SELECT (lpad(to_hex(c), 8, '0') || '-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid $$;
CREATE TABLE pg_temp.cases (c int PRIMARY KEY, make text, label text);
INSERT INTO pg_temp.cases VALUES
  (1, 'Alpha',   'A: 200 eligible, all sold: the head has 6'),
  (2, 'Bravo',   'B: 80 eligible, 45 newest unsold, ties at 46..52: the full pass runs'),
  (3, 'Charlie', 'C: exactly 48 eligible, 2 sold: the head is the whole cohort'),
  (4, 'Delta',   'D: exactly 49 eligible, the 3rd sale is the 49th: the full pass runs'),
  (5, 'Echo',    'E: a malformed auction_end_date on an unsold member: before raised, the head answers'),
  (6, 'Foxtrot', 'F: 60 eligible, ranks 47..52 share a date across position 48, 6th sale is 50: full pass'),
  (7, 'Golf',    'G: 100 eligible, ranks 47..52 share a date, sales 43..48 fill the head exactly');

-- A sold member: status sold, a sale date, a price. An unsold member: a legacy BaT row with a winning bid and a date
-- but no sale status, so vehicle_sale_basis is null (eligible, priced, filtered out).
CREATE FUNCTION pg_temp.member(c int, n int, d date, sold boolean, mk text, aed text DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.vehicles (id, make, model, year, is_public, created_at, sale_status, canonical_platform,
                               sale_date, auction_end_date, sale_price, winning_bid, mileage)
  VALUES (pg_temp.uid(c, n), mk, 'Coupe', 1970, true, '2026-01-01',
          CASE WHEN sold THEN 'sold' END, 'bat', d, aed,
          CASE WHEN sold THEN 10000 + n END, 9000 + n, 1000 + n)
$$;
SELECT pg_temp.member(1, n, date '2020-01-01' + n, true, 'Alpha') FROM generate_series(1, 200) n;
-- B: rank 1..45 newest and unsold; 46..48 sold; 49..52 share one date (ids order them), 49 and 51 sold; rest older sold.
SELECT pg_temp.member(2, n, date '2025-01-01' - n, false, 'Bravo') FROM generate_series(1, 45) n;
SELECT pg_temp.member(2, n, date '2025-01-01' - n, true, 'Bravo') FROM generate_series(46, 48) n;
SELECT pg_temp.member(2, n, date '2024-10-01', n IN (49, 51), 'Bravo') FROM generate_series(49, 52) n;
SELECT pg_temp.member(2, n, date '2024-01-01' - n, true, 'Bravo') FROM generate_series(53, 80) n;
-- C: 48 eligible, the 2 sold ones in the middle.
SELECT pg_temp.member(3, n, date '2025-01-01' - n, n IN (10, 30), 'Charlie') FROM generate_series(1, 48) n;
-- D: 49 eligible; sold at ranks 10, 30 and 49.
SELECT pg_temp.member(4, n, date '2025-01-01' - n, n IN (10, 30, 49), 'Delta') FROM generate_series(1, 49) n;
-- E: 20 sold members and one unsold member whose only date is a malformed auction_end_date.
SELECT pg_temp.member(5, n, date '2025-01-01' - n, true, 'Echo') FROM generate_series(1, 20) n;
SELECT pg_temp.member(5, 21, NULL, false, 'Echo', '2023-02-30 12:00');
-- F: 60 eligible; ranks 1..5 sold, 47..52 one date (ids order them) with 50 sold, the rest unsold.
SELECT pg_temp.member(6, n, CASE WHEN n BETWEEN 47 AND 52 THEN date '2024-06-01'
                                 WHEN n > 52 THEN date '2024-01-01' - n ELSE date '2025-01-01' - n END,
                      n <= 5 OR n = 50, 'Foxtrot') FROM generate_series(1, 60) n;
-- G: 100 eligible; ranks 1..42 unsold, 43..46 sold, 47..52 one date (ids order them) with 47, 48, 50 sold, rest sold.
SELECT pg_temp.member(7, n, CASE WHEN n BETWEEN 47 AND 52 THEN date '2024-06-01'
                                 WHEN n > 52 THEN date '2024-01-01' - n ELSE date '2025-01-01' - n END,
                      n BETWEEN 43 AND 48 OR n = 50 OR n > 52, 'Golf') FROM generate_series(1, 100) n;
-- Subjects: one per case, no sale of their own.
INSERT INTO public.vehicles (id, make, model, year, is_public)
SELECT pg_temp.uid(c, 0), make, 'Coupe', 1970, true FROM pg_temp.cases;

CREATE TABLE pg_temp.before (c int, doc jsonb);
DO $$
DECLARE r record; d jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  FOR r IN SELECT c FROM pg_temp.cases ORDER BY c LOOP
    BEGIN
      d := public.popup_vehicle_intel(pg_temp.uid(r.c, 0));
    EXCEPTION WHEN OTHERS THEN
      d := jsonb_build_object('error', SQLSTATE);
    END;
    INSERT INTO pg_temp.before VALUES (r.c, d);
  END LOOP;
END $$;

\ir ../migrations/20261125234500_popup_comps_head_batch.sql
\ir ../migrations/20261125234500_popup_comps_head_batch.sql

CREATE TABLE pg_temp.after (c int, doc jsonb);
GRANT ALL ON pg_temp.after, pg_temp.before, pg_temp.cases TO anon;
SET ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
DO $$
DECLARE r record; d jsonb;
BEGIN
  FOR r IN SELECT c FROM pg_temp.cases ORDER BY c LOOP
    BEGIN
      d := public.popup_vehicle_intel(pg_temp.uid(r.c, 0));
    EXCEPTION WHEN OTHERS THEN
      d := jsonb_build_object('error', SQLSTATE);
    END;
    INSERT INTO pg_temp.after VALUES (r.c, d);
  END LOOP;
END $$;
RESET ROLE;

-- Expected comps (member numbers, newest first), from the case design above.
CREATE TABLE pg_temp.expect (c int, members int[]);
INSERT INTO pg_temp.expect VALUES
  (1, ARRAY[200, 199, 198, 197, 196, 195]),
  (2, ARRAY[46, 47, 48, 49, 51, 53]),
  (3, ARRAY[10, 30]),
  (4, ARRAY[10, 30, 49]),
  (5, ARRAY[1, 2, 3, 4, 5, 6]),
  (6, ARRAY[1, 2, 3, 4, 5, 50]),
  (7, ARRAY[43, 44, 45, 46, 47, 48]);

DO $$
DECLARE r record; got int[]; fails int := 0;
BEGIN
  FOR r IN SELECT c.c, c.label, b.doc AS b, a.doc AS a, e.members
           FROM pg_temp.cases c JOIN pg_temp.before b USING (c) JOIN pg_temp.after a USING (c)
           JOIN pg_temp.expect e USING (c) ORDER BY c.c LOOP
    SELECT array_agg(('x' || right(x->>'id', 8))::bit(32)::int ORDER BY o) INTO got
      FROM jsonb_array_elements(r.a->'recent_comps') WITH ORDINALITY t(x, o);
    IF got IS DISTINCT FROM r.members THEN
      RAISE WARNING 'FAIL % : comps % expected %', r.label, got, r.members; fails := fails + 1;
    ELSIF r.b ? 'error' THEN
      RAISE NOTICE 'PASS % (before raised %, after answers)', r.label, r.b->>'error';
    ELSIF r.a IS DISTINCT FROM r.b THEN
      RAISE WARNING 'FAIL % : jsonb differs from the deployed body', r.label; fails := fails + 1;
    ELSE
      RAISE NOTICE 'PASS %', r.label;
    END IF;
  END LOOP;
  IF position('popup_comps_head_v1' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.popup_vehicle_intel(uuid)'::regprocedure)) = 0 THEN
    RAISE WARNING 'FAIL marker missing'; fails := fails + 1;
  END IF;
  IF NOT has_function_privilege('anon', 'public.popup_vehicle_intel(uuid)', 'EXECUTE') THEN
    RAISE WARNING 'FAIL anon lost EXECUTE'; fails := fails + 1;
  END IF;
  IF fails > 0 THEN RAISE EXCEPTION 'popup_comps_head: % failure(s)', fails; END IF;
END $$;

-- The guard refuses a body it does not know.
CREATE OR REPLACE FUNCTION public.popup_vehicle_intel(p_vehicle_id uuid) RETURNS jsonb LANGUAGE sql STABLE
  AS $$ SELECT '{}'::jsonb $$;
\set ON_ERROR_STOP off
\ir ../migrations/20261125234500_popup_comps_head_batch.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.popup_vehicle_intel(uuid)'::regprocedure) NOT LIKE '%''{}''::jsonb%' THEN
    RAISE EXCEPTION 'FAIL guard replaced an unknown body';
  END IF;
  RAISE NOTICE 'PASS guard refuses an unknown body';
END $$;

-- The revert restores the deployed body.
\ir revert_20261125234500_popup_comps_head_batch.sql
DO $$ BEGIN
  IF (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'base64') FROM pg_proc
      WHERE oid = 'public.popup_vehicle_intel(uuid)'::regprocedure) <> 'Ien2B4Ar6p3Y5+5Ra4MiALsQngpf7jOqjcDGrhJzK9U=' THEN
    RAISE EXCEPTION 'FAIL revert did not restore the deployed body';
  END IF;
  RAISE NOTICE 'PASS revert restores the deployed body';
END $$;
SELECT 'popup_comps_head: ok' AS result;
