-- Contract for 20261124194400_data_set_grade_families (empty disposable PG17). Builds on the 20261124193700 contract
-- (its stubs, fixtures and v1 assertions run first), then applies v2 and asserts: two photos read by one family (Sonnet +
-- Opus) are supported, not established; a second family on another photo establishes; a photographed stamp decode is a
-- reading of its reader's family, not a decode; a VIN decode still establishes alone; the backfill lap restarts.
-- ALLOW_RAW_TESTIMONY_WRITE: synthetic fixtures in a disposable database only.
\set ON_ERROR_STOP on
\ir test_data_set_member_grades.sql

CREATE OR REPLACE FUNCTION public.reader_lineage(p text) RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT CASE WHEN p LIKE 'claude-%' THEN 'anthropic' WHEN p LIKE 'gpt-%' THEN 'openai' END $f$;

\ir ../migrations/20261124194400_data_set_grade_families.sql
\ir ../migrations/20261124194400_data_set_grade_families.sql

DO $$
DECLARE r jsonb;
BEGIN
  ASSERT (SELECT config_value->>'done' FROM public.platform_config WHERE config_key = 'data_set_grades_backfill') = 'false',
    'the backfill lap restarts';
  r := public.data_set_grade_vehicle('10000000-0000-0000-0000-000000000001');
  ASSERT (SELECT grade FROM public.data_set_member_grades WHERE set_id = 'd0000000-0000-0000-0000-000000000002'
            AND vehicle_id = '10000000-0000-0000-0000-000000000001') = 'supported',
    'manual: two photos read by Sonnet and Opus are one family, supported';
  ASSERT (SELECT grade FROM public.data_set_member_grades WHERE set_id = 'd0000000-0000-0000-0000-000000000003') = 'established',
    'speeds: a VIN decode still establishes alone';
  ASSERT (SELECT rule_version FROM public.data_set_member_grades WHERE set_id = 'd0000000-0000-0000-0000-000000000003') = 'data_set_member_grades_v2',
    'rule version v2';
END $$;

-- a second family on another photo establishes manual; a stamp decode by one family is a reading
INSERT INTO public.vehicle_observations (id, vehicle_id, extraction_method, agent_model) VALUES
 ('0b000000-0000-0000-0000-0000000000f5', '10000000-0000-0000-0000-000000000001', 'physical_transcription_v1', 'gpt-5'),
 ('0b000000-0000-0000-0000-0000000000f6', '10000000-0000-0000-0000-000000000002', 'trans_id_stamp_decode_v1', 'claude-opus');
INSERT INTO public.observation_witnesses (observation_id, image_id) VALUES
 ('0b000000-0000-0000-0000-0000000000f5', 'a1000000-0000-0000-0000-0000000000f5'),
 ('0b000000-0000-0000-0000-0000000000f6', 'a1000000-0000-0000-0000-0000000000f6');
INSERT INTO public.data_set_members (set_id, member_type, member_id, vehicle_id, basis_type, basis_id) VALUES
 ('d0000000-0000-0000-0000-000000000002', 'vehicle', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'observation', '0b000000-0000-0000-0000-0000000000f5'),
 ('d0000000-0000-0000-0000-000000000002', 'vehicle', '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'observation', '0b000000-0000-0000-0000-0000000000f6');

DO $$
BEGIN
  PERFORM public.data_set_grade_vehicle('10000000-0000-0000-0000-000000000001');
  PERFORM public.data_set_grade_vehicle('10000000-0000-0000-0000-000000000002');
  ASSERT (SELECT grade FROM public.data_set_member_grades WHERE set_id = 'd0000000-0000-0000-0000-000000000002'
            AND vehicle_id = '10000000-0000-0000-0000-000000000001') = 'established',
    'manual: a second family on another photo establishes';
  ASSERT (SELECT row(grade, witness_classes)::text FROM public.data_set_member_grades WHERE set_id = 'd0000000-0000-0000-0000-000000000002'
            AND vehicle_id = '10000000-0000-0000-0000-000000000002') = '(supported,{reading_registered})',
    'a stamp decode read from a photo by one family is a registered reading, supported';
END $$;
\echo data_set_grade_families: ok
