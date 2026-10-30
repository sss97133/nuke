-- Extend the existing widget queue. Legacy rows stay at revision zero: this does
-- not enroll the historical backlog or resume any paused acquisition job.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.analysis_queue
  ADD COLUMN IF NOT EXISTS request_revision bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS claimed_revision bigint,
  ADD COLUMN IF NOT EXISTS completed_revision bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS claimed_widget_slugs text[],
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS lease_token uuid,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text;

CREATE INDEX IF NOT EXISTS analysis_queue_revision_pending_idx
  ON public.analysis_queue (priority DESC, created_at, id)
  WHERE status = 'pending' AND request_revision > completed_revision;
CREATE INDEX IF NOT EXISTS analysis_queue_revision_lease_idx
  ON public.analysis_queue (lease_expires_at, id)
  WHERE status = 'processing' AND request_revision > 0;

CREATE OR REPLACE FUNCTION public.enqueue_analysis_work(
  p_vehicle_id uuid, p_source text, p_reasons text[] DEFAULT '{}',
  p_widget_slugs text[] DEFAULT NULL, p_priority integer DEFAULT 50
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_slugs text[]; v_id uuid;
BEGIN
  IF p_vehicle_id IS NULL OR length(coalesce(p_source,'')) NOT BETWEEN 1 AND 100
     OR coalesce(cardinality(p_widget_slugs),0) > 100 OR coalesce(cardinality(p_reasons),0) > 100 THEN
    RAISE EXCEPTION 'invalid analysis work scope' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(w.slug ORDER BY w.slug) INTO v_slugs
    FROM public.analysis_widgets w WHERE w.is_enabled
      AND (p_widget_slugs IS NULL OR w.slug = ANY(p_widget_slugs));
  IF coalesce(cardinality(v_slugs),0) = 0 THEN RETURN NULL; END IF;
  INSERT INTO public.analysis_queue AS q
    (vehicle_id,trigger_source,trigger_reasons,widget_slugs,status,priority,request_revision)
  VALUES (p_vehicle_id,p_source,p_reasons,v_slugs,'pending',greatest(0,least(coalesce(p_priority,50),100)),1)
  ON CONFLICT (vehicle_id) DO UPDATE SET
    widget_slugs = CASE WHEN q.request_revision > q.completed_revision THEN
      ARRAY(SELECT DISTINCT x FROM unnest(coalesce(q.widget_slugs,'{}') || excluded.widget_slugs) x ORDER BY x)
      ELSE excluded.widget_slugs END,
    trigger_reasons = ARRAY(SELECT DISTINCT x FROM unnest(coalesce(q.trigger_reasons,'{}') || excluded.trigger_reasons) x ORDER BY x),
    trigger_source = excluded.trigger_source,
    priority = greatest(q.priority,excluded.priority),
    request_revision = q.request_revision + 1,
    status = CASE WHEN q.status='processing' AND q.request_revision>0 THEN 'processing' ELSE 'pending' END,
    next_attempt_at = NULL,
    attempts = CASE WHEN q.status='processing' AND q.request_revision>0 THEN q.attempts ELSE 0 END,
    completed_at = NULL
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- The third argument supports a targeted wake without draining unrelated work.
CREATE OR REPLACE FUNCTION public.claim_analysis_queue_batch(
  p_batch_size integer, p_worker_id text, p_vehicle_id uuid
) RETURNS SETOF public.analysis_queue LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
BEGIN
  IF length(coalesce(p_worker_id,'')) NOT BETWEEN 1 AND 150 THEN
    RAISE EXCEPTION 'analysis worker required' USING ERRCODE='22023';
  END IF;
  RETURN QUERY WITH candidates AS (
    SELECT q.id FROM public.analysis_queue q
     WHERE q.request_revision>q.completed_revision
       AND (p_vehicle_id IS NULL OR q.vehicle_id=p_vehicle_id)
       AND ((q.status='pending' AND coalesce(q.next_attempt_at,'-infinity')<=clock_timestamp())
         OR (q.status='processing' AND q.lease_expires_at<=clock_timestamp()))
     ORDER BY q.priority DESC,q.created_at,q.id
     LIMIT greatest(0,least(coalesce(p_batch_size,1),20)) FOR UPDATE SKIP LOCKED
  ) UPDATE public.analysis_queue q SET status='processing',worker_id=p_worker_id,
      claimed_at=clock_timestamp(),lease_expires_at=clock_timestamp()+interval '3 minutes',lease_token=gen_random_uuid(),
      claimed_revision=q.request_revision,claimed_widget_slugs=q.widget_slugs,attempts=q.attempts+1
    FROM candidates c WHERE q.id=c.id RETURNING q.*;
END $$;

CREATE OR REPLACE FUNCTION public.claim_analysis_queue_batch(
  p_batch_size integer DEFAULT 20, p_worker_id text DEFAULT 'default'
) RETURNS SETOF public.analysis_queue LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
  SELECT * FROM public.claim_analysis_queue_batch(p_batch_size,p_worker_id,NULL::uuid);
$$;

CREATE OR REPLACE FUNCTION public.finish_analysis_queue_work(
  p_id uuid,p_worker_id text,p_revision bigint,p_lease_token uuid,p_succeeded_widgets text[],
  p_failed integer DEFAULT 0,p_compute_time_ms integer DEFAULT 0,p_error text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE q public.analysis_queue; v_remaining text[]; v_status text;
BEGIN
  SELECT * INTO q FROM public.analysis_queue WHERE id=p_id FOR UPDATE;
  IF q.id IS NULL OR q.status<>'processing' OR q.worker_id IS DISTINCT FROM p_worker_id
     OR q.claimed_revision IS DISTINCT FROM p_revision OR q.lease_token IS NULL OR q.lease_token IS DISTINCT FROM p_lease_token OR q.lease_expires_at IS NULL OR q.lease_expires_at<=clock_timestamp() THEN
    RETURN jsonb_build_object('status','lease_lost');
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(coalesce(p_succeeded_widgets,'{}')) s
            WHERE NOT(s=ANY(q.claimed_widget_slugs))) THEN
    RAISE EXCEPTION 'completion outside claimed widgets' USING ERRCODE='22023';
  END IF;
  v_remaining := CASE WHEN q.request_revision>p_revision THEN q.widget_slugs ELSE
    ARRAY(SELECT x FROM unnest(q.widget_slugs) x WHERE NOT(x=ANY(coalesce(p_succeeded_widgets,'{}'))) ORDER BY x) END;
  v_status := CASE WHEN cardinality(v_remaining)=0 THEN 'complete'
    WHEN q.request_revision=p_revision AND q.attempts>=5 AND cardinality(coalesce(p_succeeded_widgets,'{}'))=0 THEN 'failed'
    ELSE 'pending' END;
  UPDATE public.analysis_queue SET status=v_status,widget_slugs=v_remaining,
    completed_revision=CASE WHEN cardinality(v_remaining)=0 THEN p_revision ELSE completed_revision END,
    widgets_computed=coalesce(cardinality(p_succeeded_widgets),0),widgets_failed=greatest(0,p_failed),
    compute_time_ms=greatest(0,p_compute_time_ms),last_error=left(p_error,2000),
    completed_at=CASE WHEN v_status='complete' THEN clock_timestamp() ELSE NULL END,
    next_attempt_at=CASE WHEN p_failed>0 AND q.request_revision=p_revision THEN clock_timestamp()+interval '1 minute' ELSE NULL END,
    attempts=CASE WHEN q.request_revision>p_revision OR cardinality(coalesce(p_succeeded_widgets,'{}'))>0 THEN 0 ELSE attempts END,
    worker_id=NULL,claimed_at=NULL,lease_expires_at=NULL,lease_token=NULL,claimed_revision=NULL,claimed_widget_slugs=NULL
  WHERE id=p_id;
  RETURN jsonb_build_object('status',v_status,'request_revision',q.request_revision,'processed_revision',p_revision,
    'remaining_widgets',v_remaining);
END $$;

-- Admission and its dependency work commit or roll back together, including
-- callers that do not use the HTTP intake. Keep the existing ARS enqueue intact.
CREATE OR REPLACE FUNCTION public.trigger_ars_on_observation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_slugs text[];
BEGIN
  IF NEW.vehicle_id IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.ars_recompute_queue(vehicle_id,dimension) VALUES(NEW.vehicle_id,'description')
    ON CONFLICT(vehicle_id) DO NOTHING;
  SELECT array_agg(w.slug ORDER BY w.slug) INTO v_slugs FROM public.analysis_widgets w
    WHERE w.is_enabled AND (w.trigger_on_observation_kinds @> ARRAY[NEW.kind::text]
      OR w.trigger_on_observation_kinds @> ARRAY['*']);
  IF cardinality(v_slugs)>0 THEN
    PERFORM public.enqueue_analysis_work(NEW.vehicle_id,'observation',ARRAY['observation_kind:'||NEW.kind::text],v_slugs,70);
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.trigger_ars_on_extraction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  PERFORM public.enqueue_analysis_work(NEW.vehicle_id,'extraction_complete',ARRAY['description_discovered'],NULL,40);
  RETURN NEW;
END $$;

-- Fence result publication and save its completion in the same transaction.
-- A crash after this RPC does not recalculate that completed widget. A worker
-- whose lease was reclaimed cannot overwrite the replacement worker's result.
CREATE OR REPLACE FUNCTION public.record_analysis_queue_signal(
  p_id uuid,p_worker_id text,p_revision bigint,p_lease_token uuid,p_signal jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE q public.analysis_queue; s public.analysis_signals; v_existing public.analysis_signals;
  v_id uuid; v_direction text; v_order text[] := ARRAY['critical','warning','info','ok'];
BEGIN
  SELECT * INTO q FROM public.analysis_queue WHERE id=p_id FOR UPDATE;
  IF q.id IS NULL OR q.status<>'processing' OR q.worker_id IS DISTINCT FROM p_worker_id
     OR q.claimed_revision IS DISTINCT FROM p_revision OR q.lease_token IS NULL OR q.lease_token IS DISTINCT FROM p_lease_token OR q.lease_expires_at IS NULL OR q.lease_expires_at<=clock_timestamp() THEN
    RETURN jsonb_build_object('status','lease_lost');
  END IF;
  s := jsonb_populate_record(NULL::public.analysis_signals,p_signal);
  IF s.vehicle_id IS DISTINCT FROM q.vehicle_id OR s.widget_slug IS NULL
     OR NOT(s.widget_slug=ANY(q.claimed_widget_slugs)) THEN
    RAISE EXCEPTION 'signal outside claimed scope' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_existing FROM public.analysis_signals
    WHERE vehicle_id=s.vehicle_id AND widget_slug=s.widget_slug FOR UPDATE;
  v_direction := CASE WHEN v_existing.id IS NULL THEN 'new'
    WHEN coalesce(array_position(v_order,s.severity),3)<coalesce(array_position(v_order,v_existing.severity),3) THEN 'degraded'
    WHEN coalesce(array_position(v_order,s.severity),3)>coalesce(array_position(v_order,v_existing.severity),3) THEN 'improved'
    ELSE 'unchanged' END;
  INSERT INTO public.analysis_signals AS current_signal
    (vehicle_id,widget_slug,score,label,severity,value_json,reasons,evidence,confidence,recommendations,
      previous_score,previous_severity,changed_at,change_direction,computed_at,stale_at,compute_time_ms)
  VALUES(s.vehicle_id,s.widget_slug,s.score,s.label,s.severity,
    coalesce(s.value_json,'{}'::jsonb)||jsonb_build_object('analysis_work',jsonb_build_object('queue_id',q.id,'revision',p_revision)),
    s.reasons,s.evidence,s.confidence,s.recommendations,v_existing.score,v_existing.severity,
    CASE WHEN v_direction='unchanged' THEN v_existing.changed_at ELSE clock_timestamp() END,v_direction,
    clock_timestamp(),s.stale_at,s.compute_time_ms)
  ON CONFLICT(vehicle_id,widget_slug) DO UPDATE SET
    score=excluded.score,label=excluded.label,severity=excluded.severity,value_json=excluded.value_json,
    reasons=excluded.reasons,evidence=excluded.evidence,confidence=excluded.confidence,
    recommendations=excluded.recommendations,previous_score=excluded.previous_score,
    previous_severity=excluded.previous_severity,changed_at=excluded.changed_at,
    change_direction=excluded.change_direction,computed_at=excluded.computed_at,
    stale_at=excluded.stale_at,compute_time_ms=excluded.compute_time_ms RETURNING id INTO v_id;
  IF v_direction<>'unchanged' THEN
    INSERT INTO public.analysis_signal_history(signal_id,vehicle_id,widget_slug,score,severity,label,reasons,computed_at)
    VALUES(v_id,s.vehicle_id,s.widget_slug,s.score,s.severity,s.label,s.reasons,clock_timestamp());
  END IF;
  IF q.request_revision=p_revision THEN
    UPDATE public.analysis_queue SET widget_slugs=array_remove(widget_slugs,s.widget_slug) WHERE id=q.id;
  END IF;
  RETURN jsonb_build_object('status','recorded','is_new',v_existing.id IS NULL,
    'changed',v_direction IN ('degraded','improved'));
END $$;

REVOKE ALL ON FUNCTION public.enqueue_analysis_work(uuid,text,text[],text[],integer),
 public.claim_analysis_queue_batch(integer,text,uuid),public.claim_analysis_queue_batch(integer,text),
 public.finish_analysis_queue_work(uuid,text,bigint,uuid,text[],integer,integer,text),
 public.record_analysis_queue_signal(uuid,text,bigint,uuid,jsonb),
 public.trigger_ars_on_observation(),public.trigger_ars_on_extraction() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_analysis_work(uuid,text,text[],text[],integer),
 public.claim_analysis_queue_batch(integer,text,uuid),public.claim_analysis_queue_batch(integer,text),
 public.finish_analysis_queue_work(uuid,text,bigint,uuid,text[],integer,integer,text),
 public.record_analysis_queue_signal(uuid,text,bigint,uuid,jsonb) TO service_role;

COMMENT ON COLUMN public.analysis_queue.request_revision IS 'Dependency request revision; zero is legacy work, not enrolled by this repair. Only the claimed revision can finish.';
COMMENT ON COLUMN public.analysis_queue.claimed_widget_slugs IS 'Immutable widget snapshot for this lease. New arrivals merge into widget_slugs without replacing the active lease.';
COMMIT;
