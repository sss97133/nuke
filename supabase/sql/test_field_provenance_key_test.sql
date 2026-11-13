-- Actual reader on PG17, synthetic rows in an EMPTY disposable database only. Proves
-- 20261116024000_field_provenance_key_test_without_gin.sql: replacing `structured_data ? p_field` with
-- `structured_data->p_field is not null` changes no answer. Every field any fixture observation carries, plus the
-- standard ones, is read before and after the change for anonymous, untied, owner and service-role callers, and the
-- answers are compared byte for byte. The plan change itself (no GIN scan) is measured on production; the numbers are
-- in the migration header.
\set ON_ERROR_STOP on
-- The live reader and its fixture (ends at the 20261116023000 body, md5 c2a6838b…).
\ir test_field_provenance_money_sources.sql
DO $$ BEGIN
 ASSERT md5(pg_get_functiondef('public.get_field_provenance(uuid,text)'::regprocedure)) = 'c2a6838bbb0e76f78b21b1b3abb71630',
   'fixture reader is the live one';
 -- The two tests agree on an object, a JSON-null value included; only a top-level array's string element differs.
 ASSERT ('{"year":null}'::jsonb ? 'year') AND ('{"year":null}'::jsonb->'year') IS NOT NULL, 'JSON null: both true';
 ASSERT NOT ('{"make":1}'::jsonb ? 'year') AND ('{"make":1}'::jsonb->'year') IS NULL, 'absent key: both false';
END $$;

-- Committed fixture rows the earlier contracts rolled back: books evidence and a field-evidence row, so the money
-- filter and the evidence list are inside the comparison.
INSERT INTO public.field_evidence(vehicle_id,field_name,proposed_value,source_type,source_confidence,status,raw_extraction_data) VALUES
 ('11111111-1111-1111-1111-111111111111','engine_type','listing says V8','bat_listing',70,'accepted','{}'),
 ('11111111-1111-1111-1111-111111111111','engine_type','books: card line','bank_statement',90,'accepted','{}');

CREATE TABLE public.kt_fields AS
  SELECT DISTINCT k AS field FROM public.vehicle_observations o, jsonb_object_keys(
    CASE WHEN jsonb_typeof(o.structured_data) = 'object' THEN o.structured_data ELSE '{}'::jsonb END) k
  UNION SELECT unnest(ARRAY['year','make','model','vin','color','mileage','engine_type','location','trim',
    'image_visible_rust_severity','image_visible_paint_stage','image_visible_assembly_state']);
CREATE TABLE public.kt_viewers(viewer text PRIMARY KEY, role_name text, auth_role text, uid text);
INSERT INTO public.kt_viewers VALUES ('anon','anon','anon',''), ('untied','authenticated','authenticated','cccccccc-cccc-cccc-cccc-cccccccccccc'),
  ('owner','authenticated','authenticated','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), ('service','service_role','service_role','');
CREATE TABLE public.kt_answers(phase text, viewer text, vehicle uuid, field text, p text, PRIMARY KEY (phase, viewer, vehicle, field));
GRANT SELECT ON public.kt_fields, public.kt_viewers TO anon, authenticated, service_role;
GRANT INSERT, SELECT ON public.kt_answers TO anon, authenticated, service_role;
SELECT count(*) >= 20 AS enough_fields FROM public.kt_fields \gset
\if :enough_fields
\else
  SELECT 1/0 AS too_few_fields;
\endif

CREATE FUNCTION pg_temp.capture(p_phase text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v record;
BEGIN
  FOR v IN SELECT * FROM public.kt_viewers LOOP
    PERFORM set_config('test.auth_role', v.auth_role, true);
    PERFORM set_config('test.auth_uid', v.uid, true);
    EXECUTE format('SET LOCAL ROLE %I', v.role_name);
    INSERT INTO public.kt_answers
    SELECT p_phase, v.viewer, x.id, f.field, public.get_field_provenance(x.id, f.field)::text
    FROM public.kt_fields f
    CROSS JOIN (VALUES ('11111111-1111-1111-1111-111111111111'::uuid), ('22222222-2222-2222-2222-222222222222'::uuid)) x(id);
    RESET ROLE;
  END LOOP;
END $$;

BEGIN; SELECT pg_temp.capture('before'); COMMIT;
\ir ../migrations/20261116024000_field_provenance_key_test_without_gin.sql
\ir ../migrations/20261116024000_field_provenance_key_test_without_gin.sql
BEGIN; SELECT pg_temp.capture('after'); COMMIT;

DO $$
DECLARE n int; d int; nonnull int;
BEGIN
  SELECT count(*) INTO n FROM public.kt_answers WHERE phase = 'before';
  SELECT count(*) INTO nonnull FROM public.kt_answers WHERE phase = 'before' AND p IS NOT NULL AND p::jsonb->'observations' <> '[]'::jsonb;
  SELECT count(*) INTO d FROM public.kt_answers b JOIN public.kt_answers a USING (viewer, vehicle, field)
   WHERE b.phase = 'before' AND a.phase = 'after' AND a.p IS DISTINCT FROM b.p;
  ASSERT n = (SELECT count(*) FROM public.kt_answers WHERE phase = 'after') AND n >= 160, format('answers %s', n);
  ASSERT nonnull > 0, 'some answers carry observations';
  ASSERT d = 0, format('%s answers changed', d);
  RAISE NOTICE 'PASS: % answers (% with observations) byte-identical across 4 viewers', n, nonnull;
END $$;
SELECT 'PASS: get_field_provenance key test without GIN changes no answer' AS result;
