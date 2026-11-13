-- Actual reader on PG17, synthetic rows in an EMPTY disposable database only. Proves
-- 20261116023000_field_provenance_money_sources_tied.sql: on a public vehicle, get_field_provenance shows evidence read
-- from the owner's books (quickbooks, invoice, email_receipt, receipt, bank_statement, card_statement) only to a viewer
-- tied to the vehicle and to the service role. Anonymous and untied signed-in callers get neither its value nor its photo
-- through the source_image_url fallback. Every other row is unchanged, and every answer that holds no money row is
-- byte-identical to the live 20261116007000 reader.
\set ON_ERROR_STOP on
-- The live reader and its fixture (applies 20261109203000 … 20261116012000; ends at md5 15d6906f…).
\ir test_field_provenance_photo_location.sql
DO $$ BEGIN
 ASSERT md5(pg_get_functiondef('public.get_field_provenance(uuid,text)'::regprocedure)) = '15d6906f9268a3cf11147d92ae5603a9',
   'fixture reader is the live one';
END $$;

-- The tied test as live (20261110100000). vehicle_user_has_access is a stand-in limited to the vehicle's own people.
-- auth.role() reads the request's JWT role in production; here a setting stands in (current_user would be the
-- definer's inside SECURITY DEFINER functions).
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('test.auth_role', true), '') $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS created_by_user_id uuid;
CREATE FUNCTION public.vehicle_user_has_access(p_vehicle_id uuid, p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = p_vehicle_id AND p_user_id IN (v.user_id, v.owner_id, v.uploaded_by)) $$;
CREATE OR REPLACE FUNCTION public.vehicle_listing_viewer_tied(p_vehicle_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT (SELECT auth.role()) = 'service_role'
      OR EXISTS (SELECT 1 FROM public.vehicles v
                 WHERE v.id = p_vehicle_id AND (SELECT auth.uid()) IS NOT NULL
                   AND (coalesce((SELECT auth.uid()) IN (v.owner_id, v.user_id, v.created_by_user_id, v.uploaded_by), false)
                        OR public.vehicle_user_has_access(v.id, (SELECT auth.uid()))))
$f$;
GRANT EXECUTE ON FUNCTION public.vehicle_listing_viewer_tied(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_field_provenance(uuid,text) TO service_role;

-- Public vehicle 1111…, owner bbbb…. Evidence for engine_type: one ordinary row, one invoice row whose photo is the only
-- cited photo, one bank_statement row; a 'color' field with no money row.
INSERT INTO public.vehicle_images(id,vehicle_id,image_url,source,vision_gate_status) VALUES
 ('77777777-7777-7777-7777-000000000001','11111111-1111-1111-1111-111111111111','https://example.invalid/invoice-page.jpg','user_upload','approved');
INSERT INTO public.field_evidence(vehicle_id,field_name,proposed_value,source_type,source_confidence,status,raw_extraction_data) VALUES
 ('11111111-1111-1111-1111-111111111111','engine_type','listing says V8','bat_listing',70,'accepted','{}'),
 ('11111111-1111-1111-1111-111111111111','engine_type','books: engine rebuild line','invoice',95,'accepted',
  '{"photo_id":"77777777-7777-7777-7777-000000000001"}'),
 ('11111111-1111-1111-1111-111111111111','engine_type','books: card line','bank_statement',90,'accepted','{}');

-- Answers that hold no money row, before the change.
SELECT public.get_field_provenance('11111111-1111-1111-1111-111111111111','color')::text AS before_color \gset
BEGIN; SET LOCAL ROLE anon;
SELECT public.get_field_provenance('11111111-1111-1111-1111-111111111111','location')::text AS before_location \gset
ROLLBACK;
CREATE TABLE public.money_base(k text PRIMARY KEY, v text NOT NULL);
INSERT INTO public.money_base VALUES ('location', :'before_location');
GRANT SELECT ON public.money_base TO anon, authenticated, service_role;
BEGIN; SET LOCAL ROLE anon;
DO $$ BEGIN
 ASSERT public.get_field_provenance('11111111-1111-1111-1111-111111111111','engine_type')::text ~ 'books: engine rebuild line',
   'before: anon reads the invoice row through the reader (the hole)';
END $$;
ROLLBACK;

\ir ../migrations/20261116023000_field_provenance_money_sources_tied.sql
\ir ../migrations/20261116023000_field_provenance_money_sources_tied.sql

BEGIN;
SET LOCAL ROLE anon;
SET LOCAL test.auth_role = 'anon';
DO $$ DECLARE p jsonb; BEGIN
 p := public.get_field_provenance('11111111-1111-1111-1111-111111111111','engine_type');
 ASSERT p::text !~ 'books:|invoice|bank_statement|invoice-page', 'anon: no money row, source or photo: ' || p::text;
 ASSERT p->'evidence' @> '[{"value":"listing says V8","source_type":"bat_listing"}]'::jsonb, 'anon: the ordinary row stays';
 ASSERT p->'source_image_url' = 'null'::jsonb, 'anon: the invoice photo is not the fallback source image';
 ASSERT public.get_field_provenance('11111111-1111-1111-1111-111111111111','location')::text = (SELECT v FROM public.money_base WHERE k = 'location'),
   'anon: location answer byte-identical';
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL test.auth_role = 'authenticated';
SET LOCAL test.auth_uid = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
DO $$ DECLARE p jsonb; BEGIN
 p := public.get_field_provenance('11111111-1111-1111-1111-111111111111','engine_type');
 ASSERT p::text !~ 'books:|invoice|bank_statement|invoice-page', 'untied signed-in viewer: no money row';
 ASSERT jsonb_array_length(p->'evidence') = 1, p->>'evidence';
END $$;
SET LOCAL test.auth_uid = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
DO $$ DECLARE p jsonb; BEGIN
 p := public.get_field_provenance('11111111-1111-1111-1111-111111111111','engine_type');
 ASSERT p->'evidence' @> '[{"value":"books: engine rebuild line","source_type":"invoice"},
                           {"value":"books: card line","source_type":"bank_statement"},
                           {"value":"listing says V8"}]'::jsonb, 'owner: every row: ' || (p->>'evidence');
 ASSERT p->>'source_image_url' = 'https://example.invalid/invoice-page.jpg', 'owner: the invoice photo is the source image';
END $$;
RESET ROLE;
SET LOCAL test.auth_uid = '';
SET LOCAL ROLE service_role;
SET LOCAL test.auth_role = 'service_role';
DO $$ BEGIN
 ASSERT jsonb_array_length(public.get_field_provenance('11111111-1111-1111-1111-111111111111','engine_type')->'evidence') = 3,
   'service_role: every row';
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT has_function_privilege('anon','public.get_field_provenance(uuid,text)','EXECUTE'), 'anon still executes the reader';
END $$;
ROLLBACK;
SELECT public.get_field_provenance('11111111-1111-1111-1111-111111111111','color')::text = :'before_color' AS color_unchanged \gset
\if :color_unchanged
\else
  \echo 'FAIL: color answer changed'
  SELECT 1/0;
\endif
SELECT 'PASS: get_field_provenance shows books evidence only to a viewer tied to the vehicle' AS result;
