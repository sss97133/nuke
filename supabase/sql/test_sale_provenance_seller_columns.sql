-- Isolated PostgreSQL 17 regression: synthetic rows and placeholder handles only, never production data.
-- Contract for migration 20261006101500_sale_provenance_allow_seller_columns.sql: the sale-provenance writer
-- can correct vehicles.bat_seller and vehicles.seller_name with the same citation rule, expected-value guard
-- and audit trail as every other allowed field, and the migration's drift guard sees the live fingerprint.
-- The frozen live writer below is a dependency fixture (its body as installed 2026-10-06), not a rule change.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT IN ('dm_sale_provenance_seller_ci')
   OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='auth')
   OR EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p','v','m')) THEN
 RAISE EXCEPTION 'Refusing fixtures outside isolated DB'; END IF;
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
  interior_color text, color text, provenance_metadata jsonb);
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY, vehicle_id uuid, is_superseded boolean);
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label;
END $$;

-- Frozen live writer (pg_get_functiondef as installed on 2026-10-06, verbatim) so the guard can match it.
CREATE OR REPLACE FUNCTION public.correct_vehicle_sale_provenance_batch(p_rows jsonb, p_asserted_by text DEFAULT 'agent'::text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_allowed CONSTANT text[] := ARRAY[
    'sale_price','sale_status','auction_outcome','reserve_status','high_bid','winning_bid',
    'bat_sold_price','sold_price','sale_date','bat_sale_date','auction_end_date','bat_buyer',
    'canonical_platform','msrp','msrp_source','listing_kind','year','make','model','bat_auction_url',
    'asking_price','interior_color','color'];
  c_numeric CONSTANT text[] := ARRAY['sale_price','high_bid','winning_bid','bat_sold_price','sold_price','msrp','year','asking_price'];
  c_date    CONSTANT text[] := ARRAY['sale_date','bat_sale_date'];
  v_row      jsonb;
  v_source   jsonb;
  v_id       uuid;
  v_veh      vehicles%ROWTYPE;
  v_field    text;
  v_spec     jsonb;
  v_orig     text;
  v_new      text;
  v_same     boolean;
  v_set      jsonb;
  v_audit    jsonb;
  v_vehicles int := 0;
  v_fields   int := 0;
  v_noop     int := 0;
  v_skipped  int := 0;
  v_stale    jsonb := '[]'::jsonb;
  v_missing  jsonb := '[]'::jsonb;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'correct_vehicle_sale_provenance_batch: p_rows must be a JSON array';
  END IF;

  PERFORM set_config('nuke.bulk_sale_correction', 'on', true);

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_id := (v_row ->> 'vehicle_id')::uuid;
    v_source := v_row -> 'source';
    -- owner testimony: a live observation of this vehicle, cited by id (who said it lives on that row)
    IF v_source ->> 'type' = 'owner_observation' THEN
      IF (v_source ->> 'observation_id') IS NULL OR NOT EXISTS (
           SELECT 1 FROM vehicle_observations o
           WHERE o.id = (v_source ->> 'observation_id')::uuid
             AND o.vehicle_id = v_id
             AND coalesce(o.is_superseded, false) = false) THEN
        RAISE EXCEPTION 'correct_vehicle_sale_provenance_batch: owner_observation % is not a live observation of vehicle %',
          v_source ->> 'observation_id', v_id;
      END IF;
      v_source := v_source || jsonb_build_object('ref', 'vehicle_observations/' || (v_source ->> 'observation_id'));
    END IF;
    IF v_source IS NULL OR v_source = '{}'::jsonb OR (v_source ->> 'ref') IS NULL THEN
      RAISE EXCEPTION 'correct_vehicle_sale_provenance_batch: vehicle % has no source document with a ref -- corrections must be cited, never guessed', v_id;
    END IF;
    IF v_row -> 'corrections' IS NULL OR jsonb_typeof(v_row -> 'corrections') <> 'object' THEN
      RAISE EXCEPTION 'correct_vehicle_sale_provenance_batch: vehicle % has no corrections object', v_id;
    END IF;

    SELECT * INTO v_veh FROM vehicles WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      v_missing := v_missing || jsonb_build_array(v_id);
      CONTINUE;
    END IF;

    v_set := '{}'::jsonb;
    v_audit := '[]'::jsonb;

    FOR v_field, v_spec IN SELECT key, value FROM jsonb_each(v_row -> 'corrections') LOOP
      -- a JSON null spec is "no proposal for this field" (2026-09-27 incident); clearing a column is
      -- said explicitly as {"value": null}. Anything else that is not an object is a caller bug.
      IF v_spec IS NULL OR jsonb_typeof(v_spec) = 'null' THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;
      IF jsonb_typeof(v_spec) <> 'object' THEN
        RAISE EXCEPTION 'correct_vehicle_sale_provenance_batch: vehicle % field % spec must be an object {value, expected?}, got %', v_id, v_field, jsonb_typeof(v_spec);
      END IF;
      IF NOT (v_field = ANY (c_allowed)) THEN
        RAISE EXCEPTION 'correct_vehicle_sale_provenance_batch: unsupported field % (supported: %)', v_field, array_to_string(c_allowed, ', ');
      END IF;

      v_orig := CASE v_field
        WHEN 'sale_price'         THEN v_veh.sale_price::text
        WHEN 'sale_status'        THEN v_veh.sale_status
        WHEN 'auction_outcome'    THEN v_veh.auction_outcome
        WHEN 'reserve_status'     THEN v_veh.reserve_status
        WHEN 'high_bid'           THEN v_veh.high_bid::text
        WHEN 'winning_bid'        THEN v_veh.winning_bid::text
        WHEN 'bat_sold_price'     THEN v_veh.bat_sold_price::text
        WHEN 'sold_price'         THEN v_veh.sold_price::text
        WHEN 'sale_date'          THEN v_veh.sale_date::text
        WHEN 'bat_sale_date'      THEN v_veh.bat_sale_date::text
        WHEN 'auction_end_date'   THEN v_veh.auction_end_date
        WHEN 'bat_buyer'          THEN v_veh.bat_buyer
        WHEN 'canonical_platform' THEN v_veh.canonical_platform
        WHEN 'msrp'               THEN v_veh.msrp::text
        WHEN 'msrp_source'        THEN v_veh.msrp_source
        WHEN 'listing_kind'       THEN v_veh.listing_kind
        WHEN 'year'               THEN v_veh.year::text
        WHEN 'make'               THEN v_veh.make
        WHEN 'model'              THEN v_veh.model
        WHEN 'bat_auction_url'    THEN v_veh.bat_auction_url
        WHEN 'asking_price'       THEN v_veh.asking_price::text
        WHEN 'interior_color'     THEN v_veh.interior_color
        WHEN 'color'              THEN v_veh.color
      END;
      v_new := v_spec ->> 'value';

      -- typed no-op / expectation checks (25000 = 25000.00; 2024-03-01 = 2024-03-01)
      v_same := CASE
        WHEN v_field = ANY (c_numeric) THEN v_orig::numeric IS NOT DISTINCT FROM v_new::numeric
        WHEN v_field = ANY (c_date)    THEN v_orig::date    IS NOT DISTINCT FROM v_new::date
        ELSE v_orig IS NOT DISTINCT FROM v_new END;
      IF v_same THEN
        v_noop := v_noop + 1;
        CONTINUE;
      END IF;

      IF v_spec ? 'expected' THEN
        IF NOT (CASE
          WHEN v_field = ANY (c_numeric) THEN v_orig::numeric IS NOT DISTINCT FROM (v_spec ->> 'expected')::numeric
          WHEN v_field = ANY (c_date)    THEN v_orig::date    IS NOT DISTINCT FROM (v_spec ->> 'expected')::date
          ELSE v_orig IS NOT DISTINCT FROM (v_spec ->> 'expected') END) THEN
          v_stale := v_stale || jsonb_build_array(jsonb_build_object(
            'vehicle_id', v_id, 'field', v_field, 'live', v_orig, 'expected', v_spec ->> 'expected', 'proposed', v_new));
          CONTINUE;
        END IF;
      END IF;

      v_set := v_set || jsonb_build_object(v_field, v_new);
      v_audit := v_audit || jsonb_build_array(jsonb_build_object(
        'field', v_field,
        'original', v_orig,
        'corrected', v_new,
        'source', v_source,
        'reason', COALESCE(v_row ->> 'reason', p_reason),
        'asserted_by', p_asserted_by,
        'asserted_at', now()));
    END LOOP;

    IF v_set = '{}'::jsonb THEN
      CONTINUE;
    END IF;

    -- one UPDATE per vehicle: every trigger on vehicles fires once, not once per field
    UPDATE vehicles SET
      sale_price         = CASE WHEN v_set ? 'sale_price'         THEN (v_set ->> 'sale_price')::integer      ELSE sale_price END,
      sale_status        = CASE WHEN v_set ? 'sale_status'        THEN  v_set ->> 'sale_status'                ELSE sale_status END,
      auction_outcome    = CASE WHEN v_set ? 'auction_outcome'    THEN  v_set ->> 'auction_outcome'            ELSE auction_outcome END,
      reserve_status     = CASE WHEN v_set ? 'reserve_status'     THEN  v_set ->> 'reserve_status'             ELSE reserve_status END,
      high_bid           = CASE WHEN v_set ? 'high_bid'           THEN (v_set ->> 'high_bid')::integer        ELSE high_bid END,
      winning_bid        = CASE WHEN v_set ? 'winning_bid'        THEN (v_set ->> 'winning_bid')::integer     ELSE winning_bid END,
      bat_sold_price     = CASE WHEN v_set ? 'bat_sold_price'     THEN (v_set ->> 'bat_sold_price')::numeric  ELSE bat_sold_price END,
      sold_price         = CASE WHEN v_set ? 'sold_price'         THEN (v_set ->> 'sold_price')::integer      ELSE sold_price END,
      sale_date          = CASE WHEN v_set ? 'sale_date'          THEN (v_set ->> 'sale_date')::date          ELSE sale_date END,
      bat_sale_date      = CASE WHEN v_set ? 'bat_sale_date'      THEN (v_set ->> 'bat_sale_date')::date      ELSE bat_sale_date END,
      auction_end_date   = CASE WHEN v_set ? 'auction_end_date'   THEN  v_set ->> 'auction_end_date'           ELSE auction_end_date END,
      bat_buyer          = CASE WHEN v_set ? 'bat_buyer'          THEN  v_set ->> 'bat_buyer'                  ELSE bat_buyer END,
      canonical_platform = CASE WHEN v_set ? 'canonical_platform' THEN  v_set ->> 'canonical_platform'         ELSE canonical_platform END,
      platform_source    = CASE WHEN v_set ? 'canonical_platform' THEN COALESCE(v_source ->> 'ref', 'correct_vehicle_sale_provenance') ELSE platform_source END,
      msrp               = CASE WHEN v_set ? 'msrp'               THEN (v_set ->> 'msrp')::numeric            ELSE msrp END,
      msrp_source        = CASE WHEN v_set ? 'msrp_source'        THEN  v_set ->> 'msrp_source'                ELSE msrp_source END,
      listing_kind       = CASE WHEN v_set ? 'listing_kind'       THEN  v_set ->> 'listing_kind'               ELSE listing_kind END,
      asking_price       = CASE WHEN v_set ? 'asking_price'       THEN (v_set ->> 'asking_price')::numeric    ELSE asking_price END,
      interior_color     = CASE WHEN v_set ? 'interior_color'     THEN  v_set ->> 'interior_color'             ELSE interior_color END,
      color              = CASE WHEN v_set ? 'color'              THEN  v_set ->> 'color'                      ELSE color END,
      provenance_metadata = COALESCE(provenance_metadata, '{}'::jsonb) || jsonb_build_object(
        'sale_provenance_corrections',
          COALESCE(provenance_metadata -> 'sale_provenance_corrections', '[]'::jsonb) || v_audit)
    WHERE id = v_id;

    -- identity / link columns in their own statement, only when one of them is corrected: triggers declared
    -- UPDATE OF year/make/model (duplicate detection, auto services, VIN checks) then fire for identity moves
    -- only, never for an ordinary sale correction (which lists none of these columns)
    IF v_set ?| ARRAY['year', 'make', 'model'] THEN
      UPDATE vehicles SET
        year  = CASE WHEN v_set ? 'year'  THEN (v_set ->> 'year')::integer ELSE year END,
        make  = CASE WHEN v_set ? 'make'  THEN  v_set ->> 'make'  ELSE make END,
        model = CASE WHEN v_set ? 'model' THEN  v_set ->> 'model' ELSE model END
      WHERE id = v_id;
    END IF;
    IF v_set ? 'bat_auction_url' THEN
      UPDATE vehicles SET bat_auction_url = v_set ->> 'bat_auction_url' WHERE id = v_id;
    END IF;

    v_vehicles := v_vehicles + 1;
    v_fields := v_fields + jsonb_array_length(v_audit);
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'vehicles_corrected', v_vehicles,
    'fields_corrected', v_fields,
    'fields_noop', v_noop,
    'fields_skipped_null_spec', v_skipped,
    'stale', v_stale,
    'missing', v_missing,
    'asserted_by', p_asserted_by);
END;
$function$;

DO $$ DECLARE f text; BEGIN
  f := md5(pg_get_functiondef('public.correct_vehicle_sale_provenance_batch(jsonb,text,text)'::regprocedure));
  RAISE NOTICE 'fixture fingerprint %', f;
  PERFORM pg_temp.ok('fixture reproduces the live fingerprint', f = '0279775cb71ebe2e5ba3afaec70112c0'); -- gitleaks:allow (fingerprint)
END $$;

\ir ../migrations/20261006101500_sale_provenance_allow_seller_columns.sql

DO $$ DECLARE f text; BEGIN
  f := md5(pg_get_functiondef('public.correct_vehicle_sale_provenance_batch(jsonb,text,text)'::regprocedure));
  RAISE NOTICE 'post-migration fingerprint %', f;
  PERFORM pg_temp.ok('migration installs the expected body', f = '4ee3ef19667c1f3989c31c1cee2df186'); -- gitleaks:allow (fingerprint)
END $$;

-- Re-running the migration is a no-op (the guard accepts the post-apply fingerprint).
\ir ../migrations/20261006101500_sale_provenance_allow_seller_columns.sql

INSERT INTO public.vehicles (id, year, make, model, bat_seller, bat_buyer, seller_name, sale_price, asking_price, sale_status, auction_outcome)
VALUES ('00000000-0000-0000-0000-000000000001', 1990, 'Make A', 'Model A', 'handle_b', 'handle_b', NULL, 10000, NULL, 'sold', 'sold'),
       ('00000000-0000-0000-0000-000000000002', 1991, 'Make B', 'Model B', 'handle_d', 'handle_d', NULL, 9000, NULL, 'sold', 'sold'),
       ('00000000-0000-0000-0000-000000000003', 1992, 'Make C', 'Model C', NULL, NULL, NULL, 19500, 19500, 'available', NULL);

-- 1. bat_seller: a cited correction whose expected value matches is applied and audited
DO $$ DECLARE r jsonb; v public.vehicles; a jsonb; BEGIN
  r := public.correct_vehicle_sale_provenance_batch($j$[
        {"vehicle_id":"00000000-0000-0000-0000-000000000001",
         "source":{"type":"lot_page","ref":"https://example.invalid/lot/1"},
         "corrections":{"bat_seller":{"value":"handle_a","expected":"handle_b"}}}]$j$::jsonb,
       'contract', 'row carried the buyer in bat_seller; lot page names the seller');
  SELECT * INTO v FROM public.vehicles WHERE id = '00000000-0000-0000-0000-000000000001';
  a := v.provenance_metadata -> 'sale_provenance_corrections' -> 0;
  PERFORM pg_temp.ok('bat_seller applied', v.bat_seller = 'handle_a');
  PERFORM pg_temp.ok('bat_buyer untouched', v.bat_buyer = 'handle_b');
  PERFORM pg_temp.ok('one field corrected', (r ->> 'fields_corrected')::int = 1 AND (r ->> 'vehicles_corrected')::int = 1);
  PERFORM pg_temp.ok('audit names field, original, corrected, source ref',
    a ->> 'field' = 'bat_seller' AND a ->> 'original' = 'handle_b' AND a ->> 'corrected' = 'handle_a'
    AND a -> 'source' ->> 'ref' = 'https://example.invalid/lot/1' AND a ->> 'asserted_by' = 'contract');
END $$;

-- 2. seller_name: same path, null -> value, both columns in one row
DO $$ DECLARE r jsonb; v public.vehicles; BEGIN
  r := public.correct_vehicle_sale_provenance_batch($j$[
        {"vehicle_id":"00000000-0000-0000-0000-000000000002",
         "source":{"type":"lot_page","ref":"https://example.invalid/lot/2"},
         "corrections":{"bat_seller":{"value":"handle_c","expected":"handle_d"},"seller_name":{"value":"handle_c"}}}]$j$::jsonb, 'contract');
  SELECT * INTO v FROM public.vehicles WHERE id = '00000000-0000-0000-0000-000000000002';
  PERFORM pg_temp.ok('bat_seller and seller_name applied together', v.bat_seller = 'handle_c' AND v.seller_name = 'handle_c');
  PERFORM pg_temp.ok('two fields audited', (r ->> 'fields_corrected')::int = 2
    AND jsonb_array_length(v.provenance_metadata -> 'sale_provenance_corrections') = 2);
END $$;

-- 3. expected mismatch: reported stale, nothing applied
DO $$ DECLARE r jsonb; v public.vehicles; BEGIN
  r := public.correct_vehicle_sale_provenance_batch($j$[
        {"vehicle_id":"00000000-0000-0000-0000-000000000001",
         "source":{"ref":"https://example.invalid/lot/1"},
         "corrections":{"bat_seller":{"value":"handle_x","expected":"handle_b"}}}]$j$::jsonb, 'contract');
  SELECT * INTO v FROM public.vehicles WHERE id = '00000000-0000-0000-0000-000000000001';
  PERFORM pg_temp.ok('stale correction not applied', v.bat_seller = 'handle_a');
  PERFORM pg_temp.ok('stale reported', jsonb_array_length(r -> 'stale') = 1 AND (r ->> 'fields_corrected')::int = 0);
END $$;

-- 4. a correction without a source ref is refused
DO $$ BEGIN
  BEGIN
    PERFORM public.correct_vehicle_sale_provenance_batch($j$[
        {"vehicle_id":"00000000-0000-0000-0000-000000000001","source":{},"corrections":{"bat_seller":{"value":"handle_x"}}}]$j$::jsonb, 'contract');
    RAISE EXCEPTION 'Contract failed: uncited correction was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%no source document with a ref%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS uncited correction refused';
  END;
END $$;

-- 5. fields outside the allowed list still raise (vin is identity, not sale provenance)
DO $$ BEGIN
  BEGIN
    PERFORM public.correct_vehicle_sale_provenance_batch($j$[
        {"vehicle_id":"00000000-0000-0000-0000-000000000001","source":{"ref":"https://example.invalid/lot/1"},"corrections":{"vin":{"value":"11111111111111111"}}}]$j$::jsonb, 'contract');
    RAISE EXCEPTION 'Contract failed: unsupported field was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%unsupported field vin%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS unsupported field refused';
  END;
END $$;

-- 6. regression: an explicit null still clears sale_price and leaves asking_price alone
DO $$ DECLARE r jsonb; v public.vehicles; BEGIN
  r := public.correct_vehicle_sale_provenance_batch($j$[
        {"vehicle_id":"00000000-0000-0000-0000-000000000003",
         "source":{"type":"listing","ref":"https://example.invalid/listing/3"},
         "corrections":{"sale_price":{"value":null,"expected":"19500"}}}]$j$::jsonb, 'contract');
  SELECT * INTO v FROM public.vehicles WHERE id = '00000000-0000-0000-0000-000000000003';
  PERFORM pg_temp.ok('explicit null clears sale_price', v.sale_price IS NULL AND v.asking_price = 19500);
END $$;

SELECT 'sale-provenance seller columns contract: all passed' AS result;
