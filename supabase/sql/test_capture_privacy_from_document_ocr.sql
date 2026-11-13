-- 20261116245000: privacy_from_document_ocr_v1 routes identity-document
-- OCR matches to private via set_image_sensitivity / privacy_promote
-- writes, and invitations to the non_vehicle log. Preset matcher only.
-- Disposable DB only (dm_refinement_capture_privacy_from_document_ocr%).
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_capture_privacy_from_document_ocr%' OR to_regclass('public.vehicle_images') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable dm_refinement_capture_privacy_from_document_ocr* database';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE public.vision_gate_status AS ENUM ('pending','approved','review_needed','rejected_personal','rejected_misattributed','rejected');
CREATE TABLE public.vehicle_images(
  id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid,
  taken_at timestamptz, created_at timestamptz DEFAULT now(),
  source text, vision_gate_status public.vision_gate_status,
  vision_gate_agent_reasoning text, vision_gate_processed_at timestamptz,
  is_sensitive boolean DEFAULT false, sensitive_type text,
  redacted_by uuid, redacted_at timestamptz, redaction_reason text,
  image_url text, file_name text, ai_scan_metadata jsonb
);
CREATE TABLE public.capture_document_pages(
  image_id uuid PRIMARY KEY, user_id uuid, revoked_at timestamptz,
  doc_type text, extraction jsonb, date_text text
);
CREATE TABLE public.capture_set_review(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid, user_id uuid, set_key text,
  image_ids uuid[], status text NOT NULL DEFAULT 'open', created_at timestamptz DEFAULT now()
);
CREATE TABLE public.capture_landing_chunks(
  id uuid PRIMARY KEY, user_id uuid, state text, run_id uuid
);
CREATE TABLE public.capture_landing_sets(
  chunk_id uuid, set_key text, decision text, image_ids uuid[],
  PRIMARY KEY (chunk_id, set_key)
);
CREATE TABLE public.capture_upload_status(
  image_id uuid PRIMARY KEY, user_id uuid, stage text
);
CREATE TABLE public.capture_privacy_promote_exclude(
  image_id uuid PRIMARY KEY, reason text, granted_by uuid
);
CREATE TABLE public.capture_privacy_promote_log(
  run_id uuid NOT NULL, image_id uuid NOT NULL, user_id uuid NOT NULL,
  granted_by uuid NOT NULL, prior_status text, prior_reasoning text,
  prior_processed_at timestamptz, reason text NOT NULL, signature text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(), reverted_at timestamptz,
  PRIMARY KEY (run_id, image_id)
);
CREATE TABLE public.capture_non_vehicle_log(
  run_id uuid NOT NULL, image_id uuid NOT NULL, user_id uuid NOT NULL,
  granted_by uuid NOT NULL, typ text, verdict text NOT NULL, reason text NOT NULL,
  day date, signature text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz, PRIMARY KEY (run_id, image_id)
);

CREATE OR REPLACE FUNCTION public.set_image_sensitivity(
  p_image_ids UUID[], p_sensitive BOOLEAN, p_sensitive_type TEXT, p_reason TEXT, p_actor_user_id UUID
) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v_n INTEGER;
BEGIN
  IF p_image_ids IS NULL OR cardinality(p_image_ids) = 0 THEN
    RAISE EXCEPTION 'set_image_sensitivity: no image ids';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'set_image_sensitivity: a reason is required';
  END IF;
  UPDATE vehicle_images
     SET is_sensitive     = p_sensitive,
         sensitive_type   = CASE WHEN p_sensitive THEN COALESCE(p_sensitive_type, sensitive_type) ELSE NULL END,
         redaction_reason = p_reason,
         redacted_by      = p_actor_user_id,
         redacted_at      = NOW()
   WHERE id = ANY(p_image_ids);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('updated', v_n, 'requested', cardinality(p_image_ids), 'sensitive', p_sensitive);
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_image_sensitivity(UUID[], BOOLEAN, TEXT, TEXT, UUID) TO service_role;

CREATE FUNCTION pg_temp.assert_true(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'contract failed: %', msg; END IF; END $$;

\i supabase/migrations/20261116245000_capture_privacy_from_document_ocr.sql

SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.capture_privacy_from_document_ocr_v1(uuid,uuid,uuid,boolean,integer)', 'EXECUTE'), 'anon cannot run');
SELECT pg_temp.assert_true(has_function_privilege('service_role', 'public.capture_privacy_from_document_ocr_v1(uuid,uuid,uuid,boolean,integer)', 'EXECUTE'), 'service_role can run');

-- Matcher: synthetic notes only. Identity before invitation. No bare license plate.
SELECT pg_temp.assert_true(public.capture_privacy_from_document_ocr_match_v1('other','other','other',NULL,'US passport photo page') = 'identity_passport', 'passport');
SELECT pg_temp.assert_true(public.capture_privacy_from_document_ocr_match_v1('other','other','other',NULL,'passeport francais') = 'identity_passport', 'passeport');
SELECT pg_temp.assert_true(public.capture_privacy_from_document_ocr_match_v1('other','other','other',NULL,'Nevada Class C driver license') = 'identity_driver_license', 'driver license');
SELECT pg_temp.assert_true(public.capture_privacy_from_document_ocr_match_v1('other','other','other',NULL,'permis de conduire') = 'identity_driver_license', 'permis');
SELECT pg_temp.assert_true(public.capture_privacy_from_document_ocr_match_v1('other','other','other',NULL,'US permanent resident card and a Florida driver license') = 'identity_driver_license', 'combo first-match driver license');
SELECT pg_temp.assert_true(public.capture_privacy_from_document_ocr_match_v1('other','other','other',NULL,'US permanent resident card') = 'identity_residence_card', 'resident card');
SELECT pg_temp.assert_true(public.capture_privacy_from_document_ocr_match_v1('other','other','other',NULL,'Social Security card') = 'identity_ssn', 'ssn');
SELECT pg_temp.assert_true(public.capture_privacy_from_document_ocr_match_v1('other','other','other',NULL,'French national identity card') = 'identity_id_card', 'id card');
SELECT pg_temp.assert_true(public.capture_privacy_from_document_ocr_match_v1('other','other','other',NULL,'birth certificate') = 'identity_similar', 'similar');
SELECT pg_temp.assert_true(public.capture_privacy_from_document_ocr_match_v1('other','other','other',NULL,'baby shower invitation, monster-truck theme') = 'personal_invitation', 'invitation');
SELECT pg_temp.assert_true(public.capture_privacy_from_document_ocr_match_v1('other','other','other',NULL,'passport photo used on an invitation') = 'identity_passport', 'identity wins over invitation');
SELECT pg_temp.assert_true(public.capture_privacy_from_document_ocr_match_v1('other','other','other',NULL,'license plate closeup, rear bumper') IS NULL, 'license plate is not a driver license');
SELECT pg_temp.assert_true(public.capture_privacy_from_document_ocr_match_v1('title','title','other',NULL,'vehicle title, VIN visible') IS NULL, 'vehicle title is not identity');
SELECT pg_temp.assert_true(public.capture_privacy_from_document_ocr_match_v1('statement','statement','statement',NULL,'credit card statement') IS NULL, 'credit card is not an id card');
SELECT pg_temp.assert_true(public.capture_privacy_from_document_ocr_match_v1('receipt','receipt','receipt',NULL,'auto parts invoice') IS NULL, 'receipt is not a match');

INSERT INTO vehicle_images(id, user_id, vehicle_id, taken_at, created_at, image_url, is_sensitive, vision_gate_status, ai_scan_metadata) VALUES
 -- e1 passport, clocked, typ=other
 ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000aa', NULL,
  '2017-03-07 18:00+00', '2017-03-07 18:05+00',
  'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/e1.jpg', false, NULL,
  '{"classification":{"image_type":"other"}}'),
 -- e2 driver license
 ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000aa', NULL,
  '2018-10-16 18:00+00', '2018-10-16 18:05+00',
  'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/e2.jpg', false, 'pending',
  '{"classification":{"image_type":"other"}}'),
 -- e3 invitation
 ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000aa', NULL,
  '2014-08-06 04:57+00', '2014-08-06 05:00+00',
  'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/e3.jpg', false, NULL,
  '{"classification":{"image_type":"other"}}'),
 -- e4 empty_url + passport notes: skip
 ('00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-0000000000aa', NULL,
  '2017-03-07 18:00+00', '2017-03-07 18:05+00',
  '', false, NULL, '{"classification":{"image_type":"other"}}'),
 -- e5 filed passport: skip
 ('00000000-0000-4000-8000-0000000000e5', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000b1',
  '2017-03-07 18:00+00', '2017-03-07 18:05+00',
  'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/e5.jpg', false, NULL,
  '{"classification":{"image_type":"other"}}'),
 -- e6 already private
 ('00000000-0000-4000-8000-0000000000e6', '00000000-0000-4000-8000-0000000000aa', NULL,
  '2017-03-07 18:00+00', '2017-03-07 18:05+00',
  'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/e6.jpg', true, 'rejected_personal',
  '{"classification":{"image_type":"other"}}'),
 -- e7 exclude list
 ('00000000-0000-4000-8000-0000000000e7', '00000000-0000-4000-8000-0000000000aa', NULL,
  '2017-03-07 18:00+00', '2017-03-07 18:05+00',
  'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/e7.jpg', false, NULL,
  '{"classification":{"image_type":"other"}}'),
 -- e8 license plate, should not match
 ('00000000-0000-4000-8000-0000000000e8', '00000000-0000-4000-8000-0000000000aa', NULL,
  '2017-03-07 18:00+00', '2017-03-07 18:05+00',
  'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/e8.jpg', false, NULL,
  '{"classification":{"image_type":"part_closeup"}}'),
 -- e9 invitation already non_vehicle
 ('00000000-0000-4000-8000-0000000000e9', '00000000-0000-4000-8000-0000000000aa', NULL,
  '2014-08-06 04:57+00', '2014-08-06 05:00+00',
  'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/e9.jpg', false, NULL,
  '{"classification":{"image_type":"other"}}'),
 -- e10 identity in an open review: include
 ('00000000-0000-4000-8000-0000000000ea', '00000000-0000-4000-8000-0000000000aa', NULL,
  '2020-09-22 18:00+00', '2020-09-22 18:05+00',
  'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/ea.jpg', false, 'pending',
  '{"classification":{"image_type":"other"}}'),
 -- e11 invitation that is already is_sensitive: skip nv
 ('00000000-0000-4000-8000-0000000000eb', '00000000-0000-4000-8000-0000000000aa', NULL,
  '2014-08-06 04:57+00', '2014-08-06 05:00+00',
  'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/eb.jpg', true, NULL,
  '{"classification":{"image_type":"other"}}'),
 -- e12 failed upload passport: skip
 ('00000000-0000-4000-8000-0000000000ec', '00000000-0000-4000-8000-0000000000aa', NULL,
  '2017-03-07 18:00+00', '2017-03-07 18:05+00',
  'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/ec.jpg', false, NULL,
  '{"classification":{"image_type":"other"}}'),
 -- e13 extra passports for cap
 ('00000000-0000-4000-8000-0000000000ed', '00000000-0000-4000-8000-0000000000aa', NULL,
  '2017-03-07 18:00+00', '2017-03-07 18:05+00',
  'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/ed.jpg', false, NULL,
  '{"classification":{"image_type":"other"}}'),
 ('00000000-0000-4000-8000-0000000000ee', '00000000-0000-4000-8000-0000000000aa', NULL,
  '2017-03-07 18:00+00', '2017-03-07 18:05+00',
  'https://proj.supabase.co/storage/v1/object/public/vehicle-photos/ee.jpg', false, NULL,
  '{"classification":{"image_type":"other"}}');

INSERT INTO capture_document_pages(image_id, user_id, revoked_at, doc_type, extraction) VALUES
 ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000aa', NULL, 'other', '{"document_type":"other","landed_type":"other","notes":"US passport photo page"}'),
 ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000aa', NULL, 'other', '{"document_type":"other","landed_type":"other","notes":"Nevada Class C driver license"}'),
 ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000aa', NULL, 'other', '{"document_type":"other","landed_type":"other","notes":"baby shower invitation, monster-truck theme"}'),
 ('00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-0000000000aa', NULL, 'other', '{"document_type":"other","landed_type":"other","notes":"US passport photo page"}'),
 ('00000000-0000-4000-8000-0000000000e5', '00000000-0000-4000-8000-0000000000aa', NULL, 'other', '{"document_type":"other","landed_type":"other","notes":"US passport photo page"}'),
 ('00000000-0000-4000-8000-0000000000e6', '00000000-0000-4000-8000-0000000000aa', NULL, 'other', '{"document_type":"other","landed_type":"other","notes":"US passport photo page"}'),
 ('00000000-0000-4000-8000-0000000000e7', '00000000-0000-4000-8000-0000000000aa', NULL, 'other', '{"document_type":"other","landed_type":"other","notes":"US passport photo page"}'),
 ('00000000-0000-4000-8000-0000000000e8', '00000000-0000-4000-8000-0000000000aa', NULL, 'other', '{"document_type":"other","landed_type":"other","notes":"license plate closeup, rear bumper"}'),
 ('00000000-0000-4000-8000-0000000000e9', '00000000-0000-4000-8000-0000000000aa', NULL, 'other', '{"document_type":"other","landed_type":"other","notes":"baby shower invitation"}'),
 ('00000000-0000-4000-8000-0000000000ea', '00000000-0000-4000-8000-0000000000aa', NULL, 'other', '{"document_type":"other","landed_type":"other","notes":"French national identity card"}'),
 ('00000000-0000-4000-8000-0000000000eb', '00000000-0000-4000-8000-0000000000aa', NULL, 'other', '{"document_type":"other","landed_type":"other","notes":"wedding invitation"}'),
 ('00000000-0000-4000-8000-0000000000ec', '00000000-0000-4000-8000-0000000000aa', NULL, 'other', '{"document_type":"other","landed_type":"other","notes":"US passport photo page"}'),
 ('00000000-0000-4000-8000-0000000000ed', '00000000-0000-4000-8000-0000000000aa', NULL, 'other', '{"document_type":"other","landed_type":"other","notes":"US passport photo page"}'),
 ('00000000-0000-4000-8000-0000000000ee', '00000000-0000-4000-8000-0000000000aa', NULL, 'other', '{"document_type":"other","landed_type":"other","notes":"US passport photo page"}');

INSERT INTO capture_privacy_promote_exclude(image_id, reason, granted_by)
VALUES ('00000000-0000-4000-8000-0000000000e7', 'privacy_backup_union', '00000000-0000-4000-8000-0000000000aa');

INSERT INTO capture_non_vehicle_log(run_id, image_id, user_id, granted_by, typ, verdict, reason, day, signature)
VALUES ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e9',
        '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000000aa',
        'other', 'non_vehicle', 'prior', '2014-08-06', 'prior');

INSERT INTO capture_set_review(run_id, user_id, set_key, image_ids, status)
VALUES ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000aa', 'held-ea',
        ARRAY['00000000-0000-4000-8000-0000000000ea'::uuid], 'open');

INSERT INTO capture_upload_status(image_id, user_id, stage)
VALUES ('00000000-0000-4000-8000-0000000000ec', '00000000-0000-4000-8000-0000000000aa', 'failed');

-- Eligible without cap: e1, e2, e3, ea, ed, ee = 6. Skips: e4 empty, e5 filed, e6 already private,
-- e7 exclude, e8 no match, e9 already nv, eb already sensitive invitation, ec failed.
-- Dry writes nothing.
SELECT public.capture_privacy_from_document_ocr_v1(
  '00000000-0000-4000-8000-0000000000aa',
  '00000000-0000-4000-8000-0000000000d1',
  '00000000-0000-4000-8000-0000000000aa',
  true, 50) AS dry1 \gset
SELECT pg_temp.assert_true((:'dry1'::jsonb->>'dry_run')::boolean, 'dry flag');
SELECT pg_temp.assert_true((:'dry1'::jsonb->>'eligible')::int = 6, 'eligible is 6');
SELECT pg_temp.assert_true((:'dry1'::jsonb->>'would_apply')::int = 6, 'would apply 6');
SELECT pg_temp.assert_true((:'dry1'::jsonb->>'would_private')::int = 5, 'would private 5');
SELECT pg_temp.assert_true((:'dry1'::jsonb->>'would_non_vehicle')::int = 1, 'would nv 1');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_privacy_promote_log) = 0, 'dry wrote no privacy log');
SELECT pg_temp.assert_true((SELECT count(*) FROM capture_non_vehicle_log WHERE signature LIKE 'privacy_from_document_ocr_v1%') = 0, 'dry wrote no nv log');
SELECT pg_temp.assert_true((SELECT is_sensitive IS FALSE FROM vehicle_images WHERE id = '00000000-0000-4000-8000-0000000000e1'), 'dry did not set sensitive');

-- Cap 2 takes the first two ids (e1, e2), both private.
SELECT public.capture_privacy_from_document_ocr_v1(
  '00000000-0000-4000-8000-0000000000aa',
  '00000000-0000-4000-8000-0000000000d2',
  '00000000-0000-4000-8000-0000000000aa',
  false, 2) AS cap2 \gset
SELECT pg_temp.assert_true((:'cap2'::jsonb->>'applied_n')::int = 2, 'cap 2 applied');
SELECT pg_temp.assert_true((:'cap2'::jsonb->>'eligible')::int = 6, 'cap run still sees 6 eligible');
SELECT pg_temp.assert_true((:'cap2'::jsonb->>'remaining_after')::int = 4, '4 remain after cap 2');
SELECT pg_temp.assert_true((SELECT vision_gate_status::text FROM vehicle_images WHERE id = '00000000-0000-4000-8000-0000000000e1') = 'rejected_personal', 'e1 private');
SELECT pg_temp.assert_true((SELECT is_sensitive AND sensitive_type = 'document' FROM vehicle_images WHERE id = '00000000-0000-4000-8000-0000000000e1'), 'e1 sensitive document');
SELECT pg_temp.assert_true((SELECT taken_at = '2017-03-07 18:00+00' FROM vehicle_images WHERE id = '00000000-0000-4000-8000-0000000000e1'), 'e1 taken_at kept');
SELECT pg_temp.assert_true((SELECT image_url LIKE '%/e1.jpg' FROM vehicle_images WHERE id = '00000000-0000-4000-8000-0000000000e1'), 'e1 url kept');
SELECT pg_temp.assert_true((SELECT vision_gate_status::text FROM vehicle_images WHERE id = '00000000-0000-4000-8000-0000000000e2') = 'rejected_personal', 'e2 private');
SELECT pg_temp.assert_true((SELECT vision_gate_status IS NULL FROM vehicle_images WHERE id = '00000000-0000-4000-8000-0000000000e3'), 'e3 not yet written under cap 2');

-- Revert cap run, then apply the rest at cap 50.
SELECT public.capture_privacy_from_document_ocr_revert_v1(
  '00000000-0000-4000-8000-0000000000aa',
  '00000000-0000-4000-8000-0000000000d2') AS rev_cap \gset
SELECT pg_temp.assert_true((:'rev_cap'::jsonb->>'reverted_private')::int = 2, 'reverted cap 2');
SELECT pg_temp.assert_true((SELECT vision_gate_status IS NULL AND is_sensitive IS FALSE FROM vehicle_images WHERE id = '00000000-0000-4000-8000-0000000000e1'), 'e1 restored');
SELECT pg_temp.assert_true((SELECT vision_gate_status::text = 'pending' AND is_sensitive IS FALSE FROM vehicle_images WHERE id = '00000000-0000-4000-8000-0000000000e2'), 'e2 restored to pending');
SELECT pg_temp.assert_true((SELECT taken_at = '2017-03-07 18:00+00' FROM vehicle_images WHERE id = '00000000-0000-4000-8000-0000000000e1'), 'revert kept taken_at');

SELECT public.capture_privacy_from_document_ocr_v1(
  '00000000-0000-4000-8000-0000000000aa',
  '00000000-0000-4000-8000-0000000000d3',
  '00000000-0000-4000-8000-0000000000aa',
  false, 50) AS signed \gset
SELECT pg_temp.assert_true((:'signed'::jsonb->>'applied_n')::int = 6, 'signed applied 6');
SELECT pg_temp.assert_true((:'signed'::jsonb->>'promoted_private')::int = 5, '5 private');
SELECT pg_temp.assert_true((:'signed'::jsonb->>'routed_non_vehicle')::int = 1, '1 nv');
SELECT pg_temp.assert_true((:'signed'::jsonb->>'remaining_after')::int = 0, 'nothing left');

SELECT pg_temp.assert_true((
  SELECT count(*) FROM vehicle_images
  WHERE id IN ('00000000-0000-4000-8000-0000000000e1','00000000-0000-4000-8000-0000000000e2',
               '00000000-0000-4000-8000-0000000000ea','00000000-0000-4000-8000-0000000000ed',
               '00000000-0000-4000-8000-0000000000ee')
    AND vision_gate_status::text = 'rejected_personal' AND is_sensitive
) = 5, 'five identity frames private');
SELECT pg_temp.assert_true((
  SELECT count(*) FROM capture_set_review WHERE status = 'open' AND set_key = 'held-ea'
) = 1, 'open review for held identity frame was not deleted');
SELECT pg_temp.assert_true((
  SELECT vision_gate_status::text = 'rejected_personal' FROM vehicle_images WHERE id = '00000000-0000-4000-8000-0000000000ea'
), 'held identity frame still went private');
SELECT pg_temp.assert_true((
  SELECT count(*) FROM capture_non_vehicle_log
  WHERE image_id = '00000000-0000-4000-8000-0000000000e3' AND reverted_at IS NULL AND verdict = 'non_vehicle'
    AND reason = 'personal_invitation'
) = 1, 'invitation on non_vehicle log');
SELECT pg_temp.assert_true((
  SELECT is_sensitive IS FALSE AND vision_gate_status IS NULL AND taken_at = '2014-08-06 04:57+00'
  FROM vehicle_images WHERE id = '00000000-0000-4000-8000-0000000000e3'
), 'invitation kept taken_at and was not marked sensitive');
SELECT pg_temp.assert_true((
  SELECT count(*) FROM capture_non_vehicle_log
  WHERE image_id = '00000000-0000-4000-8000-0000000000e9' AND reverted_at IS NULL
) = 1, 'prior nv log left in place');
SELECT pg_temp.assert_true((
  SELECT count(*) FROM vehicle_images
) = 14, 'never deleted a vehicle_images row');
SELECT pg_temp.assert_true((
  SELECT count(*) FROM capture_document_pages
) = 14, 'never deleted a document page');
SELECT pg_temp.assert_true((
  SELECT image_url = '' FROM vehicle_images WHERE id = '00000000-0000-4000-8000-0000000000e4'
), 'empty_url row untouched');
SELECT pg_temp.assert_true((
  SELECT vehicle_id IS NOT NULL AND vision_gate_status IS NULL FROM vehicle_images WHERE id = '00000000-0000-4000-8000-0000000000e5'
), 'filed row untouched');
SELECT pg_temp.assert_true((
  SELECT vision_gate_status IS NULL FROM vehicle_images WHERE id = '00000000-0000-4000-8000-0000000000e8'
), 'license plate unmatched and untouched');
SELECT pg_temp.assert_true((
  SELECT is_sensitive AND vision_gate_status IS NULL FROM vehicle_images WHERE id = '00000000-0000-4000-8000-0000000000eb'
), 'already-sensitive invitation was not routed to non_vehicle');

-- Revert signed run.
SELECT public.capture_privacy_from_document_ocr_revert_v1(
  '00000000-0000-4000-8000-0000000000aa',
  '00000000-0000-4000-8000-0000000000d3') AS rev \gset
SELECT pg_temp.assert_true((:'rev'::jsonb->>'reverted_private')::int = 5, 'reverted 5 private');
SELECT pg_temp.assert_true((:'rev'::jsonb->>'reverted_non_vehicle')::int = 1, 'reverted 1 nv');
SELECT pg_temp.assert_true((
  SELECT is_sensitive IS FALSE AND vision_gate_status IS NULL AND taken_at = '2017-03-07 18:00+00'
  FROM vehicle_images WHERE id = '00000000-0000-4000-8000-0000000000e1'
), 'signed revert restored e1 and kept taken_at');
SELECT pg_temp.assert_true((
  SELECT vision_gate_status::text = 'pending' FROM vehicle_images WHERE id = '00000000-0000-4000-8000-0000000000ea'
), 'held frame restored to pending, review remains');
SELECT pg_temp.assert_true((
  SELECT count(*) FROM capture_non_vehicle_log
  WHERE image_id = '00000000-0000-4000-8000-0000000000e3' AND reverted_at IS NULL
) = 0, 'invitation nv log marked reverted');
SELECT pg_temp.assert_true((
  SELECT count(*) FROM capture_non_vehicle_log
  WHERE image_id = '00000000-0000-4000-8000-0000000000e9' AND reverted_at IS NULL
) = 1, 'prior nv log not reverted');
SELECT pg_temp.assert_true((
  SELECT count(*) FROM capture_document_pages
) = 14, 'revert did not delete pages');

\i supabase/sql/revert_20261116245000_capture_privacy_from_document_ocr.sql
SELECT pg_temp.assert_true(to_regprocedure('public.capture_privacy_from_document_ocr_v1(uuid,uuid,uuid,boolean,integer)') IS NULL, 'producer dropped');
SELECT pg_temp.assert_true(to_regprocedure('public.capture_privacy_from_document_ocr_match_v1(text,text,text,text,text)') IS NULL, 'matcher dropped');
SELECT pg_temp.assert_true(
  NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'capture_privacy_promote_log' AND column_name = 'rule_id'
  ), 'rule_id column dropped');
