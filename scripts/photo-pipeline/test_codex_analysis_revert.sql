-- Isolated local fixture only. Run in a newly-created test database, never production.
CREATE TABLE public.image_observations (
 id uuid primary key, image_id uuid, vehicle_id uuid, role text, observed_by text,
 is_active boolean, layer_version jsonb, confidence_basis jsonb
);
\ir ../../supabase/migrations/20261110040000_revert_codex_image_analysis_batch.sql
INSERT INTO image_observations
SELECT ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
       ('10000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
       CASE WHEN i=5 THEN '90000000-0000-0000-0000-000000000001'::uuid END,
       'incidental', CASE WHEN i=4 THEN 'local_image_analysis_v1' ELSE 'codex_image_analysis_v1' END,
       true,
       jsonb_build_object('run_id', CASE WHEN i=3 THEN '20000000-0000-0000-0000-000000000002' ELSE '20000000-0000-0000-0000-000000000001' END),
       jsonb_build_object('codex_image_analysis_v1',jsonb_build_object('run_id',CASE WHEN i=3 THEN '20000000-0000-0000-0000-000000000002' ELSE '20000000-0000-0000-0000-000000000001' END,'reading','retained'))
FROM generate_series(1,5) i;
DO $$
DECLARE n integer; ids uuid[];
BEGIN
 SELECT array_agg(image_id) INTO ids FROM image_observations WHERE id <> '00000000-0000-0000-0000-000000000002';
 n := revert_codex_image_analysis_batch('20000000-0000-0000-0000-000000000001',ids);
 IF n<>1 THEN RAISE EXCEPTION 'expected 1 withdrawal, got %',n; END IF;
 IF (SELECT count(*) FROM image_observations WHERE is_active)<>4 THEN RAISE EXCEPTION 'wrong scope'; END IF;
 IF (SELECT count(*) FROM image_observations WHERE confidence_basis->'codex_image_analysis_v1'->>'reading'='retained')<>5 THEN RAISE EXCEPTION 'testimony changed'; END IF;
 n := revert_codex_image_analysis_batch('20000000-0000-0000-0000-000000000001',ids);
 IF n<>0 THEN RAISE EXCEPTION 'replay not idempotent'; END IF;
 BEGIN
   PERFORM revert_codex_image_analysis_batch('20000000-0000-0000-0000-000000000001',array_fill(ids[1],ARRAY[51]));
   RAISE EXCEPTION 'unbounded batch accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;
 END;
 IF has_function_privilege('anon','revert_codex_image_analysis_batch(uuid,uuid[])','EXECUTE') OR
    has_function_privilege('authenticated','revert_codex_image_analysis_batch(uuid,uuid[])','EXECUTE') THEN
   RAISE EXCEPTION 'public caller may withdraw';
 END IF;
 IF NOT has_function_privilege('service_role','revert_codex_image_analysis_batch(uuid,uuid[])','EXECUTE') THEN
   RAISE EXCEPTION 'service caller cannot withdraw';
 END IF;
END $$;
