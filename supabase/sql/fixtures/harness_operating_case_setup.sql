-- Synthetic electrical scope over the existing worker contract. No retained
-- vehicle/source capture or installed-device assertion is used here. Public
-- source qualification is an explicit fixture; compilation, persistence,
-- numerical solution and the private worker are the candidate implementation.
\set ON_ERROR_STOP on
\i supabase/sql/fixtures/harness_worker_phase_setup.sql
\i supabase/sql/fixtures/harness_worker_consumer_setup.sql
\i supabase/migrations/20261126071000_harness_worker_phase.sql
SET lock_timeout='2s';
-- Exact tracked bulk-revert owner from 20261124040000_model_fold_loop.sql;
-- the existing consumer fixture captures only its gauge and single revert.
create or replace function public.model_fold_revert_since(p_since timestamptz) returns jsonb
language plpgsql set search_path = public as $$
declare t record; out jsonb := '[]';
begin
  for t in select tick_id from public.model_fold_ticks where started_at >= p_since and status in ('ok','error','stale')
            order by started_at desc loop
    out := out || jsonb_build_array(public.model_fold_revert_v1(t.tick_id));
  end loop;
  return jsonb_build_object('ticks', jsonb_array_length(out), 'detail', out);
end $$;
SELECT public.t_assert(md5(prosrc)='876dc0513327e0bc5b66a03eb7d5ca70',
 'existing worker body matches the retained integration target')
 FROM pg_proc WHERE oid='public.model_fold_tick()'::regprocedure;
CREATE TABLE public.harness_endpoints(id uuid PRIMARY KEY,vehicle_id uuid REFERENCES public.vehicles(id));
CREATE TABLE public.wire_termination_specs(id uuid PRIMARY KEY,vehicle_id uuid REFERENCES public.vehicles(id),
 endpoint_id uuid REFERENCES public.harness_endpoints(id));
CREATE TABLE public.harness_segments(id uuid PRIMARY KEY,vehicle_id uuid REFERENCES public.vehicles(id),
 from_termination_id uuid REFERENCES public.wire_termination_specs(id),to_termination_id uuid REFERENCES public.wire_termination_specs(id));
CREATE TABLE public.wire_resistance_conditions(condition_key text PRIMARY KEY);
CREATE TABLE public.wire_resistance_claims(observation_id uuid PRIMARY KEY REFERENCES public.vehicle_observations(id),
 condition_key text REFERENCES public.wire_resistance_conditions(condition_key));
CREATE TABLE public.harness_model_nodes(evaluation_id uuid,id uuid,PRIMARY KEY(evaluation_id,id));
CREATE TABLE public.harness_model_segment_ends(evaluation_id uuid,segment_id uuid,side text,termination_id uuid,node_id uuid,
 PRIMARY KEY(evaluation_id,segment_id,side));
CREATE TABLE public.harness_model_checks(id uuid PRIMARY KEY,evaluation_id uuid,segment_id uuid,
 rule_key text,rule_version text,result text);
ALTER TABLE public.harness_model_evaluations ADD COLUMN input_hash text;
CREATE TABLE public.fixture_operating_source(vehicle_id uuid PRIMARY KEY REFERENCES public.vehicles(id),p jsonb,qualified boolean NOT NULL DEFAULT true);
INSERT INTO public.harness_endpoints VALUES
 ('b0000000-0000-4000-8000-000000000001',:fb1),('b0000000-0000-4000-8000-000000000002',:fb1);
INSERT INTO public.wire_termination_specs VALUES
 ('b0000000-0000-4000-8000-000000000011',:fb1,'b0000000-0000-4000-8000-000000000001'),
 ('b0000000-0000-4000-8000-000000000012',:fb1,'b0000000-0000-4000-8000-000000000002');
INSERT INTO public.harness_segments VALUES
 ('b0000000-0000-4000-8000-000000000021',:fb1,'b0000000-0000-4000-8000-000000000011','b0000000-0000-4000-8000-000000000012');
INSERT INTO public.fixture_operating_source
SELECT :fb1,jsonb_build_object('model',jsonb_build_object('contract_version',2,'selection','decided_design','vehicle_id',:fb1,
 'segments',jsonb_build_array(jsonb_build_object('id',s.id,'circuit_id','b0000000-0000-4000-8000-000000000031',
 'from_termination_id',s.from_termination_id,'to_termination_id',s.to_termination_id,'wire_part_id',NULL,
 'gauge_awg',22,'circuit_gauge_awg',22,'colour','brown/black','circuit_colour','brown/black')),
 'terminations',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.wire_termination_specs t WHERE vehicle_id=:fb1),
 'unsegmented_end_records','[]'::jsonb),
 'rules',(SELECT jsonb_agg(jsonb_build_object('rule_key',k,'version','1','subject_kind','segment') ORDER BY k)
 FROM unnest(ARRAY['segment_links','segment_plan_agreement','material_source_status','segment_specification','wire_stock_key','new_wire_demand']) k)),true
FROM public.harness_segments s;
INSERT INTO public.harness_model_evaluations(id,vehicle_id,logic_key,input_hash)
SELECT 'b0000000-0000-4000-8000-000000000041',vehicle_id,public.harness_model_logic_key(),md5(p::text)
FROM public.fixture_operating_source;
INSERT INTO public.harness_model_state(vehicle_id,source_epoch,folded_epoch,latest_evaluation_id,last_attempt_logic_key)
VALUES(:fb1,1,1,'b0000000-0000-4000-8000-000000000041',public.harness_model_logic_key());
INSERT INTO public.harness_model_nodes VALUES
 ('b0000000-0000-4000-8000-000000000041','b0000000-0000-4000-8000-000000000051'),
 ('b0000000-0000-4000-8000-000000000041','b0000000-0000-4000-8000-000000000052');
INSERT INTO public.harness_model_segment_ends VALUES
 ('b0000000-0000-4000-8000-000000000041','b0000000-0000-4000-8000-000000000021','from','b0000000-0000-4000-8000-000000000011','b0000000-0000-4000-8000-000000000051'),
 ('b0000000-0000-4000-8000-000000000041','b0000000-0000-4000-8000-000000000021','to','b0000000-0000-4000-8000-000000000012','b0000000-0000-4000-8000-000000000052');
INSERT INTO public.harness_model_checks
SELECT md5('operating fixture check '||k)::uuid,'b0000000-0000-4000-8000-000000000041',
 'b0000000-0000-4000-8000-000000000021',k,'1',CASE WHEN k IN('segment_specification','wire_stock_key') THEN 'hold' ELSE 'pass' END
FROM unnest(ARRAY['segment_links','segment_plan_agreement','material_source_status','segment_specification','wire_stock_key','new_wire_demand']) k;
CREATE FUNCTION public.harness_model_inputs(uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT p FROM public.fixture_operating_source WHERE vehicle_id=$1 $$;
CREATE FUNCTION public.harness_model_receipt_for_hash(uuid,text) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('id',e.id,'input_hash',e.input_hash,'logic_key',e.logic_key)
 FROM public.fixture_operating_source f JOIN public.harness_model_state s USING(vehicle_id)
 JOIN public.harness_model_evaluations e ON e.id=s.latest_evaluation_id AND e.vehicle_id=f.vehicle_id
 WHERE f.vehicle_id=$1 AND f.qualified AND md5(f.p::text)=$2 AND e.input_hash=$2
 AND e.logic_key=public.harness_model_logic_key() AND s.source_epoch=s.folded_epoch $$;
CREATE FUNCTION public.wire_resistance_reference_evidence(uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT NULL::jsonb$$;
CREATE FUNCTION public.fixture_operating_recipe(p_case uuid,p_state text,p_prior uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('case_id',p_case,'vehicle_id','a0000000-0000-4000-8000-000000000001',
  'case_code','fixture_'||replace(p_case::text,'-','_'),'expected_revision_id',p_prior,
  'recorded_by_agent_key','disposable-contract','method_version','analytical_fixture_v1',
  'authored_at','2026-11-26T00:00:00Z','requested_state','enabled',
  'reference_termination_id','b0000000-0000-4000-8000-000000000011',
  'wires',jsonb_build_array(jsonb_build_object('segment_id','b0000000-0000-4000-8000-000000000021',
   'wire_state',p_state,'resistance_basis','direct_assumption','direct_resistance_ohm',2,
   'length_basis','not_used','applicability_basis','conditional_assumption')),
  'elements',jsonb_build_array(jsonb_build_object('element_id','b0000000-0000-4000-8000-000000000061',
   'element_code','explicit_analytical_source','from_termination_id','b0000000-0000-4000-8000-000000000011',
   'to_termination_id','b0000000-0000-4000-8000-000000000012','law_kind','voltage_source','voltage_v',12)),
  'boundaries','[]'::jsonb) $$;
GRANT SELECT ON public.platform_config,public.vehicles,public.harness_designs,public.harness_model_state,
 public.harness_model_evaluations,public.harness_model_nodes,public.harness_model_segment_ends,public.harness_model_checks,
 public.harness_segments,public.wire_termination_specs,public.harness_endpoints,public.wire_resistance_claims,
 public.wire_resistance_conditions,public.fixture_operating_source TO service_role;
GRANT ALL ON public.model_fold_work,public.model_fold_ticks,public.model_fold_tick_runs,public.model_fold_signal TO service_role;
-- Existing generic producers in the reused fixture are INVOKER stubs, so
-- give them only their own fixture log/output access (not private case DML).
GRANT INSERT ON public.worker_phase_calls TO service_role;
GRANT SELECT ON public.vehicle_observations,public.auction_comments TO service_role;
GRANT ALL ON public.vehicle_code_reading_runs,public.vehicle_code_readings,
 public.data_set_runs,public.data_set_members,public.data_set_member_plan TO service_role;
GRANT USAGE ON SEQUENCE public.worker_phase_calls_id_seq,public.data_set_members_id_seq TO service_role;
REVOKE ALL ON PROCEDURE public.model_fold_tick() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON PROCEDURE public.model_fold_tick() TO service_role;
-- Retain the existing queue's hosted service-role/RLS entrypoint boundary.
ALTER TABLE public.model_fold_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_fold_ticks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_fold_tick_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_fold_signal ENABLE ROW LEVEL SECURITY;
UPDATE public.platform_config SET config_value=config_value||'{"max_vehicles":1}' WHERE config_key='model_fold';
