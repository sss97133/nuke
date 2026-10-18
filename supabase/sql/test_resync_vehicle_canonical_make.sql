-- Empty disposable PG17 dm_refinement_* database only; synthetic rows.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty disposable dm_refinement_* database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;

CREATE TABLE public.canonical_makes (id uuid PRIMARY KEY, canonical_name text, display_name text, aliases text[]);
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, make text, canonical_make_id uuid);
CREATE TABLE public.superseded_rows (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_table text, row_id uuid, row_data jsonb,
  superseded_at timestamptz DEFAULT now(), asserted_by text, source jsonb, reason text);
CREATE TABLE writer_seen (vehicle_id uuid, writer text);
CREATE FUNCTION public.record_writer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN INSERT INTO writer_seen VALUES (NEW.id, current_setting('app.writer', true)); RETURN NEW; END $$;
CREATE TRIGGER record_writer AFTER UPDATE ON public.vehicles FOR EACH ROW EXECUTE FUNCTION public.record_writer();

INSERT INTO public.canonical_makes VALUES
  ('a0000000-0000-0000-0000-000000000001', 'NISSAN', 'Nissan', ARRAY['datsun']),
  ('a0000000-0000-0000-0000-000000000002', 'DATSUN', 'Datsun', ARRAY[]::text[]),
  ('a0000000-0000-0000-0000-000000000003', 'FORD', 'Ford', ARRAY[]::text[]),
  ('a0000000-0000-0000-0000-000000000004', 'SHELBY', 'Shelby', ARRAY[]::text[]),
  ('a0000000-0000-0000-0000-000000000005', 'MERCEDES-BENZ', 'Mercedes-Benz', ARRAY['mercedes benz']);
INSERT INTO public.vehicles VALUES
  ('10000000-0000-0000-0000-000000000001', 'Datsun', 'a0000000-0000-0000-0000-000000000001'),  -- own row beats Nissan's alias
  ('10000000-0000-0000-0000-000000000002', 'Shelby', 'a0000000-0000-0000-0000-000000000003'),  -- Shelby filed under Ford
  ('10000000-0000-0000-0000-000000000003', 'ford',   NULL),                                    -- NULL though the make matches
  ('10000000-0000-0000-0000-000000000004', 'Mercedes Benz', 'a0000000-0000-0000-0000-000000000005'), -- alias, already right
  ('10000000-0000-0000-0000-000000000005', 'Acme Motor Works', 'a0000000-0000-0000-0000-000000000003'), -- unresolved make, id kept
  ('20000000-0000-0000-0000-000000000006', 'Datsun', 'a0000000-0000-0000-0000-000000000001');  -- outside the range

\ir ../migrations/20261019063000_resync_vehicle_canonical_make.sql
\ir ../migrations/20261019063000_resync_vehicle_canonical_make.sql

CREATE FUNCTION pg_temp.call(lo uuid, hi uuid, apply boolean) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('statement_timeout', '30s', true); RETURN public.resync_vehicle_canonical_make(lo, hi, apply); END $$;
CREATE FUNCTION pg_temp.check(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN ASSERT ok IS TRUE, label; END $$;

-- Refusals: a range over 1/64 of the space, and an inverted range.
DO $$ BEGIN
  BEGIN PERFORM pg_temp.call('00000000-0000-0000-0000-000000000000', '80000000-0000-0000-0000-000000000000', false);
        RAISE EXCEPTION 'expected refusal'; EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%1/64%' THEN RAISE; END IF; END;
  BEGIN PERFORM pg_temp.call('10000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001', false);
        RAISE EXCEPTION 'expected refusal'; EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%p_lo < p_hi%' THEN RAISE; END IF; END;
END $$;

-- Dry run reports and writes nothing.
CREATE TEMP TABLE d AS SELECT pg_temp.call('10000000-0000-0000-0000-000000000000', '10100000-0000-0000-0000-000000000000', false) AS out;
SELECT pg_temp.check((SELECT (out->>'read')::int = 5 AND (out->>'null_but_resolves')::int = 1 AND (out->>'other_make')::int = 2
                      AND (out->>'set_but_unresolved')::int = 1 AND (out->>'changed')::int = 0 FROM d), 'dry run counts');
SELECT pg_temp.check((SELECT count(*) FROM writer_seen) = 0 AND (SELECT count(*) FROM public.superseded_rows) = 0, 'dry run writes nothing');

-- Apply.
CREATE TEMP TABLE a AS SELECT pg_temp.call('10000000-0000-0000-0000-000000000000', '10100000-0000-0000-0000-000000000000', true) AS out;
SELECT pg_temp.check((SELECT (out->>'changed')::int FROM a) = 3, 'three rows re-resolved');
SELECT pg_temp.check((SELECT canonical_make_id FROM public.vehicles WHERE id='10000000-0000-0000-0000-000000000001') = 'a0000000-0000-0000-0000-000000000002', 'Datsun files as Datsun');
SELECT pg_temp.check((SELECT canonical_make_id FROM public.vehicles WHERE id='10000000-0000-0000-0000-000000000002') = 'a0000000-0000-0000-0000-000000000004', 'Shelby files as Shelby');
SELECT pg_temp.check((SELECT canonical_make_id FROM public.vehicles WHERE id='10000000-0000-0000-0000-000000000003') = 'a0000000-0000-0000-0000-000000000003', 'NULL filled case-insensitively');
SELECT pg_temp.check((SELECT canonical_make_id FROM public.vehicles WHERE id='10000000-0000-0000-0000-000000000005') = 'a0000000-0000-0000-0000-000000000003', 'unresolved make keeps its id');
SELECT pg_temp.check((SELECT canonical_make_id FROM public.vehicles WHERE id='20000000-0000-0000-0000-000000000006') = 'a0000000-0000-0000-0000-000000000001', 'outside the range untouched');
SELECT pg_temp.check((SELECT count(*) FROM public.superseded_rows WHERE asserted_by='resync_vehicle_canonical_make') = 3, 'prior ids kept');
SELECT pg_temp.check((SELECT bool_and(writer = 'resync_vehicle_canonical_make') FROM writer_seen), 'writer named');

-- Rerun changes nothing.
CREATE TEMP TABLE r AS SELECT pg_temp.call('10000000-0000-0000-0000-000000000000', '10100000-0000-0000-0000-000000000000', true) AS out;
SELECT pg_temp.check((SELECT (out->>'changed')::int FROM r) = 0, 'idempotent');

SELECT pg_temp.check(NOT has_function_privilege('anon', 'public.resync_vehicle_canonical_make(uuid,uuid,boolean)', 'EXECUTE'), 'anon cannot execute');
SELECT 'resync_vehicle_canonical_make contract passed' AS result;
