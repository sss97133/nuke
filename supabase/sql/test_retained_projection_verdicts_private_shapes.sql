-- Contract for 20261126111000_projection_verdicts_private_shapes (empty disposable PG17, dm_refinement_* only).
-- retained_projection_verdicts_for withholds a verdict whose source observation matches an active
-- vehicle_observation_private_shapes row (20261126105000's vo_private_shape_read hides such a row from anon), reads the
-- rule rows at call time, and re-records its vehicle_observations policy copy. Fixture: test_retained_projection_verdicts.sql
-- (11 BaT p/projection pairs, the live matcher closure), which reverts 20261126063500 at its end; it is re-applied here.
-- Run: createdb <db>; psql -d <db> -v ON_ERROR_STOP=1 -f supabase/sql/test_retained_projection_verdicts_private_shapes.sql
\set ON_ERROR_STOP on
\ir test_retained_projection_verdicts.sql
\ir ../migrations/20261126063500_retained_projection_verdicts.sql
CALL public.retained_projection_grade_tick();
CALL public.retained_projection_grade_tick();
SELECT pg_temp.check_e('063500 re-applied and graded', 8);
DO $$ BEGIN
  IF (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_proc
       WHERE oid = 'public.retained_projection_verdicts_for(uuid[])'::regprocedure)
     <> '734adc8a68acff3a9af32aaa73bf6bd1365765e1509e4b684faece75542bf62d' THEN
    RAISE EXCEPTION 'FAIL verdicts_for is not the 20261126063500 body the migration anchors on'; END IF;
  RAISE NOTICE 'PASS verdicts_for prosrc is 734adc8a... (the anchor)';
END $$;

-- 20261126105000 (ta-policies) needs the feed it names and vehicle_viewer_tied; this fixture has neither (anon is never tied).
CREATE FUNCTION public.vehicle_viewer_tied(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.vehicle_deep_reading_feed(uuid, timestamptz, integer, uuid) RETURNS SETOF jsonb
  LANGUAGE sql STABLE AS $$ SELECT NULL::jsonb WHERE false $$;
\ir ../migrations/20261126105000_vehicle_observation_private_shapes.sql
SELECT pg_temp.check_e('105000 live, seed shape only (no source listing matches it)', 8);

-- A rule row whose shape every fixture source listing carries.
INSERT INTO public.vehicle_observation_private_shapes (shape_key, structured_match, reader, reason)
VALUES ('fixture_red_listing', '{"color": "Red"}',
        'public.vehicle_deep_reading_feed(uuid, timestamp with time zone, integer, uuid)',
        'fixture: a shape every source listing in this database matches');
DO $$ BEGIN
  IF NOT pg_temp.counted('00000000-0000-0000-0000-00000000e001') THEN
    RAISE EXCEPTION 'FAIL vacuous: before 111000 e001 is not served'; END IF;
  RAISE NOTICE 'PASS the defect: before 111000 the direct call serves e001 although its source matches an active shape';
END $$;

\ir ../migrations/20261126111000_projection_verdicts_private_shapes.sql
\ir ../migrations/20261126111000_projection_verdicts_private_shapes.sql
SELECT pg_temp.check_e('shape active after 111000', 0);
DO $$
DECLARE d text; leaked boolean;
  term constant text := 'AND NOT (coalesce(p.structured_data, ''{}''::jsonb) @> ANY (ARRAY(SELECT s.structured_match
           FROM public.vehicle_observation_private_shapes s WHERE s.active)))';
BEGIN
  IF (SELECT count(*) FROM pg_proc WHERE oid = 'public.retained_projection_verdicts_for(uuid[])'::regprocedure AND prosecdef
        AND (length(prosrc) - length(replace(prosrc, 'private_shape_rows_v1', ''))) / length('private_shape_rows_v1') = 1) <> 1
     OR NOT has_function_privilege('anon', 'public.retained_projection_verdicts_for(uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL the term is not in the definer body exactly once, or anon lost EXECUTE'; END IF;
  IF (SELECT recorded_hash FROM public.private_row_policy_copies WHERE reader = 'retained_projection_verdicts_for(uuid[])'
        AND relation = 'vehicle_observations') IS DISTINCT FROM
     (SELECT policy_hash FROM public.private_row_policy_hash('vehicle_observations', 'p.cmd IN (''SELECT'', ''ALL'')'))
     OR (SELECT note FROM public.private_row_policy_copies WHERE reader = 'retained_projection_verdicts_for(uuid[])'
        AND relation = 'vehicle_observations') NOT LIKE '%20261126111000%' THEN
    RAISE EXCEPTION 'FAIL copy row not re-recorded'; END IF;
  -- mutant: the seed shape hardcoded instead of the rule rows
  d := pg_get_functiondef('public.retained_projection_verdicts_for(uuid[])'::regprocedure);
  IF position(term IN d) = 0 THEN RAISE EXCEPTION 'mutant anchor missing'; END IF;
  EXECUTE replace(d, term, 'AND NOT (coalesce(p.structured_data, ''{}''::jsonb) @> ''{"analysis_kind": "image_deep_byok"}''::jsonb)');
  SET LOCAL ROLE anon;
  leaked := EXISTS (SELECT 1 FROM public.retained_projection_verdicts_for(ARRAY['00000000-0000-0000-0000-00000000e001'::uuid]));
  RESET ROLE;
  EXECUTE d;
  IF NOT leaked THEN RAISE EXCEPTION 'FAIL mutant survived: a hardcoded shape still hides e001'; END IF;
  RAISE NOTICE 'PASS a source matching an active shape row is withheld for every caller; copy row re-recorded; mutant (hardcoded shape) killed';
END $$;

-- The rule rows decide at call time.
UPDATE public.vehicle_observation_private_shapes SET active = false WHERE shape_key = 'fixture_red_listing';
SELECT pg_temp.check_e('shape row inactive', 8);
UPDATE public.vehicle_observation_private_shapes SET active = true WHERE shape_key = 'fixture_red_listing';
SELECT pg_temp.check_e('shape row active again', 0);

-- A shape row that only projections carry (the input ids themselves): the term on o withholds them; without it they leak.
UPDATE public.vehicle_observation_private_shapes SET active = false WHERE shape_key = 'fixture_red_listing';
INSERT INTO public.vehicle_observation_private_shapes (shape_key, structured_match, reader, reason)
VALUES ('fixture_color_projection', '{"projection_version": "retained_listing_exterior_color_v1"}',
        'public.vehicle_deep_reading_feed(uuid, timestamp with time zone, integer, uuid)',
        'fixture: a shape every projection in this database matches and no source does');
SELECT pg_temp.check_e('projection-only shape active', 0);
DO $$
DECLARE d text; leaked boolean;
  term constant text := 'AND NOT (coalesce(o.structured_data, ''{}''::jsonb) @> ANY (ARRAY(SELECT s.structured_match
           FROM public.vehicle_observation_private_shapes s WHERE s.active)))';
BEGIN
  IF EXISTS (SELECT 1 FROM public.vehicle_observations p WHERE p.extraction_method = 'html_match'
               AND p.structured_data @> '{"projection_version": "retained_listing_exterior_color_v1"}') THEN
    RAISE EXCEPTION 'FAIL vacuous: a source carries the projection shape'; END IF;
  d := pg_get_functiondef('public.retained_projection_verdicts_for(uuid[])'::regprocedure);
  IF position(term IN d) = 0 THEN RAISE EXCEPTION 'mutant anchor missing (o term)'; END IF;
  EXECUTE replace(d, term, 'AND true');
  SET LOCAL ROLE anon;
  leaked := EXISTS (SELECT 1 FROM public.retained_projection_verdicts_for(ARRAY['00000000-0000-0000-0000-00000000e001'::uuid]));
  RESET ROLE;
  EXECUTE d;
  IF NOT leaked THEN RAISE EXCEPTION 'FAIL mutant survived: without the o term e001 is still withheld'; END IF;
  RAISE NOTICE 'PASS a projection matching an active shape is withheld (no source matches it); mutant (no o term) killed';
END $$;
UPDATE public.vehicle_observation_private_shapes SET active = false WHERE shape_key = 'fixture_color_projection';
SELECT pg_temp.check_e('projection-only shape inactive', 8);
UPDATE public.vehicle_observation_private_shapes SET active = true WHERE shape_key = 'fixture_red_listing';

-- Revert: body back to 734adc8a..., copy row back to 16c9e48f..., the defect returns; then re-apply.
\ir revert_20261126111000_projection_verdicts_private_shapes.sql
DO $$ BEGIN
  IF (SELECT encode(sha256(convert_to(prosrc, 'UTF8')), 'hex') FROM pg_proc
       WHERE oid = 'public.retained_projection_verdicts_for(uuid[])'::regprocedure)
     <> '734adc8a68acff3a9af32aaa73bf6bd1365765e1509e4b684faece75542bf62d'
     OR (SELECT recorded_hash FROM public.private_row_policy_copies WHERE reader = 'retained_projection_verdicts_for(uuid[])'
          AND relation = 'vehicle_observations') <> '16c9e48fc1fbfbe5dc4ae10fe8947c7c'
     OR NOT pg_temp.counted('00000000-0000-0000-0000-00000000e001') THEN
    RAISE EXCEPTION 'FAIL revert'; END IF;
  RAISE NOTICE 'PASS revert restores the body byte for byte and the pre-105000 copy hash';
END $$;
\ir ../migrations/20261126111000_projection_verdicts_private_shapes.sql
SELECT pg_temp.check_e('re-applied after the revert', 0);
