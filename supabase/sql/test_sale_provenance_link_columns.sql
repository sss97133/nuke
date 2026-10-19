-- Isolated PostgreSQL 17 regression: synthetic rows and placeholder links only, never production data.
-- Contract for 20261015210000_sale_provenance_link_and_normalized_columns.sql: the sale-provenance writer corrects
-- vehicles.discovery_url, auction_source, normalized_model and normalized_series with the same citation rule,
-- expected-value guard and audit trail as every other allowed field; a hybrid row (a lot row carrying another car's
-- identity) is put back in one cited call; a normalized model written beside an identity correction survives the
-- model-normalizing trigger that keeps a stale value when the corrected model has no canonical match; the migration's
-- drift guard sees the live fingerprint and refuses a drifted body; it applies twice.
-- The live writer (helpers/correct_vehicle_sale_provenance_batch_live_20261015.sql) is a dependency fixture.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%'
   OR current_setting('server_version_num')::int / 10000 <> 17
   OR EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p','v','m')) THEN
 RAISE EXCEPTION 'Requires an empty disposable PG17 dm_refinement_* database'; END IF;
END $$;
SET statement_timeout='30s';
SET lock_timeout='3s';

-- Every column the writer reads (v_veh.<col>) or writes, nothing else.
CREATE TABLE public.vehicles(
  id uuid PRIMARY KEY,
  sale_price integer, sale_status text, auction_outcome text, reserve_status text,
  high_bid integer, winning_bid integer, bat_sold_price numeric, sold_price integer,
  sale_date date, bat_sale_date date, auction_end_date text,
  bat_buyer text, bat_seller text, seller_name text,
  canonical_platform text, platform_source text, msrp numeric, msrp_source text, listing_kind text,
  year integer, make text, model text, bat_auction_url text, asking_price numeric,
  interior_color text, color text, provenance_metadata jsonb,
  discovery_url text, auction_source text, normalized_model text, normalized_series text);
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY, vehicle_id uuid, is_superseded boolean);
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label;
END $$;

-- Stand-in for auto_normalize_vehicle_model (BEFORE INSERT OR UPDATE OF model, make, year): it sets the normalized
-- model only when the model has a canonical match ("corvette..." here) and otherwise keeps the old value, as live does.
CREATE FUNCTION public.auto_normalize_vehicle_model() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF lower(NEW.model) LIKE 'corvette%' THEN NEW.normalized_model := 'Corvette'; NEW.normalized_series := 'Corvette'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_auto_normalize_model BEFORE INSERT OR UPDATE OF model, make, year ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.auto_normalize_vehicle_model();

\ir helpers/correct_vehicle_sale_provenance_batch_live_20261015.sql
DO $$ DECLARE f text; BEGIN
  f := md5(pg_get_functiondef('public.correct_vehicle_sale_provenance_batch(jsonb,text,text)'::regprocedure));
  PERFORM pg_temp.ok('fixture reproduces the live fingerprint', f = '4ee3ef19667c1f3989c31c1cee2df186'); -- gitleaks:allow (fingerprint)
END $$;

\ir ../migrations/20261015210000_sale_provenance_link_and_normalized_columns.sql
DO $$ DECLARE f text; BEGIN
  f := md5(pg_get_functiondef('public.correct_vehicle_sale_provenance_batch(jsonb,text,text)'::regprocedure));
  PERFORM pg_temp.ok('migration installs the expected body', f = 'ba684423888b5fb3d2048b743d19abc7'); -- gitleaks:allow (fingerprint)
END $$;
-- A second application is a no-op that passes its own guard.
\ir ../migrations/20261015210000_sale_provenance_link_and_normalized_columns.sql

-- A hybrid row: its own lot is a BaT 1967 Chevrolet truck sold for $3,450; a Barrett-Jackson docket Corvette's model,
-- link, venue and normalized model sit on it.
INSERT INTO public.vehicles (id, year, make, model, sale_price, sale_status, bat_auction_url, discovery_url,
  auction_source, normalized_model, normalized_series)
VALUES ('00000000-0000-0000-0000-000000000001', 1967, 'Chevrolet', 'Corvette 427/435 Convertible', 3450, 'sold',
        'https://example.invalid/bat/1967-chevrolet-custom-sport-truck/', 'https://example.invalid/bj/docket/200665',
        'barrett-jackson', 'Corvette', 'Corvette'),
       ('00000000-0000-0000-0000-000000000002', 1967, 'Chevrolet', 'Chevelle', 16000, 'sold', NULL,
        'https://example.invalid/bj/docket/79129', 'barrett-jackson', 'Corvette', 'Corvette');

-- 1. The hybrid in one cited call: model back to its lot's, the foreign link and venue cleared, the normalized model
--    written beside the identity correction. The trigger keeps "Corvette" for a model without a canonical match, so
--    the cited normalized value must win.
DO $$ DECLARE r jsonb; v public.vehicles; BEGIN
  r := public.correct_vehicle_sale_provenance_batch($j$[
        {"vehicle_id":"00000000-0000-0000-0000-000000000001",
         "source":{"type":"lot_page","ref":"https://example.invalid/bat/1967-chevrolet-custom-sport-truck/"},
         "corrections":{"model":{"value":"Custom Sport Truck","expected":"Corvette 427/435 Convertible"},
                        "discovery_url":{"value":null,"expected":"https://example.invalid/bj/docket/200665"},
                        "auction_source":{"value":"bat","expected":"barrett-jackson"},
                        "normalized_model":{"value":"C/K","expected":"Corvette"},
                        "normalized_series":{"value":"C/K","expected":"Corvette"}}}]$j$::jsonb,
       'contract', 'the row is its BaT lot; the Corvette identity is a Barrett-Jackson docket car');
  SELECT * INTO v FROM public.vehicles WHERE id = '00000000-0000-0000-0000-000000000001';
  PERFORM pg_temp.ok('model back to the lot''s', v.model = 'Custom Sport Truck');
  PERFORM pg_temp.ok('foreign discovery_url cleared, venue back to bat', v.discovery_url IS NULL AND v.auction_source = 'bat');
  PERFORM pg_temp.ok('the cited normalized model survives the trigger', v.normalized_model = 'C/K' AND v.normalized_series = 'C/K');
  PERFORM pg_temp.ok('the lot''s own sale and link untouched', v.sale_price = 3450 AND v.bat_auction_url LIKE '%custom-sport-truck%');
  PERFORM pg_temp.ok('five fields corrected and audited with the source',
    (r ->> 'fields_corrected')::int = 5
    AND jsonb_array_length(v.provenance_metadata -> 'sale_provenance_corrections') = 5
    AND (SELECT bool_and(a -> 'source' ->> 'ref' LIKE '%custom-sport-truck%')
         FROM jsonb_array_elements(v.provenance_metadata -> 'sale_provenance_corrections') a));
  PERFORM pg_temp.ok('the cleared link is audited with its original',
    (SELECT a ->> 'original' FROM jsonb_array_elements(v.provenance_metadata -> 'sale_provenance_corrections') a
     WHERE a ->> 'field' = 'discovery_url') = 'https://example.invalid/bj/docket/200665');
END $$;

-- 2. Without the normalized fields, the trigger leaves the stale value: why the writer must carry them.
DO $$ DECLARE v public.vehicles; BEGIN
  PERFORM public.correct_vehicle_sale_provenance_batch($j$[
        {"vehicle_id":"00000000-0000-0000-0000-000000000002",
         "source":{"type":"lot_page","ref":"https://example.invalid/mecum/lots/132893/1967-chevrolet-chevelle"},
         "corrections":{"auction_source":{"value":"mecum","expected":"barrett-jackson"}}}]$j$::jsonb, 'contract');
  SELECT * INTO v FROM public.vehicles WHERE id = '00000000-0000-0000-0000-000000000002';
  PERFORM pg_temp.ok('a venue-only correction leaves the normalized model as it was', v.normalized_model = 'Corvette'
    AND v.auction_source = 'mecum' AND v.discovery_url = 'https://example.invalid/bj/docket/79129');
END $$;

-- 3. Expected mismatch on a link column: reported stale, nothing written.
DO $$ DECLARE r jsonb; v public.vehicles; BEGIN
  r := public.correct_vehicle_sale_provenance_batch($j$[
        {"vehicle_id":"00000000-0000-0000-0000-000000000002",
         "source":{"ref":"https://example.invalid/mecum/lots/132893/1967-chevrolet-chevelle"},
         "corrections":{"discovery_url":{"value":null,"expected":"https://example.invalid/somewhere-else"}}}]$j$::jsonb, 'contract');
  SELECT * INTO v FROM public.vehicles WHERE id = '00000000-0000-0000-0000-000000000002';
  PERFORM pg_temp.ok('stale link correction not applied, reported', v.discovery_url = 'https://example.invalid/bj/docket/79129'
    AND jsonb_array_length(r -> 'stale') = 1 AND (r ->> 'fields_corrected')::int = 0);
END $$;

-- 4. Uncited and unsupported corrections are still refused (vin keeps its own writer).
DO $$ BEGIN
  BEGIN
    PERFORM public.correct_vehicle_sale_provenance_batch($j$[
        {"vehicle_id":"00000000-0000-0000-0000-000000000002","source":{},"corrections":{"discovery_url":{"value":null}}}]$j$::jsonb, 'contract');
    RAISE EXCEPTION 'Contract failed: uncited correction was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%no source document with a ref%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS uncited link correction refused';
  END;
  BEGIN
    PERFORM public.correct_vehicle_sale_provenance_batch($j$[
        {"vehicle_id":"00000000-0000-0000-0000-000000000002","source":{"ref":"https://example.invalid/x"},"corrections":{"vin":{"value":"X"}}}]$j$::jsonb, 'contract');
    RAISE EXCEPTION 'Contract failed: vin was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%unsupported field vin%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS vin still refused here';
  END;
END $$;

-- 5. A drifted live body is refused by the guard.
CREATE OR REPLACE FUNCTION public.correct_vehicle_sale_provenance_batch(p_rows jsonb, p_asserted_by text DEFAULT 'agent'::text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE sql AS $f$ SELECT '{}'::jsonb $f$;
\set ON_ERROR_STOP off
\ir ../migrations/20261015210000_sale_provenance_link_and_normalized_columns.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok('a drifted body is not replaced',
  (SELECT prosrc FROM pg_proc WHERE proname = 'correct_vehicle_sale_provenance_batch') LIKE '%SELECT ''{}''::jsonb%');

SELECT 'sale-provenance link columns contract: all passed' AS result;
