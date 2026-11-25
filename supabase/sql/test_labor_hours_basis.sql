-- Disposable PG17: labor_hours_basis_v1. Every book row keeps its hours and reads basis uncited_seed; a row can claim
-- shop_paper or corpus_reported only with a citation row; removing that citation under the basis is refused; a second
-- apply is a no-op; anon reads the basis table and cannot read or write citations. Synthetic rows only.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_%' THEN RAISE EXCEPTION 'Requires disposable dm_refinement_* database'; END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;
CREATE FUNCTION pg_temp.refused(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  BEGIN
    EXECUTE stmt;
    SET CONSTRAINTS ALL IMMEDIATE;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS %', label; RETURN;
  END;
  RAISE EXCEPTION 'Contract failed: % (not refused)', label;
END $$;

-- guardrail-allow(center-key-fk): vehicle_observations.id: synthetic fixture table in a disposable test database
CREATE TABLE public.vehicle_observations (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.receipt_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.service_manual_chunks (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.stage_transition_labor_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), from_stage text, to_stage text,
  estimated_hours_min numeric, estimated_hours_typical numeric, estimated_hours_max numeric);
CREATE TABLE public.labor_operations (code text PRIMARY KEY, base_hours numeric);
INSERT INTO public.stage_transition_labor_map (id, from_stage, to_stage, estimated_hours_min, estimated_hours_typical, estimated_hours_max)
VALUES ('00000000-0000-0000-0000-00000000000a', 'primer', 'base_coat', 3, 5, 8),
       ('00000000-0000-0000-0000-00000000000b', 'base_coat', 'clear_coat', 2, 4, 6);
INSERT INTO public.labor_operations (code, base_hours) VALUES ('OP1', 2.5), ('OP2', NULL);
INSERT INTO public.receipt_items (id) VALUES ('00000000-0000-0000-0000-0000000000c1');
CREATE TEMP TABLE hours_before AS
  SELECT id::text k, estimated_hours_min a, estimated_hours_typical b, estimated_hours_max c FROM public.stage_transition_labor_map
  UNION ALL SELECT code, base_hours, NULL, NULL FROM public.labor_operations;

\ir ../migrations/20261125141500_labor_hours_basis.sql
\ir ../migrations/20261125141500_labor_hours_basis.sql

DO $$ BEGIN
  PERFORM pg_temp.ok('three bases, ranked shop_paper < corpus_reported < uncited_seed', (
    SELECT array_agg(basis_key ORDER BY rank) = ARRAY['shop_paper', 'corpus_reported', 'uncited_seed'] FROM public.labor_hours_bases));
  PERFORM pg_temp.ok('every existing row reads uncited_seed', (
    SELECT bool_and(hours_basis = 'uncited_seed') FROM public.stage_transition_labor_map)
    AND (SELECT bool_and(hours_basis = 'uncited_seed') FROM public.labor_operations));
  PERFORM pg_temp.ok('no hour changed or nulled', NOT EXISTS (
    (SELECT * FROM hours_before) EXCEPT
    (SELECT id::text, estimated_hours_min, estimated_hours_typical, estimated_hours_max FROM public.stage_transition_labor_map
     UNION ALL SELECT code, base_hours, NULL, NULL FROM public.labor_operations)));
  PERFORM pg_temp.ok('citations ship empty', (SELECT count(*) = 0 FROM public.labor_hours_citations));
END $$;

SELECT pg_temp.refused('map row cannot claim shop_paper with no citation',
  $s$UPDATE public.stage_transition_labor_map SET hours_basis = 'shop_paper' WHERE id = '00000000-0000-0000-0000-00000000000a'$s$);
SELECT pg_temp.refused('operation cannot claim corpus_reported with no citation',
  $s$UPDATE public.labor_operations SET hours_basis = 'corpus_reported' WHERE code = 'OP1'$s$);
SELECT pg_temp.refused('a new operation cannot be born cited without a citation',
  $s$INSERT INTO public.labor_operations (code, base_hours, hours_basis) VALUES ('OP3', 1, 'shop_paper')$s$);
SELECT pg_temp.refused('a citation names exactly one target',
  $s$INSERT INTO public.labor_hours_citations (transition_id, operation_code, receipt_item_id, hours_min, hours_typical, hours_max, cited_by)
     VALUES ('00000000-0000-0000-0000-00000000000a', 'OP1', '00000000-0000-0000-0000-0000000000c1', 1, 2, 3, 'test')$s$);
SELECT pg_temp.refused('a citation names exactly one source',
  $s$INSERT INTO public.labor_hours_citations (transition_id, hours_min, hours_typical, hours_max, cited_by)
     VALUES ('00000000-0000-0000-0000-00000000000a', 1, 2, 3, 'test')$s$);
SELECT pg_temp.refused('a citation range is ordered',
  $s$INSERT INTO public.labor_hours_citations (operation_code, receipt_item_id, hours_min, hours_typical, hours_max, cited_by)
     VALUES ('OP1', '00000000-0000-0000-0000-0000000000c1', 3, 2, 1, 'test')$s$);

-- With a citation row, the basis may move; removing the citation under it is refused.
INSERT INTO public.labor_hours_citations (operation_code, receipt_item_id, hours_min, hours_typical, hours_max, cited_by)
VALUES ('OP1', '00000000-0000-0000-0000-0000000000c1', 2, 2.5, 3, 'test');
UPDATE public.labor_operations SET hours_basis = 'shop_paper' WHERE code = 'OP1';
DO $$ BEGIN
  PERFORM pg_temp.ok('cited operation reads shop_paper', (SELECT hours_basis = 'shop_paper' FROM public.labor_operations WHERE code = 'OP1'));
END $$;
SELECT pg_temp.refused('a citation cannot be removed under its basis',
  $s$DELETE FROM public.labor_hours_citations WHERE operation_code = 'OP1'$s$);
SELECT pg_temp.refused('a citation cannot be re-pointed away from its basis',
  $s$UPDATE public.labor_hours_citations SET operation_code = 'OP2' WHERE operation_code = 'OP1'$s$);
UPDATE public.labor_operations SET hours_basis = 'uncited_seed' WHERE code = 'OP1';
DELETE FROM public.labor_hours_citations WHERE operation_code = 'OP1';

DO $$ BEGIN
  PERFORM pg_temp.ok('anon reads the basis table', has_table_privilege('anon', 'public.labor_hours_bases', 'SELECT'));
  PERFORM pg_temp.ok('anon cannot read citations', NOT has_table_privilege('anon', 'public.labor_hours_citations', 'SELECT'));
  PERFORM pg_temp.ok('anon cannot write citations', NOT has_table_privilege('anon', 'public.labor_hours_citations', 'INSERT'));
  PERFORM pg_temp.ok('anon cannot write the basis table', NOT has_table_privilege('anon', 'public.labor_hours_bases', 'INSERT'));
END $$;
\echo labor_hours_basis: ok
