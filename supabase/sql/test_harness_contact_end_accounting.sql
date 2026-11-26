-- Empty disposable PostgreSQL17 only; parent contract enforces the boundary.
\set ON_ERROR_STOP on
\i supabase/sql/test_harness_manual_context_references.sql

-- Historical minimal fixture compatibility; these are existing production
-- source columns, not schema minted by this change.
ALTER TABLE public.harness_endpoints ADD COLUMN IF NOT EXISTS superseded_by uuid;
ALTER TABLE public.wire_termination_specs ADD COLUMN IF NOT EXISTS superseded_by uuid;

CREATE TEMP TABLE contact_end_before AS SELECT
 public.harness_model_inputs(md5('functional context vehicle')::uuid) AS input,
 public.harness_model_compute(public.harness_model_inputs(md5('functional context vehicle')::uuid)) AS computed,
 (SELECT latest_evaluation_id FROM public.harness_model_state WHERE vehicle_id=md5('functional context vehicle')::uuid) AS evaluation_id;
\i supabase/migrations/20261126061300_harness_contact_end_accounting.sql

DO $$
DECLARE v uuid:=md5('functional context vehicle')::uuid; r jsonb; p jsonb;
BEGIN
 IF (SELECT count(*) FROM public.harness_model_rules WHERE rule_key IN('segment_links','termination_cavity_key','circuit_segments') AND version='1' AND NOT is_current AND superseded_at IS NOT NULL)<>3
 OR (SELECT count(*) FROM public.harness_model_rules WHERE ((rule_key IN('termination_cavity_key','circuit_segments') AND version='2') OR (rule_key='segment_links' AND version='3')) AND is_current)<>3
 THEN RAISE EXCEPTION 'Changed predicates did not retain their old immutable versions'; END IF;
 r:=public.harness_manual_index(v);
 IF r->>'status'='current' THEN RAISE EXCEPTION 'Old evaluation survived changed input/rule/logic'; END IF;
 r:=public.harness_model_fold(v);
 IF r->>'status' IS DISTINCT FROM 'current' OR (r->>'evaluation_id')::uuid=(SELECT evaluation_id FROM contact_end_before)
 THEN RAISE EXCEPTION 'Normal fold failed after integrity upgrade: %',r; END IF;
 p:=public.harness_model_inputs(v);
 -- The baseline has no extra current ends. Its uncontested contact geometry
 -- and positive physical-piece predictions must survive the rule upgrade.
 IF jsonb_array_length(p#>'{model,unsegmented_end_records}')<>0 THEN RAISE EXCEPTION 'Invented baseline extra ends'; END IF;
 IF public.harness_model_compute(p)->'nodes' IS DISTINCT FROM (SELECT computed->'nodes' FROM contact_end_before)
 OR public.harness_model_compute(p)->'segment_ends' IS DISTINCT FROM (SELECT computed->'segment_ends' FROM contact_end_before)
 OR public.harness_model_compute(p)->'wire_requirements' IS DISTINCT FROM (SELECT computed->'wire_requirements' FROM contact_end_before)
 THEN RAISE EXCEPTION 'Uncontested baseline connections or wire plans changed'; END IF;
 IF p#>'{model,circuits}' IS DISTINCT FROM (SELECT input#>'{model,circuits}' FROM contact_end_before)
 THEN RAISE EXCEPTION 'Selected circuit context fields changed'; END IF;
END $$;

-- Contradictory recorded labels for one keyed contact remain separate and held.
BEGIN;
UPDATE public.harness_endpoints SET node_kind='terminals' WHERE id=md5('functional context controller')::uuid;
INSERT INTO public.connector_cavity_layouts(id,connector_model,cavity_id) VALUES(md5('contact end cavity')::uuid,'Synthetic contact','1');
UPDATE public.wire_termination_specs SET cavity_layout_id=md5('contact end cavity')::uuid,
 cavity=CASE WHEN id=md5('functional end 1from')::uuid THEN '1' ELSE '2' END
 WHERE id IN(md5('functional end 1from')::uuid,md5('functional end 2from')::uuid);
DO $$
DECLARE r jsonb:=public.harness_model_compute(public.harness_model_inputs(md5('functional context vehicle')::uuid));
BEGIN
 IF (SELECT count(DISTINCT x->>'node_id') FROM jsonb_array_elements(r->'segment_ends') x
 WHERE x->>'termination_id' IN(md5('functional end 1from')::uuid::text,md5('functional end 2from')::uuid::text))<>2
 THEN RAISE EXCEPTION 'Competing keyed labels silently joined'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(r->'checks') x WHERE x->>'rule_key'='termination_cavity_key'
 AND x->>'termination_id' IN(md5('functional end 1from')::uuid::text,md5('functional end 2from')::uuid::text) AND x->>'result'='hold')<>2
 OR (SELECT count(*) FROM jsonb_array_elements(r->'wire_requirements') x
 WHERE x->>'segment_id' IN(md5('functional piece 1')::uuid::text,md5('functional piece 2')::uuid::text)
 AND x->>'state'='held' AND (x->>'planned_quantity')::numeric>0)<>2
 THEN RAISE EXCEPTION 'Competing contact claims did not hold positive piece predictions'; END IF;
END $$;
ROLLBACK;

-- Uncontested recorded prefixes differ from library labels without inventing
-- an alias mapping. Exact source key/label claims stay shared in one net.
BEGIN;
UPDATE public.harness_endpoints SET node_kind='terminals' WHERE id=md5('functional context controller')::uuid;
INSERT INTO public.connector_cavity_layouts(id,connector_model,cavity_id) VALUES(md5('contact end cavity')::uuid,'Synthetic contact','11');
UPDATE public.wire_termination_specs SET cavity_layout_id=md5('contact end cavity')::uuid,cavity='A11'
 WHERE id IN(md5('functional end 1from')::uuid,md5('functional end 2from')::uuid);
DO $$
DECLARE r jsonb:=public.harness_model_compute(public.harness_model_inputs(md5('functional context vehicle')::uuid));
BEGIN
 IF (SELECT count(DISTINCT x->>'node_id') FROM jsonb_array_elements(r->'segment_ends') x
 WHERE x->>'termination_id' IN(md5('functional end 1from')::uuid::text,md5('functional end 2from')::uuid::text))<>1
 THEN RAISE EXCEPTION 'Uncontested prefixed source claim was broken'; END IF;
END $$;
UPDATE public.wire_termination_specs SET cavity='a11' WHERE id=md5('functional end 2from')::uuid;
DO $$
DECLARE r jsonb:=public.harness_model_compute(public.harness_model_inputs(md5('functional context vehicle')::uuid));
BEGIN
 IF (SELECT count(DISTINCT x->>'node_id') FROM jsonb_array_elements(r->'segment_ends') x
 WHERE x->>'termination_id' IN(md5('functional end 1from')::uuid::text,md5('functional end 2from')::uuid::text))<>2
 THEN RAISE EXCEPTION 'Case-sensitive source identities were normalized together'; END IF;
END $$;
ROLLBACK;

-- The same explicitly keyed contact cannot quietly claim two declared nets.
BEGIN;
UPDATE public.harness_endpoints SET node_kind='terminals' WHERE id=md5('functional context controller')::uuid;
INSERT INTO public.connector_cavity_layouts(id,connector_model,cavity_id) VALUES(md5('contact end cavity')::uuid,'Synthetic contact','1');
INSERT INTO public.harness_nets(id,vehicle_id,net_code,source,method,observed_at,trust)
 VALUES(md5('contact end second net')::uuid,md5('functional context vehicle')::uuid,'CONTACT-END-SECOND','synthetic','synthetic',now(),'T3');
UPDATE public.harness_segments SET net_id=md5('contact end second net')::uuid WHERE id=md5('functional piece 2')::uuid;
UPDATE public.wire_termination_specs SET cavity_layout_id=md5('contact end cavity')::uuid,cavity='1'
 WHERE id IN(md5('functional end 1from')::uuid,md5('functional end 2from')::uuid);
DO $$
DECLARE r jsonb:=public.harness_model_compute(public.harness_model_inputs(md5('functional context vehicle')::uuid));
BEGIN
 IF (SELECT count(*) FROM jsonb_array_elements(r->'checks') x WHERE x->>'rule_key'='segment_links'
 AND x->>'segment_id' IN(md5('functional piece 1')::uuid::text,md5('functional piece 2')::uuid::text) AND x->>'result'='fail')<>2
 THEN RAISE EXCEPTION 'Conflicting declared nets at one keyed contact were not flagged'; END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(r->'nodes') x WHERE x->>'source_termination_id'
 IN(md5('functional end 1from')::uuid::text,md5('functional end 2from')::uuid::text) AND x->>'basis'<>'isolated_end')
 THEN RAISE EXCEPTION 'Conflicted contact still offered continuity'; END IF;
END $$;
-- Without explicit keys the same descriptive label is ambiguity, not proof of
-- a physical short. It must still hold the material and isolate the attachments.
UPDATE public.wire_termination_specs SET cavity_layout_id=NULL,cavity='SAME-DESCRIPTION'
 WHERE id IN(md5('functional end 1from')::uuid,md5('functional end 2from')::uuid);
DO $$
DECLARE r jsonb:=public.harness_model_compute(public.harness_model_inputs(md5('functional context vehicle')::uuid));
BEGIN
 IF (SELECT count(*) FROM jsonb_array_elements(r->'checks') x WHERE x->>'rule_key'='segment_links'
 AND x->>'segment_id' IN(md5('functional piece 1')::uuid::text,md5('functional piece 2')::uuid::text) AND x->>'result'='hold')<>2
 THEN RAISE EXCEPTION 'Unkeyed cross-net description was treated as qualified'; END IF;
END $$;
ROLLBACK;

-- A current end on a selected circuit cannot disappear because it is not part
-- of a selected physical piece. The drawing exposes exact keys and counts.
BEGIN;
INSERT INTO public.wire_termination_specs(id,vehicle_id,circuit_id,endpoint_id,cavity)
 SELECT md5('contact end extra '||i)::uuid,md5('functional context vehicle')::uuid,md5('functional circuit 1')::uuid,
 md5('functional context connector')::uuid,'EXTRA-'||i FROM generate_series(1,27) i;
-- One end is linked only to an excluded candidate segment; the old raw orphan
-- list omitted it. Selection accounting must still identify that exact end.
INSERT INTO public.harness_segments(id,vehicle_id,vehicle_custom_circuit_id,net_id,from_termination_id,to_termination_id,
 gauge_awg,colour,planned_length_ft,planned_length_method,build_state,design_status,source,method,observed_at,trust)
 VALUES(md5('contact end candidate')::uuid,md5('functional context vehicle')::uuid,md5('functional circuit 1')::uuid,
 md5('functional context net')::uuid,md5('contact end extra 1')::uuid,md5('contact end extra 2')::uuid,
 20,'red',1,'synthetic plan','uncut','candidate','synthetic','synthetic',now(),'T3');
DO $$
DECLARE v uuid:=md5('functional context vehicle')::uuid; p jsonb; r jsonb; eid uuid; sid uuid; drawing jsonb;
BEGIN
 p:=public.harness_model_inputs(v);
 IF jsonb_array_length(p#>'{model,unsegmented_end_records}')<>27
 OR NOT EXISTS(SELECT FROM jsonb_array_elements(p#>'{model,unsegmented_end_records}') x WHERE x->>'id'=md5('contact end extra 1')::uuid::text)
 THEN RAISE EXCEPTION 'Current ends were lost to candidate or raw-reader selection'; END IF;
 r:=public.harness_model_compute(p);
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(r->'checks') x WHERE x->>'circuit_id'=md5('functional circuit 1')::uuid::text
 AND x->>'rule_key'='circuit_segments' AND x->>'rule_version'='2' AND x->>'result'='hold')
 OR NOT EXISTS(SELECT FROM jsonb_array_elements(r->'wire_requirements') x WHERE x->>'segment_id'=md5('functional piece 1')::uuid::text
 AND x->>'state'='held' AND (x->>'planned_quantity')::numeric>0)
 OR jsonb_array_length(r->'wire_requirements')<>20
 THEN RAISE EXCEPTION 'Extra ends fabricated pieces, hid a positive plan or failed to hold it'; END IF;
 r:=public.harness_model_fold(v);
 IF r->>'status' IS DISTINCT FROM 'current' THEN RAISE EXCEPTION 'Honest gapped model failed to publish: %',r; END IF;
 eid:=(r->>'evaluation_id')::uuid;
 SELECT sheet_id INTO sid FROM public.harness_model_sheet_members WHERE evaluation_id=eid AND segment_id=md5('functional piece 1')::uuid;
 drawing:=public.harness_manual_sheet(v,eid,sid);
 IF drawing->>'status' IS DISTINCT FROM 'current' OR (drawing#>>'{model,unsegmented_end_count}')::int<>27
 OR jsonb_array_length(drawing#>'{model,unsegmented_end_records}')<>25
 OR (drawing#>>'{model,unsegmented_end_records_complete}')::boolean IS DISTINCT FROM false
 OR EXISTS(SELECT FROM jsonb_array_elements(drawing#>'{model,unsegmented_end_records}') x
 WHERE x->>'circuit_id'<>md5('functional circuit 1')::uuid::text OR x->>'endpoint_code' IS DISTINCT FROM 'FC-CONNECTOR')
 THEN RAISE EXCEPTION 'Drawing did not expose bounded exact gap addresses/count/completeness: %',drawing; END IF;
END $$;
SET ROLE anon;
DO $$
DECLARE v uuid:=md5('functional context vehicle')::uuid; eid uuid; sid uuid; r jsonb;
BEGIN
 SELECT latest_evaluation_id INTO eid FROM public.harness_model_state WHERE vehicle_id=v;
 SELECT sheet_id INTO sid FROM public.harness_model_sheet_members WHERE evaluation_id=eid AND segment_id=md5('functional piece 1')::uuid;
 r:=public.harness_manual_sheet(v,eid,sid);
 IF r->>'status' IS DISTINCT FROM 'current' OR (r#>>'{model,unsegmented_end_count}')::int<>27
 OR r::text LIKE '%PRIVATE_FUNCTIONAL%' OR r::text LIKE '%FOREIGN_FUNCTIONAL%'
 THEN RAISE EXCEPTION 'Anonymous source gap read lost qualification or exposed prose'; END IF;
END $$;
RESET ROLE;
-- Hiding only an unattached source end must invalidate this public drawing;
-- derived child counts alone cannot establish source visibility completeness.
ALTER TABLE public.wire_termination_specs ENABLE ROW LEVEL SECURITY;
CREATE POLICY contact_end_fixture_read ON public.wire_termination_specs FOR SELECT USING(true);
CREATE POLICY contact_end_hide_one ON public.wire_termination_specs AS RESTRICTIVE FOR SELECT TO anon
 USING(id<>md5('contact end extra 1')::uuid);
SET ROLE anon;
DO $$
DECLARE v uuid:=md5('functional context vehicle')::uuid; eid uuid; sid uuid; r jsonb;
BEGIN
 SELECT latest_evaluation_id INTO eid FROM public.harness_model_state WHERE vehicle_id=v;
 SELECT sheet_id INTO sid FROM public.harness_model_sheet_members WHERE evaluation_id=eid AND segment_id=md5('functional piece 1')::uuid;
 r:=public.harness_manual_sheet(v,eid,sid);
 IF r->>'status'='current' OR r->'model' IS DISTINCT FROM 'null'::jsonb
 THEN RAISE EXCEPTION 'Hidden unattached source end left a current printable model'; END IF;
END $$;
RESET ROLE;
ROLLBACK;

SELECT 'test_harness_contact_end_accounting: PASS' AS result;
