-- Isolated PostgreSQL17 regression: synthetic rows only, never production intake.
-- Frozen live2026-10-05 resolver bodies reproduce the installed rule and its fingerprint.
-- They are a dependency fixture, not proof of any source sale/price or venue completeness.
-- Execute in an empty dm_refinement_canonical_inputs_ci database with no auth schema.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT IN ('dm_canonical_inputs_ci','dm_refinement_canonical_inputs_ci')
   OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='auth')
   OR EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p','v','m')) THEN
 RAISE EXCEPTION 'Refusing fixtures outside isolated DB'; END IF;
END $$;
SET statement_timeout='30s';
SET lock_timeout='3s';
CREATE TABLE public.source_alias_mapping(raw_value text PRIMARY KEY,canonical_slug text);
CREATE TABLE public.vehicles(id text PRIMARY KEY,source text,listing_source text,discovery_source text,auction_source text,
 price numeric,asking_price numeric,sale_price numeric,sold_price numeric,purchase_price numeric,bat_sold_price numeric,
 high_bid numeric,winning_bid numeric,sale_status text,reserve_status text,auction_outcome text,listing_url text,
 discovery_url text,notes text,import_metadata jsonb,created_at timestamptz,
 canonical_platform text,canonical_outcome text,canonical_sold_price numeric,fixture_note text);
CREATE FUNCTION pg_temp.ok(label text,condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %',label; END IF; RAISE NOTICE 'PASS %',label;
END $$;

CREATE OR REPLACE FUNCTION public.resolve_platform_slug(raw text)
 RETURNS text
 LANGUAGE sql
 STABLE PARALLEL SAFE
AS $function$
  SELECT COALESCE(
    (SELECT canonical_slug FROM source_alias_mapping WHERE raw_value = raw),
    -- Fallback: basic slug normalization (lowercase, trim, replace spaces/underscores with hyphens)
    LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(raw, '[_\s]+', '-', 'g'), '[^a-z0-9-]', '', 'g')))
  );
$function$
;
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
$function$
;
CREATE OR REPLACE FUNCTION public.trg_resolve_canonical_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  raw_source TEXT;
  best_price NUMERIC;
  price_type TEXT;
  sale_basis TEXT;
BEGIN
  -- 1. canonical_platform: resolve from first non-null source column
  raw_source := COALESCE(NEW.source, NEW.listing_source, NEW.discovery_source, NEW.auction_source);
  IF raw_source IS NOT NULL THEN
    NEW.canonical_platform := resolve_platform_slug(raw_source);
  ELSE
    NEW.canonical_platform := 'unknown';
  END IF;

  -- 2. canonical_outcome: a consummated sale is a STATUS, or (pre-2026-09-27 rows only) the
  --    platform's own sale marker. A price alone is a bid, an ask or an estimate
  --    (2026-09-27: 30,612 unsold BaT lots, 4,612 Mecum bid-goes-on lots, 6,155 Cars & Bids
  --    reserve-not-met lots and 82 RM Sotheby's low estimates were all sitting in sale_price).
  sale_basis := vehicle_sale_basis(NEW.sale_status, NEW.auction_outcome, NEW.canonical_platform,
                                   NEW.listing_url, NEW.discovery_url, NEW.sale_price::numeric,
                                   NEW.notes, NEW.import_metadata, NEW.created_at);
  IF sale_basis IS NOT NULL THEN
    NEW.canonical_outcome := 'sold';
  ELSIF NEW.sale_status IN ('not_sold', 'unsold', 'bid_to') OR NEW.reserve_status = 'reserve_not_met'
        OR NEW.auction_outcome IN ('reserve_not_met', 'no_sale') THEN
    NEW.canonical_outcome := 'reserve_not_met';
  ELSIF NEW.sale_status IN ('auction_live', 'upcoming') THEN
    NEW.canonical_outcome := 'active';
  ELSIF NEW.sale_status = 'for_sale' OR (COALESCE(NEW.asking_price, 0) > 0 AND COALESCE(NEW.sale_status, 'available') NOT IN ('ended')) THEN
    NEW.canonical_outcome := 'for_sale';
  ELSIF NEW.sale_status = 'ended' THEN
    NEW.canonical_outcome := 'ended';
  ELSIF NEW.sale_status = 'available' AND (COALESCE(NEW.high_bid, 0) > 0 OR COALESCE(NEW.winning_bid, 0) > 0) THEN
    -- Has bids but no sale price → auction ended without clear outcome
    NEW.canonical_outcome := 'ended';
  ELSE
    NEW.canonical_outcome := 'unknown';
  END IF;

  -- 3. canonical_sold_price: context-aware price resolution
  CASE NEW.canonical_outcome
    WHEN 'sold' THEN
      -- Transaction price priority: sale_price > winning_bid > bat_sold_price > sold_price > high_bid > price
      best_price := COALESCE(
        NULLIF(NEW.sale_price, 0)::NUMERIC,
        NULLIF(NEW.winning_bid, 0)::NUMERIC,
        NULLIF(NEW.bat_sold_price, 0),
        NULLIF(NEW.sold_price, 0)::NUMERIC,
        NULLIF(NEW.high_bid, 0)::NUMERIC,
        NULLIF(NEW.price, 0)::NUMERIC
      );
    WHEN 'for_sale' THEN
      -- Asking price priority
      best_price := COALESCE(
        NULLIF(NEW.asking_price, 0),
        NULLIF(NEW.price, 0)::NUMERIC
      );
    WHEN 'reserve_not_met' THEN
      -- Highest bid reached
      best_price := COALESCE(
        NULLIF(NEW.high_bid, 0)::NUMERIC,
        NULLIF(NEW.winning_bid, 0)::NUMERIC,
        NULLIF(NEW.bat_sold_price, 0),
        NULLIF(NEW.price, 0)::NUMERIC
      );
    ELSE
      -- Best available
      best_price := COALESCE(
        NULLIF(NEW.sale_price, 0)::NUMERIC,
        NULLIF(NEW.bat_sold_price, 0),
        NULLIF(NEW.sold_price, 0)::NUMERIC,
        NULLIF(NEW.winning_bid, 0)::NUMERIC,
        NULLIF(NEW.high_bid, 0)::NUMERIC,
        NULLIF(NEW.asking_price, 0),
        NULLIF(NEW.price, 0)::NUMERIC
      );
  END CASE;

  NEW.canonical_sold_price := best_price;

  RETURN NEW;
END;
$function$
;
CREATE TRIGGER trg_resolve_canonical_columns BEFORE INSERT OR UPDATE OF source, listing_source, discovery_source, auction_source, price, asking_price, sale_price, sold_price, purchase_price, bat_sold_price, high_bid, winning_bid, sale_status, reserve_status ON public.vehicles FOR EACH ROW EXECUTE FUNCTION public.trg_resolve_canonical_columns();

INSERT INTO public.vehicles(id,source,sale_status,auction_outcome,listing_url,discovery_url,notes,import_metadata,created_at,sale_price,high_bid)
VALUES
 ('auction_outcome','bat','available','sold',NULL,NULL,NULL,NULL,'2026-09-29',40000,5000),
 ('listing_url',NULL,'available',NULL,'https://goodingco.com/lot/offline',NULL,NULL,NULL,'2026-01-01',40000,NULL),
 ('discovery_url',NULL,'available',NULL,NULL,'https://goodingco.com/lot/offline',NULL,NULL,'2026-01-01',40000,NULL),
 ('notes','mecum','available',NULL,NULL,NULL,'Result: sold',NULL,'2026-01-01',40000,NULL),
 ('import_metadata','cars-and-bids','available',NULL,NULL,NULL,NULL,'{"auction_status":"sold"}','2026-01-01',40000,NULL),
 ('created_at','gooding','available',NULL,NULL,NULL,NULL,NULL,'2026-01-01',40000,NULL);

SELECT pg_temp.ok('six original inputs initially resolve sold',count(*)=6 AND bool_and(canonical_outcome='sold')) FROM public.vehicles;

UPDATE public.vehicles SET auction_outcome='no_sale' WHERE id='auction_outcome';
UPDATE public.vehicles SET listing_url='https://example.com/offline' WHERE id='listing_url';
UPDATE public.vehicles SET discovery_url='https://example.com/offline' WHERE id='discovery_url';
UPDATE public.vehicles SET notes='Result: bid-goes-on' WHERE id='notes';
UPDATE public.vehicles SET import_metadata='{"auction_status":"reserve_not_met"}' WHERE id='import_metadata';
UPDATE public.vehicles SET created_at='2026-09-29' WHERE id='created_at';

SELECT pg_temp.ok('old dependency list leaves each changed result stale',canonical_outcome='sold') FROM public.vehicles ORDER BY id;
CREATE TEMP TABLE prior_rows AS SELECT * FROM public.vehicles;
CREATE TEMP TABLE prior_properties AS SELECT oid,tgname,tgtype,tgenabled,tgfoid,tgnargs,tgargs,tgqual FROM pg_trigger WHERE tgrelid='public.vehicles'::regclass;
\ir ../migrations/20261005013500_canonical_trigger_input_dependencies.sql
-- Applying the actual guarded migration twice must preserve rows and trigger identity.
\ir ../migrations/20261005013500_canonical_trigger_input_dependencies.sql

SELECT pg_temp.ok('trigger replacement does not replay any rows',NOT EXISTS((SELECT * FROM prior_rows EXCEPT SELECT * FROM public.vehicles) UNION ALL (SELECT * FROM public.vehicles EXCEPT SELECT * FROM prior_rows)));
SELECT pg_temp.ok('trigger oid mode timing function and arguments retained',NOT EXISTS(SELECT * FROM prior_properties EXCEPT SELECT oid,tgname,tgtype,tgenabled,tgfoid,tgnargs,tgargs,tgqual FROM pg_trigger WHERE tgrelid='public.vehicles'::regclass));

UPDATE public.vehicles SET auction_outcome='no_sale' WHERE id='auction_outcome';
UPDATE public.vehicles SET listing_url='https://example.com/offline' WHERE id='listing_url';
UPDATE public.vehicles SET discovery_url='https://example.com/offline' WHERE id='discovery_url';
UPDATE public.vehicles SET notes='Result: bid-goes-on' WHERE id='notes';
UPDATE public.vehicles SET import_metadata='{"auction_status":"reserve_not_met"}' WHERE id='import_metadata';
UPDATE public.vehicles SET created_at='2026-09-29' WHERE id='created_at';

SELECT pg_temp.ok(id||' alone recomputes expected context',canonical_outcome=CASE WHEN id='auction_outcome' THEN 'reserve_not_met' ELSE 'unknown' END) FROM public.vehicles ORDER BY id;
SELECT pg_temp.ok('no-sale result selects existing bid priority',canonical_sold_price=5000) FROM public.vehicles WHERE id='auction_outcome';
UPDATE public.vehicles SET canonical_outcome='offline-sentinel' WHERE id='notes';
UPDATE public.vehicles SET fixture_note='unrelated update' WHERE id='notes';
SELECT pg_temp.ok('unrelated update does not invoke resolver',canonical_outcome='offline-sentinel') FROM public.vehicles WHERE id='notes';
UPDATE public.vehicles SET sale_status=sale_status WHERE id='notes';
SELECT pg_temp.ok('previous watched status update still invokes resolver',canonical_outcome='unknown') FROM public.vehicles WHERE id='notes';
