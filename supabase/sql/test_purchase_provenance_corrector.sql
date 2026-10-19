-- Isolated PostgreSQL 17 regression: synthetic rows only, never production data.
-- ALLOW_RAW_TESTIMONY_WRITE (fixture rows in a disposable local database, not the ledger)
-- Contract for 20261018040000_correct_vehicle_purchase_provenance.sql: purchase fields are corrected only with a
-- citation, honor the expected-value guard, clear with {"value": null}, skip a bare JSON null, refuse other columns,
-- check an owner_observation is a live observation of that vehicle, leave a cited audit entry, and apply twice.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() NOT LIKE 'dm_refinement_%'
   OR current_setting('server_version_num')::int / 10000 <> 17
   OR EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p','v','m')) THEN
 RAISE EXCEPTION 'Requires an empty disposable PG17 dm_refinement_* database'; END IF;
END $$;
SET statement_timeout='30s';
SET lock_timeout='3s';
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, purchase_price numeric, purchase_date date, purchase_location text,
  sale_price integer, provenance_metadata jsonb);
CREATE TABLE public.vehicle_observations(id uuid PRIMARY KEY, vehicle_id uuid, is_superseded boolean);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF; RAISE NOTICE 'PASS %', label;
END $$;

\ir ../migrations/20261018040000_correct_vehicle_purchase_provenance.sql
-- A second application is a no-op.
\ir ../migrations/20261018040000_correct_vehicle_purchase_provenance.sql

INSERT INTO public.vehicles VALUES
 ('00000000-0000-0000-0000-000000000001', 124000, NULL, NULL, 5, NULL),
 ('00000000-0000-0000-0000-000000000002', 4000, NULL, '35.9, -114.8', 5, NULL);
INSERT INTO public.vehicle_observations VALUES
 ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000002', false),
 ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000002', true);

-- 1. clear a price, cited by statement; the audit entry keeps the original
DO $$ DECLARE r jsonb; v public.vehicles; BEGIN
  r := public.correct_vehicle_purchase_provenance($j$[{"vehicle_id":"00000000-0000-0000-0000-000000000001",
    "source":{"type":"owner_statement","ref":"owner statement 2026-10-15"},
    "corrections":{"purchase_price":{"value":null,"expected":124000}}}]$j$::jsonb, 'contract', 'never priced');
  SELECT * INTO v FROM public.vehicles WHERE id='00000000-0000-0000-0000-000000000001';
  PERFORM pg_temp.ok('price cleared', v.purchase_price IS NULL AND (r->>'fields_corrected')::int = 1);
  PERFORM pg_temp.ok('audit keeps original and citation',
    (v.provenance_metadata->'purchase_provenance_corrections'->0->>'original')::numeric = 124000
    AND v.provenance_metadata->'purchase_provenance_corrections'->0->'source'->>'ref' = 'owner statement 2026-10-15');
END $$;

-- 2. all three fields via a live owner observation; sale fields untouched
DO $$ DECLARE r jsonb; v public.vehicles; BEGIN
  r := public.correct_vehicle_purchase_provenance($j$[{"vehicle_id":"00000000-0000-0000-0000-000000000002",
    "source":{"type":"owner_observation","observation_id":"00000000-0000-0000-0000-0000000000a1"},
    "corrections":{"purchase_price":{"value":3900,"expected":4000},"purchase_date":{"value":"2023-10-09"},
                   "purchase_location":{"value":"near Cottonwood, AZ"}}}]$j$::jsonb, 'contract', NULL);
  SELECT * INTO v FROM public.vehicles WHERE id='00000000-0000-0000-0000-000000000002';
  PERFORM pg_temp.ok('three fields set', v.purchase_price=3900 AND v.purchase_date='2023-10-09'
    AND v.purchase_location='near Cottonwood, AZ' AND v.sale_price=5 AND (r->>'fields_corrected')::int = 3);
  PERFORM pg_temp.ok('observation citation expanded to ref',
    v.provenance_metadata->'purchase_provenance_corrections'->0->'source'->>'ref' = 'vehicle_observations/00000000-0000-0000-0000-0000000000a1');
END $$;

-- 3. repeat is a no-op; a stale expectation is reported, not applied; a bare null is skipped
DO $$ DECLARE r jsonb; v public.vehicles; BEGIN
  r := public.correct_vehicle_purchase_provenance($j$[{"vehicle_id":"00000000-0000-0000-0000-000000000002",
    "source":{"ref":"x"},"corrections":{"purchase_price":{"value":3900},
    "purchase_date":{"value":"2024-01-01","expected":"2020-01-01"},"purchase_location":null}}]$j$::jsonb);
  SELECT * INTO v FROM public.vehicles WHERE id='00000000-0000-0000-0000-000000000002';
  PERFORM pg_temp.ok('noop, stale and skipped counted', (r->>'fields_noop')::int=1 AND jsonb_array_length(r->'stale')=1
    AND (r->>'fields_skipped_null_spec')::int=1 AND v.purchase_date='2023-10-09');
END $$;

-- 4. refusals and privileges
DO $$ BEGIN
  BEGIN PERFORM public.correct_vehicle_purchase_provenance('[{"vehicle_id":"00000000-0000-0000-0000-000000000002","source":{},"corrections":{"purchase_price":{"value":1}}}]'::jsonb);
    RAISE EXCEPTION 'uncited accepted';
  EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.ok('uncited refused', SQLERRM LIKE '%no source document%'); END;
  BEGIN PERFORM public.correct_vehicle_purchase_provenance('[{"vehicle_id":"00000000-0000-0000-0000-000000000002","source":{"ref":"x"},"corrections":{"sale_price":{"value":1}}}]'::jsonb);
    RAISE EXCEPTION 'field accepted';
  EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.ok('other column refused', SQLERRM LIKE '%unsupported field%'); END;
  BEGIN PERFORM public.correct_vehicle_purchase_provenance('[{"vehicle_id":"00000000-0000-0000-0000-000000000002","source":{"type":"owner_observation","observation_id":"00000000-0000-0000-0000-0000000000a2"},"corrections":{"purchase_price":{"value":1}}}]'::jsonb);
    RAISE EXCEPTION 'superseded accepted';
  EXCEPTION WHEN raise_exception THEN PERFORM pg_temp.ok('superseded observation refused', SQLERRM LIKE '%not a live observation%'); END;
  PERFORM pg_temp.ok('only service_role can execute',
    NOT has_function_privilege('anon','public.correct_vehicle_purchase_provenance(jsonb,text,text)','EXECUTE')
    AND has_function_privilege('service_role','public.correct_vehicle_purchase_provenance(jsonb,text,text)','EXECUTE'));
END $$;
