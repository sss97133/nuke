-- Reuse the actual queue protocol fixture, not a fake invalidation RPC.
\set ON_ERROR_STOP on
\i supabase/sql/test_observation_analysis_work.sql
RESET ROLE;
CREATE TABLE public.model_registry(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),slug text UNIQUE,
 provider text,caller_kind text,base_trust numeric,version text,last_seen timestamptz,notes text);
CREATE TABLE public.projection_event(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_envelope jsonb,
 result_envelope jsonb,result_kind text,model_id uuid REFERENCES public.model_registry(id),model_caller text,
 prompt_sha256 text,observation_ids uuid[] DEFAULT '{}',observed_at timestamptz,recorded_at timestamptz DEFAULT now(),
 retracted_by uuid REFERENCES public.projection_event(id),retracted_at timestamptz);
\i supabase/migrations/20260615000000_projection_event_evidence_class.sql
CREATE TRIGGER projection_event_freeze_trigger BEFORE UPDATE ON public.projection_event
 FOR EACH ROW EXECUTE FUNCTION public.projection_event_freeze_trigger();
\i supabase/migrations/20260615020000_consensus_and_reputation.sql
\i supabase/migrations/20260615050000_retract_projection_event.sql
\i supabase/migrations/20260615030000_vehicle_wiki_view.sql
ALTER TABLE public.vehicles ADD COLUMN year integer,ADD COLUMN make text,ADD COLUMN model text,ADD COLUMN vin text,
 ADD COLUMN body_style text,ADD COLUMN color text,ADD COLUMN color_family text,ADD COLUMN color_source text,
 ADD COLUMN horsepower integer,ADD COLUMN torque integer,ADD COLUMN displacement text,ADD COLUMN seats integer,
 ADD COLUMN canonical_outcome text,ADD COLUMN is_for_sale boolean,ADD COLUMN status text;
CREATE TABLE public.vehicle_metric_recompute_queue(vehicle_id uuid PRIMARY KEY REFERENCES public.vehicles(id),
 live_metrics_dirty boolean DEFAULT false,queued_at timestamptz DEFAULT now());
CREATE TABLE public.pipeline_registry(table_name text,column_name text,owned_by text,description text,
 do_not_write_directly boolean,write_via text,UNIQUE(table_name,column_name));
INSERT INTO public.model_registry(slug,base_trust,version) VALUES('fixture-reader',0.7,'fixture-v1');
-- Historical weights were never retained. Keep this original testimony intact.
INSERT INTO public.projection_event(request_envelope,result_envelope,model_id,observed_at)
 SELECT '{"subject_id":"10000000-0000-4000-8000-000000000002","attribute":"vehicle.horsepower"}',
 '{"label":111,"confidence":0.8}',id,'2026-10-01T00:00:00Z' FROM public.model_registry WHERE slug='fixture-reader';
\i supabase/migrations/20261030164639_replay_attribute_projection_cutoffs.sql
INSERT INTO public.analysis_widgets(slug,is_enabled,trigger_on_observation_kinds)
 VALUES('identity-confidence',true,'{}'),('data-quality',true,'{}'),('price-position',true,'{}'),('comp-freshness',true,'{}');
CREATE TEMP TABLE first_projection AS WITH inserted AS (
 INSERT INTO public.projection_event(request_envelope,result_envelope,result_kind,model_id,prompt_sha256,
   evidence_class,evidence_ref,observed_at,recorded_at,consensus_context)
 SELECT '{"subject_id":"10000000-0000-4000-8000-000000000001","attribute":"vehicle.horsepower"}',
  '{"label":200,"confidence":0.8}', 'projection',id,repeat('a',64),'document','{"document_id":"fixture"}',
  '2026-10-01T00:00:00Z','1900-01-01T00:00:00Z','{"actor_trust":1,"method_revision":"forged"}'
 FROM public.model_registry WHERE slug='fixture-reader' RETURNING *) SELECT * FROM inserted;
SELECT pg_temp.ok('admission pins real method and trust, and prevents backdated knowledge',
 (SELECT consensus_context->>'method_revision'='attribute_consensus_v2' AND consensus_context->>'actor_trust'='0.7'
  AND consensus_context->>'model_version'='fixture-v1' AND recorded_at>'2026-10-01T00:00:00Z' FROM first_projection));
CREATE TEMP TABLE earlier_answer AS SELECT clock_timestamp() AS known_at,public.project_attribute(
 '10000000-0000-4000-8000-000000000001','vehicle.horsepower','2026-10-02T00:00:00Z',clock_timestamp(),
 'attribute_consensus_v2') AS answer;
SELECT pg_temp.ok('answer cites its immutable projection and method with separate clocks',
 (SELECT answer->>'consensus'='200' AND answer->>'replay_status'='replayable'
  AND answer#>>'{candidates,0,contributors,0,projection_event_id}'=(SELECT id::text FROM first_projection) FROM earlier_answer));
UPDATE public.model_registry SET base_trust=0.1,version='fixture-v2' WHERE slug='fixture-reader';
SELECT pg_temp.ok('current evaluation uses newly retained reputation without rewriting the old claim',
 public.project_attribute('10000000-0000-4000-8000-000000000001','vehicle.horsepower')#>>'{candidates,0,contributors,0,actor_trust}'='0.1'
 AND (SELECT consensus_context->>'actor_trust'='0.7' FROM public.projection_event WHERE id=(SELECT id FROM first_projection)));
SELECT pg_temp.ok('later model reputation or revision cannot change an earlier pinned answer',
 (SELECT public.project_attribute('10000000-0000-4000-8000-000000000001','vehicle.horsepower',
 '2026-10-02T00:00:00Z',known_at,'attribute_consensus_v2')->'candidates'=answer->'candidates' FROM earlier_answer));
CREATE TEMP TABLE correction AS WITH inserted AS (
 INSERT INTO public.projection_event(request_envelope,result_envelope,result_kind,model_id,prompt_sha256,evidence_class,observed_at)
 SELECT '{"subject_id":"10000000-0000-4000-8000-000000000001","attribute":"vehicle.horsepower"}',
  '{"label":150,"confidence":0.9}','projection',id,repeat('b',64),'document','2026-10-01T00:00:00Z'
 FROM public.model_registry WHERE slug='fixture-reader' RETURNING *) SELECT * FROM inserted;
INSERT INTO public.analysis_signals(vehicle_id,widget_slug,severity,stale_at)
 VALUES('10000000-0000-4000-8000-000000000001','identity-confidence','ok',clock_timestamp()+interval '1 day');
CREATE TEMP TABLE corrected AS SELECT public.retract_projection_event(a.id,'Fixture source correction',c.id) AS r
 FROM first_projection a,correction c;
SELECT pg_temp.ok('correction retains both values, a retraction marker and explicit replacement lineage',
 (SELECT (r->>'replacement_event_id')::uuid=(SELECT id FROM correction) FROM corrected)
 AND (SELECT result_envelope->>'label'='200' AND retracted_at IS NOT NULL AND consensus_context->>'actor_trust'='0.7'
  FROM public.projection_event WHERE id=(SELECT id FROM first_projection)));
SELECT pg_temp.ok('same cutoff reproduces the earlier answer after correction',
 (SELECT public.project_attribute('10000000-0000-4000-8000-000000000001','vehicle.horsepower',
  '2026-10-02T00:00:00Z',known_at,'attribute_consensus_v2')->'candidates'=answer->'candidates' FROM earlier_answer));
SELECT pg_temp.ok('revised knowledge at the same event cutoff returns the corrected answer',
 public.project_attribute('10000000-0000-4000-8000-000000000001','vehicle.horsepower','2026-10-02T00:00:00Z',
  clock_timestamp(),'attribute_consensus_v2')->>'consensus'='150');
SELECT pg_temp.ok('event cutoff excludes later interpretations even when already known',
 public.project_attribute('10000000-0000-4000-8000-000000000001','vehicle.horsepower','2026-09-30T00:00:00Z',
  clock_timestamp(),'attribute_consensus_v2')->>'consensus' IS NULL);
SELECT pg_temp.ok('profile replay exposes historical cited fields without a current canonical header',
 (SELECT public.vehicle_wiki('10000000-0000-4000-8000-000000000001','2026-10-02T00:00:00Z',known_at,
  'attribute_consensus_v2')#>>'{cited_fields,0,consensus}'='200' FROM earlier_answer)
 AND public.vehicle_wiki('10000000-0000-4000-8000-000000000001','2026-10-02T00:00:00Z',clock_timestamp(),
  'attribute_consensus_v2')->>'canonical_status'='not_historically_replayed');
SELECT pg_temp.ok('current profile reader uses the revised result',
 public.vehicle_wiki('10000000-0000-4000-8000-000000000001')#>>'{cited_fields,0,consensus}'='150');
SELECT pg_temp.ok('missing historical inputs are explicit unknown, not fabricated replay',
 public.project_attribute('10000000-0000-4000-8000-000000000002','vehicle.horsepower','2026-10-02T00:00:00Z',
  clock_timestamp(),'attribute_consensus_v2')->>'replay_status'='unavailable_unpinned_inputs'
 AND public.project_attribute('10000000-0000-4000-8000-000000000002','vehicle.horsepower')->>'consensus'='111');
SELECT pg_temp.ok('corrections durably invalidate existing metric and analysis work',
 EXISTS(SELECT FROM public.vehicle_metric_recompute_queue WHERE vehicle_id='10000000-0000-4000-8000-000000000001' AND live_metrics_dirty)
 AND (SELECT request_revision>completed_revision AND widget_slugs @> ARRAY['data-quality','identity-confidence','price-position','comp-freshness']
  FROM public.analysis_queue WHERE vehicle_id='10000000-0000-4000-8000-000000000001')
 AND (SELECT stale_at<=clock_timestamp() FROM public.analysis_signals
  WHERE vehicle_id='10000000-0000-4000-8000-000000000001' AND widget_slug='identity-confidence'));
DO $$ BEGIN
 BEGIN
  UPDATE public.projection_event SET consensus_context='{}' WHERE id=(SELECT id FROM first_projection);
  RAISE EXCEPTION 'expected method immutability';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'projection_event rows are append-only.%' THEN RAISE; END IF; END;
 BEGIN
  UPDATE public.projection_event SET retracted_at=NULL,retracted_by=NULL WHERE id=(SELECT id FROM first_projection);
  RAISE EXCEPTION 'expected retraction history immutability';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Retraction history is append-only%' THEN RAISE; END IF; END;
END $$;
SELECT pg_temp.ok('new correction writer keeps the existing service-only authority',
 NOT has_function_privilege('anon','public.retract_projection_event(uuid,text,uuid)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.retract_projection_event(uuid,text,uuid)','EXECUTE'));
SELECT pg_temp.ok('scoring history writes belong only to its trigger, including projects with broad default grants',
 NOT has_table_privilege('anon','public.model_consensus_history','INSERT,UPDATE,DELETE')
 AND NOT has_table_privilege('authenticated','public.model_consensus_history','INSERT,UPDATE,DELETE')
 AND NOT has_table_privilege('service_role','public.model_consensus_history','INSERT,UPDATE,DELETE'));
INSERT INTO public.projection_event(request_envelope,result_envelope,result_kind,model_id,prompt_sha256,evidence_class,observed_at)
 SELECT '{"subject_id":"10000000-0000-4000-8000-000000000001","attribute":"vehicle.exterior_color"}',
  jsonb_build_object('label',label,'confidence',1),'projection',m.id,repeat('c',64),'image','2026-10-01T00:00:00Z'
 FROM public.model_registry m CROSS JOIN (VALUES('Red'),('Blue')) colors(label) WHERE m.slug='fixture-reader';
SELECT pg_temp.ok('comparable contradictory interpretations remain disputed with deterministic ties',
 public.project_attribute('10000000-0000-4000-8000-000000000001','vehicle.exterior_color')->>'state'='disputed'
 AND public.project_attribute('10000000-0000-4000-8000-000000000001','vehicle.exterior_color')->>'consensus'='Blue');
DO $$ BEGIN
 BEGIN
  PERFORM public.project_attribute('10000000-0000-4000-8000-000000000001','vehicle.horsepower',now(),now(),'unregistered_method');
  RAISE EXCEPTION 'expected unsupported method refusal';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
-- Both historical and current readers retain the caller's underlying row policy.
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projection_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY fixture_visible_vehicle ON public.vehicles FOR SELECT TO anon
 USING(id='10000000-0000-4000-8000-000000000001');
CREATE POLICY fixture_visible_projection ON public.projection_event FOR SELECT TO anon
 USING(request_envelope->>'subject_id'='10000000-0000-4000-8000-000000000001');
GRANT SELECT ON public.vehicles,public.projection_event,public.model_registry TO anon;
SET ROLE anon;
SELECT pg_temp.ok('cited scoring metadata serves the reader without opening private model-registry notes',
 NOT EXISTS(SELECT FROM public.model_registry)
 AND public.project_attribute('10000000-0000-4000-8000-000000000001','vehicle.horsepower')->>'consensus'='150');
SELECT pg_temp.ok('historical reader respects source RLS without revealing hidden legacy rows',
 public.project_attribute('10000000-0000-4000-8000-000000000002','vehicle.horsepower','2026-10-02T00:00:00Z',
  clock_timestamp(),'attribute_consensus_v2')->>'consensus' IS NULL
 AND public.project_attribute('10000000-0000-4000-8000-000000000002','vehicle.horsepower','2026-10-02T00:00:00Z',
  clock_timestamp(),'attribute_consensus_v2')->>'unpinned_count'='0'
 AND public.vehicle_wiki('10000000-0000-4000-8000-000000000002','2026-10-02T00:00:00Z',clock_timestamp(),
  'attribute_consensus_v2') IS NULL);
RESET ROLE;
