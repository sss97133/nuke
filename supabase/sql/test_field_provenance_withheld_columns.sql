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
  ADD COLUMN color_source text, ADD COLUMN currency_source text,
  -- Sibling gates, one live column each: mileage_normalized is not a column, while its _source and _confidence are
  -- denied to anon and authenticated; vin_source_image_id is granted (test 12 revokes it from anon).
  ADD COLUMN mileage_normalized_source text, ADD COLUMN mileage_normalized_confidence text,
  ADD COLUMN vin text, ADD COLUMN vin_source_image_id uuid;
REVOKE ALL ON public.vehicles FROM anon, authenticated;
GRANT SELECT (id,is_public,user_id,owner_id,uploaded_by,color,deleted_at,listing_kind,engine_type,created_by_user_id,
  color_source,vin,vin_source_image_id) ON public.vehicles TO anon, authenticated;
GRANT SELECT (license_plate) ON public.vehicles TO authenticated;
GRANT SELECT ON public.vehicles TO service_role;

UPDATE public.vehicles SET owner_name = 'fixture owner', license_plate = 'FIXTURE1', purchase_price = 1,
  purchase_location = 'fixture place', color = coalesce(color, 'fixture color'),
  color_source = 'fixture color source', currency_source = 'fixture currency source',
  mileage_normalized_source = 'fixture mileage source', mileage_normalized_confidence = '0.9',
  vin = 'FIXTUREVIN0000001',
  -- a photo every caller may see, so only the column grant decides whether source_image_url is returned
  vin_source_image_id = (SELECT i.id FROM public.vehicle_images i WHERE i.vehicle_id = '11111111-1111-1111-1111-111111111111'
    AND i.source = 'user_upload' AND nullif(btrim(i.image_url), '') IS NOT NULL AND i.is_sensitive IS NOT TRUE
    AND i.is_superseded IS NOT TRUE AND i.is_duplicate IS NOT TRUE AND i.is_document IS NOT TRUE
    AND (i.vision_gate_status IS NULL OR i.vision_gate_status = 'approved')
    AND coalesce(i.image_vehicle_match_status, '') NOT IN ('mismatch', 'unrelated') ORDER BY i.id LIMIT 1)
WHERE id IN ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
             '99999999-9999-9999-9999-999999999999');
INSERT INTO public.vehicles (id, is_public, deleted_at, owner_id, owner_name, color)
VALUES ('33333333-3333-3333-3333-333333333333', true, now(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'fixture owner', 'red');
-- Evidence filed under a withheld name: it must leave with the value, never without it.
INSERT INTO public.field_evidence(vehicle_id,field_name,proposed_value,source_type,source_confidence,status,raw_extraction_data) VALUES
 ('11111111-1111-1111-1111-111111111111','owner_name','fixture owner','bat_listing',70,'accepted','{}');
INSERT INTO public.vehicle_field_sources(vehicle_id,field_name,field_value,source_type,confidence_score,created_at) VALUES
 ('11111111-1111-1111-1111-111111111111','purchase_price','1','user_input',90,now());

-- Gallery eligibility, as live (2026-11-25): the vehicle_images columns it reads, photo_extracted_fields,
-- image_privacy_rules and the live bodies of image_stage_custody_external, vehicle_image_privacy_withheld and
-- vehicle_image_gallery_eligible(vehicle_images). bat_pending_image_has_listing reads auction_events_canonical, which this
-- fixture does not carry; it is stubbed false (it only admits 'pending' BaT photos, and no fixture photo is pending).
ALTER TABLE public.vehicle_images ADD COLUMN user_id uuid REFERENCES auth.users(id), ADD COLUMN is_external boolean,
  ADD COLUMN is_approved boolean, ADD COLUMN approval_status text, ADD COLUMN verification_status text,
  ADD COLUMN redaction_level text, ADD COLUMN exif_data jsonb;
CREATE TABLE public.photo_extracted_fields (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id uuid NOT NULL REFERENCES public.vehicle_images(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  field_name text NOT NULL, value text NOT NULL, source text NOT NULL DEFAULT 'classifier_v2',
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (image_id, field_name, source));
CREATE TABLE public.image_privacy_rules (field_name text NOT NULL, min_alnum integer NOT NULL CHECK (min_alnum >= 1),
  applies_to text NOT NULL CHECK (applies_to = 'custody'), enabled boolean NOT NULL DEFAULT true,
  reason text NOT NULL CHECK (btrim(reason) <> ''), created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (field_name, applies_to));
CREATE FUNCTION public.bat_pending_image_has_listing(p_vehicle_id uuid, p_exif jsonb) RETURNS boolean LANGUAGE sql STABLE
  SET search_path TO '' AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.image_stage_custody_external(p_is_external boolean, p_user_id uuid, p_source text, p_exif jsonb)
 RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $function$
  select case
    when p_is_external is not true then false
    when p_user_id is not null and p_source = 'iphoto'
         and p_exif -> 'source_rendition' ->> 'contract' = 'photos_cached_preview_v1' then false
    else true
  end $function$;
CREATE OR REPLACE FUNCTION public.vehicle_image_privacy_withheld(p_image_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER COST 50 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT CASE
    WHEN (SELECT auth.role()) = 'service_role' THEN false
    WHEN (SELECT auth.role()) IS NULL AND session_user <> 'authenticator' THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.photo_extracted_fields f
      JOIN public.image_privacy_rules r
        ON r.field_name = f.field_name AND r.enabled AND r.applies_to = 'custody'
      JOIN public.vehicle_images i ON i.id = f.image_id
      WHERE f.image_id = p_image_id
        AND length(regexp_replace(upper(f.value), '[^A-Z0-9]', '', 'g')) >= r.min_alnum
        AND NOT public.image_stage_custody_external(i.is_external, i.user_id, i.source, i.exif_data)
        AND i.user_id IS DISTINCT FROM (SELECT auth.uid())
        AND NOT public.vehicle_viewer_tied(i.vehicle_id))
  END
$function$;
CREATE OR REPLACE FUNCTION public.vehicle_image_gallery_eligible(vehicle_images)
 RETURNS boolean LANGUAGE sql STABLE
AS $function$
  SELECT
    coalesce(($1).is_document,false)=false
    AND coalesce(($1).is_duplicate,false)=false
    AND coalesce(($1).is_superseded,false)=false
    AND nullif(btrim(($1).image_url),'') IS NOT NULL
    AND ($1).image_url NOT LIKE 'file://%'
    AND (($1).source IS NULL OR ($1).source <> 'e2e_test')
    AND coalesce(($1).image_vehicle_match_status,'') NOT IN ('mismatch','unrelated')
    AND CASE
      WHEN ($1).vision_gate_status IS NULL OR ($1).vision_gate_status::text='approved' THEN true
      WHEN ($1).vision_gate_status::text='pending' THEN
        coalesce(($1).is_sensitive,false)=false
        AND (
          (
            coalesce(($1).source='bat_import',false)
            AND ($1).is_external IS TRUE
            AND ($1).is_approved IS TRUE
            AND coalesce(($1).approval_status::text IN ('approved','auto_approved'),false)
            AND coalesce(($1).verification_status='approved',false)
            AND coalesce(($1).redaction_level::text='none',false)
            AND ($1).image_url ~* '^https://(www\.)?bringatrailer\.com/wp-content/uploads/'
            AND public.bat_pending_image_has_listing(($1).vehicle_id, ($1).exif_data)
          )
          OR (
            coalesce(($1).source='bat_import',false)=false
            AND ($1).is_external IS TRUE
            AND ($1).user_id IS NULL
            AND ($1).is_approved IS TRUE
            AND coalesce(($1).approval_status::text,'') <> 'rejected'
            AND coalesce(($1).verification_status='approved',false)
            AND coalesce(($1).redaction_level::text='none',false)
            AND ($1).image_url ~* '^https://'
          )
        )
      ELSE false
    END
    AND NOT public.vehicle_image_privacy_withheld(($1).id);
$function$;
GRANT SELECT ON public.image_privacy_rules TO anon, authenticated;
INSERT INTO public.image_privacy_rules (field_name, min_alnum, applies_to, reason) VALUES ('license_plate', 4, 'custody', 'fixture');

-- Rows each source table's own read policy hides from some caller, under non-column names (their own cases, test 10):
--   seller_name: field_evidence seller identity, signed-in callers only ("Anyone can view evidence");
--   fixture_doc_field: a vehicle_field_sources row citing a document photo (not gallery-eligible);
--   fixture_plate_photo: a row citing a custody photo with a keyed plate reading (image_privacy_rules) uploaded by
--     someone else, hidden from a caller who is not tied;
--   fixture_statement: an owner_statement_v1 observation, readable only by its submitter (the signed-in stranger cccc).
-- ALLOW_RAW_TESTIMONY_WRITE: fixture rows in an empty disposable PG17 database, never production.
INSERT INTO auth.users (id) SELECT 'dddddddd-dddd-dddd-dddd-dddddddddddd' WHERE NOT EXISTS
  (SELECT 1 FROM auth.users WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddddd');
INSERT INTO public.vehicle_images (id, vehicle_id, image_url, source, is_document) VALUES
  ('d0c00000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'https://fixture.invalid/doc.jpg', 'user_upload', true);
INSERT INTO public.vehicle_images (id, vehicle_id, image_url, source, user_id, is_external) VALUES
  ('d0c00000-0000-4000-8000-000000000002', '11111111-1111-1111-1111-111111111111', 'https://fixture.invalid/plate.jpg', 'user_upload',
   'dddddddd-dddd-dddd-dddd-dddddddddddd', false);
INSERT INTO public.photo_extracted_fields (image_id, field_name, value) VALUES
  ('d0c00000-0000-4000-8000-000000000002', 'license_plate', 'FIXTURE9');
INSERT INTO public.field_evidence(vehicle_id,field_name,proposed_value,source_type,source_confidence,status,raw_extraction_data) VALUES
 ('11111111-1111-1111-1111-111111111111','seller_name','fixture seller','bat_listing',70,'accepted','{}');
INSERT INTO public.vehicle_field_sources(vehicle_id,field_name,field_value,source_type,confidence_score,source_image_id,created_at) VALUES
 ('11111111-1111-1111-1111-111111111111','fixture_doc_field','doc value','user_input',90,'d0c00000-0000-4000-8000-000000000001',now()),
 ('11111111-1111-1111-1111-111111111111','fixture_plate_photo','plate value','user_input',90,'d0c00000-0000-4000-8000-000000000002',now());
INSERT INTO public.vehicle_observations (id, vehicle_id, kind, structured_data, is_superseded, observed_at, ingested_at,
  content_text, extraction_method, confidence_score, submitted_by_user_id)
VALUES ('d0c00000-0000-4000-8000-000000000003', '11111111-1111-1111-1111-111111111111', 'condition',
  '{"fixture_statement":"said by the stranger"}', false, now(), now(), 'fixture statement', 'owner_statement_v1', 0.5,
  'cccccccc-cccc-cccc-cccc-cccccccccccc');

-- Every answer before and after, for five callers: anon, a signed-in stranger, the owner (tied), the service role,
-- and a direct SQL caller with no request claims (pg_cron, scripts), which must count as anon.
CREATE TABLE public.wc_fields AS
  SELECT DISTINCT k AS field FROM public.vehicle_observations o, jsonb_object_keys(
    CASE WHEN jsonb_typeof(o.structured_data) = 'object' THEN o.structured_data ELSE '{}'::jsonb END) k
  UNION SELECT unnest(ARRAY['year','make','model','vin','color','mileage','engine_type','location','trim','currency',
    'owner_name','license_plate','purchase_price','purchase_location','color_source','currency_source',
    'image_visible_rust_severity','image_visible_paint_stage','image_visible_assembly_state',
    'seller_name','fixture_doc_field','fixture_plate_photo','fixture_statement','mileage_normalized',
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
     AND a.field NOT IN ('seller_name','fixture_doc_field','fixture_plate_photo','fixture_statement')
     AND NOT (a.field IN ('currency','mileage_normalized') AND NOT (v.viewer = 'service' OR (v.viewer = 'owner' AND a.vehicle = pub))
       AND a.p - 'inline_source' - 'inline_confidence' = b.p - 'inline_source' - 'inline_confidence'
       AND a.p->'inline_source' = 'null'::jsonb AND a.p->'inline_confidence' = 'null'::jsonb);
  ASSERT n >= 400, format('8 answers %s', n);
  ASSERT d = 0, format('8 %s answers changed that were not a withheld column or sibling', d);
  RAISE NOTICE 'PASS 1-8: % answers per phase, 5 callers', n;

  -- 10. A non-column name returns only what each source table's own read policy would show the caller.
  ASSERT pg_temp.ask('anon', pub, 'seller_name')->'evidence' = '[]'::jsonb, '10 anon seller_name field_evidence (policy)';
  ASSERT jsonb_array_length(pg_temp.ask('untied', pub, 'seller_name')->'evidence') = 1, '10 signed-in seller_name evidence';
  ASSERT jsonb_array_length(pg_temp.ask('service', pub, 'seller_name')->'evidence') = 1, '10 service seller_name evidence';
  ASSERT pg_temp.ask('anon', pub, 'fixture_doc_field')->'evidence' = '[]'::jsonb, '10 anon document photo source';
  ASSERT pg_temp.ask('untied', pub, 'fixture_doc_field')->'evidence' = '[]'::jsonb, '10 stranger document photo source';
  ASSERT pg_temp.ask('owner', pub, 'fixture_doc_field')->'evidence'->0->>'image_id' = 'd0c00000-0000-4000-8000-000000000001',
    '10 owner document photo source';
  ASSERT pg_temp.ask('anon', pub, 'fixture_plate_photo')->'evidence' = '[]'::jsonb, '10 anon privacy-rule photo source';
  ASSERT pg_temp.ask('untied', pub, 'fixture_plate_photo')->'evidence' = '[]'::jsonb, '10 stranger privacy-rule photo source';
  ASSERT pg_temp.ask('owner', pub, 'fixture_plate_photo')->'evidence'->0->>'image_id' = 'd0c00000-0000-4000-8000-000000000002',
    '10 owner privacy-rule photo source';
  ASSERT pg_temp.ask('anon', pub, 'fixture_statement')->'observations' = '[]'::jsonb, '10 anon owner statement';
  ASSERT pg_temp.ask('owner', pub, 'fixture_statement')->'observations' = '[]'::jsonb, '10 owner is not the submitter';
  ASSERT pg_temp.ask('untied', pub, 'fixture_statement')->'observations'->0->>'id' = 'd0c00000-0000-4000-8000-000000000003',
    '10 submitter reads own statement';
  ASSERT jsonb_array_length(pg_temp.ask('service', pub, 'fixture_statement')->'observations') = 1, '10 service statement';
  -- The prior body returned the policy-hidden rows, so these cases bite.
  ASSERT (SELECT p->'evidence' <> '[]'::jsonb FROM public.wc_answers WHERE phase = 'before'
          AND viewer = 'anon' AND vehicle = pub AND field = 'seller_name'), '10 prior body leaked seller_name to anon';
  ASSERT (SELECT p->'observations' <> '[]'::jsonb FROM public.wc_answers WHERE phase = 'before'
          AND viewer = 'anon' AND vehicle = pub AND field = 'fixture_statement'), '10 prior body leaked the statement to anon';
  ASSERT (SELECT p->'evidence' <> '[]'::jsonb FROM public.wc_answers WHERE phase = 'before'
          AND viewer = 'anon' AND vehicle = pub AND field = 'fixture_doc_field'), '10 prior body cited the document photo to anon';

  -- 11. A non-column name is never an alias onto a column: its value is null for every caller; the only vehicles
  -- columns it reaches are its own _source/_confidence/_source_image_id siblings, each gated (test 7).
  SELECT count(*) INTO d FROM public.wc_answers a WHERE a.phase = 'after' AND a.p IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM pg_attribute t WHERE t.attrelid = 'public.vehicles'::regclass AND t.attname = a.field
                    AND t.attnum > 0 AND NOT t.attisdropped)
    AND a.p->>'value' IS NOT NULL;
  ASSERT d = 0, format('11 %s non-column answers carry a value', d);
  RAISE NOTICE 'PASS 10-11';

  -- 12. Each sibling column is gated on its own grant, separately. mileage_normalized is not a column; its _source
  -- and _confidence are denied to anon and authenticated (live), so only privileged callers read them.
  r := pg_temp.ask('anon', pub, 'mileage_normalized');
  ASSERT r->'inline_source' = 'null'::jsonb, '12 anon mileage_normalized_source';
  ASSERT r->'inline_confidence' = 'null'::jsonb, '12 anon mileage_normalized_confidence';
  r := pg_temp.ask('untied', pub, 'mileage_normalized');
  ASSERT r->'inline_source' = 'null'::jsonb, '12 stranger mileage_normalized_source';
  ASSERT r->'inline_confidence' = 'null'::jsonb, '12 stranger mileage_normalized_confidence';
  r := pg_temp.ask('owner', pub, 'mileage_normalized');
  ASSERT r->>'inline_source' = 'fixture mileage source', '12 owner mileage_normalized_source';
  ASSERT r->>'inline_confidence' = '0.9', '12 owner mileage_normalized_confidence';
  ASSERT pg_temp.ask('service', pub, 'mileage_normalized')->>'inline_confidence' = '0.9', '12 service mileage_normalized_confidence';
  -- The prior body returned both to anon, so the cases bite.
  ASSERT (SELECT p->>'inline_confidence' = '0.9' AND p->>'inline_source' = 'fixture mileage source' FROM public.wc_answers
          WHERE phase = 'before' AND viewer = 'anon' AND vehicle = pub AND field = 'mileage_normalized'),
    '12 prior body leaked mileage_normalized siblings to anon';
  -- vin_source_image_id granted: anon reads the cited photo (the REVOKE half is below).
  ASSERT pg_temp.ask('anon', pub, 'vin')->>'source_image_url' IS NOT NULL, '12 anon vin source image (granted)';
  RAISE NOTICE 'PASS 12 (a)';

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

-- 12 (b). The _source_image_id sibling on its own: revoke vin_source_image_id from anon; vin's value stays, its cited
-- photo goes; the owner still reads it. Then re-grant.
REVOKE SELECT (vin_source_image_id) ON public.vehicles FROM anon;
BEGIN;
SELECT set_config('test.auth_role','anon',true), set_config('test.auth_uid','',true);
SET LOCAL ROLE anon;
DO $$ DECLARE r jsonb := public.get_field_provenance('11111111-1111-1111-1111-111111111111','vin');
BEGIN
  ASSERT r->>'value' = 'FIXTUREVIN0000001', '12 anon vin value (granted)';
  ASSERT r->'source_image_url' = 'null'::jsonb, '12 anon vin_source_image_id revoked';
END $$;
COMMIT;
BEGIN;
SELECT set_config('test.auth_role','authenticated',true), set_config('test.auth_uid','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  ASSERT public.get_field_provenance('11111111-1111-1111-1111-111111111111','vin')->>'source_image_url' IS NOT NULL,
    '12 owner vin source image while revoked from anon';
END $$;
COMMIT;
GRANT SELECT (vin_source_image_id) ON public.vehicles TO anon;
SELECT 'PASS 12 (b)' AS result;
-- 13. The owner of a PRIVATE car reads its withheld column (owner_name) with its value; anon and a stranger get NULL.
INSERT INTO public.vehicles (id, is_public, owner_id, owner_name, color)
VALUES ('55555555-5555-5555-5555-555555555555', false, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'fixture private owner', 'blue');
BEGIN;
SELECT set_config('test.auth_role','authenticated',true), set_config('test.auth_uid','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE r jsonb := public.get_field_provenance('55555555-5555-5555-5555-555555555555','owner_name');
BEGIN
  ASSERT r->>'value' = 'fixture private owner', '13 owner of a private car reads owner_name';
  ASSERT coalesce((r->>'withheld')::boolean, false) = false, '13 owner of a private car is not withheld';
END $$;
COMMIT;
BEGIN;
SELECT set_config('test.auth_role','authenticated',true), set_config('test.auth_uid','cccccccc-cccc-cccc-cccc-cccccccccccc',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  ASSERT public.get_field_provenance('55555555-5555-5555-5555-555555555555','owner_name') IS NULL, '13 stranger gets NULL for a private car';
END $$;
COMMIT;
BEGIN;
SELECT set_config('test.auth_role','anon',true), set_config('test.auth_uid','',true);
SET LOCAL ROLE anon;
DO $$ BEGIN
  ASSERT public.get_field_provenance('55555555-5555-5555-5555-555555555555','owner_name') IS NULL, '13 anon gets NULL for a private car';
END $$;
COMMIT;
SELECT 'PASS 13' AS result;
SELECT 'PASS: get_field_provenance withholds columns the caller cannot select' AS result;
