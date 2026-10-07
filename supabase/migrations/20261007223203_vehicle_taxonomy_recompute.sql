-- Retained NHTSA reference -> existing current taxonomy. Owner-authorized Oct7.
-- Live owner/guards/partial VIN index inspected; no raw testimony writes.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='1s';
DO $$ BEGIN
 IF (SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND state='active'
     AND (query ILIKE '%vehicles%' OR query ILIKE '%vin_decoded_data%'))>2 THEN
   RAISE EXCEPTION 'Taxonomy DDL deferred: active owner load';
 END IF;
END $$;

CREATE FUNCTION public.derive_vehicle_taxonomy(p_vin text,p_body_style text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE c public.vin_decoded_data%ROWTYPE; physical_body text:=nullif(btrim(p_body_style),'');
 raw_body text; n_body text; n_type text; body_key text; type_key text; reason text:='no_cache';
 body_basis text; type_basis text; accepted boolean:=false;
BEGIN
 SELECT * INTO c FROM public.vin_decoded_data WHERE vin=upper(p_vin);
 IF FOUND THEN
   reason:=CASE WHEN p_vin !~ '^[A-HJ-NPR-Z0-9a-hj-npr-z]{17}$' THEN 'invalid_vin'
    WHEN c.provider IS DISTINCT FROM 'nhtsa' THEN 'provider'
    WHEN btrim(c.raw_response->>'ErrorCode') IS DISTINCT FROM '0' THEN 'error_code'
    WHEN upper(c.raw_response->>'VIN') IS DISTINCT FROM c.vin THEN 'raw_vin_binding'
    WHEN nullif(btrim(c.raw_response->>'BodyClass'),'') IS DISTINCT FROM nullif(btrim(c.body_type),'')
      OR nullif(btrim(c.raw_response->>'VehicleType'),'') IS DISTINCT FROM nullif(btrim(c.vehicle_type),'') THEN 'raw_projection_mismatch'
    WHEN c.decoded_at IS NULL OR c.decoded_at>statement_timestamp() THEN 'future_or_missing_clock'
    ELSE 'accepted' END;
   accepted:=reason='accepted';
 END IF;
 IF accepted THEN n_body:=nullif(btrim(c.body_type),''); n_type:=nullif(btrim(c.vehicle_type),''); END IF;
 raw_body:=coalesce(physical_body,n_body,n_type);
 SELECT canonical_name,vehicle_type INTO body_key,type_key FROM public.canonical_body_styles
  WHERE canonical_name=public.normalize_body_style(raw_body) AND is_active;
 body_basis:=CASE WHEN physical_body IS NOT NULL THEN 'recorded_body_style'
   WHEN accepted THEN 'vin_factory_reference' ELSE 'unavailable' END;
 IF body_key IS NOT NULL THEN type_basis:=body_basis;
 ELSE
   SELECT canonical_name INTO type_key FROM public.canonical_vehicle_types
    WHERE canonical_name=public.normalize_vehicle_type(coalesce(n_type,raw_body)) AND is_active;
   type_basis:=CASE WHEN n_type IS NOT NULL THEN 'vin_factory_reference' ELSE body_basis END;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.canonical_vehicle_types WHERE canonical_name=type_key AND is_active) THEN type_key:=NULL; END IF;
 RETURN jsonb_build_object('method','retained_vin_taxonomy_v1','canonical_body_style',body_key,
  'canonical_vehicle_type',type_key,'body_basis',body_basis,'type_basis',type_basis,
  'reference_status',reason,'physical_configuration_verified',false,
  'input',jsonb_build_object('vin',p_vin,'recorded_body_style',p_body_style,
    'cache_vin',c.vin,'body_type',c.body_type,'vehicle_type',c.vehicle_type,'provider',c.provider,
    'error_code',c.raw_response->>'ErrorCode','source_recorded_at',c.decoded_at,'cache_updated_at',c.updated_at,
    'raw_sha256',CASE WHEN c.raw_response IS NOT NULL THEN encode(sha256(convert_to(c.raw_response::text,'UTF8')),'hex') END));
END $$;

CREATE OR REPLACE FUNCTION public.set_vehicle_canonical_taxonomy() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE r jsonb;
BEGIN
 r:=public.derive_vehicle_taxonomy(NEW.vin,NEW.body_style);
 NEW.canonical_body_style:=r->>'canonical_body_style';
 NEW.canonical_vehicle_type:=r->>'canonical_vehicle_type';
 RETURN NEW;
END $$;

CREATE TABLE public.vehicle_taxonomy_replay_state (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), generation integer NOT NULL DEFAULT 1 CHECK(generation>0),
 vin_cursor text, scan_completed_at timestamptz, started_at timestamptz NOT NULL DEFAULT now(),
 cache_keys_seen bigint NOT NULL DEFAULT 0, processed bigint NOT NULL DEFAULT 0,
 changed bigint NOT NULL DEFAULT 0, binding_overflow_events bigint NOT NULL DEFAULT 0,
 last_batch_at timestamptz
);
INSERT INTO public.vehicle_taxonomy_replay_state(id) VALUES(true);
CREATE TABLE public.vehicle_taxonomy_recompute_queue (
 vehicle_id uuid PRIMARY KEY REFERENCES public.vehicles(id),
 queued_at timestamptz NOT NULL DEFAULT now(), next_due_at timestamptz DEFAULT now(),
 generation integer NOT NULL CHECK(generation>0), consecutive_failures integer NOT NULL DEFAULT 0 CHECK(consecutive_failures BETWEEN 0 AND 3),
 last_error text, last_verified_at timestamptz, last_receipt_id bigint
);
CREATE INDEX vehicle_taxonomy_due_idx ON public.vehicle_taxonomy_recompute_queue(next_due_at,vehicle_id)
 WHERE next_due_at IS NOT NULL;
CREATE INDEX vehicle_taxonomy_failure_idx ON public.vehicle_taxonomy_recompute_queue(vehicle_id)
 WHERE consecutive_failures>0;
-- Append-only ingress avoids producer ON CONFLICT waiting on the worker's state
-- row. Operational requests are removed only in the transaction that folds them
-- into durable work state; source evidence/revisions are never deleted.
CREATE TABLE public.vehicle_taxonomy_invalidations (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
 queued_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vehicle_taxonomy_invalidations_vehicle_idx ON public.vehicle_taxonomy_invalidations(vehicle_id,id);
CREATE TABLE public.vehicle_taxonomy_revisions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
 cache_vin text REFERENCES public.vin_decoded_data(vin),
 input_sha256 bytea NOT NULL CHECK(octet_length(input_sha256)=32),
 canonical_body_style text REFERENCES public.canonical_body_styles(canonical_name),
 canonical_vehicle_type text REFERENCES public.canonical_vehicle_types(canonical_name),
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),
 computed_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(vehicle_id,input_sha256), UNIQUE(vehicle_id,id)
);
ALTER TABLE public.vehicle_taxonomy_recompute_queue ADD CONSTRAINT vehicle_taxonomy_own_receipt_fk
 FOREIGN KEY(vehicle_id,last_receipt_id) REFERENCES public.vehicle_taxonomy_revisions(vehicle_id,id);
CREATE FUNCTION public.reject_vehicle_taxonomy_revision_change() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Derived taxonomy revisions are immutable'; END $$;
CREATE TRIGGER vehicle_taxonomy_revisions_immutable BEFORE UPDATE OR DELETE ON public.vehicle_taxonomy_revisions
 FOR EACH ROW EXECUTE FUNCTION public.reject_vehicle_taxonomy_revision_change();

CREATE FUNCTION public.enqueue_vehicle_taxonomy(p_vehicle_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET lock_timeout='500ms' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.vehicles WHERE id=p_vehicle_id AND deleted_at IS NULL AND status IS DISTINCT FROM 'merged') THEN RETURN; END IF;
 INSERT INTO public.vehicle_taxonomy_invalidations(vehicle_id) VALUES(p_vehicle_id);
END $$;
CREATE FUNCTION public.enqueue_vehicle_taxonomy_for_vin(p_vin text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET lock_timeout='500ms' AS $$
DECLARE ids uuid[]; vid uuid;
BEGIN
 SELECT array_agg(id) INTO ids FROM (SELECT id FROM public.vehicles
  WHERE upper(vin)=p_vin AND deleted_at IS NULL AND status IS DISTINCT FROM 'merged' LIMIT 11) v;
 IF coalesce(cardinality(ids),0)>10 THEN
  UPDATE public.vehicle_taxonomy_replay_state SET binding_overflow_events=binding_overflow_events+1 WHERE id; RETURN;
 END IF;
 FOREACH vid IN ARRAY coalesce(ids,'{}'::uuid[]) LOOP PERFORM public.enqueue_vehicle_taxonomy(vid); END LOOP;
END $$;
CREATE FUNCTION public.trg_enqueue_vehicle_taxonomy() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_TABLE_NAME='vehicles' THEN
   IF TG_OP='UPDATE' AND row(OLD.vin,OLD.body_style) IS NOT DISTINCT FROM row(NEW.vin,NEW.body_style)
     AND current_setting('app.writer',true)='drain_vehicle_taxonomy_queue' THEN RETURN NEW; END IF;
   IF TG_OP='UPDATE' AND row(OLD.vin,OLD.body_style,OLD.canonical_body_style,OLD.canonical_vehicle_type)
    IS NOT DISTINCT FROM row(NEW.vin,NEW.body_style,NEW.canonical_body_style,NEW.canonical_vehicle_type) THEN RETURN NEW; END IF;
   PERFORM public.enqueue_vehicle_taxonomy(NEW.id);
 ELSE
   IF TG_OP='UPDATE' AND row(OLD.vin,OLD.body_type,OLD.vehicle_type,OLD.provider,OLD.raw_response,OLD.decoded_at,OLD.updated_at)
    IS NOT DISTINCT FROM row(NEW.vin,NEW.body_type,NEW.vehicle_type,NEW.provider,NEW.raw_response,NEW.decoded_at,NEW.updated_at) THEN RETURN NEW; END IF;
   IF TG_OP='UPDATE' AND OLD.vin IS DISTINCT FROM NEW.vin THEN PERFORM public.enqueue_vehicle_taxonomy_for_vin(OLD.vin); END IF;
   PERFORM public.enqueue_vehicle_taxonomy_for_vin(NEW.vin);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_enqueue_vehicle_taxonomy AFTER INSERT OR UPDATE ON public.vehicles
 FOR EACH ROW EXECUTE FUNCTION public.trg_enqueue_vehicle_taxonomy();
CREATE TRIGGER trg_enqueue_cached_vehicle_taxonomy AFTER INSERT OR UPDATE OF vin,body_type,vehicle_type,provider,raw_response,decoded_at,updated_at ON public.vin_decoded_data
 FOR EACH ROW EXECUTE FUNCTION public.trg_enqueue_vehicle_taxonomy();

CREATE FUNCTION public.replay_vehicle_taxonomy() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET lock_timeout='500ms' AS $$
BEGIN
 IF NOT pg_try_advisory_xact_lock(879105,1) THEN RAISE EXCEPTION 'Taxonomy worker active'; END IF;
 UPDATE public.vehicle_taxonomy_replay_state SET generation=generation+1,vin_cursor=NULL,
  scan_completed_at=NULL,started_at=now(),cache_keys_seen=0,processed=0,changed=0,binding_overflow_events=0,last_batch_at=NULL WHERE id;
END $$;

CREATE FUNCTION public.drain_vehicle_taxonomy_queue() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET lock_timeout='500ms' AS $$
DECLARE s public.vehicle_taxonomy_replay_state%ROWTYPE; q public.vehicle_taxonomy_recompute_queue%ROWTYPE;
 v record; c record; ev record; r jsonb; h bytea; rid bigint; n integer:=0; changes integer:=0;
 seen integer:=0; new_revisions integer:=0; inserted boolean; started timestamptz:=clock_timestamp(); touched integer; state_error text;
BEGIN
 IF NOT pg_try_advisory_xact_lock(879105,1) THEN RETURN jsonb_build_object('status','skipped','reason','worker_active'); END IF;
 IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND pid<>pg_backend_pid()) OR
   (SELECT count(*) FROM pg_stat_activity WHERE state='active' AND backend_type='client backend' AND pid<>pg_backend_pid())>8
 THEN RETURN jsonb_build_object('status','skipped','reason','lock_or_load_governor'); END IF;
 PERFORM set_config('app.writer','drain_vehicle_taxonomy_queue',true);
 SELECT * INTO s FROM public.vehicle_taxonomy_replay_state WHERE id;
 FOR ev IN SELECT * FROM public.vehicle_taxonomy_invalidations ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 100 LOOP
  PERFORM 1 FROM public.vehicle_taxonomy_recompute_queue WHERE vehicle_id=ev.vehicle_id FOR UPDATE SKIP LOCKED;
  IF NOT FOUND AND EXISTS(SELECT 1 FROM public.vehicle_taxonomy_recompute_queue WHERE vehicle_id=ev.vehicle_id) THEN CONTINUE; END IF;
  INSERT INTO public.vehicle_taxonomy_recompute_queue(vehicle_id,generation,queued_at)
   VALUES(ev.vehicle_id,s.generation,ev.queued_at)
  ON CONFLICT(vehicle_id) DO UPDATE SET next_due_at=now(),generation=EXCLUDED.generation,
   consecutive_failures=0,last_error=NULL,queued_at=least(vehicle_taxonomy_recompute_queue.queued_at,EXCLUDED.queued_at);
  DELETE FROM public.vehicle_taxonomy_invalidations WHERE id=ev.id;
 END LOOP;
 IF s.scan_completed_at IS NULL AND
   (SELECT count(*) FROM (SELECT 1 FROM public.vehicle_taxonomy_recompute_queue WHERE next_due_at IS NOT NULL LIMIT 500) d)<500 THEN
  FOR c IN SELECT vin FROM public.vin_decoded_data WHERE vin>=coalesce(s.vin_cursor,'')
    AND (s.vin_cursor IS NULL OR vin>s.vin_cursor) ORDER BY vin LIMIT 100 LOOP
   -- Index-bound lookups; no hash join/whole-vehicle scan. Existing current-generation
   -- completed work is not reset merely because the replay cursor reaches it.
   FOR v IN SELECT id FROM public.vehicles WHERE upper(vin)=c.vin AND deleted_at IS NULL AND status IS DISTINCT FROM 'merged' LIMIT 11 LOOP
    IF (SELECT count(*) FROM (SELECT 1 FROM public.vehicles WHERE upper(vin)=c.vin AND deleted_at IS NULL AND status IS DISTINCT FROM 'merged' LIMIT 11) x)>10 THEN
     UPDATE public.vehicle_taxonomy_replay_state SET binding_overflow_events=binding_overflow_events+1 WHERE id; EXIT;
    END IF;
    INSERT INTO public.vehicle_taxonomy_recompute_queue(vehicle_id,generation) VALUES(v.id,s.generation)
     ON CONFLICT(vehicle_id) DO UPDATE SET next_due_at=now(),generation=EXCLUDED.generation,consecutive_failures=0,last_error=NULL
     WHERE vehicle_taxonomy_recompute_queue.generation<EXCLUDED.generation;
   END LOOP;
   s.vin_cursor:=c.vin; seen:=seen+1;
  END LOOP;
  UPDATE public.vehicle_taxonomy_replay_state SET vin_cursor=s.vin_cursor,cache_keys_seen=cache_keys_seen+seen,
   scan_completed_at=CASE WHEN seen<100 THEN now() ELSE NULL END WHERE id;
 END IF;
 FOR q IN SELECT * FROM public.vehicle_taxonomy_recompute_queue WHERE next_due_at<=now()
   ORDER BY next_due_at,vehicle_id FOR UPDATE SKIP LOCKED LIMIT 25 LOOP
  EXIT WHEN clock_timestamp()-started>interval '8 seconds';
  BEGIN
   SELECT id,vin,body_style,deleted_at,status,canonical_body_style,canonical_vehicle_type INTO v
    FROM public.vehicles WHERE id=q.vehicle_id FOR NO KEY UPDATE SKIP LOCKED;
   IF NOT FOUND THEN CONTINUE; END IF;
   IF v.deleted_at IS NOT NULL OR v.status='merged' THEN
    UPDATE public.vehicle_taxonomy_recompute_queue SET next_due_at=NULL,last_error='parent_inactive' WHERE vehicle_id=q.vehicle_id; CONTINUE;
   END IF;
   r:=public.derive_vehicle_taxonomy(v.vin,v.body_style); h:=sha256(convert_to(r::text,'UTF8'));
   INSERT INTO public.vehicle_taxonomy_revisions(vehicle_id,cache_vin,input_sha256,canonical_body_style,canonical_vehicle_type,receipt)
    VALUES(v.id,r#>>'{input,cache_vin}',h,r->>'canonical_body_style',r->>'canonical_vehicle_type',
      r||jsonb_build_object('previous_projection',jsonb_build_object('canonical_body_style',v.canonical_body_style,'canonical_vehicle_type',v.canonical_vehicle_type)))
    ON CONFLICT(vehicle_id,input_sha256) DO NOTHING RETURNING id INTO rid;
   inserted:=rid IS NOT NULL;
   IF rid IS NULL THEN SELECT id INTO rid FROM public.vehicle_taxonomy_revisions WHERE vehicle_id=v.id AND input_sha256=h; END IF;
   UPDATE public.vehicles SET canonical_body_style=r->>'canonical_body_style',canonical_vehicle_type=r->>'canonical_vehicle_type'
    WHERE id=v.id AND (canonical_body_style IS DISTINCT FROM r->>'canonical_body_style' OR canonical_vehicle_type IS DISTINCT FROM r->>'canonical_vehicle_type');
   GET DIAGNOSTICS touched=ROW_COUNT;
   IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND pid<>pg_backend_pid()) THEN
    RAISE EXCEPTION 'Taxonomy write deferred after observed lock wait';
   END IF;
   UPDATE public.vehicle_taxonomy_recompute_queue SET next_due_at=NULL,last_verified_at=now(),last_receipt_id=rid,
    consecutive_failures=0,last_error=NULL WHERE vehicle_id=v.id;
   n:=n+1; changes:=changes+touched;
   IF inserted THEN new_revisions:=new_revisions+1; END IF;
  EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS state_error=RETURNED_SQLSTATE;
   UPDATE public.vehicle_taxonomy_recompute_queue SET consecutive_failures=consecutive_failures+1,
    next_due_at=CASE WHEN consecutive_failures+1>=3 THEN NULL ELSE now()+interval '15 minutes' END,
    last_error='record_write_failed:'||state_error WHERE vehicle_id=q.vehicle_id;
  END;
 END LOOP;
 IF n>0 OR seen>0 THEN
  UPDATE public.vehicle_taxonomy_replay_state SET processed=processed+n,changed=changed+changes,last_batch_at=now() WHERE id;
 END IF;
 IF changes>0 THEN INSERT INTO public.write_receipts(tbl,op,rows,writer,db_role,app_name,txid)
  VALUES('vehicles','UPDATE',changes,'drain_vehicle_taxonomy_queue',current_user,current_setting('application_name'),txid_current()); END IF;
 IF new_revisions>0 THEN INSERT INTO public.write_receipts(tbl,op,rows,writer,db_role,app_name,txid)
  VALUES('vehicle_taxonomy_revisions','INSERT',new_revisions,'drain_vehicle_taxonomy_queue',current_user,current_setting('application_name'),txid_current()); END IF;
 RETURN jsonb_build_object('status',CASE WHEN n>0 THEN 'processed' ELSE 'idle' END,'processed',n,'changed',changes,'cache_keys_seen',seen,
  'lock_waits',(SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND pid<>pg_backend_pid()));
END $$;

CREATE FUNCTION public.read_vehicle_taxonomy_fold(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp SET statement_timeout='5s' AS $$
 SELECT coalesce((SELECT jsonb_build_object('vehicle_id',q.vehicle_id,'receipt_id',r.id,'receipt',r.receipt,
  'computed_at',r.computed_at,'last_verified_at',q.last_verified_at,'last_error',q.last_error,
  'stale',q.next_due_at IS NOT NULL OR q.last_error IS NOT NULL OR q.last_receipt_id IS NULL
     OR q.generation<>(SELECT generation FROM public.vehicle_taxonomy_replay_state WHERE id)
     OR v.deleted_at IS NOT NULL OR v.status IS NOT DISTINCT FROM 'merged'
     OR EXISTS(SELECT 1 FROM public.vehicle_taxonomy_invalidations WHERE vehicle_id=q.vehicle_id)
     OR row(v.canonical_body_style,v.canonical_vehicle_type) IS DISTINCT FROM row(r.canonical_body_style,r.canonical_vehicle_type),
  'canonical_columns_match',r.id IS NOT NULL AND row(v.canonical_body_style,v.canonical_vehicle_type) IS NOT DISTINCT FROM row(r.canonical_body_style,r.canonical_vehicle_type))
 FROM public.vehicle_taxonomy_recompute_queue q LEFT JOIN public.vehicle_taxonomy_revisions r ON r.id=q.last_receipt_id
 JOIN public.vehicles v ON v.id=q.vehicle_id WHERE q.vehicle_id=$1),jsonb_build_object('status','not_queued','stale',true));
$$;
CREATE FUNCTION public.assay_vehicle_taxonomy_fold() RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp SET statement_timeout='5s' AS $$
 WITH pending AS (SELECT count(*) n,min(next_due_at) oldest FROM public.vehicle_taxonomy_recompute_queue WHERE next_due_at IS NOT NULL),
 ingress AS (SELECT count(*) n FROM public.vehicle_taxonomy_invalidations),
 failures AS (SELECT count(*) n,count(*) FILTER(WHERE consecutive_failures=3) paused FROM public.vehicle_taxonomy_recompute_queue WHERE consecutive_failures>0),
 s AS (SELECT * FROM public.vehicle_taxonomy_replay_state WHERE id)
 SELECT jsonb_build_object('status',CASE WHEN failures.n>0 THEN 'failed'
   WHEN (s.scan_completed_at IS NULL OR pending.n+ingress.n>0)
     AND coalesce(s.last_batch_at,s.started_at)<statement_timestamp()-interval '15 minutes' THEN 'failed'
   WHEN s.scan_completed_at IS NULL OR pending.n+ingress.n>0 OR s.binding_overflow_events>0 THEN 'partial' ELSE 'passed' END,
  'scope','retained_cache_replay_and_incremental_dirty_vehicle_inputs','state',to_jsonb(s)-'vin_cursor',
  'pending',pending.n,'pending_invalidations',ingress.n,'oldest_due_at',pending.oldest,'record_failures',failures.n,'paused_failures',failures.paused,
  'physical_configuration_verified',false) FROM s,pending,failures,ingress;
$$;

REVOKE ALL ON public.vehicle_taxonomy_replay_state,public.vehicle_taxonomy_recompute_queue,public.vehicle_taxonomy_revisions,public.vehicle_taxonomy_invalidations FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SEQUENCE public.vehicle_taxonomy_revisions_id_seq,public.vehicle_taxonomy_invalidations_id_seq FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.vehicle_taxonomy_replay_state,public.vehicle_taxonomy_recompute_queue,public.vehicle_taxonomy_revisions,public.vehicle_taxonomy_invalidations TO service_role;
ALTER TABLE public.vehicle_taxonomy_replay_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_taxonomy_recompute_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_taxonomy_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_taxonomy_invalidations ENABLE ROW LEVEL SECURITY;
CREATE POLICY taxonomy_service_read ON public.vehicle_taxonomy_replay_state FOR SELECT TO service_role USING(true);
CREATE POLICY taxonomy_service_read ON public.vehicle_taxonomy_recompute_queue FOR SELECT TO service_role USING(true);
CREATE POLICY taxonomy_service_read ON public.vehicle_taxonomy_revisions FOR SELECT TO service_role USING(true);
CREATE POLICY taxonomy_service_read ON public.vehicle_taxonomy_invalidations FOR SELECT TO service_role USING(true);
REVOKE ALL ON FUNCTION public.enqueue_vehicle_taxonomy(uuid),public.enqueue_vehicle_taxonomy_for_vin(text),public.trg_enqueue_vehicle_taxonomy(),
 public.replay_vehicle_taxonomy(),public.drain_vehicle_taxonomy_queue(),public.read_vehicle_taxonomy_fold(uuid),public.assay_vehicle_taxonomy_fold(),public.reject_vehicle_taxonomy_revision_change() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_vehicle_taxonomy(uuid),public.replay_vehicle_taxonomy(),public.drain_vehicle_taxonomy_queue(),
 public.read_vehicle_taxonomy_fold(uuid),public.assay_vehicle_taxonomy_fold() TO service_role;

INSERT INTO public.pipeline_registry(table_name,column_name,owned_by,description,do_not_write_directly,write_via) VALUES
 ('vehicles','canonical_body_style','set_vehicle_canonical_taxonomy','Current derived body classification; recorded style precedence, qualified factory-reference fallback. Not physical verification.',true,'set_vehicle_canonical_taxonomy / drain_vehicle_taxonomy_queue via derive_vehicle_taxonomy'),
 ('vehicles','canonical_vehicle_type','set_vehicle_canonical_taxonomy','Current derived type via existing active vocabulary and same qualified inputs.',true,'set_vehicle_canonical_taxonomy / drain_vehicle_taxonomy_queue via derive_vehicle_taxonomy'),
 ('vehicle_taxonomy_replay_state',NULL,'drain_vehicle_taxonomy_queue','Resumable retained-cache keyset replay and measured counters.',true,'replay_vehicle_taxonomy / drain_vehicle_taxonomy_queue'),
 ('vehicle_taxonomy_recompute_queue',NULL,'drain_vehicle_taxonomy_queue','Vehicle dirty-work state and current immutable receipt pointer.',true,'enqueue_vehicle_taxonomy / drain_vehicle_taxonomy_queue'),
 ('vehicle_taxonomy_invalidations',NULL,'drain_vehicle_taxonomy_queue','Append-only operational ingress, consumed atomically into dirty state; prevents intake waiting on worker queue locks.',true,'enqueue_vehicle_taxonomy / drain_vehicle_taxonomy_queue'),
 ('vehicle_taxonomy_revisions',NULL,'set_vehicle_canonical_taxonomy','Immutable shared-calculation provenance; typed vehicle/cache/vocabulary relationships.',true,'drain_vehicle_taxonomy_queue');

-- Extend existing health owner without replacing its other branch semantics.
DO $health$
DECLARE v text:=pg_get_viewdef('public.v_job_health'::regclass,true); a text; b text;
BEGIN
 a:='WITH residual_assay AS MATERIALIZED (';
 b:='WITH taxonomy_assay AS MATERIALIZED (SELECT public.assay_vehicle_taxonomy_fold() AS reading), residual_assay AS MATERIALIZED (';
 IF position(a IN v)=0 THEN RAISE EXCEPTION 'Job health CTE differs'; END IF; v:=replace(v,a,b);
 a:=$s$WHEN j.jobname = 'drain-vehicle-derived-queues'::text THEN ( SELECT metric_assay.reading ->> 'status'::text
               FROM metric_assay)$s$;
 b:=a||$s$
            WHEN j.jobname = 'drain-vehicle-taxonomy'::text THEN (SELECT reading->>'status' FROM taxonomy_assay)$s$;
 IF position(a IN v)=0 THEN RAISE EXCEPTION 'Job health assay differs'; END IF; v:=replace(v,a,b);
 a:=$s$WHEN j.jobname = 'drain-vehicle-derived-queues'::text THEN ( SELECT metric_assay.reading
               FROM metric_assay)$s$;
 b:=a||$s$
            WHEN j.jobname = 'drain-vehicle-taxonomy'::text THEN (SELECT reading FROM taxonomy_assay)$s$;
 IF position(a IN v)=0 THEN RAISE EXCEPTION 'Job health receipt differs'; END IF; v:=replace(v,a,b);
 a:=$s$WHEN j.jobname = 'drain-vehicle-derived-queues'::text THEN
            CASE$s$;
 b:=$s$WHEN j.jobname = 'drain-vehicle-taxonomy'::text THEN
            CASE WHEN lr.last_run_at IS NULL OR lr.last_run_at<=statement_timestamp()-interval '15 minutes' THEN 'failed'::text
                 WHEN (SELECT reading->>'status' FROM taxonomy_assay)='failed' THEN 'failed'::text
                 WHEN (SELECT reading->>'status' FROM taxonomy_assay)='passed' AND lr.last_status='succeeded' THEN 'passed'::text
                 ELSE 'unknown'::text END
            $s$||a;
 IF position(a IN v)=0 THEN RAISE EXCEPTION 'Job health decision differs'; END IF; v:=replace(v,a,b);
 EXECUTE 'CREATE OR REPLACE VIEW public.v_job_health AS '||v;
END $health$;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='drain-vehicle-taxonomy') THEN RAISE EXCEPTION 'Taxonomy job already exists'; END IF;
 PERFORM cron.schedule('drain-vehicle-taxonomy','* * * * *',$cmd$
  SET statement_timeout='20s'; SET lock_timeout='500ms';
  SELECT public.drain_vehicle_taxonomy_queue();
 $cmd$);
END $$;
COMMENT ON TABLE public.vehicle_taxonomy_replay_state IS 'Singleton operational replay cursor/counters for retained VIN taxonomy. No testimony; writer drain_vehicle_taxonomy_queue and service-only replay_vehicle_taxonomy; reader assay_vehicle_taxonomy_fold.';
COMMENT ON TABLE public.vehicle_taxonomy_invalidations IS 'Operational vehicle-input invalidation mailbox, one request per enqueue. Append without coalescing/worker state locks; drain folds claimed requests into queue state then deletes only those operational requests atomically. Source evidence and immutable calculation receipts are never deleted. Service read only.';
COMMENT ON COLUMN public.vehicle_taxonomy_invalidations.id IS 'Ingress identity key; only exact claimed IDs removed, so concurrently appended invalidations remain pending.';
COMMENT ON COLUMN public.vehicle_taxonomy_invalidations.vehicle_id IS 'FK to existing physical vehicle; producer append key-share is compatible with worker NO KEY UPDATE lock.';
COMMENT ON COLUMN public.vehicle_taxonomy_invalidations.queued_at IS 'Database enqueue clock, not source event time or decode freshness.';
COMMENT ON COLUMN public.vehicle_taxonomy_replay_state.id IS 'Singleton true key; no entity identity minted.';
COMMENT ON COLUMN public.vehicle_taxonomy_replay_state.generation IS 'Positive replay/recipe generation; old queue generations become stale.';
COMMENT ON COLUMN public.vehicle_taxonomy_replay_state.vin_cursor IS 'Last cache primary key visited in this replay; not a temporal cutoff or VIN verification.';
COMMENT ON COLUMN public.vehicle_taxonomy_replay_state.scan_completed_at IS 'Database clock when this generation reached an empty/short keyset page; incremental cache/vehicle triggers remain active.';
COMMENT ON COLUMN public.vehicle_taxonomy_replay_state.started_at IS 'Database start clock of the current explicit replay generation.';
COMMENT ON COLUMN public.vehicle_taxonomy_replay_state.cache_keys_seen IS 'Cache keys visited this generation; includes unbound/error-bearing records, not eligible vehicles.';
COMMENT ON COLUMN public.vehicle_taxonomy_replay_state.processed IS 'Successful queue verifications this generation, including identical/no-op inputs; not new facts.';
COMMENT ON COLUMN public.vehicle_taxonomy_replay_state.changed IS 'Actual vehicles whose two derived canonical columns changed this generation; raw testimony untouched.';
COMMENT ON COLUMN public.vehicle_taxonomy_replay_state.binding_overflow_events IS 'Refused cache-to-vehicle lookup events with more than10 undeleted/unmerged parents; keeps assay partial; not a deduplicated population.';
COMMENT ON COLUMN public.vehicle_taxonomy_replay_state.last_batch_at IS 'Last actual progress clock (visited cache keys or verified dirty inputs); zero-yield idle/locked runs do not refresh it. Monitor combines it with backlog and natural cron status.';
COMMENT ON TABLE public.vehicle_taxonomy_recompute_queue IS 'One current dirty-work/verification state per physical vehicle FK. Drain atomically coalesces append-only invalidations and bounded retained-cache replay. Derived writer drain_vehicle_taxonomy_queue; service cached reader; direct API DML denied.';
COMMENT ON COLUMN public.vehicle_taxonomy_recompute_queue.vehicle_id IS 'PK and FK to existing vehicles physical entity; no VIN becomes a duplicate vehicle entity.';
COMMENT ON COLUMN public.vehicle_taxonomy_recompute_queue.queued_at IS 'Database clock of first enqueue; preserved across bursts; not source-event time.';
COMMENT ON COLUMN public.vehicle_taxonomy_recompute_queue.next_due_at IS 'NULL when verified or paused/inactive; otherwise bounded replay/invalidation/retry due clock.';
COMMENT ON COLUMN public.vehicle_taxonomy_recompute_queue.generation IS 'Replay generation last enqueued; reader marks older generations stale.';
COMMENT ON COLUMN public.vehicle_taxonomy_recompute_queue.consecutive_failures IS '0..3 record write failures;15min backoff and pause after3; new input invalidation resets.';
COMMENT ON COLUMN public.vehicle_taxonomy_recompute_queue.last_error IS 'Bounded state/reason and SQLSTATE only; no source values, query text or credentials.';
COMMENT ON COLUMN public.vehicle_taxonomy_recompute_queue.last_verified_at IS 'Database clock that current inputs were assayed against canonical output.';
COMMENT ON COLUMN public.vehicle_taxonomy_recompute_queue.last_receipt_id IS 'Composite own-vehicle FK to immutable latest calculation receipt; old receipt survives failed work.';
COMMENT ON TABLE public.vehicle_taxonomy_revisions IS 'Immutable derived taxonomy calculation receipts, one physical vehicle x qualified input SHA256. Typed cache/vocabulary edges, original inputs and previous projection retained; not new physical testimony, confidence or historical factory configuration. Owner set_vehicle_canonical_taxonomy via shared derive_vehicle_taxonomy, materializer drain_vehicle_taxonomy_queue.';
COMMENT ON COLUMN public.vehicle_taxonomy_revisions.id IS 'Surrogate immutable revision key; composite own-vehicle identity for current queue pointer.';
COMMENT ON COLUMN public.vehicle_taxonomy_revisions.vehicle_id IS 'FK to the existing physical vehicle whose recorded VIN/body inputs were computed.';
COMMENT ON COLUMN public.vehicle_taxonomy_revisions.cache_vin IS 'Nullable FK to original retained VIN decode, including withheld references; receipt retains consumed fields/hash/record clocks if cache later changes.';
COMMENT ON COLUMN public.vehicle_taxonomy_revisions.input_sha256 IS '32-byte qualified calculation/input digest, excluding computed/verification clocks and previous output; repeats reuse the revision.';
COMMENT ON COLUMN public.vehicle_taxonomy_revisions.canonical_body_style IS 'Nullable FK to existing active body vocabulary; recorded-body precedence then qualified VIN reference; unknown withheld.';
COMMENT ON COLUMN public.vehicle_taxonomy_revisions.canonical_vehicle_type IS 'Nullable FK to existing active type vocabulary, preferring canonical body mapping; not proof of physical configuration.';
COMMENT ON COLUMN public.vehicle_taxonomy_revisions.receipt IS 'Method, raw current body input, consumed cache taxonomy/error/provider/clock/hash, normalized outputs, separate basis labels and previous projection. No invented source event clock or confidence.';
COMMENT ON COLUMN public.vehicle_taxonomy_revisions.computed_at IS 'Original database derivation clock, immutable on input replay; queue last_verified_at records later verification.';
COMMENT ON COLUMN public.vehicles.canonical_body_style IS 'Current derived classification in canonical_body_styles vocabulary: recorded body_style has precedence, otherwise clean/structurally valid/nonfuture NHTSA VIN factory reference. Not verified physical configuration. Owner set_vehicle_canonical_taxonomy / bounded drain_vehicle_taxonomy_queue; cached lineage read_vehicle_taxonomy_fold.';
COMMENT ON COLUMN public.vehicles.canonical_vehicle_type IS 'Current derived canonical_vehicle_types key using same qualified inputs and body vocabulary mapping; factory reference distinguished from recorded body input in immutable vehicle_taxonomy_revisions. Unknown retained; not verified physical configuration.';
COMMENT ON FUNCTION public.derive_vehicle_taxonomy(text,text) IS 'Shared read-only taxonomy calculation for existing vehicle trigger and derived worker; strict retained-reference qualification, existing active vocabulary, body precedence, explicit factory basis and unknowns. Public invoker uses already-public cache/vocabulary only; no vehicle lookup or private-parent access.';
COMMENT ON FUNCTION public.drain_vehicle_taxonomy_queue() IS 'Service-only bounded materializer: governor/advisory exclusion, cache keyset seed under500 pending, max25 vehicles/8s loop and20s cron budget, SKIP LOCKED, idempotent receipts and only differing derived canonical columns. Failures15min/pause3. No provider/model calls, raw testimony or bypass flags.';
COMMENT ON FUNCTION public.replay_vehicle_taxonomy() IS 'Service-only replay/recipe invalidation: new generation and reset cache-PK cursor/counters; prior immutable receipts retained, old generations stale until revisited.';
COMMENT ON FUNCTION public.read_vehicle_taxonomy_fold(uuid) IS 'Service-only cached input/typed-lineage/verification reader; explicit stale state and canonical output equality. No source rescan or private data grant.';
COMMENT ON FUNCTION public.assay_vehicle_taxonomy_fold() IS 'Service-only queue/cursor/yield assay integrated into existing v_job_health; initial/existing replay remains partial until keyset exhausted and dirty work drained, record failures/governor stalling visible.';
COMMENT ON TABLE public.vin_decoded_data IS 'Retained NHTSA vPIC factory-reference payload per VIN, PK vin; raw_response preserves provider VIN/error/body/type fields. Producer scripts/mass-vin-decode.ts (registered) and historical decode-all-vins; October7 intake is live. Public reference read, service-role write policy. The existing vehicle taxonomy trigger and bounded drain_vehicle_taxonomy_queue share strict raw VIN/projection/ErrorCode0/record-clock qualification and keep recorded body input precedence. Cache changes append durable taxonomy invalidations. A decode is testimony of the VIN, not proof of physical configuration. decoded_at/created_at/updated_at are local recording clocks, not the time NHTSA changed its answer. Earlier dated atlas audit remains in migration20261008003000; its counts/activity/policies were superseded by October7 intake, PR815 and this fold.';
NOTIFY pgrst,'reload schema';
COMMIT;
