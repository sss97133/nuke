-- Isolated PostgreSQL 17 contract for trg_resolve_canonical_columns in 20261019030000_merge_carries_identity_unmerge_batch.sql.
-- Synthetic rows only; never production. Run in an empty, disposable dm_refinement_* database from the repo root.
-- resolve_platform_slug and vehicle_sale_basis are the live 2026-10-18 bodies; the trigger watches the live column list.
-- Proof: a listing_url write leaves a recorded 'sold' alone (2026-10-18: 5 legacy Mecum sales turned 'unknown' that way), while a
-- write that removes the sale evidence or brings a no-sale still recomputes, and the 2026-10-06 input cases still resolve.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '30s';
SET lock_timeout = '3s';
SET TimeZone = 'UTC';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

CREATE TABLE public.source_alias_mapping (raw_value text PRIMARY KEY, canonical_slug text);
CREATE TABLE public.vehicles (id text PRIMARY KEY, source text, listing_source text, discovery_source text, auction_source text,
  price numeric, asking_price numeric, sale_price numeric, sold_price numeric, purchase_price numeric, bat_sold_price numeric,
  high_bid numeric, winning_bid numeric, sale_status text, reserve_status text, auction_outcome text, listing_url text,
  discovery_url text, notes text, import_metadata jsonb, created_at timestamptz,
  canonical_platform text, canonical_outcome text, canonical_sold_price numeric);

CREATE FUNCTION public.resolve_platform_slug(raw text) RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $function$
  SELECT COALESCE(
    (SELECT canonical_slug FROM source_alias_mapping WHERE raw_value = raw),
    LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(raw, '[_\s]+', '-', 'g'), '[^a-z0-9-]', '', 'g')))
  );
$function$;
CREATE FUNCTION public.vehicle_sale_basis(p_sale_status text, p_auction_outcome text, p_canonical_platform text, p_listing_url text,
  p_discovery_url text, p_sale_price numeric, p_notes text, p_import_metadata jsonb, p_created_at timestamp with time zone)
 RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $function$
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
    WHEN p_auction_outcome IN ('reserve_not_met', 'no_sale')
      OR p_sale_status IN ('not_sold', 'unsold', 'bid_to')
      OR (plat = 'mecum' AND p_notes ~ 'Result: bid-goes-on')                                              THEN NULL
    WHEN p_sale_status = 'sold' OR p_auction_outcome = 'sold' THEN 'status'
    WHEN p_created_at >= '2026-09-27 00:00:00+00'::timestamptz THEN NULL
    WHEN plat = 'mecum'           AND p_sale_price > 0 AND p_notes ~ 'Result: sold'                       THEN 'mecum_sale_result'
    WHEN plat = 'cars-and-bids'   AND p_sale_price > 0 AND p_import_metadata->>'auction_status' = 'sold'  THEN 'cab_auction_status'
    WHEN plat = 'gooding'         AND p_sale_price > 0                                                    THEN 'gooding_sale_price'
    WHEN plat = 'barrett-jackson' AND p_sale_price > 0
         AND p_auction_outcome IS DISTINCT FROM 'no_sale' AND p_sale_status IS DISTINCT FROM 'not_sold'   THEN 'bj_result_price'
    WHEN plat = 'conceptcarz'     AND p_sale_price > 0 AND p_notes ~ '"status": "sold"'                   THEN 'conceptcarz_sold'
    ELSE NULL
  END
  FROM x;
$function$;

\i supabase/migrations/20261019030000_merge_carries_identity_unmerge_batch.sql

CREATE TRIGGER trg_resolve_canonical_columns BEFORE INSERT OR UPDATE OF source, listing_source, discovery_source, auction_source, price,
  asking_price, sale_price, sold_price, purchase_price, bat_sold_price, high_bid, winning_bid, sale_status, reserve_status,
  auction_outcome, listing_url, discovery_url, notes, import_metadata, created_at
  ON public.vehicles FOR EACH ROW EXECUTE FUNCTION public.trg_resolve_canonical_columns();

-- Legacy Mecum rows like the 5 of 2026-10-18: 'sold' stored by an earlier rule, sale_status 'available', a price, no notes.
INSERT INTO vehicles (id, source, sale_status, sale_price, high_bid, discovery_url, created_at) VALUES
  ('legacy_url', 'mecum', 'available', 27000, NULL, 'https://mecum.com/lots/393859/2011-chevrolet-camaro', '2026-02-10'),
  ('legacy_bids', 'mecum', 'available', 730000, 730000, 'https://mecum.com/lots/1152586/2009-slr', '2026-01-25'),
  ('legacy_bgo', 'mecum', 'available', 85000, NULL, 'https://mecum.com/lots/fl0125-494997/1964-pontiac', '2026-02-10'),
  ('legacy_status', 'mecum', 'available', 13000, NULL, 'https://mecum.com/lots/172992/2000-jaguar', '2026-02-10');
UPDATE vehicles SET canonical_outcome = 'sold';  -- canonical_outcome is not a watched column: the earlier rule's value stays
SELECT pg_temp.ok('fixture: four legacy rows hold a stored sold', count(*) = 4 AND bool_and(canonical_outcome = 'sold')) FROM vehicles;

UPDATE vehicles SET listing_url = 'https://www.mecum.com/lots/393859/2011-chevrolet-camaro/' WHERE id = 'legacy_url';
UPDATE vehicles SET listing_url = 'https://www.mecum.com/lots/1152586/2009-slr/' WHERE id = 'legacy_bids';
SELECT pg_temp.ok('a listing_url write keeps the recorded sale and its price',
  canonical_outcome = 'sold' AND canonical_sold_price = 27000) FROM vehicles WHERE id = 'legacy_url';
SELECT pg_temp.ok('a listing_url write on a row with bids keeps the recorded sale (old and new inputs both say ended)',
  canonical_outcome = 'sold' AND canonical_sold_price = 730000) FROM vehicles WHERE id = 'legacy_bids';

UPDATE vehicles SET sale_status = 'bid_to', high_bid = 85000, sale_price = NULL WHERE id = 'legacy_bgo';
SELECT pg_temp.ok('a no-sale status recomputes: bid-goes-on is reserve_not_met at the high bid',
  canonical_outcome = 'reserve_not_met' AND canonical_sold_price = 85000) FROM vehicles WHERE id = 'legacy_bgo';

UPDATE vehicles SET notes = 'Result: bid-goes-on' WHERE id = 'legacy_url';
SELECT pg_temp.ok('a contradicting no-sale note drops the sale even though the rule said unknown before and after',
  canonical_outcome = 'unknown') FROM vehicles WHERE id = 'legacy_url';

UPDATE vehicles SET sale_status = 'sold' WHERE id = 'legacy_status';
SELECT pg_temp.ok('a sold status resolves sold by status', canonical_outcome = 'sold' AND canonical_sold_price = 13000)
  FROM vehicles WHERE id = 'legacy_status';
UPDATE vehicles SET sale_status = 'available' WHERE id = 'legacy_status';
SELECT pg_temp.ok('removing the status that made the sale recomputes to unknown', canonical_outcome = 'unknown')
  FROM vehicles WHERE id = 'legacy_status';

-- The 2026-10-06 input cases: each changed input still recomputes (old and new inputs resolve differently).
INSERT INTO vehicles (id, source, sale_status, auction_outcome, listing_url, discovery_url, notes, import_metadata, created_at, sale_price, high_bid)
VALUES
 ('auction_outcome', 'bat', 'available', 'sold', NULL, NULL, NULL, NULL, '2026-09-29', 40000, 5000),
 ('listing_url', NULL, 'available', NULL, 'https://goodingco.com/lot/offline', NULL, NULL, NULL, '2026-01-01', 40000, NULL),
 ('discovery_url', NULL, 'available', NULL, NULL, 'https://goodingco.com/lot/offline', NULL, NULL, '2026-01-01', 40000, NULL),
 ('notes', 'mecum', 'available', NULL, NULL, NULL, 'Result: sold', NULL, '2026-01-01', 40000, NULL),
 ('import_metadata', 'cars-and-bids', 'available', NULL, NULL, NULL, NULL, '{"auction_status":"sold"}', '2026-01-01', 40000, NULL),
 ('created_at', 'gooding', 'available', NULL, NULL, NULL, NULL, NULL, '2026-01-01', 40000, NULL);
SELECT pg_temp.ok('six inputs resolve sold', count(*) = 6 AND bool_and(canonical_outcome = 'sold'))
  FROM vehicles WHERE id IN ('auction_outcome', 'listing_url', 'discovery_url', 'notes', 'import_metadata', 'created_at');
UPDATE vehicles SET auction_outcome = 'no_sale' WHERE id = 'auction_outcome';
UPDATE vehicles SET listing_url = 'https://example.com/offline' WHERE id = 'listing_url';
UPDATE vehicles SET discovery_url = 'https://example.com/offline' WHERE id = 'discovery_url';
UPDATE vehicles SET notes = 'Result: bid-goes-on' WHERE id = 'notes';
UPDATE vehicles SET import_metadata = '{"auction_status":"reserve_not_met"}' WHERE id = 'import_metadata';
UPDATE vehicles SET created_at = '2026-09-29' WHERE id = 'created_at';
SELECT pg_temp.ok(id || ' alone recomputes', canonical_outcome = CASE WHEN id = 'auction_outcome' THEN 'reserve_not_met' ELSE 'unknown' END)
  FROM vehicles WHERE id IN ('auction_outcome', 'listing_url', 'discovery_url', 'notes', 'import_metadata', 'created_at') ORDER BY id;

UPDATE vehicles SET canonical_outcome = 'offline-sentinel' WHERE id = 'notes';
UPDATE vehicles SET sale_status = sale_status WHERE id = 'notes';
SELECT pg_temp.ok('a watched no-op update still recomputes an outcome that is not sold', canonical_outcome = 'unknown')
  FROM vehicles WHERE id = 'notes';
INSERT INTO vehicles (id, source, sale_status, sale_price, created_at) VALUES ('insert_path', 'mecum', 'available', 5000, '2026-02-01');
SELECT pg_temp.ok('an insert is resolved from its own inputs only', canonical_outcome = 'unknown') FROM vehicles WHERE id = 'insert_path';
