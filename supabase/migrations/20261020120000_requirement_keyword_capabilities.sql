-- Capability keys for real requirement texts. On 2026-10-19 the owner's published jobs listed 39 open requirements and only
-- 5 had capability keys: publish_work_order quotes each operation verbatim as a skill requirement when the template has
-- no entry, and those operations carry no component system, so neither the template nor the operation mapping applied.
-- The skill match was "unknown" for every candidate on 33 of 35 skill requirements.
--   capability_evidence_map (the capability fold's reviewed mapping) gains kind requirement_keyword:
--     <phrase with words joined by _>:<capability type>. A phrase matches a requirement whose description or operation text
--     contains it as whole words (case-insensitive, punctuation as spaces, the last word optionally plural). Every row
--     below names the live text it was added for; nothing speculative. Steering, suspension and alignment parts, trim
--     pieces and emblems stay unmapped, as the fold already decided for installing steering/suspension/brake parts
--     ("installing ... parts alone names no capability"), and no capability type fits trim.
--   requirement_capability_keys: one more source, from 'reviewed_keyword' (anchored edit; additive: keys are only added).
-- Contract: supabase/sql/test_requirement_keyword_capabilities.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

ALTER TABLE public.capability_evidence_map DROP CONSTRAINT capability_evidence_map_kind_check,
  ADD CONSTRAINT capability_evidence_map_kind_check CHECK (kind = ANY (ARRAY['process_key','component_system','task_system','task_type',
    'requirement_template','requirement_keyword']));
COMMENT ON TABLE public.capability_evidence_map IS 'Reviewed mapping (checked into 20261019235000; requirement_template rows in 20261020060000; requirement_keyword rows in 20261020120000) from evidence keys onto actor_capabilities.capability_type. process_key and component_system match the key or a finer dotted/underscored key (longest wins); task_system is task_type:system_key; requirement_template is <slugged template description>:<capability_type>; requirement_keyword is <phrase_words>:<capability_type>, matched as whole words in a requirement''s description or operation text (last word optionally plural). A tier only where defined.';
INSERT INTO public.capability_evidence_map(kind, source_key, system_key, capability_type, note) VALUES
  ('requirement_keyword', 'oil_change:general_maintenance', NULL, 'general_maintenance', '"Oil change (Shell Rotella T6 5W-40)"'),
  ('requirement_keyword', 'oil_filter:general_maintenance', NULL, 'general_maintenance', '"Oil filter"'),
  ('requirement_keyword', 'spark_plug:general_maintenance', NULL, 'general_maintenance', '"Spark plug replacement (AC Delco R45TS x8)"'),
  ('requirement_keyword', 'v_belt:general_maintenance', NULL, 'general_maintenance', '"AC V belt replacement"'),
  ('requirement_keyword', 'battery:general_maintenance', NULL, 'general_maintenance', '"Group 75 side post battery"'),
  ('requirement_keyword', 'light_bulb:general_maintenance', NULL, 'general_maintenance', '"Dome light bulb"'),
  ('requirement_keyword', 'oil_pan_gasket:general_maintenance', NULL, 'general_maintenance', '"Oil pan gasket replacement"'),
  ('requirement_keyword', 'transmission_pan_gasket:general_maintenance', NULL, 'general_maintenance', '"TH350/400 transmission pan gasket replacement"'),
  ('requirement_keyword', 'motor_mount:general_maintenance', NULL, 'general_maintenance', '"Motor mount replacement"'),
  ('requirement_keyword', 'radiator:cooling_system', NULL, 'cooling_system', '"Factory radiator top brackets" (the fold maps radiator components to cooling_system)'),
  ('requirement_keyword', 'thermostat_housing:cooling_system', NULL, 'cooling_system', '"Thermostat housing gasket"'),
  ('requirement_keyword', 'header_collector:exhaust_system', NULL, 'exhaust_system', '"Header collector gasket (3-bolt)"'),
  ('requirement_keyword', 'collector_flange:exhaust_system', NULL, 'exhaust_system', '"Wire wheel/clean collector flanges"'),
  ('requirement_keyword', 'header_bolt:exhaust_system', NULL, 'exhaust_system', '"Replace corroded header bolts (stainless kit)"'),
  ('requirement_keyword', 'header_polish:exhaust_system', NULL, 'exhaust_system', '"Header polish/cleaning (muriatic acid bath)"'),
  ('requirement_keyword', 'intake_manifold:intake_system', NULL, 'intake_system', '"Intake manifold gasket (Fel-Pro 1205)"'),
  ('requirement_keyword', 'fuel_pump:fuel_system', NULL, 'fuel_system', '"Install Fuelab electric fuel pump (customer supplied)"'),
  ('requirement_keyword', 'fuel_line:fuel_system', NULL, 'fuel_system', '"Fuel line routing and connections"'),
  ('requirement_keyword', 'recover_seat:upholstery_full', NULL, 'upholstery_full', '"recover seats" (re-covering seats is a full upholstery job)'),
  ('requirement_keyword', 'seat_finished:upholstery_repair', NULL, 'upholstery_repair', '"i need the back seat finished and installed"'),
  ('requirement_keyword', 'window_locking_strip:glass_installation', NULL, 'glass_installation', '"Chrome window locking strip (front/rear)" (the locking strip seats the glass in its gasket)');

DO $apply$
DECLARE
  cdef text := pg_get_functiondef('public.requirement_capability_keys(jsonb,jsonb)'::regprocedure);
  c1 constant text := $a$      WHERE li.id = (p_requirement->>'line_item_id')::uuid AND co.capability_type IS NOT NULL
  ) t$a$;
BEGIN
  IF position('reviewed_keyword' IN cdef) > 0 THEN RAISE EXCEPTION 'requirement_capability_keys already reads reviewed keywords'; END IF;
  IF (length(cdef) - length(replace(cdef, c1, ''))) / length(c1) <> 1 THEN RAISE EXCEPTION 'requirement_capability_keys operation anchor not found once'; END IF;
  EXECUTE replace(cdef, c1, $r$      WHERE li.id = (p_requirement->>'line_item_id')::uuid AND co.capability_type IS NOT NULL
    UNION
    SELECT DISTINCT m.capability_type, 'reviewed_keyword' FROM public.capability_evidence_map m,
      (SELECT ' ' || regexp_replace(lower(concat_ws(' ', p_requirement->>'description', (SELECT li.task_description FROM public.work_order_line_items li
          WHERE li.id = (p_requirement->>'line_item_id')::uuid))), '[^a-z0-9]+', ' ', 'g') || ' ' AS txt) x
      WHERE m.kind = 'requirement_keyword'
        AND (x.txt LIKE '% ' || replace(split_part(m.source_key, ':', 1), '_', ' ') || ' %'
          OR x.txt LIKE '% ' || replace(split_part(m.source_key, ':', 1), '_', ' ') || 's %')
  ) t$r$);
END $apply$;
COMMIT;
