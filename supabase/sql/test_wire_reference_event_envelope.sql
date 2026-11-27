\set ON_ERROR_STOP on
-- The existing full source-reference contract creates zero numerical OBS.
\i supabase/sql/test_conditioned_wire_resistance_reference.sql
-- Complete only the type-only fixture; real production already has these keys.
ALTER TABLE vehicle_observations ADD COLUMN source_event_date date,
 ADD COLUMN source_vehicle_event_id uuid, ADD COLUMN auction_event_id uuid;
CREATE TEMP TABLE resistance_recipe_before AS SELECT public.qualify_wire_resistance_reference(public.test_wire_resistance_fixture()) AS q;
\i supabase/migrations/20261126222910_wire_reference_event_envelope.sql
\i supabase/migrations/20261126222910_wire_reference_event_envelope.sql
DO $$ DECLARE recipe jsonb; field text; mutated jsonb; q jsonb; BEGIN
 recipe:=(SELECT t.q->'recipe' FROM resistance_recipe_before t);
 PERFORM pg_temp.ok('source qualifier and canonical identity remain exactly unchanged',
  (SELECT t.q=public.qualify_wire_resistance_reference(public.test_wire_resistance_fixture()) FROM resistance_recipe_before t));
 PERFORM pg_temp.ok('existing source recipe still binds without numerical re-admission',
  public.wire_resistance_observation_binding(jsonb_populate_record(NULL::vehicle_observations,recipe))->>'ok'='true');
 FOREACH field IN ARRAY ARRAY['source_event_date','source_vehicle_event_id','auction_event_id'] LOOP
  mutated:=recipe||jsonb_build_object(field,CASE field WHEN 'source_event_date' THEN '2026-01-01' ELSE '73000000-0000-0000-0000-000000000001' END);
  q:=public.wire_resistance_observation_binding(jsonb_populate_record(NULL::vehicle_observations,mutated));
  PERFORM pg_temp.ok('documentary reference rejects physical event field '||field,
   q->>'ok'='false' AND q->>'reason'='class_reference_physical_event_unqualified');
  PERFORM pg_temp.ok('immutable trigger covers event field '||field,
   strpos(pg_get_functiondef('public.guard_wire_resistance_reference()'::regprocedure),quote_literal(field))>0);
 END LOOP;
 PERFORM pg_temp.ok('private function ACL remains unchanged',
  NOT has_function_privilege('anon','public.wire_resistance_observation_binding(public.vehicle_observations)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.wire_resistance_observation_binding(public.vehicle_observations)','EXECUTE')
  AND has_function_privilege('service_role','public.wire_resistance_observation_binding(public.vehicle_observations)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.guard_wire_resistance_reference()','EXECUTE'));
 PERFORM pg_temp.ok('no numerical testimony or projection fixtures',NOT EXISTS(SELECT FROM vehicle_observations)
  AND NOT EXISTS(SELECT FROM wire_resistance_claims) AND NOT EXISTS(SELECT FROM wire_resistance_conditions)
  AND NOT EXISTS(SELECT FROM observation_reference_spans));
END $$;
SELECT 'PASS: documentary class event envelope, unchanged qualifier/identity, exact replay and private permissions; zero numerical testimony' AS result;
