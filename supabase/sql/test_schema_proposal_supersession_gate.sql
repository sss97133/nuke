-- Disposable PG17: schema_proposal_supersession_gate ratifies exactly one shape of modify_property by measure: a
-- description-only supersession that moves a key's allowed values from an 'Allowed values:' list to a key table the
-- storing column references by foreign key, with no stored value orphaned. Chains the gate A test (the 8 labor keys
-- ratified), then builds a synthetic key table, storing table, null-reason table and qualifier observations.
-- Fixture rows below live in a disposable test database only.
\set ON_ERROR_STOP on
\ir test_schema_proposal_key_gate.sql
\ir ../migrations/20261125191500_schema_proposal_supersession_gate.sql
\ir ../migrations/20261125191500_schema_proposal_supersession_gate.sql

CREATE TABLE public.fx_systems (system_key text PRIMARY KEY, label text);
CREATE TABLE public.fx_values (property_key text NOT NULL, value text NOT NULL,
  system_key text REFERENCES public.fx_systems(system_key), note text, PRIMARY KEY (property_key, value));
CREATE TABLE public.fx_null_reasons (property_key text NOT NULL, reason text NOT NULL, PRIMARY KEY (property_key, reason));
INSERT INTO public.fx_systems VALUES ('engine', 'Engine'), ('paint', 'Paint'), ('hardware', 'Hardware');
INSERT INTO public.fx_values VALUES ('labor_system_key', 'engine', 'engine'), ('labor_system_key', 'paint', 'paint');
INSERT INTO public.fx_null_reasons VALUES ('labor_system_key', 'names_no_one_system');
-- guardrail-allow(center-key-fk): vehicle_observations.id: the table's own primary key, not a reference (fixture stub)
CREATE TABLE IF NOT EXISTS public.vehicle_observations (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
ALTER TABLE public.vehicle_observations ADD COLUMN IF NOT EXISTS property_id uuid REFERENCES public.observation_properties(id),
  ADD COLUMN IF NOT EXISTS is_superseded boolean NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS structured_data jsonb;
-- ALLOW_RAW_TESTIMONY_WRITE (disposable PG17 fixture database)
INSERT INTO public.vehicle_observations (property_id, structured_data)
SELECT o.id, v.sd FROM public.observation_properties o,
  (VALUES ('{"labor_system_key": "engine"}'::jsonb), ('{"labor_system_key_null_reason": "names_no_one_system"}'::jsonb),
          ('{"other": 1}'::jsonb)) v(sd)
 WHERE o.property_key = 'labor_hours_reported_low';

CREATE FUNCTION pg_temp.file_supersession(p_payload jsonb, p_supersedes uuid DEFAULT NULL) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.schema_proposals (proposed_by_agent_key, proposal_type, status, supersedes_proposal_id, payload, evidence)
  SELECT 'claude-reported-labor-hours', 'modify_property', 'open', coalesce(p_supersedes, o.proposed_by_proposal_id), p_payload,
         '[{"role": "measurement", "what": "fixture"}]'::jsonb
    FROM public.observation_properties o WHERE o.property_key = 'labor_system_key'
  RETURNING id $$;

DO $$
DECLARE
  good jsonb := '{"property_key": "labor_system_key", "field": "description", "values_from": "fx_systems.system_key",
                  "stored_in": "fx_values.system_key", "null_reasons_from": "fx_null_reasons",
                  "qualifier_of": ["labor_hours_reported_low", "labor_hours_reported_high"],
                  "description": "The car system the hours were spent on: a fx_systems.system_key. Absent for whole_build."}';
  orig uuid := (SELECT proposed_by_proposal_id FROM public.observation_properties WHERE property_key = 'labor_system_key');
  row_before jsonb := (SELECT to_jsonb(p) - 'description' FROM public.observation_properties p WHERE property_key = 'labor_system_key');
  others_before text := (SELECT md5(string_agg(to_jsonb(p)::text, '|' ORDER BY id)) FROM public.observation_properties p
                          WHERE property_key <> 'labor_system_key');
  sid uuid;
  r jsonb;
BEGIN
  PERFORM pg_temp.ok('fixture: the ratified text holds an Allowed values list', (SELECT description ~* 'allowed values:'
    FROM public.observation_properties WHERE property_key = 'labor_system_key'));

  -- refusals, one per measured check; nothing moves
  r := public.schema_proposal_supersession_gate(pg_temp.file_supersession(good || '{"data_type": "text"}'));
  PERFORM pg_temp.ok('a type change is not this shape: ' || r::text, r->'reasons' ? 'payload_key_not_allowed:data_type');
  r := public.schema_proposal_supersession_gate(pg_temp.file_supersession(good || '{"adds_values": ["x"]}'));
  PERFORM pg_temp.ok('a value list change is not this shape', r->'reasons' ? 'payload_key_not_allowed:adds_values');
  r := public.schema_proposal_supersession_gate(pg_temp.file_supersession(good || '{"field": "data_type"}'));
  PERFORM pg_temp.ok('not description-only refused', r->'reasons' ? 'not_description_only');
  r := public.schema_proposal_supersession_gate(pg_temp.file_supersession(good || '{"description": "fx_systems keys. Allowed values: engine, paint."}'));
  PERFORM pg_temp.ok('new text still listing values refused', r->'reasons' ? 'description_holds_value_list');
  r := public.schema_proposal_supersession_gate(pg_temp.file_supersession(good || '{"description": "a system key from the key table"}'));
  PERFORM pg_temp.ok('new text not naming the table refused', r->'reasons' ? 'description_does_not_name_table');
  r := public.schema_proposal_supersession_gate(pg_temp.file_supersession(good || '{"values_from": "fx_missing.system_key"}'));
  PERFORM pg_temp.ok('missing key table refused', r->'reasons' ? 'values_from_table_missing');
  r := public.schema_proposal_supersession_gate(pg_temp.file_supersession(good || '{"values_from": "fx_systems.label"}'));
  PERFORM pg_temp.ok('a column that is not a key refused', r->'reasons' ? 'values_from_not_a_key');
  r := public.schema_proposal_supersession_gate(pg_temp.file_supersession(good || '{"stored_in": "fx_values.value"}'));
  PERFORM pg_temp.ok('a storing column with no foreign key refused', r->'reasons' ? 'stored_in_no_foreign_key');
  r := public.schema_proposal_supersession_gate(pg_temp.file_supersession(good || '{"null_reasons_from": "fx_systems"}'));
  PERFORM pg_temp.ok('a null-reason table without property_key/reason refused', r->'reasons' ? 'null_reasons_from_invalid');
  r := public.schema_proposal_supersession_gate(pg_temp.file_supersession(good || '{"qualifier_of": ["no_such_key"]}'));
  PERFORM pg_temp.ok('unknown qualifier_of refused', r->'reasons' ? 'qualifier_of_unknown');
  r := public.schema_proposal_supersession_gate(pg_temp.file_supersession(good || '{"property_key": "labor_scope"}'));
  PERFORM pg_temp.ok('superseding another key''s proposal refused', r->'reasons' ? 'supersedes_not_the_ratifying_proposal');

  -- orphans: a stored qualifier value outside the key table, and a NULL without a reason row
  -- ALLOW_RAW_TESTIMONY_WRITE (disposable PG17 fixture database)
  INSERT INTO public.vehicle_observations (property_id, structured_data)
  SELECT o.id, v.sd FROM public.observation_properties o,
    (VALUES ('{"labor_system_key": "unplaced"}'::jsonb), ('{"labor_system_key_null_reason": "too_hard"}'::jsonb)) v(sd)
   WHERE o.property_key = 'labor_hours_reported_high';
  sid := pg_temp.file_supersession(good);
  r := public.schema_proposal_supersession_gate(sid);
  PERFORM pg_temp.ok('stored values outside the key table refuse: ' || r::text, r->'reasons' = '["stored_values_orphaned"]'::jsonb
    AND (r->>'observations_orphaned')::int = 2 AND (r->>'observations')::int = 4);
  PERFORM pg_temp.ok('a refusal changes no status and no registry text',
    (SELECT status FROM public.schema_proposals WHERE id = orig) = 'approved'
    AND (SELECT status FROM public.schema_proposals WHERE schema_proposals.id = sid) = 'open'
    AND (SELECT description FROM public.observation_properties WHERE property_key = 'labor_system_key') ~* 'allowed values:');
  -- ALLOW_RAW_TESTIMONY_WRITE (disposable PG17 fixture database)
  UPDATE public.vehicle_observations SET is_superseded = true WHERE structured_data ->> 'labor_system_key' = 'unplaced'
     OR structured_data ->> 'labor_system_key_null_reason' = 'too_hard';
  -- a NULL storing column on this property's stored rows is an orphan too
  INSERT INTO public.fx_values VALUES ('labor_system_key', 'tires', NULL);
  r := public.schema_proposal_supersession_gate(sid);
  PERFORM pg_temp.ok('a stored row with no key refuses: ' || r::text, r->'reasons' = '["stored_values_orphaned"]'::jsonb
    AND (r->>'stored_rows_orphaned')::int = 1);
  DELETE FROM public.fx_values WHERE value = 'tires';

  -- ratified
  r := public.schema_proposal_supersession_gate(sid);
  PERFORM pg_temp.ok('ratified with every check measured: ' || r::text, r->>'decision' = 'ratified' AND r->'reasons' = '[]'::jsonb
    AND (r->>'stored_rows')::int = 2 AND (r->>'observations')::int = 2 AND (r->>'observations_orphaned')::int = 0);
  PERFORM pg_temp.ok('successor approved with the measure; no person reviewed', (SELECT status = 'approved' AND gate_measure = r
    AND decision_rationale LIKE 'schema_proposal_supersession_gate_v1%' FROM public.schema_proposals WHERE schema_proposals.id = sid)
    AND NOT EXISTS (SELECT 1 FROM public.schema_proposal_reviews WHERE proposal_id = sid));
  PERFORM pg_temp.ok('the ratifying proposal is superseded by it', (SELECT status = 'superseded' AND superseded_by = sid
    FROM public.schema_proposals WHERE schema_proposals.id = orig));
  PERFORM pg_temp.ok('the registry text is the new text', (SELECT description FROM public.observation_properties
    WHERE property_key = 'labor_system_key') = good ->> 'description');
  PERFORM pg_temp.ok('type, namespace, key, label and proposal id unchanged', (SELECT to_jsonb(p) - 'description'
    FROM public.observation_properties p WHERE property_key = 'labor_system_key') = row_before);
  PERFORM pg_temp.ok('no other registry row moved', (SELECT md5(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id))
    FROM public.observation_properties p WHERE property_key <> 'labor_system_key') = others_before);
  r := public.schema_proposal_supersession_gate(sid);
  PERFORM pg_temp.ok('a second call is refused and keeps the ratifying measure', r->'reasons' ? 'status_approved'
    AND (SELECT gate_measure->>'decision' FROM public.schema_proposals WHERE schema_proposals.id = sid) = 'ratified');
  r := public.schema_proposal_supersession_gate(pg_temp.file_supersession(good, orig));
  PERFORM pg_temp.ok('a second supersession of the same text is refused', r->'reasons' ? 'superseded_not_approved'
    AND r->'reasons' ? 'already_superseded');
END $$;

DO $$ BEGIN
  PERFORM pg_temp.ok('anon cannot call the gate', NOT has_function_privilege('anon', 'public.schema_proposal_supersession_gate(uuid)', 'EXECUTE'));
  PERFORM pg_temp.ok('service_role can', has_function_privilege('service_role', 'public.schema_proposal_supersession_gate(uuid)', 'EXECUTE'));
END $$;
\echo schema_proposal_supersession_gate: ok
