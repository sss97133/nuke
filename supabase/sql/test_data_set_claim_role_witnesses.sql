-- Contract for 20261124194800_data_set_claim_role_witnesses (empty disposable PG17; minimal data_set_candidates_v1 and
-- model_fold_logic_key holding the live anchors verbatim). Asserts: a reading of another method with a mapped claim role
-- becomes a trans_type candidate keyed like the decode path, with vehicle and photo members; a decode-method reading is
-- not doubled; an unmapped role, a superseded reading and an unreadable value are not admitted; editing a rule row moves
-- the logic key; the patch is idempotent.
-- ALLOW_RAW_TESTIMONY_WRITE: synthetic fixtures in a disposable database only.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF to_regclass('public.vehicle_observations') IS NOT NULL THEN RAISE EXCEPTION 'Requires an empty disposable database'; END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, make text, deleted_at timestamptz);
CREATE TABLE public.vehicle_images (id uuid PRIMARY KEY, vehicle_id uuid);
CREATE TABLE public.vehicle_observations (id uuid PRIMARY KEY, vehicle_id uuid, extraction_method text, structured_data jsonb,
  confidence_score numeric, is_superseded boolean DEFAULT false);
CREATE TABLE public.observation_witnesses (observation_id uuid, image_id uuid);
CREATE TABLE public.vehicle_decode_rules (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), superseded_at timestamptz);
CREATE TABLE public.vehicle_facet_claim_roles (role text, field text, item_key text, nk text, detail text[], PRIMARY KEY (role, field, item_key));
INSERT INTO public.vehicle_facet_claim_roles VALUES
  ('identified_transmission_housing', 'transmission', 'transmission.current.type', 'transmission_type', NULL),
  ('transmission_id_stamp', 'transmission', 'transmission.current.type', 'transmission_type', NULL),
  ('nominal_engine_displacement', 'engine_size', 'engine.current.displacement', 'displacement', NULL);
CREATE FUNCTION public.vehicle_facet_norm(p_kind text, p_value text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE WHEN p_value ~* 'manual|speed' THEN 'manual' WHEN p_value ~* 'automatic' THEN 'automatic' END $f$;
CREATE FUNCTION public.data_set_rule_label(p_rule text, p_mk text, p_code text, p_year integer) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_object('label', p_code) $f$;
CREATE FUNCTION public.model_fold_config() RETURNS jsonb LANGUAGE sql AS $f$ SELECT '{"decoder":"d1"}'::jsonb $f$;
CREATE FUNCTION public.model_fold_logic_key() RETURNS text LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  select md5('x'
          || '|' || coalesce(public.model_fold_config() ->> 'decoder', '')
          || '|' || coalesce((select md5(string_agg(r.id::text || ':' || coalesce(r.superseded_at::text, ''), ',' order by r.id))
                                from public.vehicle_decode_rules r), ''))
$function$;
CREATE FUNCTION public.data_set_candidates_v1(p_vehicles uuid[])
 RETURNS TABLE(set_kind text, set_key text, set_label text, set_provenance jsonb, member_type text, member_id uuid, vehicle_id uuid,
   basis_type text, basis_id uuid, basis_detail jsonb, confidence numeric, member_rule_version text)
 LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH v AS (SELECT x.id, lower(btrim(x.make)) AS mk FROM public.vehicles x WHERE x.id = ANY (p_vehicles) AND x.deleted_at IS NULL),
  obs_out AS (
    SELECT 'trans_type'::text, 'pontiac:manual'::text, NULL::text, '{}'::jsonb, 'vehicle'::text, o.vehicle_id, o.vehicle_id,
           'observation'::text, o.id, '{}'::jsonb, 0.5::numeric, o.extraction_method
      FROM public.vehicle_observations o JOIN v ON v.id = o.vehicle_id WHERE o.extraction_method = 'trans_id_stamp_decode_v1'),
  -- Text code readings (vehicle_code_readings, text_code_decode_v1 / v2): keyed by data_set_code_key_v1, one cited read each.
  crd_out AS (SELECT * FROM obs_out WHERE false)
  SELECT * FROM obs_out
  UNION ALL SELECT * FROM obs_out
  UNION ALL SELECT * FROM crd_out
$function$;

INSERT INTO public.vehicles VALUES ('20000000-0000-0000-0000-000000000001', 'Pontiac', NULL);
INSERT INTO public.vehicle_images VALUES ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001'),
                                         ('30000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000099');
INSERT INTO public.vehicle_observations (id, vehicle_id, extraction_method, structured_data, is_superseded) VALUES
 ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'interactive_physical_source_review_v1',
  '{"claim_role":"identified_transmission_housing","transmission":"Muncie four-speed manual"}', false),
 ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'trans_id_stamp_decode_v1',
  '{"claim_role":"transmission_id_stamp","transmission":"manual"}', false),
 ('40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', 'interactive_physical_source_review_v1',
  '{"claim_role":"identified_transmission_housing","transmission":"Muncie four-speed manual"}', true),
 ('40000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000001', 'interactive_physical_source_review_v1',
  '{"claim_role":"identified_transmission_housing","transmission":"unclear"}', false),
 ('40000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000001', 'interactive_physical_source_review_v1',
  '{"claim_role":"nominal_engine_displacement","engine_size":"400"}', false);
INSERT INTO public.observation_witnesses VALUES
 ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'),
 ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000009');
CREATE TEMP TABLE k0 AS SELECT public.model_fold_logic_key() AS k;

\ir ../migrations/20261124194800_data_set_claim_role_witnesses.sql
\ir ../migrations/20261124194800_data_set_claim_role_witnesses.sql

DO $$
DECLARE k1 text;
BEGIN
  ASSERT (SELECT count(*) FROM public.data_set_candidates_v1(ARRAY['20000000-0000-0000-0000-000000000001'::uuid]) c
           WHERE c.basis_id = '40000000-0000-0000-0000-000000000001') = 2, 'the role reading: vehicle + its own photo';
  ASSERT (SELECT array_agg(c.set_key || '/' || c.member_type ORDER BY c.member_type)
            FROM public.data_set_candidates_v1(ARRAY['20000000-0000-0000-0000-000000000001'::uuid]) c
           WHERE c.basis_id = '40000000-0000-0000-0000-000000000001') = ARRAY['pontiac:manual/image', 'pontiac:manual/vehicle'], 'keyed as the decode path';
  ASSERT (SELECT member_id FROM public.data_set_candidates_v1(ARRAY['20000000-0000-0000-0000-000000000001'::uuid]) c
           WHERE c.basis_id = '40000000-0000-0000-0000-000000000001' AND c.member_type = 'image') = '30000000-0000-0000-0000-000000000001',
    'a photo of another vehicle is not a member';
  ASSERT (SELECT count(*) FROM public.data_set_candidates_v1(ARRAY['20000000-0000-0000-0000-000000000001'::uuid]) c
           WHERE c.basis_id = '40000000-0000-0000-0000-000000000002') = 2, 'decode-method reading keeps its own path only (2 = the stub union)';
  ASSERT NOT EXISTS (SELECT 1 FROM public.data_set_candidates_v1(ARRAY['20000000-0000-0000-0000-000000000001'::uuid]) c
           WHERE c.basis_id IN ('40000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000005')),
    'superseded, unreadable and unmapped readings are not admitted';
  k1 := public.model_fold_logic_key();
  ASSERT k1 <> (SELECT k FROM k0), 'the logic key covers the rule rows';
  UPDATE public.data_set_item_kinds SET note = note || '.';
  ASSERT public.model_fold_logic_key() <> k1, 'editing a rule row moves the logic key';
  ASSERT (SELECT count(*) FROM regexp_matches(pg_get_functiondef('public.data_set_candidates_v1(uuid[])'::regprocedure), 'role_out', 'g')) = 2, 'patched once';
END $$;
\echo data_set_claim_role_witnesses: ok
