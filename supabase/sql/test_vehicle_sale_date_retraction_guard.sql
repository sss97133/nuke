-- Isolated PostgreSQL 17 contract for 20261006234500_enforce_vehicle_sale_date_retraction.sql.
-- Synthetic rows and example.invalid URLs only; never production. Run in an empty disposable dm_refinement_* database:
--   createdb dm_refinement_sale_date_retraction_guard_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_refinement_sale_date_retraction_guard_ci -f supabase/sql/test_vehicle_sale_date_retraction_guard.sql
-- Fixture: the columns the guard, the producer and the writers touch (prod shape 2026-10-06), pipeline_registry as the
-- live table, the prod column comments, and four live bodies frozen verbatim (pg_get_functiondef, read 2026-10-06
-- 23:20Z; each fingerprint is asserted): correct_vehicle_sale_provenance_batch (the sanctioned writer),
-- auto_mark_vehicle_sold_from_external_listing (the producer, before this migration), flag_sale_date_ingest_stamp (the
-- other BEFORE trigger that reads sale_date) and fix_missing_sale_dates (a second re-landing path). The migration is
-- applied as shipped (\ir), twice.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%'
     OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_refinement_* database';
  END IF;
END $$;
SET statement_timeout = '30s';
SET lock_timeout = '3s';
SET TimeZone = 'UTC';
SET DateStyle = 'ISO, MDY';

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY,
  year integer, make text, model text, color text, interior_color text, msrp numeric, msrp_source text,
  sale_price integer, sale_status text, auction_outcome text, reserve_status text, high_bid integer, winning_bid integer,
  bat_sold_price numeric, sold_price integer, sale_date date, bat_sale_date date, auction_end_date text,
  bat_buyer text, bat_seller text, seller_name text, canonical_platform text, platform_source text, listing_kind text,
  bat_auction_url text, asking_price numeric, bid_count integer, auction_source text, bat_lot_number text,
  bat_bids integer, bat_views integer, bat_watchers integer,
  listing_url text, discovery_url text, platform_url text,
  provenance_metadata jsonb, data_quality_flags jsonb,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
COMMENT ON COLUMN public.vehicles.sale_date IS 'Date of sale if sold';
COMMENT ON COLUMN public.vehicles.provenance_metadata IS 'Full invocation chain as JSONB for complex cases';

CREATE TABLE public.external_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL, organization_id uuid, platform text NOT NULL, listing_url text NOT NULL,
  listing_status text NOT NULL, end_date timestamptz, current_bid numeric, bid_count integer DEFAULT 0,
  view_count integer DEFAULT 0, watcher_count integer DEFAULT 0, final_price numeric, sold_at timestamptz,
  metadata jsonb DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.organization_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL, vehicle_id uuid NOT NULL, relationship_type text NOT NULL,
  listing_status text DEFAULT 'for_sale', sale_date date, sale_price numeric, status text DEFAULT 'active',
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  UNIQUE (organization_id, vehicle_id, relationship_type)
);

CREATE TABLE public.bat_listings (vehicle_id uuid, listing_status text, sale_date date);
CREATE TABLE public.vehicle_observations (id uuid PRIMARY KEY, vehicle_id uuid, is_superseded boolean);

CREATE TABLE public.pipeline_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_name text NOT NULL, column_name text,
  owned_by text NOT NULL, description text NOT NULL, valid_values text[],
  do_not_write_directly boolean NOT NULL DEFAULT false, write_via text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (table_name, column_name)
);

-- ===== Frozen live bodies (verbatim) =====
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
    'asking_price','interior_color','color','bat_seller','seller_name'];
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
        WHEN 'bat_seller'         THEN v_veh.bat_seller
        WHEN 'seller_name'        THEN v_veh.seller_name
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
      bat_seller         = CASE WHEN v_set ? 'bat_seller'         THEN  v_set ->> 'bat_seller'                 ELSE bat_seller END,
      seller_name        = CASE WHEN v_set ? 'seller_name'        THEN  v_set ->> 'seller_name'                ELSE seller_name END,
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

CREATE OR REPLACE FUNCTION public.auto_mark_vehicle_sold_from_external_listing()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  affected_rows integer;
  sale_amount numeric;
  new_sale_date date;
begin
  -- Only process when listing_status is sold
  if new.listing_status = 'sold' and new.vehicle_id is not null then
    affected_rows := 0;
    sale_amount := coalesce(new.final_price, new.current_bid);
    new_sale_date := coalesce(new.sold_at::date, new.end_date::date, current_date);

    -- Update organization_vehicles for this vehicle and organization (best-effort)
    if new.organization_id is not null and to_regclass('public.organization_vehicles') is not null then
      insert into organization_vehicles (
        organization_id,
        vehicle_id,
        relationship_type,
        listing_status,
        sale_date,
        sale_price,
        status,
        updated_at
      )
      values (
        new.organization_id,
        new.vehicle_id,
        'sold_by',
        'sold',
        new_sale_date,
        sale_amount,
        'past',
        now()
      )
      on conflict (organization_id, vehicle_id, relationship_type)
      do update set
        listing_status = 'sold',
        -- Only advance the sale_date (guarded by the WHERE clause below)
        sale_date = coalesce(excluded.sale_date, organization_vehicles.sale_date),
        sale_price = coalesce(sale_amount, organization_vehicles.sale_price),
        status = 'past',
        updated_at = now()
      where organization_vehicles.sale_date is null or excluded.sale_date >= organization_vehicles.sale_date;
    end if;

    -- Update vehicles table sale fields + auction bid semantics
    update vehicles
    set
      sale_price = coalesce(sale_amount, vehicles.sale_price),
      sale_date = coalesce(new_sale_date, vehicles.sale_date),
      sale_status = 'sold',
      auction_outcome = 'sold',
      winning_bid = coalesce(sale_amount, vehicles.winning_bid),
      high_bid = coalesce(sale_amount, vehicles.high_bid),
      bid_count = coalesce(new.bid_count, vehicles.bid_count),
      auction_source = coalesce(new.platform, vehicles.auction_source),
      -- Keep legacy string cache aligned for older UI paths
      auction_end_date = coalesce(new.end_date::date::text, vehicles.auction_end_date),
      -- BaT cache fields (latest SOLD listing)
      bat_auction_url = case when new.platform = 'bat' then coalesce(new.listing_url, vehicles.bat_auction_url) else vehicles.bat_auction_url end,
      bat_lot_number = case when new.platform = 'bat' then coalesce(new.metadata->>'lot_number', vehicles.bat_lot_number) else vehicles.bat_lot_number end,
      bat_seller = case when new.platform = 'bat' then coalesce(new.metadata->>'seller_username', vehicles.bat_seller) else vehicles.bat_seller end,
      bat_buyer = case when new.platform = 'bat' then coalesce(new.metadata->>'buyer_username', vehicles.bat_buyer) else vehicles.bat_buyer end,
      reserve_status = case when new.platform = 'bat' then coalesce(new.metadata->>'reserve_status', vehicles.reserve_status) else vehicles.reserve_status end,
      bat_bids = case when new.platform = 'bat' then coalesce(new.bid_count, vehicles.bat_bids) else vehicles.bat_bids end,
      bat_views = case when new.platform = 'bat' then coalesce(new.view_count, vehicles.bat_views) else vehicles.bat_views end,
      bat_watchers = case when new.platform = 'bat' then coalesce(new.watcher_count, vehicles.bat_watchers) else vehicles.bat_watchers end,
      updated_at = now()
    where
      id = new.vehicle_id
      and (vehicles.sale_date is null or new_sale_date >= vehicles.sale_date);

    get diagnostics affected_rows = row_count;
    if affected_rows > 0 then
      raise notice 'Updated vehicle % sold cache from external listing % (platform=%)', new.vehicle_id, new.id, new.platform;
    end if;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.flag_sale_date_ingest_stamp()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_url      text;
  v_slug     text;
  v_url_year int;
BEGIN
  -- only consider rows carrying a sale_date that looks like an ingest-day stamp
  IF NEW.sale_date IS NULL
     OR NEW.sale_date < (now()::date - 3)
     OR NEW.sale_date > (now()::date + 3) THEN
    RETURN NEW;
  END IF;

  v_url := COALESCE(NEW.listing_url, NEW.discovery_url, NEW.platform_url, NEW.bat_auction_url);
  IF v_url IS NULL THEN
    RETURN NEW;
  END IF;

  -- first path segment after the domain = the auction event slug
  v_slug := (regexp_match(v_url, '^https?://[^/]+/([^/?#]+)'))[1];
  IF v_slug IS NULL THEN
    RETURN NEW;
  END IF;

  v_url_year := (regexp_match(v_slug, '((?:19|20)\d\d)'))[1]::int;

  IF v_url_year IS NOT NULL
     AND v_url_year < extract(year FROM NEW.sale_date)::int THEN
    NEW.data_quality_flags := COALESCE(NEW.data_quality_flags, '{}'::jsonb)
      || jsonb_build_object(
           'sale_date_ingest_stamp_suspect',
           jsonb_build_object(
             'flagged_at',      now(),
             'stamped_sale_date', NEW.sale_date,
             'url_event_year',  v_url_year,
             'event_slug',      v_slug,
             'detector',        'flag_sale_date_ingest_stamp',
             'remedy',          'correct_vehicle_sale_provenance'));
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fix_missing_sale_dates()
 RETURNS TABLE(vehicle_id uuid, sale_price numeric, sale_date date, source text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_vehicle RECORD;
  v_sale_date DATE;
  v_source TEXT;
BEGIN
  FOR v_vehicle IN
    SELECT 
      v.id,
      v.sale_price::NUMERIC,
      v.sale_date,
      v.bat_auction_url,
      bl.sale_date as bat_sale_date,
      el.sold_at as external_sold_at,
      el.final_price as external_final_price
    FROM vehicles v
    LEFT JOIN bat_listings bl ON bl.vehicle_id = v.id AND bl.listing_status = 'sold'
    LEFT JOIN external_listings el ON el.vehicle_id = v.id AND el.listing_status = 'sold'
    WHERE v.sale_price IS NOT NULL 
      AND v.sale_price > 0
      AND v.sale_date IS NULL
  LOOP
    -- Determine sale_date from available sources
    v_sale_date := COALESCE(
      v_vehicle.sale_date,
      v_vehicle.bat_sale_date,
      v_vehicle.external_sold_at::DATE
    );

    v_source := CASE
      WHEN v_vehicle.bat_sale_date IS NOT NULL THEN 'bat_listings'
      WHEN v_vehicle.external_sold_at IS NOT NULL THEN 'external_listings'
      ELSE 'unknown'
    END;

    -- Update if we found a date
    IF v_sale_date IS NOT NULL THEN
      UPDATE vehicles
      SET 
        sale_date = v_sale_date,
        updated_at = NOW()
      WHERE id = v_vehicle.id;
    END IF;

    RETURN QUERY SELECT 
      v_vehicle.id,
      v_vehicle.sale_price::NUMERIC,
      v_sale_date,
      v_source;
  END LOOP;
END;
$function$;

-- The live triggers that call two of the frozen bodies (pg_get_triggerdef, prod 2026-10-06).
CREATE TRIGGER trigger_auto_mark_vehicle_sold AFTER INSERT OR UPDATE OF listing_status, final_price, sold_at, end_date ON public.external_listings FOR EACH ROW WHEN ((new.listing_status = 'sold'::text)) EXECUTE FUNCTION auto_mark_vehicle_sold_from_external_listing();
CREATE TRIGGER trg_flag_sale_date_ingest_stamp BEFORE INSERT OR UPDATE OF sale_date, listing_url, discovery_url ON public.vehicles FOR EACH ROW EXECUTE FUNCTION flag_sale_date_ingest_stamp();

SELECT pg_temp.ok('fixture: frozen bodies reproduce the live fingerprints',
  md5(pg_get_functiondef('public.correct_vehicle_sale_provenance_batch(jsonb,text,text)'::regprocedure)) = '4ee3ef19667c1f3989c31c1cee2df186' -- gitleaks:allow (function fingerprint)
  AND md5(pg_get_functiondef('public.auto_mark_vehicle_sold_from_external_listing()'::regprocedure)) = '0e35eebd55832b86f7c8b4ae567806ca' -- gitleaks:allow (function fingerprint)
  AND md5(pg_get_functiondef('public.flag_sale_date_ingest_stamp()'::regprocedure)) = '5adbaec1eb094c41c46bdc24cb00a932' -- gitleaks:allow (function fingerprint)
  AND md5(pg_get_functiondef('public.fix_missing_sale_dates()'::regprocedure)) = '2c3bfb8dba827411ce7c6460c7bbd123'); -- gitleaks:allow (function fingerprint)

-- Listings first: the frozen producer fires on these inserts but finds no vehicle yet, as on prod after the fact.
-- a: created_at form (sold_at within 1 s of created_at); b: updated_at-only form; f: a real whole-second sale;
-- p: a write clock on a vehicle that already carries an earlier, real sale.
INSERT INTO public.external_listings (id, vehicle_id, platform, listing_url, listing_status, sold_at, end_date, final_price, bid_count, created_at, updated_at) VALUES
  ('e0000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'pcarmarket', 'https://example.invalid/auction/a', 'sold',
   '2026-02-13 10:17:46.824+00', NULL, 50000, 3, '2026-02-13 10:17:46.900+00', '2026-02-13 10:17:46.900+00'),
  ('e0000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'pcarmarket', 'https://example.invalid/auction/b', 'sold',
   '2026-02-26 21:04:11.337+00', NULL, 41000, 5, '2026-02-10 08:00:00+00', '2026-02-26 21:04:11.337+00'),
  ('e0000000-0000-0000-0000-00000000000f', '10000000-0000-0000-0000-00000000000f', 'bat', 'https://example.invalid/listing/f', 'sold',
   '2025-11-02 19:30:00+00', '2025-11-02 19:30:00+00', 30000, 40, '2025-11-03 06:00:00+00', '2025-11-03 06:00:00+00'),
  ('e0000000-0000-0000-0000-000000000019', '10000000-0000-0000-0000-000000000019', 'pcarmarket', 'https://example.invalid/auction/p', 'sold',
   '2026-02-13 07:05:00.874+00', NULL, 48000, 9, '2026-02-13 07:05:01.002+00', '2026-02-13 07:05:01.002+00');

-- Vehicles in their pre-retraction state.
INSERT INTO public.vehicles (id, sale_date, sale_price, sale_status, auction_outcome, auction_source, listing_url, provenance_metadata) VALUES
  ('10000000-0000-0000-0000-00000000000a', '2026-02-13', 50000, 'sold', 'sold', 'pcarmarket', 'https://example.invalid/auction/a', NULL),
  ('10000000-0000-0000-0000-00000000000b', '2026-02-26', 41000, 'sold', 'sold', 'pcarmarket', 'https://example.invalid/auction/b', NULL),
  ('10000000-0000-0000-0000-00000000000c', NULL,         NULL,  'sold', NULL,   NULL,         NULL, NULL),
  ('10000000-0000-0000-0000-00000000000d', '2026-02-11', NULL,  'sold', NULL,   NULL,         NULL, NULL),
  ('10000000-0000-0000-0000-00000000000e', '2026-02-14', NULL,  'sold', NULL,   NULL,         NULL, NULL),
  ('10000000-0000-0000-0000-00000000000f', NULL,         30000, 'sold', 'sold', 'bat',        'https://example.invalid/listing/f', NULL),
  ('10000000-0000-0000-0000-000000000010', NULL,         20000, 'sold', NULL,   NULL,         NULL, NULL),
  ('10000000-0000-0000-0000-000000000011', '2025-06-28', NULL,  'sold', NULL,   NULL,         NULL, NULL),
  ('10000000-0000-0000-0000-000000000012', '2026-02-12', NULL,  'sold', NULL,   NULL,         NULL, NULL),
  ('10000000-0000-0000-0000-000000000013', '2026-02-13', NULL,  'sold', NULL,   NULL,         NULL, NULL),
  ('10000000-0000-0000-0000-000000000014', current_date, NULL,  'sold', NULL,   NULL,         NULL, NULL),
  ('10000000-0000-0000-0000-000000000015', NULL,         NULL,  NULL,   NULL,   NULL,         'https://example.invalid/2019-spring-auction/lot-8', NULL),
  ('10000000-0000-0000-0000-000000000019', '2025-05-01', 61000, 'sold', 'sold', 'bat',        'https://example.invalid/listing/p0', NULL),
  ('10000000-0000-0000-0000-00000000001a', NULL,         NULL,  NULL,   NULL,   NULL,         NULL, '{"sale_provenance_corrections": {"not": "an array"}}'),
  ('10000000-0000-0000-0000-00000000001b', NULL,         NULL,  NULL,   NULL,   NULL,         NULL,
   '{"sale_provenance_corrections": ["x", 5, null, {"field": "sale_date", "original": "2026-02-13", "corrected": null, "source": "free text", "reason": "importer write clock", "asserted_by": "fixture-junk"}]}');

-- ===== Apply the migration as shipped =====
\ir ../migrations/20261006234500_enforce_vehicle_sale_date_retraction.sql

DO $$ DECLARE f text; BEGIN
  f := md5(pg_get_functiondef('public.auto_mark_vehicle_sold_from_external_listing()'::regprocedure));
  RAISE NOTICE 'post-migration producer fingerprint %', f;
  PERFORM pg_temp.ok('migration installs the expected producer body', f = '9c8f473e3b4b9ce2b21e96be6e6b7e35'); -- gitleaks:allow (function fingerprint)
END $$;

SELECT pg_temp.ok('trigger: BEFORE UPDATE OF sale_date with a WHEN clause',
  (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'trg_enforce_vehicle_sale_date_retraction')
    LIKE 'CREATE TRIGGER trg_enforce_vehicle_sale_date_retraction BEFORE UPDATE OF sale_date ON public.vehicles FOR EACH ROW WHEN (%');
SELECT pg_temp.ok('trigger: fires before trg_flag_sale_date_ingest_stamp (BEFORE triggers run in name order)',
  (SELECT array_agg(tgname::text ORDER BY tgname::text COLLATE "C") FROM pg_trigger
   WHERE tgrelid = 'public.vehicles'::regclass AND NOT tgisinternal AND (tgtype & 2) <> 0)
    = ARRAY['trg_enforce_vehicle_sale_date_retraction', 'trg_flag_sale_date_ingest_stamp']);

-- ===== Retractions through the sanctioned writer, with the guard installed (a retraction to NULL is never refused) =====
SELECT pg_temp.ok('writer retracts the V2-shape days (basis importer_write_clock) on six vehicles',
  (public.correct_vehicle_sale_provenance_batch($j$[
    {"vehicle_id": "10000000-0000-0000-0000-00000000000a", "corrections": {"sale_date": {"value": null, "expected": "2026-02-13"}},
     "source": {"type": "vehicle_events_write_clock", "basis": "importer_write_clock", "ref": "superseded_rows/f0000000-0000-0000-0000-00000000000a",
                "propagated_from": "external_listings/e0000000-0000-0000-0000-00000000000a", "write_clock": "2026-02-13 10:17:46.824+00"}},
    {"vehicle_id": "10000000-0000-0000-0000-00000000000b", "corrections": {"sale_date": {"value": null, "expected": "2026-02-26"}},
     "source": {"type": "vehicle_events_write_clock", "basis": "importer_write_clock", "ref": "superseded_rows/f0000000-0000-0000-0000-00000000000b",
                "propagated_from": "external_listings/e0000000-0000-0000-0000-00000000000b"}},
    {"vehicle_id": "10000000-0000-0000-0000-00000000000d", "corrections": {"sale_date": {"value": null, "expected": "2026-02-11"}},
     "source": {"type": "vehicle_events_write_clock", "basis": "importer_write_clock", "ref": "superseded_rows/f0000000-0000-0000-0000-00000000000d"}},
    {"vehicle_id": "10000000-0000-0000-0000-00000000000e", "corrections": {"sale_date": {"value": null, "expected": "2026-02-14"}},
     "source": {"type": "vehicle_events_write_clock", "basis": "importer_write_clock", "ref": "superseded_rows/f0000000-0000-0000-0000-00000000000e"}},
    {"vehicle_id": "10000000-0000-0000-0000-000000000012", "corrections": {"sale_date": {"value": null, "expected": "2026-02-12"}},
     "source": {"type": "vehicle_events_write_clock", "basis": "importer_write_clock", "ref": "superseded_rows/f0000000-0000-0000-0000-000000000012"}},
    {"vehicle_id": "10000000-0000-0000-0000-000000000013", "corrections": {"sale_date": {"value": null, "expected": "2026-02-13"}},
     "source": {"type": "vehicle_events_write_clock", "basis": "importer_write_clock", "ref": "superseded_rows/f0000000-0000-0000-0000-000000000013"}}
  ]$j$::jsonb, 'lane-v2-pcm-sale-date',
  'Retract vehicles.sale_date: it is the UTC day of the importer clock, copied onto the vehicle by trigger_auto_mark_vehicle_sold.')
   ->> 'vehicles_corrected')::int = 6);
SELECT pg_temp.ok('writer retracts a near-now day (V2 shape) on the flag-order vehicle',
  (public.correct_vehicle_sale_provenance_batch(jsonb_build_array(jsonb_build_object(
     'vehicle_id', '10000000-0000-0000-0000-000000000014',
     'corrections', jsonb_build_object('sale_date', jsonb_build_object('value', NULL, 'expected', to_char(current_date, 'YYYY-MM-DD'))),
     'source', jsonb_build_object('type', 'vehicle_events_write_clock', 'basis', 'importer_write_clock',
                                  'ref', 'superseded_rows/f0000000-0000-0000-0000-000000000014'))),
   'lane-v2-pcm-sale-date', 'Retract: importer clock.') ->> 'vehicles_corrected')::int = 1);
-- S2 shape: lane S landed the day from an episode, lane S2 retracted it; no basis key, the finding and reason name the clock.
SELECT pg_temp.ok('writer lands the S2-shape day from an episode (lane S)',
  (public.correct_vehicle_sale_provenance_batch($j$[
    {"vehicle_id": "10000000-0000-0000-0000-00000000000c", "corrections": {"sale_date": {"value": "2026-02-13", "expected": null}},
     "source": {"type": "vehicle_events", "ref": "vehicle_events/c0000000-0000-0000-0000-00000000000c", "date_basis": "pcarmarket end instant"},
     "reason": "Land the dated sale episode already retained in vehicle_events onto vehicles.sale_date."}]$j$::jsonb,
   'lane-s-land-sale-set') ->> 'vehicles_corrected')::int = 1);
SELECT pg_temp.ok('writer retracts the S2-shape day (no basis key; the finding and reason name the clock)',
  (public.correct_vehicle_sale_provenance_batch($j$[
    {"vehicle_id": "10000000-0000-0000-0000-00000000000c", "corrections": {"sale_date": {"value": null, "expected": "2026-02-13"}},
     "source": {"type": "vehicle_events", "ref": "vehicle_events/c0000000-0000-0000-0000-00000000000c",
                "finding": "vehicle_events.sold_at 2026-02-13 02:53:54.412+00 is a write clock: millisecond precision, 0 s from the episode row's created_at",
                "superseded_basis": "pcarmarket end instant (UTC day), lane S wave 1"},
     "reason": "Retract the sale_date landed by lane S wave 1: its source instant is the ingest write time, not the auction end. The sale day is unknown."}]$j$::jsonb,
   'lane-s2-pcm-retract') ->> 'vehicles_corrected')::int = 1);
-- A retraction that does not name a write clock (the bat-archive "no sale" shape): outside this guard.
SELECT pg_temp.ok('writer retracts a no-sale day (bat-archive shape)',
  (public.correct_vehicle_sale_provenance_batch($j$[
    {"vehicle_id": "10000000-0000-0000-0000-000000000011", "corrections": {"sale_date": {"value": null, "expected": "2025-06-28"}},
     "source": {"type": "bat", "ref": "https://example.invalid/listing/h", "method": "listings-filter catalog + lot page sale record; price: no sale",
                "detector": "archive lot view"},
     "reason": "BaT catalog + lot page truth"}]$j$::jsonb, 'bat-archive-fixture') ->> 'vehicles_corrected')::int = 1);
SELECT pg_temp.ok('every retracted vehicle reads NULL with its audit entry and no hit log',
  (SELECT count(*) = 10 AND bool_and(sale_date IS NULL) AND bool_and(NOT (provenance_metadata ? 'sale_date_lock_hits'))
   FROM public.vehicles WHERE provenance_metadata -> 'sale_provenance_corrections' @> '[{"field": "sale_date", "corrected": null}]'));

-- ===== Option B: the producer no longer copies a write-clock sold_at =====
-- created_at form: an update of final_price and bid_count re-fires the producer; the day stays NULL, the rest lands.
UPDATE public.external_listings SET final_price = 50500, bid_count = 7 WHERE id = 'e0000000-0000-0000-0000-00000000000a';
SELECT pg_temp.ok('B: write-clock listing (created_at form) leaves sale_date NULL; price and bid count land; nothing was attempted',
  (SELECT sale_date IS NULL AND sale_price = 50500 AND bid_count = 7 AND NOT (provenance_metadata ? 'sale_date_lock_hits')
   FROM public.vehicles WHERE id = '10000000-0000-0000-0000-00000000000a'));
-- updated_at-only form after a writer bumps updated_at: the clock matches OLD.updated_at only.
UPDATE public.external_listings SET final_price = 41500, updated_at = now() WHERE id = 'e0000000-0000-0000-0000-00000000000b';
SELECT pg_temp.ok('B: write clock matched against OLD.updated_at after the writer bumped updated_at',
  (SELECT sale_date IS NULL AND sale_price = 41500 AND NOT (provenance_metadata ? 'sale_date_lock_hits')
   FROM public.vehicles WHERE id = '10000000-0000-0000-0000-00000000000b'));
-- a dated vehicle: a write-clock listing no longer advances its sale cache (it used to overwrite day, price and source).
UPDATE public.external_listings SET bid_count = 10 WHERE id = 'e0000000-0000-0000-0000-000000000019';
UPDATE public.external_listings SET final_price = 48100 WHERE id = 'e0000000-0000-0000-0000-000000000019';
SELECT pg_temp.ok('B: a write-clock listing leaves a dated vehicle''s day, price and auction_source alone',
  (SELECT sale_date = '2025-05-01' AND sale_price = 61000 AND auction_source = 'bat'
   FROM public.vehicles WHERE id = '10000000-0000-0000-0000-000000000019'));

-- ===== Option A: every other writer is refused the retracted day =====
-- fix_missing_sale_dates() re-reads external_listings.sold_at for every NULL sale_date with a price (1,196 of the 1,231 on prod).
SELECT set_config('app.writer', 'fix-missing-sale-dates-contract', false);
SELECT pg_temp.ok('fix_missing_sale_dates walks the four priced vehicles without a day (one has no listing, so no date)',
  (SELECT count(*) = 4 FROM public.fix_missing_sale_dates()));
SELECT set_config('app.writer', '', false);
SELECT pg_temp.ok('A: the retracted created_at-form day is refused and recorded with the writer, the kept value and depth 1',
  (SELECT sale_date IS NULL
      AND jsonb_array_length(provenance_metadata -> 'sale_date_lock_hits') = 1
      AND provenance_metadata -> 'sale_date_lock_hits' -> 0 ->> 'blocked_day' = '2026-02-13'
      AND provenance_metadata -> 'sale_date_lock_hits' -> 0 -> 'kept' = 'null'::jsonb
      AND provenance_metadata -> 'sale_date_lock_hits' -> 0 ->> 'retraction_asserted_by' = 'lane-v2-pcm-sale-date'
      AND provenance_metadata -> 'sale_date_lock_hits' -> 0 ->> 'app_writer' = 'fix-missing-sale-dates-contract'
      AND (provenance_metadata -> 'sale_date_lock_hits' -> 0 ->> 'trigger_depth')::int = 1
      AND (provenance_metadata -> 'sale_date_lock_hits' -> 0 ->> 'at') IS NOT NULL
      AND jsonb_array_length(provenance_metadata -> 'sale_provenance_corrections') = 1
   FROM public.vehicles WHERE id = '10000000-0000-0000-0000-00000000000a'));
SELECT pg_temp.ok('A: the retracted updated_at-form day is refused too',
  (SELECT sale_date IS NULL AND provenance_metadata -> 'sale_date_lock_hits' -> 0 ->> 'blocked_day' = '2026-02-26'
   FROM public.vehicles WHERE id = '10000000-0000-0000-0000-00000000000b'));
SELECT pg_temp.ok('A: a vehicle without a retraction entry is untouched (fix_missing_sale_dates dates it)',
  (SELECT sale_date = '2025-11-02' AND provenance_metadata IS NULL
   FROM public.vehicles WHERE id = '10000000-0000-0000-0000-00000000000f'));

-- A different, later day passes; the retracted day is then refused against a non-NULL value too.
UPDATE public.vehicles SET sale_date = '2026-03-02' WHERE id = '10000000-0000-0000-0000-00000000000a';
SELECT pg_temp.ok('A: a different later day passes with no new hit',
  (SELECT sale_date = '2026-03-02' AND jsonb_array_length(provenance_metadata -> 'sale_date_lock_hits') = 1
   FROM public.vehicles WHERE id = '10000000-0000-0000-0000-00000000000a'));
UPDATE public.vehicles SET sale_date = '2026-02-13' WHERE id = '10000000-0000-0000-0000-00000000000a';
SELECT pg_temp.ok('A: the retracted day is refused against a dated row; the dated value is kept and recorded',
  (SELECT sale_date = '2026-03-02' AND jsonb_array_length(provenance_metadata -> 'sale_date_lock_hits') = 2
      AND provenance_metadata -> 'sale_date_lock_hits' -> 1 ->> 'kept' = '2026-03-02'
   FROM public.vehicles WHERE id = '10000000-0000-0000-0000-00000000000a'));
UPDATE public.vehicles SET sale_price = 50600 WHERE id = '10000000-0000-0000-0000-00000000000a';
SELECT pg_temp.ok('A: an update that does not name sale_date does not fire the guard',
  (SELECT sale_price = 50600 AND jsonb_array_length(provenance_metadata -> 'sale_date_lock_hits') = 2
   FROM public.vehicles WHERE id = '10000000-0000-0000-0000-00000000000a'));

-- S2 shape: a direct lander write, then the producer itself with a whole-second sold_at on the retracted day (depth 2).
UPDATE public.vehicles SET sale_date = '2026-02-13' WHERE id = '10000000-0000-0000-0000-00000000000c';
INSERT INTO public.external_listings (vehicle_id, platform, listing_url, listing_status, sold_at, final_price)
VALUES ('10000000-0000-0000-0000-00000000000c', 'pcarmarket', 'https://example.invalid/auction/c', 'sold', '2026-02-13 18:00:00+00', 39000);
SELECT pg_temp.ok('A: the S2-shape retraction (finding and reason name the clock) is enforced, against a lander and against the producer',
  (SELECT sale_date IS NULL AND sale_price = 39000
      AND jsonb_array_length(provenance_metadata -> 'sale_date_lock_hits') = 2
      AND provenance_metadata -> 'sale_date_lock_hits' -> 0 ->> 'retraction_asserted_by' = 'lane-s2-pcm-retract'
      AND (provenance_metadata -> 'sale_date_lock_hits' -> 0 ->> 'trigger_depth')::int = 1
      AND (provenance_metadata -> 'sale_date_lock_hits' -> 1 ->> 'trigger_depth')::int = 2
   FROM public.vehicles WHERE id = '10000000-0000-0000-0000-00000000000c'));

-- ===== The sanctioned writer =====
SELECT pg_temp.ok('writer: a cited restore of the retracted day passes',
  (public.correct_vehicle_sale_provenance_batch($j$[
    {"vehicle_id": "10000000-0000-0000-0000-00000000000d", "corrections": {"sale_date": {"value": "2026-02-11", "expected": null}},
     "source": {"type": "listing_page_snapshots", "ref": "listing_page_snapshots/d0000000-0000-0000-0000-00000000000d"},
     "reason": "The lot page states the sale day."}]$j$::jsonb, 'lane-fixture-restore') ->> 'vehicles_corrected')::int = 1);
SELECT pg_temp.ok('writer: the restored day is on the row with its audit entry and no hit',
  (SELECT sale_date = '2026-02-11' AND jsonb_array_length(provenance_metadata -> 'sale_provenance_corrections') = 2
          AND NOT (provenance_metadata ? 'sale_date_lock_hits')
   FROM public.vehicles WHERE id = '10000000-0000-0000-0000-00000000000d'));
SELECT pg_temp.ok('writer: a cited move to another day passes',
  (public.correct_vehicle_sale_provenance_batch($j$[
    {"vehicle_id": "10000000-0000-0000-0000-00000000000d", "corrections": {"sale_date": {"value": "2026-02-12", "expected": "2026-02-11"}},
     "source": {"type": "listing_page_snapshots", "ref": "listing_page_snapshots/d0000000-0000-0000-0000-0000000000d2"}}]$j$::jsonb,
   'lane-fixture-restore') ->> 'vehicles_corrected')::int = 1);
UPDATE public.vehicles SET sale_date = '2026-02-11' WHERE id = '10000000-0000-0000-0000-00000000000d';
SELECT pg_temp.ok('A: a later cited restore lifts the lock on that day (a lander may write it again)',
  (SELECT sale_date = '2026-02-11' AND NOT (provenance_metadata ? 'sale_date_lock_hits')
   FROM public.vehicles WHERE id = '10000000-0000-0000-0000-00000000000d'));
SELECT pg_temp.ok('writer: a second write-clock retraction of the day lands',
  (public.correct_vehicle_sale_provenance_batch($j$[
    {"vehicle_id": "10000000-0000-0000-0000-00000000000d", "corrections": {"sale_date": {"value": null, "expected": "2026-02-11"}},
     "source": {"type": "vehicle_events_write_clock", "basis": "importer_write_clock", "ref": "superseded_rows/f0000000-0000-0000-0000-0000000000d2"}}]$j$::jsonb,
   'lane-fixture-retract') ->> 'vehicles_corrected')::int = 1);
UPDATE public.vehicles SET sale_date = '2026-02-11' WHERE id = '10000000-0000-0000-0000-00000000000d';
SELECT pg_temp.ok('A: the latest word wins: a retraction after the restore locks the day again',
  (SELECT sale_date IS NULL AND jsonb_array_length(provenance_metadata -> 'sale_date_lock_hits') = 1
      AND provenance_metadata -> 'sale_date_lock_hits' -> 0 ->> 'retraction_asserted_by' = 'lane-fixture-retract'
   FROM public.vehicles WHERE id = '10000000-0000-0000-0000-00000000000d'));
-- The writer's flag alone (a cascade inside its transaction, no audit entry of its own) does not pass.
DO $$ BEGIN
  PERFORM set_config('nuke.bulk_sale_correction', 'on', true);
  UPDATE public.vehicles SET sale_date = '2026-02-14' WHERE id = '10000000-0000-0000-0000-00000000000e';
END $$;
SELECT pg_temp.ok('A: the writer''s flag without its own new audit entry for the day is refused',
  (SELECT sale_date IS NULL AND jsonb_array_length(provenance_metadata -> 'sale_date_lock_hits') = 1
   FROM public.vehicles WHERE id = '10000000-0000-0000-0000-00000000000e'));

-- ===== Rows the guard leaves alone =====
SELECT pg_temp.ok('writer corrects only sale_price on a vehicle (a corrections key without a sale_date entry)',
  (public.correct_vehicle_sale_provenance_batch($j$[
    {"vehicle_id": "10000000-0000-0000-0000-000000000010", "corrections": {"sale_price": {"value": 21000, "expected": 20000}},
     "source": {"type": "lot_page", "ref": "https://example.invalid/lot/g"}}]$j$::jsonb, 'lane-fixture') ->> 'vehicles_corrected')::int = 1);
UPDATE public.vehicles SET sale_date = '2026-01-05' WHERE id = '10000000-0000-0000-0000-000000000010';
SELECT pg_temp.ok('A: corrections for other fields only: a day lands, no hit log',
  (SELECT sale_date = '2026-01-05' AND NOT (provenance_metadata ? 'sale_date_lock_hits')
   FROM public.vehicles WHERE id = '10000000-0000-0000-0000-000000000010'));
UPDATE public.vehicles SET sale_date = '2025-06-28' WHERE id = '10000000-0000-0000-0000-000000000011';
SELECT pg_temp.ok('A: a retraction that names no write clock (no-sale shape) is outside this guard',
  (SELECT sale_date = '2025-06-28' AND NOT (provenance_metadata ? 'sale_date_lock_hits')
   FROM public.vehicles WHERE id = '10000000-0000-0000-0000-000000000011'));
UPDATE public.vehicles SET sale_date = '2026-02-13' WHERE id = '10000000-0000-0000-0000-00000000001a';
SELECT pg_temp.ok('A: never raises: a non-array corrections value is ignored and the day lands',
  (SELECT sale_date = '2026-02-13' FROM public.vehicles WHERE id = '10000000-0000-0000-0000-00000000001a'));
UPDATE public.vehicles SET sale_date = '2026-02-13' WHERE id = '10000000-0000-0000-0000-00000000001b';
SELECT pg_temp.ok('A: never raises: junk elements are skipped and the valid write-clock retraction among them holds',
  (SELECT sale_date IS NULL AND provenance_metadata -> 'sale_date_lock_hits' -> 0 ->> 'retraction_asserted_by' = 'fixture-junk'
   FROM public.vehicles WHERE id = '10000000-0000-0000-0000-00000000001b'));

-- ===== Hit log, wholesale writes, trigger order =====
DO $$ BEGIN
  FOR i IN 1..25 LOOP
    UPDATE public.vehicles SET sale_date = '2026-02-12' WHERE id = '10000000-0000-0000-0000-000000000012';
  END LOOP;
END $$;
SELECT pg_temp.ok('A: the hit log keeps the last 20',
  (SELECT sale_date IS NULL AND jsonb_array_length(provenance_metadata -> 'sale_date_lock_hits') = 20
   FROM public.vehicles WHERE id = '10000000-0000-0000-0000-000000000012'));
UPDATE public.vehicles SET sale_date = '2026-02-13', provenance_metadata = '{"source": "lander-x"}'
WHERE id = '10000000-0000-0000-0000-000000000013';
SELECT pg_temp.ok('A: a write that also replaces provenance_metadata: day refused, writer key kept, retraction record put back',
  (SELECT sale_date IS NULL AND provenance_metadata ->> 'source' = 'lander-x'
      AND jsonb_array_length(provenance_metadata -> 'sale_provenance_corrections') = 1
      AND jsonb_array_length(provenance_metadata -> 'sale_date_lock_hits') = 1
   FROM public.vehicles WHERE id = '10000000-0000-0000-0000-000000000013'));
UPDATE public.vehicles SET listing_url = 'https://example.invalid/2019-spring-auction/lot-7' WHERE id = '10000000-0000-0000-0000-000000000014';
UPDATE public.vehicles SET sale_date = current_date WHERE id = '10000000-0000-0000-0000-000000000014';
UPDATE public.vehicles SET sale_date = current_date WHERE id = '10000000-0000-0000-0000-000000000015';
SELECT pg_temp.ok('order: a refused near-now day is never seen by flag_sale_date_ingest_stamp; the same write on an unlocked row is flagged',
  (SELECT sale_date IS NULL AND data_quality_flags IS NULL AND jsonb_array_length(provenance_metadata -> 'sale_date_lock_hits') = 1
   FROM public.vehicles WHERE id = '10000000-0000-0000-0000-000000000014')
  AND (SELECT sale_date = current_date AND data_quality_flags ? 'sale_date_ingest_stamp_suspect'
       FROM public.vehicles WHERE id = '10000000-0000-0000-0000-000000000015'));

-- ===== Option B on insert, and the producer's unchanged paths =====
INSERT INTO public.vehicles (id) VALUES
  ('10000000-0000-0000-0000-000000000016'), ('10000000-0000-0000-0000-000000000017'), ('10000000-0000-0000-0000-000000000018');
INSERT INTO public.external_listings (vehicle_id, organization_id, platform, listing_url, listing_status, sold_at, end_date, final_price, created_at, updated_at) VALUES
  ('10000000-0000-0000-0000-000000000016', '0a000000-0000-0000-0000-000000000001', 'cars_and_bids', 'https://example.invalid/cab/m', 'sold',
   '2026-01-23 20:56:44.498+00', NULL, 27500, '2026-01-23 20:56:44.731+00', '2026-01-23 20:56:44.731+00'),
  ('10000000-0000-0000-0000-000000000017', '0a000000-0000-0000-0000-000000000001', 'bat', 'https://example.invalid/listing/n', 'sold',
   '2025-09-14 17:45:00+00', '2025-09-14 17:45:00+00', 52000, now(), now()),
  ('10000000-0000-0000-0000-000000000018', NULL, 'bonhams', 'https://example.invalid/lot/o', 'sold',
   NULL, '2025-08-16 00:00:00+00', 88000, now(), now());
SELECT pg_temp.ok('B: an inserted write-clock listing marks the vehicle and the organization row sold with no day',
  (SELECT sale_date IS NULL AND sale_status = 'sold' AND sale_price = 27500 AND auction_source = 'cars_and_bids'
   FROM public.vehicles WHERE id = '10000000-0000-0000-0000-000000000016')
  AND (SELECT sale_date IS NULL AND listing_status = 'sold' AND sale_price = 27500
       FROM public.organization_vehicles WHERE vehicle_id = '10000000-0000-0000-0000-000000000016'));
SELECT pg_temp.ok('B: unchanged: a whole-second sold_at dates the vehicle and the organization row',
  (SELECT sale_date = '2025-09-14' FROM public.vehicles WHERE id = '10000000-0000-0000-0000-000000000017')
  AND (SELECT sale_date = '2025-09-14' FROM public.organization_vehicles WHERE vehicle_id = '10000000-0000-0000-0000-000000000017'));
SELECT pg_temp.ok('B: unchanged: no sold_at falls back to the end_date day',
  (SELECT sale_date = '2025-08-16' FROM public.vehicles WHERE id = '10000000-0000-0000-0000-000000000018'));

-- ===== The rule names its mechanism =====
SELECT pg_temp.ok('registry: a vehicles.sale_date row names the trigger, its owner and the writer',
  (SELECT count(*) = 1
      AND bool_and(description LIKE '%trg_enforce_vehicle_sale_date_retraction%')
      AND bool_and(owned_by LIKE 'listing landers%')
      AND bool_and(write_via LIKE '%correct_vehicle_sale_provenance_batch%')
      AND bool_and(NOT do_not_write_directly)
   FROM public.pipeline_registry WHERE table_name = 'vehicles' AND column_name = 'sale_date'));
SELECT pg_temp.ok('comments: vehicles.sale_date keeps its text and names the trigger; provenance_metadata names both keys; external_listings.sold_at is described',
  col_description('public.vehicles'::regclass, (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.vehicles'::regclass AND attname = 'sale_date'))
    LIKE 'Date of sale if sold. Enforced by trg_enforce_vehicle_sale_date_retraction%'
  AND col_description('public.vehicles'::regclass, (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.vehicles'::regclass AND attname = 'provenance_metadata'))
    LIKE 'Full invocation chain as JSONB for complex cases. Keys: sale_provenance_corrections[]%sale_date_lock_hits[]%'
  AND col_description('public.external_listings'::regclass, (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.external_listings'::regclass AND attname = 'sold_at'))
    LIKE 'Sale instant as the listing''s lander stored it%auto_mark_vehicle_sold_from_external_listing%');
SELECT pg_temp.ok('comments: both functions and the trigger are described',
  obj_description('public.enforce_vehicle_sale_date_retraction()'::regprocedure, 'pg_proc') LIKE 'BEFORE UPDATE guard for vehicles.sale_date%'
  AND obj_description('public.auto_mark_vehicle_sold_from_external_listing()'::regprocedure, 'pg_proc') LIKE 'Marks vehicles as sold%write clock%'
  AND (SELECT obj_description(oid, 'pg_trigger') FROM pg_trigger WHERE tgname = 'trg_enforce_vehicle_sale_date_retraction') LIKE 'Keeps a sale day%');

-- ===== Idempotent re-apply; an existing registry row is appended to, never replaced =====
\ir ../migrations/20261006234500_enforce_vehicle_sale_date_retraction.sql
SELECT pg_temp.ok('re-apply: one trigger, the same producer body, every text names the trigger once',
  (SELECT count(*) = 1 FROM pg_trigger WHERE tgname = 'trg_enforce_vehicle_sale_date_retraction')
  AND md5(pg_get_functiondef('public.auto_mark_vehicle_sold_from_external_listing()'::regprocedure)) = '9c8f473e3b4b9ce2b21e96be6e6b7e35' -- gitleaks:allow (function fingerprint)
  AND (SELECT array_length(string_to_array(description, 'trg_enforce_vehicle_sale_date_retraction'), 1) = 2
       FROM public.pipeline_registry WHERE table_name = 'vehicles' AND column_name = 'sale_date')
  AND (SELECT bool_and(array_length(string_to_array(col_description(a.attrelid, a.attnum), 'trg_enforce_vehicle_sale_date_retraction'), 1) = 2)
       FROM pg_attribute a WHERE a.attrelid = 'public.vehicles'::regclass AND a.attname IN ('sale_date', 'provenance_metadata'))
  AND (SELECT array_length(string_to_array(col_description(a.attrelid, a.attnum), 'auto_mark_vehicle_sold_from_external_listing'), 1) = 2
       FROM pg_attribute a WHERE a.attrelid = 'public.external_listings'::regclass AND a.attname = 'sold_at'));
UPDATE public.pipeline_registry SET description = 'Prior owner text.' WHERE table_name = 'vehicles' AND column_name = 'sale_date';
\ir ../migrations/20261006234500_enforce_vehicle_sale_date_retraction.sql
SELECT pg_temp.ok('re-apply over an existing registry row appends the mechanism once and keeps the prior text',
  (SELECT description LIKE 'Prior owner text. Enforced by trg_enforce_vehicle_sale_date_retraction%'
      AND array_length(string_to_array(description, 'trg_enforce_vehicle_sale_date_retraction'), 1) = 2
   FROM public.pipeline_registry WHERE table_name = 'vehicles' AND column_name = 'sale_date'));
SELECT pg_temp.ok('after every scenario and both re-applies, no retracted day sits on a locked row',
  (SELECT count(*) = 0 FROM public.vehicles v
   WHERE v.id IN ('10000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000c',
                  '10000000-0000-0000-0000-00000000000e', '10000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000013')
     AND to_char(v.sale_date, 'YYYY-MM-DD') IN ('2026-02-13', '2026-02-26', '2026-02-14', '2026-02-12')));

-- ===== Drift guard: a producer body that is neither the live one nor this migration's is refused and left alone =====
CREATE OR REPLACE FUNCTION public.auto_mark_vehicle_sold_from_external_listing()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return new; -- drifted fixture
end;
$function$;
SELECT md5(pg_get_functiondef('public.auto_mark_vehicle_sold_from_external_listing()'::regprocedure)) AS drifted_fp \gset
UPDATE public.pipeline_registry SET description = 'Text before the refused apply.' WHERE table_name = 'vehicles' AND column_name = 'sale_date';
\echo The ERROR below is the drift guard of the migration refusing a drifted producer body: the expected result.
\set ON_ERROR_STOP off
\ir ../migrations/20261006234500_enforce_vehicle_sale_date_retraction.sql
\set ON_ERROR_STOP on
SELECT pg_temp.ok('drifted producer: migration refused whole, definition and registry text untouched',
  md5(pg_get_functiondef('public.auto_mark_vehicle_sold_from_external_listing()'::regprocedure)) = :'drifted_fp'
  AND (SELECT description = 'Text before the refused apply.' FROM public.pipeline_registry
       WHERE table_name = 'vehicles' AND column_name = 'sale_date'));

SELECT 'test_vehicle_sale_date_retraction_guard: all contracts passed' AS result;
