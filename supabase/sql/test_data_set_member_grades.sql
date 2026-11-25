-- Contract for 20261124193700_data_set_member_grades (empty disposable PG17; dependencies stubbed, fixtures synthetic).
-- Asserts: a membership is graded by its witnesses' classes (spans of one text are one witness, text only is mentioned, a
-- decode establishes alone, two registered photo readings establish, one does not); two supported values of an exclusive
-- kind are a conflict, a non-exclusive kind is not; at most one established value per exclusive kind (index); the fold
-- loop grades after it applies; the backfill pages and stops; public counts and vehicle_data_sets split by grade; anon
-- reads none of it.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF to_regclass('public.vehicles') IS NOT NULL THEN RAISE EXCEPTION 'Requires an empty disposable database'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, is_public boolean DEFAULT true, deleted_at timestamptz);
CREATE TABLE public.observation_properties (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), property_key text, deprecated_at timestamptz);
INSERT INTO public.observation_properties (property_key) VALUES ('transmission_type'), ('transmission_speeds'), ('transmission_model');
CREATE TABLE public.data_sets (id uuid PRIMARY KEY, set_kind text, set_key text, label text, rule_version text);
CREATE TABLE public.data_set_members (id bigserial PRIMARY KEY, set_id uuid, member_type text, member_id uuid, vehicle_id uuid,
  basis_type text, basis_id uuid, confidence numeric, rule_version text, state text DEFAULT 'active');
CREATE TABLE public.vehicle_observations (id uuid PRIMARY KEY, vehicle_id uuid, extraction_method text, agent_model text);
CREATE TABLE public.observation_witnesses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), observation_id uuid, image_id uuid);
CREATE TABLE public.field_evidence (id uuid PRIMARY KEY, vehicle_id uuid, source_type text, extraction_context text, raw_extraction_data jsonb);
CREATE TABLE public.vehicle_code_readings (id uuid PRIMARY KEY, vehicle_id uuid, origin_table text, origin_id uuid);
CREATE TABLE public.data_set_public_counts (set_id uuid PRIMARY KEY, public_vehicles integer, counted_at timestamptz);
CREATE TABLE public.platform_config (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), config_key text UNIQUE NOT NULL,
  config_value jsonb NOT NULL, description text, updated_at timestamptz, updated_by text);
-- as 20261124193600 makes it
CREATE TABLE public.evidence_class_rank (class text PRIMARY KEY, rank integer, is_witness boolean NOT NULL, note text NOT NULL);
INSERT INTO public.evidence_class_rank VALUES ('decode', 0, true, 'n'), ('receipt', 1, true, 'n'), ('reading_registered', 2, true, 'n'),
  ('claim', 3, true, 'n'), ('reading_unregistered', 4, true, 'n'), ('record', NULL, false, 'n'), ('record_mirror', NULL, false, 'n');
CREATE FUNCTION public.reader_lineage(p text) RETURNS text LANGUAGE sql STABLE AS $f$ SELECT CASE WHEN p LIKE 'claude-%' THEN 'anthropic' END $f$;
CREATE FUNCTION public.data_set_can_read_vehicle(p uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT true $f$;
-- the live fold and apply, reduced to the lines the migration anchors on
CREATE FUNCTION public.data_set_membership_apply_v1(r uuid, a int, b int, c boolean) RETURNS jsonb LANGUAGE sql AS $f$ SELECT '{}'::jsonb $f$;
CREATE FUNCTION public.model_fold_one(p_tick uuid, p_vehicle uuid, p_cfg jsonb, p_edited uuid[] DEFAULT '{}'::uuid[])
RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'public' AS $f$
declare v_mem uuid := gen_random_uuid(); a jsonb;
begin
  a := public.data_set_membership_apply_v1(v_mem, 500, 200, false);
  return a;
end $f$;
-- vehicle_data_sets as live (20261124025000)
CREATE OR REPLACE FUNCTION public.vehicle_data_sets(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '8s'
AS $function$
DECLARE v_out jsonb;
BEGIN
  IF p_vehicle_id IS NULL OR NOT public.data_set_can_read_vehicle(p_vehicle_id) THEN
    RETURN jsonb_build_object('vehicle_id', p_vehicle_id, 'error', 'not_found_or_not_public');
  END IF;
  WITH mine AS (
    SELECT m.set_id, max(m.confidence) AS conf,
           count(*) FILTER (WHERE m.member_type = 'vehicle') AS n_vehicle_bases,
           count(*) FILTER (WHERE m.member_type = 'image') AS n_images,
           count(*) FILTER (WHERE m.member_type = 'auction_comment') AS n_comments,
           jsonb_agg(DISTINCT jsonb_build_object('basis_type', m.basis_type, 'basis_id', m.basis_id, 'rule', m.rule_version,
                                                 'confidence', m.confidence))
             FILTER (WHERE m.member_type = 'vehicle') AS bases
      FROM public.data_set_members m
     WHERE m.vehicle_id = p_vehicle_id AND m.state = 'active'
     GROUP BY m.set_id),
  sets AS (
    SELECT s.id, s.set_kind, s.set_key, s.label, s.rule_version, mine.*,
           coalesce(pc.public_vehicles,
             (SELECT count(DISTINCT m2.vehicle_id) FROM public.data_set_members m2
                JOIN public.vehicles pv ON pv.id = m2.vehicle_id AND pv.is_public IS TRUE AND pv.deleted_at IS NULL
               WHERE m2.set_id = s.id AND m2.state = 'active' AND m2.member_type IN ('vehicle','auction_comment'))) AS n_vehicles,
           pc.counted_at
      FROM mine JOIN public.data_sets s ON s.id = mine.set_id
      LEFT JOIN public.data_set_public_counts pc ON pc.set_id = s.id)
  SELECT jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'sets', coalesce(jsonb_agg(jsonb_build_object(
        'set_id', sets.id, 'set_kind', sets.set_kind, 'set_key', sets.set_key, 'label', sets.label,
        'confidence', sets.conf, 'public_vehicles_in_set', sets.n_vehicles, 'public_vehicles_counted_at', sets.counted_at,
        'evidence', jsonb_build_object('vehicle_bases', coalesce(sets.bases, '[]'::jsonb), 'images', sets.n_images,
                                       'comments', sets.n_comments))
        ORDER BY sets.set_kind, sets.set_key), '[]'::jsonb))
    INTO v_out FROM sets;
  RETURN v_out;
END
$function$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vehicle_data_sets(uuid) TO anon;

-- vehicle 1: trans_type automatic (3 spans of one description + 1 comment) and manual (2 photo readings by a registered
-- reader, one by an unregistered one); trans_speeds 4 by a VIN decode; trans_model muncie and th400 by one claim each;
-- rpo_code two codes by claims (not exclusive). vehicle 2: trans_type manual, one registered photo reading.
INSERT INTO public.vehicles (id) VALUES ('10000000-0000-0000-0000-000000000001'), ('10000000-0000-0000-0000-000000000002');
INSERT INTO public.data_sets VALUES
 ('d0000000-0000-0000-0000-000000000001', 'trans_type', 'automatic', 'a', 'r'), ('d0000000-0000-0000-0000-000000000002', 'trans_type', 'manual', 'm', 'r'),
 ('d0000000-0000-0000-0000-000000000003', 'trans_speeds', '4', '4', 'r'), ('d0000000-0000-0000-0000-000000000004', 'trans_model', 'muncie', 'mu', 'r'),
 ('d0000000-0000-0000-0000-000000000005', 'trans_model', 'th400', 'th', 'r'), ('d0000000-0000-0000-0000-000000000006', 'rpo_code', 'm20', 'm20', 'r'),
 ('d0000000-0000-0000-0000-000000000007', 'rpo_code', 'g80', 'g80', 'r');
INSERT INTO public.vehicle_observations VALUES
 ('0b000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'physical_transcription_v1', 'claude-sonnet'),
 ('0b000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'physical_transcription_v1', 'claude-opus'),
 ('0b000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'ai_visual', NULL),
 ('0b000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', 'physical_transcription_v1', 'claude-sonnet');
INSERT INTO public.observation_witnesses (observation_id, image_id) VALUES
 ('0b000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001'),
 ('0b000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002'),
 ('0b000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000003'),
 ('0b000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000004');
INSERT INTO public.field_evidence VALUES
 ('fe000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'bat', NULL, NULL),
 ('fe000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'bat_listing', NULL, NULL),
 ('fe000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'nhtsa', 'vin_decode_gm_v1 via observation-writer', NULL);
INSERT INTO public.vehicle_code_readings VALUES
 ('c0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'vehicles', '10000000-0000-0000-0000-000000000001'),
 ('c0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'vehicles', '10000000-0000-0000-0000-000000000001'),
 ('c0000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'vehicles', '10000000-0000-0000-0000-000000000001'),
 ('c0000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'auction_comments', 'ac000000-0000-0000-0000-000000000001'),
 ('c0000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'field_evidence', 'fe000000-0000-0000-0000-000000000003');
INSERT INTO public.data_set_members (set_id, member_type, member_id, vehicle_id, basis_type, basis_id) VALUES
 ('d0000000-0000-0000-0000-000000000001', 'vehicle', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'code_reading', 'c0000000-0000-0000-0000-000000000001'),
 ('d0000000-0000-0000-0000-000000000001', 'vehicle', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'code_reading', 'c0000000-0000-0000-0000-000000000002'),
 ('d0000000-0000-0000-0000-000000000001', 'vehicle', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'code_reading', 'c0000000-0000-0000-0000-000000000003'),
 ('d0000000-0000-0000-0000-000000000001', 'vehicle', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'code_reading', 'c0000000-0000-0000-0000-000000000004'),
 ('d0000000-0000-0000-0000-000000000002', 'vehicle', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'observation', '0b000000-0000-0000-0000-000000000001'),
 ('d0000000-0000-0000-0000-000000000002', 'vehicle', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'observation', '0b000000-0000-0000-0000-000000000002'),
 ('d0000000-0000-0000-0000-000000000002', 'vehicle', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'observation', '0b000000-0000-0000-0000-000000000003'),
 ('d0000000-0000-0000-0000-000000000003', 'vehicle', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'code_reading', 'c0000000-0000-0000-0000-000000000005'),
 ('d0000000-0000-0000-0000-000000000004', 'vehicle', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'field_evidence', 'fe000000-0000-0000-0000-000000000001'),
 ('d0000000-0000-0000-0000-000000000005', 'vehicle', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'field_evidence', 'fe000000-0000-0000-0000-000000000002'),
 ('d0000000-0000-0000-0000-000000000006', 'vehicle', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'field_evidence', 'fe000000-0000-0000-0000-000000000001'),
 ('d0000000-0000-0000-0000-000000000007', 'vehicle', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'field_evidence', 'fe000000-0000-0000-0000-000000000002'),
 ('d0000000-0000-0000-0000-000000000002', 'vehicle', '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'observation', '0b000000-0000-0000-0000-000000000004');

\ir ../migrations/20261124193700_data_set_member_grades.sql
\ir ../migrations/20261124193700_data_set_member_grades.sql

DO $$
DECLARE r jsonb; g record; vds jsonb;
BEGIN
  r := public.data_set_grade_vehicle('10000000-0000-0000-0000-000000000001');
  ASSERT (r->>'graded')::int = 7, 'seven memberships graded; got ' || r::text;
  SELECT * INTO g FROM public.data_set_member_grades WHERE set_id = 'd0000000-0000-0000-0000-000000000001';
  ASSERT g.grade = 'mentioned' AND g.n_witnesses = 2 AND g.witness_classes = '{mentioned}',
    'automatic: three spans of one description and one comment are two mentions; got ' || g.grade || ' ' || g.n_witnesses;
  SELECT * INTO g FROM public.data_set_member_grades WHERE set_id = 'd0000000-0000-0000-0000-000000000002' AND vehicle_id = '10000000-0000-0000-0000-000000000001';
  ASSERT g.grade = 'established' AND g.n_witnesses = 3, 'manual: two registered photo readings establish; got ' || g.grade;
  ASSERT (SELECT grade FROM public.data_set_member_grades WHERE set_id = 'd0000000-0000-0000-0000-000000000003') = 'established',
    'speeds: a decode establishes alone';
  ASSERT (SELECT array_agg(grade ORDER BY set_id)::text[] FROM public.data_set_member_grades WHERE set_kind = 'trans_model') = '{conflict,conflict}',
    'two supported models of an exclusive kind are a conflict';
  ASSERT (SELECT array_agg(grade ORDER BY set_id)::text[] FROM public.data_set_member_grades WHERE set_kind = 'rpo_code') = '{supported,supported}',
    'a non-exclusive kind holds both';

  -- the backfill grades vehicle 2 and stops (the cron row is absent in this database)
  r := public.data_set_grades_backfill_v1(1);
  ASSERT (r->>'cursor')::uuid = '10000000-0000-0000-0000-000000000001', 'first page';
  r := public.data_set_grades_backfill_v1(1);
  ASSERT (SELECT grade FROM public.data_set_member_grades WHERE vehicle_id = '10000000-0000-0000-0000-000000000002') = 'supported',
    'one registered photo reading supports, not establishes';
  r := public.data_set_grades_backfill_v1(1);
  ASSERT (r->>'done')::boolean, 'the lap ends; got ' || r::text;
  ASSERT (public.data_set_grades_backfill_v1(1)->>'done')::boolean, 'and stays done';

  -- a second registered reading of one photo is not a second witness; a membership gone is removed
  UPDATE public.data_set_members SET state = 'superseded' WHERE set_id = 'd0000000-0000-0000-0000-000000000005';
  INSERT INTO public.vehicle_observations VALUES ('0b000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000002', 'physical_transcription_v1', 'claude-opus');
  INSERT INTO public.observation_witnesses (observation_id, image_id) VALUES ('0b000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000004');
  INSERT INTO public.data_set_members (set_id, member_type, member_id, vehicle_id, basis_type, basis_id) VALUES
   ('d0000000-0000-0000-0000-000000000002', 'vehicle', '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'observation', '0b000000-0000-0000-0000-000000000005');
  PERFORM public.model_fold_one(gen_random_uuid(), '10000000-0000-0000-0000-000000000002', '{}'::jsonb);
  ASSERT (SELECT grade FROM public.data_set_member_grades WHERE vehicle_id = '10000000-0000-0000-0000-000000000002') = 'supported',
    'two readers of one photo are one witness; the fold loop re-graded';
  PERFORM public.model_fold_one(gen_random_uuid(), '10000000-0000-0000-0000-000000000001', '{}'::jsonb);
  ASSERT NOT EXISTS (SELECT 1 FROM public.data_set_member_grades WHERE set_id = 'd0000000-0000-0000-0000-000000000005'), 'a superseded membership is removed';
  ASSERT (SELECT grade FROM public.data_set_member_grades WHERE set_id = 'd0000000-0000-0000-0000-000000000004') = 'supported',
    'the remaining model is no longer in conflict';

  -- the index refuses a second established value of an exclusive kind
  BEGIN
    INSERT INTO public.data_set_member_grades (vehicle_id, set_id, set_kind, grade, witness_classes, n_witnesses, exclusive, rule_version)
    VALUES ('10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'trans_type', 'established', '{decode}', 1, true, 't')
    ON CONFLICT (vehicle_id, set_id) DO UPDATE SET grade = 'established';
    RAISE EXCEPTION 'FAIL: two established trans_type values';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.data_set_member_grades (vehicle_id, set_id, set_kind, grade, witness_classes, n_witnesses, exclusive, rule_version)
    VALUES ('10000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000003', 'trans_speeds', 'established', '{}', 0, true, 't');
    RAISE EXCEPTION 'FAIL: established without a witness';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.data_set_kind_properties (set_kind, exclusive, establish_alone, note) VALUES ('x', true, '{vibes}', 'n');
    RAISE EXCEPTION 'FAIL: an unknown class in a rule row';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  -- readers by grade
  PERFORM public.data_set_public_count_one('d0000000-0000-0000-0000-000000000002');
  ASSERT (SELECT row(public_vehicles, established_vehicles, supported_vehicles, mentioned_vehicles, conflict_vehicles)::text
            FROM public.data_set_public_counts WHERE set_id = 'd0000000-0000-0000-0000-000000000002') = '(2,1,1,0,0)', 'counts by grade';
  vds := public.vehicle_data_sets('10000000-0000-0000-0000-000000000001');
  ASSERT (SELECT s->>'grade' FROM jsonb_array_elements(vds->'sets') s WHERE s->>'set_key' = 'manual') = 'established'
     AND (SELECT (s->'public_vehicles_by_grade'->>'established')::int FROM jsonb_array_elements(vds->'sets') s WHERE s->>'set_key' = 'manual') = 1,
    'vehicle_data_sets returns grade and counts by grade; got ' || vds::text;
END $$;

SET ROLE anon;
DO $$ BEGIN
  PERFORM 1 FROM public.data_set_member_grades;
  RAISE EXCEPTION 'FAIL: anon read grades';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
DO $$ BEGIN
  PERFORM public.data_set_grade_vehicle('10000000-0000-0000-0000-000000000001');
  RAISE EXCEPTION 'FAIL: anon ran the fold';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;
\echo data_set_member_grades: ok
