-- Disposable PG17 only. Existing historical contracts run before the new semantics.
\set ON_ERROR_STOP on
\i supabase/sql/test_k5_harness_segment_keys_fold.sql

ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.vehicle_custom_circuits
  ADD COLUMN IF NOT EXISTS measured_length_ft numeric,
  ADD COLUMN IF NOT EXISTS checks jsonb,
  ADD COLUMN IF NOT EXISTS checks_version text,
  ADD COLUMN IF NOT EXISTS checked_at timestamptz;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('test.auth_jwt', true), '')::jsonb, '{}'::jsonb) $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;
GRANT SELECT ON public.vehicles, public.vehicle_custom_circuits, public.vehicle_wiring_overlays,
  public.harness_designs, public.harness_endpoints, public.wire_termination_specs, public.catalog_parts TO anon, authenticated;

CREATE TABLE IF NOT EXISTS public.wiring_decisions (id uuid PRIMARY KEY, vehicle_id uuid NOT NULL REFERENCES public.vehicles(id), is_superseded boolean NOT NULL DEFAULT false);

CREATE TEMP TABLE material_fixture (name text PRIMARY KEY, vehicle_id uuid, overlay_id uuid, design_id uuid,
  circuit_id uuid, old_segment_id uuid, from_end uuid, to_end uuid, from_plug uuid, to_plug uuid, net_id uuid, route_id uuid);
INSERT INTO public.catalog_parts (part_number, name) VALUES ('M22759/32-18-2', '18 AWG fixture wire'), ('M22759/32-16-2', '16 AWG fixture wire');
DO $fixtures$
DECLARE label text; v uuid; o uuid; d uuid; c uuid; s uuid; a uuid; b uuid; ea uuid; eb uuid; net uuid; route uuid;
BEGIN
  FOREACH label IN ARRAY ARRAY['repair', 'physical', 'second'] LOOP
    v := gen_random_uuid(); o := gen_random_uuid(); d := gen_random_uuid(); c := gen_random_uuid(); s := gen_random_uuid();
    a := gen_random_uuid(); b := gen_random_uuid(); ea := gen_random_uuid(); eb := gen_random_uuid(); net := gen_random_uuid(); route := gen_random_uuid();
    INSERT INTO public.vehicles (id, is_public, user_id) VALUES (v, label <> 'second', '00000000-0000-0000-0000-000000007777');
    INSERT INTO public.vehicle_wiring_overlays (id, vehicle_id) VALUES (o, v);
    INSERT INTO public.harness_designs (id, vehicle_id) VALUES (d, v);
    INSERT INTO public.harness_endpoints (id, design_id, code, endpoint_type) VALUES (ea, d, 'SRC', 'connector'), (eb, d, 'DST', 'connector');
    INSERT INTO public.vehicle_custom_circuits (id, overlay_id, circuit_code, circuit_name, design_status, build_state,
      wire_type, wire_gauge_awg, wire_color, from_endpoint_id, to_endpoint_id, source, observed_at, trust,
      checks, checks_version, checked_at)
    VALUES (c, o, '23', 'fixture material', 'decided', 'uncut', 'M22759/32', 18, 'red', ea, eb, 'fixture source',
      '2026-10-01', 'T3', '{"R8":"PASS"}', 'old-rule-version', '2026-10-02');
    INSERT INTO public.wire_termination_specs (id, vehicle_id, circuit_id, endpoint_id, cavity)
    VALUES (a, v, c, ea, '1'), (b, v, c, eb, '2');
    INSERT INTO public.harness_nets (id, vehicle_id, net_code, source, method, observed_at, trust)
    VALUES (net, v, 'wire 23', 'fixture source', 'fixture', '2026-10-01', 'T3');
    INSERT INTO public.harness_segments (id, vehicle_id, net_id, vehicle_custom_circuit_id, from_termination_id, to_termination_id,
      gauge_awg, colour, wire_part_id, planned_length_ft, planned_length_method, build_state, measured_length_ft, measured_at,
      source, method, observed_at, trust)
    VALUES (s, v, net, c, a, b, 20, 'red', (SELECT id FROM public.catalog_parts WHERE part_number = 'M22759/32-18-2'),
      2, 'fixture route estimate', CASE WHEN label = 'physical' THEN 'cut' ELSE 'uncut' END,
      CASE WHEN label = 'physical' THEN 2.1 END, CASE WHEN label = 'physical' THEN '2026-10-02'::timestamptz END,
      'fixture source', 'old projection', '2026-10-01', 'T3');
    INSERT INTO public.vehicle_harness_landmarks (id, vehicle_id, distance_in) VALUES (route, v, 24);
    INSERT INTO public.harness_routings (segment_id, landmark_id, seq, source, observed_at, trust)
    VALUES (s, route, 1, 'original route witness', '2026-09-30', 'T3');
    INSERT INTO public.harness_evidence (vehicle_id, observation_id, row_kind, row_id, field, relation)
    SELECT v, id, 'segment', s, 'material', 'supports' FROM public.vehicle_observations LIMIT 1;
    INSERT INTO material_fixture VALUES (label, v, o, d, c, s, a, b, ea, eb, net, route);
  END LOOP;
END $fixtures$;

\i supabase/migrations/20261125233231_harness_segment_material_revisions.sql

DO $repair$
DECLARE f record; current_s public.harness_segments%ROWTYPE; old_s public.harness_segments%ROWTYPE; result jsonb; before_n bigint;
BEGIN
  FOR f IN SELECT * FROM material_fixture WHERE name <> 'physical' LOOP
    -- Private second vehicle can be processed by the sanctioned service role as in production.
    -- The disposable test runner is postgres, as required by run-db-contracts.sh.
    SELECT * INTO old_s FROM public.harness_segments WHERE id = f.old_segment_id;
    SELECT * INTO current_s FROM public.harness_segments WHERE id = old_s.superseded_by;
    IF NOT old_s.is_superseded OR current_s.id IS NULL OR current_s.gauge_awg <> 18 OR old_s.gauge_awg <> 20
      OR current_s.wire_part_id IS DISTINCT FROM old_s.wire_part_id OR current_s.vehicle_id <> f.vehicle_id THEN
      RAISE EXCEPTION 'material tuple/history/second vehicle failed: %', f.name;
    END IF;
    IF current_s.measured_length_ft IS NOT NULL OR current_s.build_state <> 'uncut' THEN RAISE EXCEPTION 'physical state copied'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.harness_routings WHERE segment_id = current_s.id AND landmark_id = f.route_id
      AND source = 'original route witness' AND observed_at = '2026-09-30') THEN RAISE EXCEPTION 'route provenance lost'; END IF;
    IF EXISTS (SELECT 1 FROM public.harness_evidence WHERE row_kind = 'segment' AND row_id = current_s.id)
      OR NOT EXISTS (SELECT 1 FROM public.harness_evidence WHERE row_kind = 'segment' AND row_id = old_s.id) THEN
      RAISE EXCEPTION 'material witness copied or history lost';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.vehicle_custom_circuits WHERE id = f.circuit_id
      AND checks = '{"R8":"PASS"}' AND checks_version = 'old-rule-version' AND checked_at = '2026-10-02'
      AND checks_invalidated_at IS NOT NULL AND checks_input_hash IS NULL) THEN RAISE EXCEPTION 'check history/applicability'; END IF;
    SELECT count(*) INTO before_n FROM public.harness_segments WHERE vehicle_id = f.vehicle_id;
    result := public.key_harness_segments(f.vehicle_id);
    IF (result->>'segments_superseded')::int <> 0 OR (SELECT count(*) FROM public.harness_segments WHERE vehicle_id = f.vehicle_id) <> before_n THEN
      RAISE EXCEPTION 'repeat fold changes history: %', result;
    END IF;
  END LOOP;
END $repair$;

-- Triggered changes: unmapped/ambiguous replacement cannot retain a stale key; a real matching row re-keys it.
DO $catalog$
DECLARE f material_fixture%ROWTYPE; s public.harness_segments%ROWTYPE; duplicate_id uuid;
BEGIN
  SELECT * INTO f FROM material_fixture WHERE name = 'repair';
  UPDATE public.vehicle_custom_circuits SET wire_color = 'violet/orange' WHERE id = f.circuit_id;
  SELECT * INTO s FROM public.harness_segments WHERE vehicle_id = f.vehicle_id AND NOT is_superseded;
  IF s.wire_part_id IS NOT NULL OR s.colour <> 'violet/orange'
    OR NOT EXISTS (SELECT 1 FROM public.harness_segment_spec_status(f.vehicle_id) WHERE 'catalog_part_missing' = ANY(blockers)) THEN
    RAISE EXCEPTION 'unmapped material retained stale key'; END IF;
  INSERT INTO public.catalog_parts (part_number, name) VALUES ('M22759/32-18-73', 'fixture replacement');
  SELECT * INTO s FROM public.harness_segments WHERE vehicle_id = f.vehicle_id AND NOT is_superseded;
  IF s.wire_part_id IS NULL THEN RAISE EXCEPTION 'catalog insertion did not recompute'; END IF;
  INSERT INTO public.catalog_parts (part_number, name) VALUES ('M22759/32-18-73', 'fixture replacement') RETURNING id INTO duplicate_id;
  SELECT * INTO s FROM public.harness_segments WHERE vehicle_id = f.vehicle_id AND NOT is_superseded;
  IF s.wire_part_id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM public.harness_segment_spec_status(f.vehicle_id)
    WHERE catalog_matches = 2 AND 'catalog_part_ambiguous' = ANY(blockers)) THEN RAISE EXCEPTION 'ambiguous part chosen'; END IF;
  DELETE FROM public.catalog_parts WHERE id = duplicate_id;
  IF NOT EXISTS (SELECT 1 FROM public.harness_segments WHERE vehicle_id = f.vehicle_id AND NOT is_superseded AND wire_part_id IS NOT NULL) THEN
    RAISE EXCEPTION 'ambiguity resolution did not recompute'; END IF;
END $catalog$;

-- Admission order: source successor before its ends holds; one end still holds; complete unchanged pair permits revision.
DO $successor$
DECLARE f material_fixture%ROWTYPE; next_c uuid := gen_random_uuid(); first_end uuid := gen_random_uuid(); second_end uuid := gen_random_uuid(); old_id uuid;
BEGIN
  SELECT * INTO f FROM material_fixture WHERE name = 'repair';
  SELECT id INTO old_id FROM public.harness_segments WHERE vehicle_id = f.vehicle_id AND NOT is_superseded;
  UPDATE public.vehicle_custom_circuits SET is_superseded = true WHERE id = f.circuit_id;
  INSERT INTO public.vehicle_custom_circuits (id, overlay_id, circuit_code, circuit_name, design_status, build_state,
    wire_type, wire_gauge_awg, wire_color, from_endpoint_id, to_endpoint_id, source, observed_at, trust)
  VALUES (next_c, f.overlay_id, '23', 'successor', 'decided', 'uncut', 'M22759/32', 16, 'red', f.from_plug, f.to_plug, 'successor source', now(), 'T3');
  UPDATE public.vehicle_custom_circuits SET superseded_by = next_c WHERE id = f.circuit_id;
  IF NOT EXISTS (SELECT 1 FROM public.harness_segment_spec_status(f.vehicle_id) WHERE segment_id = old_id
    AND current_circuit_id = next_c AND 'current_termination_pair_unresolved' = ANY(blockers)) THEN RAISE EXCEPTION 'partial source not held'; END IF;
  INSERT INTO public.wire_termination_specs (id, vehicle_id, circuit_id, endpoint_id, cavity)
  VALUES (first_end, f.vehicle_id, next_c, f.from_plug, '1');
  IF NOT EXISTS (SELECT 1 FROM public.harness_segments WHERE id = old_id AND NOT is_superseded) THEN RAISE EXCEPTION 'one end admitted a revision'; END IF;
  INSERT INTO public.wire_termination_specs (id, vehicle_id, circuit_id, endpoint_id, cavity)
  VALUES (second_end, f.vehicle_id, next_c, f.to_plug, '2');
  IF NOT EXISTS (SELECT 1 FROM public.harness_segments WHERE vehicle_id = f.vehicle_id AND NOT is_superseded
    AND vehicle_custom_circuit_id = next_c AND from_termination_id = first_end AND to_termination_id = second_end
    AND gauge_awg = 16 AND planned_length_ft IS NULL) THEN RAISE EXCEPTION 'complete source pair did not revise'; END IF;
  UPDATE material_fixture SET circuit_id = next_c, from_end = first_end, to_end = second_end WHERE name = 'repair';
END $successor$;

-- A fully admitted changed plug code must reach topology conformance, not remain permanently held.
DO $topology$
DECLARE f material_fixture%ROWTYPE; next_c uuid := gen_random_uuid(); new_plug uuid := gen_random_uuid();
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); old_id uuid;
BEGIN
  SELECT * INTO f FROM material_fixture WHERE name = 'repair';
  SELECT id INTO old_id FROM public.harness_segments WHERE vehicle_id = f.vehicle_id AND NOT is_superseded;
  INSERT INTO public.harness_endpoints (id, design_id, code, endpoint_type) VALUES (new_plug, f.design_id, 'DST-NEW', 'connector');
  UPDATE public.vehicle_custom_circuits SET is_superseded = true WHERE id = f.circuit_id;
  INSERT INTO public.vehicle_custom_circuits (id, overlay_id, circuit_code, circuit_name, design_status, build_state,
    wire_type, wire_gauge_awg, wire_color, from_endpoint_id, to_endpoint_id, source, observed_at, trust)
  VALUES (next_c, f.overlay_id, '23', 'changed topology', 'decided', 'uncut', 'M22759/32', 16, 'red',
    f.from_plug, new_plug, 'changed topology source', now(), 'T3');
  UPDATE public.vehicle_custom_circuits SET superseded_by = next_c WHERE id = f.circuit_id;
  INSERT INTO public.wire_termination_specs (id, vehicle_id, circuit_id, endpoint_id, cavity)
  VALUES (a, f.vehicle_id, next_c, f.from_plug, '1'), (b, f.vehicle_id, next_c, new_plug, '9');
  PERFORM public.conform_harness_segments(f.vehicle_id);
  IF NOT EXISTS (SELECT 1 FROM public.harness_segments WHERE id = old_id AND is_superseded)
    OR NOT EXISTS (SELECT 1 FROM public.harness_segments WHERE vehicle_id = f.vehicle_id AND NOT is_superseded
      AND vehicle_custom_circuit_id = next_c AND from_termination_id = a AND to_termination_id = b
      AND gauge_awg = 16 AND wire_part_id IS NOT NULL AND build_state = 'uncut' AND planned_length_ft IS NULL) THEN
    RAISE EXCEPTION 'changed endpoint successor stuck or history mutated';
  END IF;
  UPDATE material_fixture SET circuit_id = next_c, from_end = a, to_end = b, to_plug = new_plug WHERE name = 'repair';
END $topology$;

-- Built/measured material is retained by all folds; a direct rewrite/deletion is rejected.
DO $physical$
DECLARE f material_fixture%ROWTYPE; result jsonb;
BEGIN
  SELECT * INTO f FROM material_fixture WHERE name = 'physical';
  result := public.resync_harness_segments(f.vehicle_id);
  PERFORM public.conform_harness_segments(f.vehicle_id);
  IF NOT EXISTS (SELECT 1 FROM public.harness_segment_spec_status(f.vehicle_id) WHERE segment_id = f.old_segment_id
    AND physical_progress AND 'physical_revision_hold' = ANY(blockers)) THEN RAISE EXCEPTION 'physical hold not persistent'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.harness_segments WHERE id = f.old_segment_id AND NOT is_superseded
    AND gauge_awg = 20 AND measured_length_ft = 2.1 AND build_state = 'cut') THEN RAISE EXCEPTION 'physical row changed'; END IF;
  BEGIN
    UPDATE public.harness_segments SET gauge_awg = 18 WHERE id = f.old_segment_id;
    RAISE EXCEPTION 'unreachable material';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'unreachable material' THEN RAISE; END IF; END;
  BEGIN
    UPDATE public.harness_segments SET build_state = 'uncut', measured_length_ft = NULL, measured_at = NULL WHERE id = f.old_segment_id;
    UPDATE public.harness_segments SET gauge_awg = 18 WHERE id = f.old_segment_id;
    RAISE EXCEPTION 'unreachable physical erasure';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'unreachable physical erasure' THEN RAISE; END IF; END;
  BEGIN
    UPDATE public.harness_segments SET measured_length_ft = 99 WHERE id = f.old_segment_id;
    RAISE EXCEPTION 'unreachable measurement rewrite';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'unreachable measurement rewrite' THEN RAISE; END IF; END;
  BEGIN
    DELETE FROM public.harness_segments WHERE id = f.old_segment_id;
    RAISE EXCEPTION 'unreachable delete';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'unreachable delete' THEN RAISE; END IF; END;
  UPDATE public.vehicle_custom_circuits SET is_superseded = true WHERE id = f.circuit_id;
  PERFORM public.resync_harness_segments(f.vehicle_id);
  IF NOT EXISTS (SELECT 1 FROM public.harness_segment_spec_status(f.vehicle_id) WHERE segment_id = f.old_segment_id
    AND current_circuit_id IS NULL AND 'physical_revision_hold' = ANY(blockers)) THEN RAISE EXCEPTION 'built superseded-source disappeared'; END IF;
END $physical$;

-- Concept source never produces a new decided material row. Same-vehicle constraints reject crossing wires.
DO $qualification$
DECLARE f material_fixture%ROWTYPE; other_f material_fixture%ROWTYPE; old_id uuid;
BEGIN
  SELECT * INTO f FROM material_fixture WHERE name = 'repair';
  SELECT * INTO other_f FROM material_fixture WHERE name = 'second';
  SELECT id INTO old_id FROM public.harness_segments WHERE vehicle_id = f.vehicle_id AND NOT is_superseded;
  UPDATE public.vehicle_custom_circuits SET design_status = 'concept', wire_gauge_awg = 18 WHERE id = f.circuit_id;
  IF NOT EXISTS (SELECT 1 FROM public.harness_segment_spec_status(f.vehicle_id) WHERE segment_id = old_id
    AND 'source_design_not_decided' = ANY(blockers)) THEN RAISE EXCEPTION 'concept source not blocked'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.harness_segments WHERE id = old_id AND NOT is_superseded) THEN RAISE EXCEPTION 'concept promoted'; END IF;
  BEGIN
    UPDATE public.harness_segments SET superseded_by = (SELECT superseded_by FROM public.harness_segments WHERE id = other_f.old_segment_id)
      WHERE id = f.old_segment_id;
    RAISE EXCEPTION 'unreachable historical retarget';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'unreachable historical retarget' THEN RAISE; END IF; END;
  BEGIN
    UPDATE public.harness_segments SET from_termination_id = other_f.from_end WHERE id = old_id;
    RAISE EXCEPTION 'unreachable crossvehicle';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'unreachable crossvehicle' THEN RAISE; END IF; END;
END $qualification$;

-- Actual role execution, not only privilege introspection. Private/deleted/anonymous owner sessions return no rows.
GRANT SELECT ON material_fixture TO anon, authenticated;
SET ROLE anon;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.harness_segment_spec_status((SELECT vehicle_id FROM material_fixture WHERE name = 'second'))) THEN
    RAISE EXCEPTION 'private vehicle visible anonymously'; END IF;
  BEGIN
    PERFORM public.key_harness_segments((SELECT vehicle_id FROM material_fixture WHERE name = 'repair'));
    RAISE EXCEPTION 'unreachable visitor fold';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('test.auth_uid', '00000000-0000-0000-0000-000000007777', false);
SELECT set_config('test.auth_jwt', '{"is_anonymous":true}', false);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.harness_segment_spec_status((SELECT vehicle_id FROM material_fixture WHERE name = 'second'))) THEN
    RAISE EXCEPTION 'anonymous sign-in opened private owner vehicle'; END IF;
  BEGIN
    UPDATE public.harness_segments SET gauge_awg = 8 WHERE vehicle_id = (SELECT vehicle_id FROM material_fixture WHERE name = 'repair');
    RAISE EXCEPTION 'unreachable visitor mutation';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('test.auth_jwt', '{"is_anonymous":false}', false);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.harness_segment_spec_status((SELECT vehicle_id FROM material_fixture WHERE name = 'second'))) THEN
    RAISE EXCEPTION 'real owner cannot inspect private material'; END IF;
END $$;
RESET ROLE;
UPDATE public.vehicles SET deleted_at = now() WHERE id = (SELECT vehicle_id FROM material_fixture WHERE name = 'second');
SET ROLE authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.harness_segment_spec_status((SELECT vehicle_id FROM material_fixture WHERE name = 'second'))) THEN
    RAISE EXCEPTION 'deleted vehicle leaked'; END IF;
END $$;
RESET ROLE;
SELECT set_config('test.auth_uid', '', false);
SELECT set_config('test.auth_jwt', '{}', false);
SELECT 'test_harness_segment_material_revisions: PASS';
