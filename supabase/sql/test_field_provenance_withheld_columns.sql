-- Actual reader on PG17, synthetic rows in an EMPTY disposable database only. Proves
-- 20261125175500_field_provenance_withheld_columns.sql: get_field_provenance returns a vehicles column's value (and
-- its siblings and evidence) only to a caller whose request role may SELECT that column, a tied viewer or the
-- service role; a private, deleted or missing vehicle stays NULL; malformed names are withheld; a REVOKE flips a
-- field with no function change; every other answer is byte-identical to the prior live body.
-- Run: createdb <db>; psql -d <db> -v ON_ERROR_STOP=1 -f supabase/sql/test_field_provenance_withheld_columns.sql
-- Optional: -v mig=<path> to run the contract against another body (the mutation runs use it).
\set ON_ERROR_STOP on
\if :{?mig}
\else
  \set mig ../migrations/20261125175500_field_provenance_withheld_columns.sql
\endif
-- The live reader and its fixture (ends at the 20261116024000 body, which is the live body read 2026-11-25).
\ir test_field_provenance_money_sources.sql
\ir ../migrations/20261116024000_field_provenance_key_test_without_gin.sql
DO $$ BEGIN
  ASSERT (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
          WHERE oid = 'public.get_field_provenance(uuid,text)'::regprocedure)
    = '876c9959f9febede5e52f069e0df50fa8943a8be167e686fc8bbdf12ef5406a8', 'fixture reader is the live one';
END $$;

-- vehicle_viewer_tied: the live body (read 2026-11-25).
CREATE OR REPLACE FUNCTION public.vehicle_viewer_tied(p_vehicle_id uuid)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  RETURN (
  SELECT CASE
           WHEN (SELECT auth.role()) = 'service_role' THEN true
           WHEN (SELECT auth.uid()) IS NULL THEN false
           ELSE coalesce((SELECT (SELECT auth.uid()) IN (v.owner_id, v.user_id, v.created_by_user_id, v.uploaded_by)
                            FROM public.vehicles v WHERE v.id = p_vehicle_id), false)
                OR coalesce(public.vehicle_user_has_access(p_vehicle_id, (SELECT auth.uid())), false)
         END
);
END
$function$;
GRANT EXECUTE ON FUNCTION public.vehicle_viewer_tied(uuid) TO anon, authenticated, service_role;

-- Live columns and live column grants (has_column_privilege read 2026-11-25) for the columns this fixture carries.
ALTER TABLE public.vehicles ADD COLUMN owner_name text, ADD COLUMN license_plate text,
  ADD COLUMN purchase_price numeric(10,2), ADD COLUMN purchase_location text,
  ADD COLUMN color_source text, ADD COLUMN currency_source text;
REVOKE ALL ON public.vehicles FROM anon, authenticated;
GRANT SELECT (id,is_public,user_id,owner_id,uploaded_by,color,deleted_at,listing_kind,engine_type,created_by_user_id,
  color_source) ON public.vehicles TO anon, authenticated;
GRANT SELECT (license_plate) ON public.vehicles TO authenticated;
GRANT SELECT ON public.vehicles TO service_role;

UPDATE public.vehicles SET owner_name = 'fixture owner', license_plate = 'FIXTURE1', purchase_price = 1,
  purchase_location = 'fixture place', color = coalesce(color, 'fixture color'),
  color_source = 'fixture color source', currency_source = 'fixture currency source'
WHERE id IN ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
             '99999999-9999-9999-9999-999999999999');
INSERT INTO public.vehicles (id, is_public, deleted_at, owner_id, owner_name, color)
VALUES ('33333333-3333-3333-3333-333333333333', true, now(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'fixture owner', 'red');
-- Evidence filed under a withheld name: it must leave with the value, never without it.
INSERT INTO public.field_evidence(vehicle_id,field_name,proposed_value,source_type,source_confidence,status,raw_extraction_data) VALUES
 ('11111111-1111-1111-1111-111111111111','owner_name','fixture owner','bat_listing',70,'accepted','{}');
INSERT INTO public.vehicle_field_sources(vehicle_id,field_name,field_value,source_type,confidence_score,created_at) VALUES
 ('11111111-1111-1111-1111-111111111111','purchase_price','1','user_input',90,now());

-- Every answer before and after, for five callers: anon, a signed-in stranger, the owner (tied), the service role,
-- and a direct SQL caller with no request claims (pg_cron, scripts), which must count as anon.
CREATE TABLE public.wc_fields AS
  SELECT DISTINCT k AS field FROM public.vehicle_observations o, jsonb_object_keys(
    CASE WHEN jsonb_typeof(o.structured_data) = 'object' THEN o.structured_data ELSE '{}'::jsonb END) k
  UNION SELECT unnest(ARRAY['year','make','model','vin','color','mileage','engine_type','location','trim','currency',
    'owner_name','license_plate','purchase_price','purchase_location','color_source','currency_source',
    'image_visible_rust_severity','image_visible_paint_stage','image_visible_assembly_state',
    'x''); drop table public.vehicles; --','Owner_Name','']);
-- The owner viewer is tied to 1111 only; on 2222 it is a signed-in stranger.
CREATE TABLE public.wc_viewers(viewer text PRIMARY KEY, role_name text, auth_role text, uid text);
INSERT INTO public.wc_viewers VALUES
  ('anon','anon','anon',''),
  ('untied','authenticated','authenticated','cccccccc-cccc-cccc-cccc-cccccccccccc'),
  ('owner','authenticated','authenticated','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  ('service','service_role','service_role',''),
  ('noclaims','postgres','','');
CREATE TABLE public.wc_answers(phase text, viewer text, vehicle uuid, field text, p jsonb, PRIMARY KEY (phase, viewer, vehicle, field));
GRANT SELECT ON public.wc_fields, public.wc_viewers TO anon, authenticated, service_role;
GRANT INSERT, SELECT ON public.wc_answers TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.capture(p_phase text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v record;
BEGIN
  FOR v IN SELECT * FROM public.wc_viewers LOOP
    PERFORM set_config('test.auth_role', v.auth_role, true);
    PERFORM set_config('test.auth_uid', v.uid, true);
    EXECUTE format('SET LOCAL ROLE %I', v.role_name);
    INSERT INTO public.wc_answers
    SELECT p_phase, v.viewer, x.id, f.field, public.get_field_provenance(x.id, f.field)
    FROM public.wc_fields f
    CROSS JOIN (VALUES ('11111111-1111-1111-1111-111111111111'::uuid), ('22222222-2222-2222-2222-222222222222'::uuid),
      ('99999999-9999-9999-9999-999999999999'::uuid), ('33333333-3333-3333-3333-333333333333'::uuid),
      ('44444444-4444-4444-4444-444444444444'::uuid)) x(id);
    RESET ROLE;
  END LOOP;
END $$;

-- Ask one question as one caller.
CREATE FUNCTION pg_temp.ask(p_viewer text, p_vehicle uuid, p_field text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT p FROM public.wc_answers WHERE phase = 'after' AND viewer = p_viewer AND vehicle = p_vehicle AND field = p_field $$;

BEGIN; SELECT pg_temp.capture('before'); COMMIT;
DO $$ BEGIN
  ASSERT (SELECT p->>'value' FROM public.wc_answers WHERE phase='before' AND viewer='anon'
          AND vehicle='11111111-1111-1111-1111-111111111111' AND field='owner_name') = 'fixture owner',
    'the defect reproduces on the prior body: anon reads owner_name';
END $$;

\ir :mig
\ir :mig
BEGIN; SELECT pg_temp.capture('after'); COMMIT;

DO $$
DECLARE
  pub uuid := '11111111-1111-1111-1111-111111111111';
  f text; r jsonb; n int; d int;
BEGIN
  -- 1. anon reads a column anon may select on a public car, siblings included.
  r := pg_temp.ask('anon', pub, 'color');
  ASSERT r->>'value' IS NOT NULL AND NOT (r ? 'withheld'), format('1 anon color: %s', r->>'withheld_reason');
  ASSERT r->>'inline_source' = 'fixture color source', '1 anon color_source sibling';

  -- 2. anon is withheld on each denied column, with every derived piece emptied.
  FOREACH f IN ARRAY ARRAY['owner_name','license_plate','purchase_price','purchase_location'] LOOP
    r := pg_temp.ask('anon', pub, f);
    ASSERT r->>'value' IS NULL AND r->'withheld' = 'true'::jsonb AND r->>'withheld_reason' = 'column_not_public',
      format('2 anon %s withheld', f);
    ASSERT r->'evidence' = '[]'::jsonb AND r->'observations' = '[]'::jsonb AND r->'image_observations' = '[]'::jsonb
       AND r->'inline_source' = 'null'::jsonb AND r->'source_image_url' = 'null'::jsonb, format('2 anon %s siblings', f);
    ASSERT r::text NOT LIKE '%fixture owner%' AND r::text NOT LIKE '%FIXTURE1%' AND r::text NOT LIKE '%fixture place%',
      format('2 anon %s carries no value text', f);
  END LOOP;

  -- 3. A private, deleted or missing car is NULL for anon and a stranger, whatever the field; the three are identical.
  FOREACH f IN ARRAY ARRAY['color','owner_name','engine_type'] LOOP
    ASSERT pg_temp.ask('anon', '99999999-9999-9999-9999-999999999999', f) IS NULL, format('3 anon private %s', f);
    ASSERT pg_temp.ask('anon', '33333333-3333-3333-3333-333333333333', f) IS NULL, format('3 anon deleted %s', f);
    ASSERT pg_temp.ask('anon', '44444444-4444-4444-4444-444444444444', f) IS NULL, format('3 anon missing %s', f);
    ASSERT pg_temp.ask('untied', '99999999-9999-9999-9999-999999999999', f) IS NULL, format('3 untied private %s', f);
    ASSERT pg_temp.ask('untied', '33333333-3333-3333-3333-333333333333', f) IS NULL, format('3 untied deleted %s', f);
  END LOOP;

  -- 4. A signed-in stranger gets what the authenticated grants allow and no more.
  ASSERT pg_temp.ask('untied', pub, 'license_plate')->>'value' = 'FIXTURE1', '4 untied license_plate (granted)';
  FOREACH f IN ARRAY ARRAY['owner_name','purchase_price','purchase_location'] LOOP
    ASSERT pg_temp.ask('untied', pub, f)->'withheld' = 'true'::jsonb, format('4 untied %s withheld', f);
  END LOOP;

  -- 5. A tied viewer and the service role get the value and its evidence.
  ASSERT pg_temp.ask('owner', pub, 'owner_name')->>'value' = 'fixture owner', '5 owner owner_name';
  ASSERT pg_temp.ask('owner', pub, 'purchase_price')->>'value' IS NOT NULL, '5 owner purchase_price';
  ASSERT pg_temp.ask('service', pub, 'owner_name')->>'value' = 'fixture owner', '5 service owner_name';
  ASSERT jsonb_array_length(pg_temp.ask('service', pub, 'owner_name')->'evidence') = 1, '5 service owner_name evidence';
  ASSERT jsonb_array_length(pg_temp.ask('service', pub, 'purchase_price')->'evidence') = 1, '5 service purchase_price evidence';

  -- 6. Malformed names are withheld without echoing the input; a direct caller with no claims counts as anon.
  FOREACH f IN ARRAY ARRAY['x''); drop table public.vehicles; --','Owner_Name',''] LOOP
    r := pg_temp.ask('anon', pub, f);
    ASSERT r->'withheld' = 'true'::jsonb AND r->>'withheld_reason' = 'field_not_recognized'
       AND r->'field' = 'null'::jsonb, format('6 anon malformed %s', f);
  END LOOP;
  ASSERT pg_temp.ask('noclaims', pub, 'owner_name')->'withheld' = 'true'::jsonb, '6 no-claims caller withheld';

  -- 7. A sibling column is gated on its own grant: currency is not a column, currency_source is denied.
  ASSERT pg_temp.ask('anon', pub, 'currency')->'inline_source' = 'null'::jsonb, '7 anon currency_source sibling';
  ASSERT pg_temp.ask('service', pub, 'currency')->>'inline_source' = 'fixture currency source', '7 service sibling';

  -- 8. Every other answer is byte-identical to the prior body; every changed answer is a withheld denied column.
  SELECT count(*) INTO n FROM public.wc_answers WHERE phase = 'after';
  SELECT count(*) INTO d FROM public.wc_answers b JOIN public.wc_answers a USING (viewer, vehicle, field)
    JOIN public.wc_viewers v USING (viewer)
   WHERE b.phase = 'before' AND a.phase = 'after' AND a.p IS DISTINCT FROM b.p
     AND NOT (a.p->'withheld' = 'true'::jsonb AND (a.p->>'withheld_reason' = 'field_not_recognized'
       OR (NOT (v.viewer = 'service' OR (v.viewer = 'owner' AND a.vehicle = pub)) AND EXISTS (SELECT 1 FROM pg_attribute t WHERE t.attrelid = 'public.vehicles'::regclass
             AND t.attname = a.field AND t.attnum > 0
             AND NOT has_column_privilege(CASE WHEN v.role_name = 'authenticated' THEN 'authenticated' ELSE 'anon' END,
               'public.vehicles'::regclass, t.attnum, 'SELECT')))))
     AND NOT (a.field = 'currency' AND NOT (v.viewer = 'service' OR (v.viewer = 'owner' AND a.vehicle = pub))
       AND a.p - 'inline_source' = b.p - 'inline_source' AND a.p->'inline_source' = 'null'::jsonb);
  ASSERT n >= 400, format('8 answers %s', n);
  ASSERT d = 0, format('8 %s answers changed that were not a withheld column or sibling', d);
  RAISE NOTICE 'PASS 1-8: % answers per phase, 5 callers', n;
END $$;

-- 9. A REVOKE closes the path with no function change; the GRANT reopens it.
CREATE TEMP TABLE wc_body AS SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') AS body_sha FROM pg_proc
 WHERE oid = 'public.get_field_provenance(uuid,text)'::regprocedure;
REVOKE SELECT (color) ON public.vehicles FROM anon;
BEGIN;
SELECT set_config('test.auth_role','anon',true), set_config('test.auth_uid','',true);
SET LOCAL ROLE anon;
DO $$ BEGIN
  ASSERT public.get_field_provenance('11111111-1111-1111-1111-111111111111','color')->>'withheld_reason' = 'column_not_public',
    '9 revoked color is withheld';
END $$;
COMMIT;
GRANT SELECT (color) ON public.vehicles TO anon;
BEGIN;
SELECT set_config('test.auth_role','anon',true), set_config('test.auth_uid','',true);
SET LOCAL ROLE anon;
DO $$ BEGIN
  ASSERT public.get_field_provenance('11111111-1111-1111-1111-111111111111','color')->>'value' IS NOT NULL,
    '9 re-granted color is readable';
END $$;
COMMIT;
DO $$ BEGIN
  ASSERT (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
          WHERE oid = 'public.get_field_provenance(uuid,text)'::regprocedure) = (SELECT body_sha FROM wc_body), '9 function unchanged';
END $$;
SELECT 'PASS: get_field_provenance withholds columns the caller cannot select' AS result;
