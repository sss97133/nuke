-- Replay governed model outputs in their existing owner. Generic observations
-- remain in vehicle_observations; no source is copied into projection_event.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='5s';
DO $owners$
BEGIN
 IF to_regclass('public.model_consensus_history') IS NOT NULL
  OR to_regprocedure('public.retain_model_consensus_revision()') IS NOT NULL
  OR to_regprocedure('public.pin_projection_consensus_context()') IS NOT NULL THEN
  RAISE EXCEPTION 'Projection replay owner collision; review before migration'; END IF;
 IF encode(sha256(convert_to(pg_get_functiondef('public.project_attribute(uuid,text)'::regprocedure),'UTF8')),'base64')
   IS DISTINCT FROM '1t4Tgam9IgUCHdsPQNIBX8wZMyru+GE6uANZnWnaHs8='
 OR encode(sha256(convert_to(pg_get_functiondef('public.retract_projection_event(uuid,text)'::regprocedure),'UTF8')),'base64')
   IS DISTINCT FROM '8I6ae/gH4+k8IJ9ixMKccbBWVgwYDItKifdKDPpUke4='
 OR encode(sha256(convert_to(pg_get_functiondef('public.vehicle_wiki(uuid)'::regprocedure),'UTF8')),'base64')
   IS DISTINCT FROM '7U6wqm8D7scyIvBmRpBRNulwQq1E85mPGjDWN5V5GW4='
 OR encode(sha256(convert_to(pg_get_functiondef('public.projection_event_freeze_trigger()'::regprocedure),'UTF8')),'base64')
   IS DISTINCT FROM 'yV7uHP91tPKh1+MiD/IBcZqFVZjj1aL8kxe+h3CDtwg=' THEN
  RAISE EXCEPTION 'Projection owner changed; review replay migration'; END IF;
END $owners$;

-- model_registry is mutable and has no historical owner. This child records
-- only the scoring fields its existing reputation writer changes. Without it,
-- either past answers drift or current reputation stops affecting older claims.
CREATE TABLE public.model_consensus_history(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 model_id uuid NOT NULL REFERENCES public.model_registry(id),
 known_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 actor text NOT NULL,actor_trust numeric NOT NULL,model_version text
);
CREATE INDEX model_consensus_history_cutoff_idx ON public.model_consensus_history(model_id,known_at DESC,id DESC);
ALTER TABLE public.model_consensus_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.model_consensus_history FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.model_consensus_history TO anon,authenticated,service_role;
-- Expose scoring metadata only for models the caller can already see cited in
-- projection_event. Never grant access to registry notes or source contents.
CREATE POLICY model_consensus_history_cited_read ON public.model_consensus_history FOR SELECT TO anon,authenticated
 USING(EXISTS(SELECT FROM public.projection_event p WHERE p.model_id=model_consensus_history.model_id));
CREATE OR REPLACE FUNCTION public.retain_model_consensus_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='INSERT' OR ROW(NEW.slug,NEW.base_trust,NEW.version) IS DISTINCT FROM ROW(OLD.slug,OLD.base_trust,OLD.version) THEN
  INSERT INTO public.model_consensus_history(model_id,actor,actor_trust,model_version)
  VALUES(NEW.id,coalesce(NEW.slug,'unknown'),coalesce(NEW.base_trust,0.3),NEW.version);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER model_registry_retain_consensus_revision AFTER INSERT OR UPDATE OF slug,base_trust,version
 ON public.model_registry FOR EACH ROW EXECUTE FUNCTION public.retain_model_consensus_revision();
INSERT INTO public.model_consensus_history(model_id,actor,actor_trust,model_version)
 SELECT id,coalesce(slug,'unknown'),coalesce(base_trust,0.3),version FROM public.model_registry;
CREATE OR REPLACE FUNCTION public.model_consensus_history_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'Model consensus history is append-only'; END $$;
CREATE TRIGGER model_consensus_history_freeze BEFORE UPDATE OR DELETE ON public.model_consensus_history
 FOR EACH ROW EXECUTE FUNCTION public.model_consensus_history_append_only();
COMMENT ON TABLE public.model_consensus_history IS
 'Append-only scoring revisions of model_registry, owned by its reputation updates via retain_model_consensus_revision. Grain one changed model scoring tuple. known_at is server knowledge time; first snapshots make no claim about earlier trust. Contains no source content, credentials or registry notes.';
COMMENT ON COLUMN public.model_consensus_history.id IS 'Stable scoring-revision witness key, uuid.';
COMMENT ON COLUMN public.model_consensus_history.model_id IS 'Parent model_registry key whose scoring tuple was retained.';
COMMENT ON COLUMN public.model_consensus_history.known_at IS 'Server recording clock of this scoring revision; never backdated to a claim event.';
COMMENT ON COLUMN public.model_consensus_history.actor IS 'Model label recorded with this scoring revision, not a source author identity.';
COMMENT ON COLUMN public.model_consensus_history.actor_trust IS 'Reputation weight recorded from model_registry.base_trust at known_at; unit scalar.';
COMMENT ON COLUMN public.model_consensus_history.model_version IS 'Registry revision as recorded at known_at; original claim prompt/model declaration remains on the event.';
INSERT INTO public.pipeline_registry(table_name,column_name,owned_by,description,do_not_write_directly,write_via)
 SELECT 'model_consensus_history',c,'retain_model_consensus_revision',
  'Append-only server-time scoring revision of model_registry; cited-only replay metadata, not source testimony.',true,
  'retain_model_consensus_revision' FROM unnest(ARRAY['id','model_id','known_at','actor','actor_trust','model_version'])c
 ON CONFLICT(table_name,column_name) DO NOTHING;

ALTER TABLE public.projection_event
 ADD COLUMN IF NOT EXISTS consensus_context jsonb,
 ADD COLUMN IF NOT EXISTS replacement_event_id uuid REFERENCES public.projection_event(id);
COMMENT ON COLUMN public.projection_event.consensus_context IS
 'Immutable server-pinned attribute_consensus_v2 scoring inputs at admission: actor trust, evidence weight, confidence, model/prompt revision. NULL on historical rows means their prior weights cannot be replayed.';
COMMENT ON COLUMN public.projection_event.replacement_event_id IS
 'Optional same-subject/attribute replacement cited by a service-authorized retraction marker. Original and replacement events remain immutable; retraction knowledge time is on the original event.';

CREATE OR REPLACE FUNCTION public.pin_projection_consensus_context()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m public.model_registry; confidence numeric;
BEGIN
 SELECT * INTO m FROM public.model_registry WHERE id=NEW.model_id;
 confidence:=CASE WHEN pg_input_is_valid(NEW.result_envelope->>'confidence','numeric')
  THEN (NEW.result_envelope->>'confidence')::numeric END;
 NEW.recorded_at:=clock_timestamp();
 NEW.consensus_context:=jsonb_build_object('method_revision','attribute_consensus_v2',
  'actor',coalesce(m.slug,'unknown'),'actor_trust',coalesce(m.base_trust,0.3),
  'evidence_weight',public.nuke_evidence_weight(NEW.evidence_class),
  'confidence',CASE WHEN confidence BETWEEN 0 AND 1 THEN confidence ELSE 0.5 END,
  'model_version',coalesce(NEW.result_envelope#>>'{envelope,model_version}',m.version),
  'prompt_sha256',NEW.prompt_sha256,'event_time_basis','projection_event.observed_at');
 IF NEW.replacement_event_id IS NOT NULL AND NOT EXISTS(SELECT FROM public.projection_event p
  WHERE p.id=NEW.replacement_event_id AND p.request_envelope->>'subject_id'=NEW.request_envelope->>'subject_id'
    AND p.request_envelope->>'attribute'=NEW.request_envelope->>'attribute'
    AND NEW.request_envelope->>'op'='retraction') THEN
  RAISE EXCEPTION 'Replacement must cite the same subject and attribute'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER projection_event_pin_consensus BEFORE INSERT ON public.projection_event
 FOR EACH ROW EXECUTE FUNCTION public.pin_projection_consensus_context();

CREATE OR REPLACE FUNCTION public.projection_event_freeze_trigger()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF (to_jsonb(NEW)-'retracted_at'-'retracted_by') IS DISTINCT FROM (to_jsonb(OLD)-'retracted_at'-'retracted_by') THEN
  RAISE EXCEPTION 'projection_event rows are append-only.'; END IF;
 IF ROW(NEW.retracted_at,NEW.retracted_by) IS DISTINCT FROM ROW(OLD.retracted_at,OLD.retracted_by) AND (
  OLD.retracted_at IS NOT NULL OR OLD.retracted_by IS NOT NULL
  OR NEW.retracted_at IS NULL OR NEW.retracted_by IS NULL OR NEW.retracted_at<OLD.recorded_at) THEN
  RAISE EXCEPTION 'Retraction history is append-only; use the retraction owner'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.project_attribute(p_subject_id uuid,p_attribute text,
 p_event_at timestamptz,p_known_at timestamptz,p_method_revision text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb; legacy bigint; current_read boolean;
BEGIN
 IF p_subject_id IS NULL OR nullif(btrim(p_attribute),'') IS NULL OR p_event_at IS NULL OR p_known_at IS NULL
  OR NOT isfinite(p_event_at) OR NOT isfinite(p_known_at) OR p_method_revision IS DISTINCT FROM 'attribute_consensus_v2' THEN
  RAISE EXCEPTION 'Finite event/knowledge cutoffs and supported pinned method required' USING ERRCODE='22023'; END IF;
 current_read:=p_event_at=statement_timestamp() AND p_known_at=statement_timestamp();
 SELECT count(*) INTO legacy FROM public.projection_event pe
 WHERE pe.request_envelope ? 'subject_id' AND pe.request_envelope ? 'attribute'
  AND pe.request_envelope->>'subject_id'=p_subject_id::text AND pe.request_envelope->>'attribute'=p_attribute
  AND pe.observed_at<=p_event_at AND pe.recorded_at<=p_known_at
  AND (pe.retracted_at IS NULL OR pe.retracted_at>p_known_at)
  AND pe.request_envelope->>'op' IS DISTINCT FROM 'retraction' AND pe.consensus_context IS NULL;
 IF legacy>0 AND NOT current_read THEN
  RETURN jsonb_build_object('subject_id',p_subject_id,'attribute',p_attribute,'consensus',NULL,'conflict',NULL,
   'state','unknown','observation_count',NULL,'candidates','[]'::jsonb,'method_revision',p_method_revision,
   'event_at',p_event_at,'known_at',p_known_at,'replay_status','unavailable_unpinned_inputs','unpinned_count',legacy);
 END IF;
 WITH atoms AS MATERIALIZED (
  SELECT pe.id,pe.result_envelope->'label' AS label,pe.result_envelope->>'label' AS label_text,
   pe.evidence_class,pe.observation_ids,pe.observed_at,pe.recorded_at,pe.consensus_context,h.id AS scoring_revision_id,
   h.model_version AS scoring_model_version,
   coalesce((pe.consensus_context->>'confidence')::numeric,
    CASE WHEN pg_input_is_valid(pe.result_envelope->>'confidence','numeric') THEN (pe.result_envelope->>'confidence')::numeric END,0.5) AS confidence,
   coalesce(h.actor_trust,(pe.consensus_context->>'actor_trust')::numeric,m.base_trust,0.3) AS actor_trust,
   coalesce(h.actor,pe.consensus_context->>'actor',m.slug,'unknown') AS actor,
   coalesce((pe.consensus_context->>'evidence_weight')::numeric,public.nuke_evidence_weight(pe.evidence_class)) AS evidence_weight
  FROM public.projection_event pe LEFT JOIN public.model_registry m ON m.id=pe.model_id
  LEFT JOIN LATERAL(SELECT v.* FROM public.model_consensus_history v WHERE v.model_id=pe.model_id
   AND v.known_at<=p_known_at ORDER BY v.known_at DESC,v.id DESC LIMIT 1)h ON true
  WHERE pe.request_envelope ? 'subject_id' AND pe.request_envelope ? 'attribute'
   AND pe.request_envelope->>'subject_id'=p_subject_id::text AND pe.request_envelope->>'attribute'=p_attribute
   AND pe.observed_at<=p_event_at AND pe.recorded_at<=p_known_at
   AND (pe.retracted_at IS NULL OR pe.retracted_at>p_known_at)
   AND pe.request_envelope->>'op' IS DISTINCT FROM 'retraction'
 ), weighted AS (
  SELECT *,evidence_weight*actor_trust*confidence*
   greatest(0.3,1.0-extract(epoch FROM (p_event_at-observed_at))/(3*365*86400.0)) AS weight FROM atoms
 ), tally AS (
  SELECT label_text,min(label::text)::jsonb AS label,sum(weight) AS support,count(*) AS n,
   count(DISTINCT actor) AS distinct_actors,
   jsonb_agg(jsonb_build_object('projection_event_id',id,'observation_ids',observation_ids,
    'actor',actor,'evidence_class',evidence_class,'confidence',confidence,'weight',round(weight,4),
    'observed_at',observed_at,'recorded_at',recorded_at,'method',consensus_context,
    'scoring_revision_id',scoring_revision_id,'scoring_model_version',scoring_model_version,'actor_trust',actor_trust)
    ORDER BY weight DESC,recorded_at,id) AS contributors
  FROM weighted GROUP BY label_text
 ), ranked AS (SELECT *,row_number() OVER(ORDER BY support DESC,label_text COLLATE "C") AS rk FROM tally)
 SELECT jsonb_build_object('subject_id',p_subject_id,'attribute',p_attribute,
  'consensus',(SELECT label FROM ranked WHERE rk=1),
  'consensus_support',(SELECT round(support,4) FROM ranked WHERE rk=1),
  'total_support',(SELECT round(coalesce(sum(support),0),4) FROM tally),
  'corroboration',(SELECT distinct_actors FROM ranked WHERE rk=1),'distinct_values',(SELECT count(*) FROM tally),
  'observation_count',(SELECT coalesce(sum(n),0) FROM tally),
  'conflict',coalesce((SELECT (SELECT support FROM ranked WHERE rk=2)/nullif((SELECT support FROM ranked WHERE rk=1),0)>0.5),false),
  'candidates',coalesce((SELECT jsonb_agg(jsonb_build_object('value',label,'support',round(support,4),
    'distinct_actors',distinct_actors,'contributors',contributors) ORDER BY support DESC,label_text COLLATE "C") FROM tally),'[]'::jsonb),
  'method_revision',p_method_revision,'event_at',p_event_at,'known_at',p_known_at,
  'event_time_basis','projection_event.observed_at',
  'replay_status',CASE WHEN legacy>0 THEN 'legacy_current_weights_not_replayable' ELSE 'replayable' END,
  'unpinned_count',legacy) INTO result;
 RETURN result||jsonb_build_object('state',CASE WHEN result->'conflict'='true'::jsonb THEN 'disputed'
  WHEN result->>'consensus' IS NOT NULL THEN 'interpreted' ELSE 'unknown' END);
END $$;
CREATE OR REPLACE FUNCTION public.project_attribute(p_subject_id uuid,p_attribute text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT public.project_attribute(p_subject_id,p_attribute,statement_timestamp(),statement_timestamp(),'attribute_consensus_v2')
$$;

CREATE OR REPLACE FUNCTION public.vehicle_wiki(p_vehicle_id uuid,p_event_at timestamptz,
 p_known_at timestamptz,p_method_revision text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE header jsonb; fields jsonb; is_current boolean;
BEGIN
 IF NOT EXISTS(SELECT FROM public.vehicles WHERE id=p_vehicle_id) THEN RETURN NULL; END IF;
 IF p_event_at IS NULL OR p_known_at IS NULL OR NOT isfinite(p_event_at) OR NOT isfinite(p_known_at)
  OR p_method_revision IS DISTINCT FROM 'attribute_consensus_v2' THEN
  RAISE EXCEPTION 'Finite cutoffs and supported method required' USING ERRCODE='22023'; END IF;
 is_current:=p_event_at=statement_timestamp() AND p_known_at=statement_timestamp();
 IF is_current THEN
  SELECT to_jsonb(t) INTO header FROM(SELECT id,year,make,model,vin,body_style,color,color_family,color_source,
   horsepower,torque,displacement,seats,canonical_outcome,is_for_sale,status FROM public.vehicles WHERE id=p_vehicle_id)t;
 END IF;
 SELECT coalesce(jsonb_agg(public.project_attribute(p_vehicle_id,a.attribute,p_event_at,p_known_at,p_method_revision)
  ORDER BY a.attribute),'[]'::jsonb) INTO fields FROM(
  SELECT DISTINCT request_envelope->>'attribute' AS attribute FROM public.projection_event
  WHERE request_envelope ? 'subject_id' AND request_envelope ? 'attribute'
   AND request_envelope->>'subject_id'=p_vehicle_id::text AND observed_at<=p_event_at AND recorded_at<=p_known_at
   AND request_envelope->>'op' IS DISTINCT FROM 'retraction')a;
 RETURN jsonb_build_object('vehicle_id',p_vehicle_id,'canonical',header,
  'canonical_status',CASE WHEN is_current THEN 'current_denormalized_record' ELSE 'not_historically_replayed' END,
  'cited_fields',fields,'field_count',jsonb_array_length(fields),'event_at',p_event_at,'known_at',p_known_at,
  'method_revision',p_method_revision,'note','Governed interpretations retain their source IDs, scoring method and cutoffs. Reported source fields have separate reader owners.');
END $$;
CREATE OR REPLACE FUNCTION public.vehicle_wiki(p_vehicle_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT public.vehicle_wiki(p_vehicle_id,statement_timestamp(),statement_timestamp(),'attribute_consensus_v2')
$$;

-- Keep the existing authorized retraction writer and give corrections an
-- optional explicit replacement. Neither event's value or method is rewritten.
CREATE OR REPLACE FUNCTION public.retract_projection_event(p_target uuid,p_reason text,p_replacement uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.projection_event; actor uuid; marker uuid; at_time timestamptz;
BEGIN
 SELECT * INTO t FROM public.projection_event WHERE id=p_target FOR UPDATE;
 IF t.id IS NULL THEN RETURN jsonb_build_object('error','target not found'); END IF;
 IF t.retracted_at IS NOT NULL THEN RETURN jsonb_build_object('error','already retracted','retracted_by',t.retracted_by); END IF;
 IF p_replacement IS NOT NULL AND (p_replacement=p_target OR NOT EXISTS(SELECT FROM public.projection_event r
  WHERE r.id=p_replacement AND r.retracted_at IS NULL
   AND r.request_envelope->>'subject_id'=t.request_envelope->>'subject_id'
   AND r.request_envelope->>'attribute'=t.request_envelope->>'attribute'
   AND r.request_envelope->>'op' IS DISTINCT FROM 'retraction')) THEN
  RAISE EXCEPTION 'Replacement must be a current same-subject attribute event'; END IF;
 INSERT INTO public.model_registry(slug,provider,caller_kind,base_trust,notes)
 VALUES('owner-retraction','owner','platform',0.95,'High-trust retraction actor')
 ON CONFLICT(slug) DO UPDATE SET last_seen=clock_timestamp() RETURNING id INTO actor;
 INSERT INTO public.projection_event(request_envelope,result_envelope,result_kind,model_id,model_caller,
  prompt_sha256,observed_at,replacement_event_id)
 VALUES(jsonb_build_object('subject_id',t.request_envelope->>'subject_id','attribute',t.request_envelope->>'attribute','op','retraction'),
  jsonb_build_object('label','__retracted__','retracts',p_target,'replacement',p_replacement,'reason',p_reason,'confidence',1),
  'projection',actor,'owner:retraction',t.prompt_sha256,clock_timestamp(),p_replacement) RETURNING id INTO marker;
 at_time:=clock_timestamp();
 UPDATE public.projection_event SET retracted_by=marker,retracted_at=at_time WHERE id IN(p_target,marker);
 RETURN jsonb_build_object('retracted',p_target,'by_event',marker,'replacement_event_id',p_replacement,'reason',p_reason);
END $$;
CREATE OR REPLACE FUNCTION public.retract_projection_event(p_target uuid,p_reason text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.retract_projection_event(p_target,p_reason,NULL)
$$;

CREATE OR REPLACE FUNCTION public.invalidate_projection_dependents()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE subject uuid; attribute text; widgets text[];
BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW.retracted_at,NEW.retracted_by) IS NOT DISTINCT FROM ROW(OLD.retracted_at,OLD.retracted_by) THEN RETURN NEW; END IF;
 IF NOT pg_input_is_valid(NEW.request_envelope->>'subject_id','uuid') THEN RETURN NEW; END IF;
 subject:=(NEW.request_envelope->>'subject_id')::uuid; attribute:=NEW.request_envelope->>'attribute';
 IF NOT EXISTS(SELECT FROM public.vehicles WHERE id=subject) THEN RETURN NEW; END IF;
 INSERT INTO public.vehicle_metric_recompute_queue(vehicle_id,live_metrics_dirty)
 VALUES(subject,true) ON CONFLICT(vehicle_id) DO UPDATE SET live_metrics_dirty=true,
  queued_at=least(vehicle_metric_recompute_queue.queued_at,clock_timestamp());
 SELECT array_agg(slug) INTO widgets FROM public.analysis_widgets WHERE is_enabled
  AND (slug IN ('identity-confidence','data-quality') OR attribute IN ('vehicle.horsepower','vehicle.torque','vehicle.displacement')
    AND slug IN ('price-position','comp-freshness'));
 IF cardinality(widgets)>0 THEN
  UPDATE public.analysis_signals SET stale_at=least(coalesce(stale_at,clock_timestamp()),clock_timestamp())
   WHERE vehicle_id=subject AND widget_slug=ANY(widgets);
  PERFORM public.enqueue_analysis_work(subject,'projection_change',ARRAY['projection_attribute:'||attribute],widgets,70);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER projection_event_invalidate_dependents AFTER INSERT OR UPDATE OF retracted_at,retracted_by
 ON public.projection_event FOR EACH ROW EXECUTE FUNCTION public.invalidate_projection_dependents();
REVOKE ALL ON FUNCTION public.pin_projection_consensus_context(),public.invalidate_projection_dependents(),
 public.retain_model_consensus_revision(),public.model_consensus_history_append_only(),
 public.retract_projection_event(uuid,text),public.retract_projection_event(uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.retract_projection_event(uuid,text),public.retract_projection_event(uuid,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.project_attribute(uuid,text,timestamptz,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.project_attribute(uuid,text,timestamptz,timestamptz,text) TO anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.vehicle_wiki(uuid,timestamptz,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_wiki(uuid,timestamptz,timestamptz,text) TO anon,authenticated,service_role;
COMMENT ON FUNCTION public.project_attribute(uuid,text,timestamptz,timestamptz,text) IS
 'Bitemporal governed interpretation reader; event cutoff is projection observed_at, knowledge cutoff is server recorded_at/retracted_at. New inputs pin method/weights; historical missing pins return unknown. Source observations remain in their existing log/reader owners.';
COMMIT;
