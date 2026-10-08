-- Earned from50 retained headers/11 pinned previews:8qualified,3semantic refusals,
-- 0writes/0models. Reuse the existing queue/batcher/canonical protected-v1 intake.
-- This admits derived supported testimony; no native result/profile/source writes.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='1s';
DO $$ BEGIN
 IF (SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND state='active'
   AND (query ILIKE '%derivation_queue%' OR query ILIKE '%listing_page_snapshots%'))>2 THEN
  RAISE EXCEPTION 'Archive intake DDL deferred: active owner load';
 END IF;
 IF EXISTS(SELECT 1 FROM public.observation_extractors WHERE slug='bat-archived-sale-v1') THEN
  RAISE EXCEPTION 'Archive sale reader already exists';
 END IF;
END $$;
INSERT INTO public.observation_extractors(source_id,slug,display_name,extractor_type,edge_function_name,
 extractor_config,produces_kinds,is_active,schedule_type,rate_limit_per_hour,min_interval_seconds)
SELECT id,'bat-archived-sale-v1','Protected archived BaT sale intake','edge_function','batch-extract-snapshots',
 '{"mode":"source_sale_qualification","use_source_queue":true,"qualification_version":"v1","model_calls":0}'::jsonb,
 ARRAY['sale_result'],true,'cron',240,300 FROM public.observation_sources WHERE slug='bat';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.observation_extractors WHERE slug='bat-archived-sale-v1') THEN
  RAISE EXCEPTION 'Canonical BaT source missing';
 END IF;
END $$;

CREATE TABLE public.bat_sale_replay_state (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 snapshot_cursor uuid REFERENCES public.listing_page_snapshots(id),
 scan_completed_at timestamptz, started_at timestamptz NOT NULL DEFAULT now(),
 keys_seen bigint NOT NULL DEFAULT 0 CHECK(keys_seen>=0),
 seed_queued bigint NOT NULL DEFAULT 0 CHECK(seed_queued>=0),
 last_seed_at timestamptz,last_finished_at timestamptz
);
INSERT INTO public.bat_sale_replay_state(id) VALUES(true);
ALTER TABLE public.derivation_queue
 ADD COLUMN source_snapshot_id uuid REFERENCES public.listing_page_snapshots(id),
 ADD COLUMN source_vehicle_id uuid REFERENCES public.vehicles(id),
 ADD COLUMN source_sale_observation_id uuid REFERENCES public.vehicle_observations(id);
ALTER TABLE public.derivation_queue DROP CONSTRAINT derivation_queue_evidence_type_check;
ALTER TABLE public.derivation_queue ADD CONSTRAINT derivation_queue_evidence_type_check CHECK(evidence_type IN
 ('secure_document','vehicle_image','receipt','qb_transaction','imessage_conversation','email','artifact','auction_comment','listing_page_snapshot')) NOT VALID;
ALTER TABLE public.derivation_queue DROP CONSTRAINT derivation_queue_owner_scope_check;
ALTER TABLE public.derivation_queue ADD CONSTRAINT derivation_queue_owner_scope_check CHECK(
 (evidence_type IN ('auction_comment','listing_page_snapshot') AND user_id IS NULL)
 OR (evidence_type NOT IN ('auction_comment','listing_page_snapshot') AND user_id IS NOT NULL)) NOT VALID;
ALTER TABLE public.derivation_queue ADD CONSTRAINT derivation_queue_source_sale_route CHECK(
 (evidence_type='listing_page_snapshot' AND extractor_slug='bat-archived-sale-v1'
  AND source_snapshot_id=evidence_id AND source_snapshot_id IS NOT NULL AND source_vehicle_id IS NOT NULL
  AND user_id IS NULL AND cost_cents IS NOT DISTINCT FROM 0 AND credential_source IS NOT DISTINCT FROM 'deterministic'
  AND max_attempts=3 AND attempts BETWEEN 0 AND 3
  AND (status<>'done' OR source_sale_observation_id IS NOT NULL))
 OR (evidence_type<>'listing_page_snapshot' AND source_snapshot_id IS NULL
  AND source_vehicle_id IS NULL AND source_sale_observation_id IS NULL)) NOT VALID;
CREATE INDEX derivation_queue_bat_sale_due ON public.derivation_queue(next_attempt_at,created_at,id)
 WHERE evidence_type='listing_page_snapshot' AND status IN ('pending','skipped');
CREATE INDEX derivation_queue_bat_sale_result ON public.derivation_queue(source_sale_observation_id)
 WHERE evidence_type='listing_page_snapshot';
CREATE INDEX derivation_queue_bat_sale_claimed ON public.derivation_queue(locked_at,id)
 WHERE evidence_type='listing_page_snapshot' AND status='claimed';

CREATE FUNCTION public.guard_bat_sale_work() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s record; o record;
BEGIN
 IF TG_OP='UPDATE' AND OLD.evidence_type='listing_page_snapshot' AND NEW.evidence_type IS DISTINCT FROM OLD.evidence_type THEN
  RAISE EXCEPTION 'Capture work route is immutable';
 END IF;
 IF NEW.evidence_type<>'listing_page_snapshot' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND (NEW.source_snapshot_id IS DISTINCT FROM OLD.source_snapshot_id
   OR NEW.source_vehicle_id IS DISTINCT FROM OLD.source_vehicle_id OR NEW.extractor_slug IS DISTINCT FROM OLD.extractor_slug) THEN
  RAISE EXCEPTION 'Capture work bindings are immutable';
 END IF;
 IF NEW.source_sale_observation_id IS NOT NULL THEN
  SELECT platform,success,http_status,metadata,html_sha256 INTO s FROM public.listing_page_snapshots WHERE id=NEW.source_snapshot_id;
  SELECT id,vehicle_id,source_snapshot_id,kind,extraction_method,is_superseded,source_id,structured_data INTO o
   FROM public.vehicle_observations WHERE id=NEW.source_sale_observation_id;
  IF NOT FOUND OR o.vehicle_id IS DISTINCT FROM NEW.source_vehicle_id OR o.source_snapshot_id IS DISTINCT FROM NEW.source_snapshot_id
   OR o.kind IS DISTINCT FROM 'sale_result' OR o.extraction_method IS DISTINCT FROM 'protected_archived_sale_observation_v1'
   OR o.is_superseded IS DISTINCT FROM false
   OR NOT EXISTS(SELECT 1 FROM public.observation_sources WHERE id=o.source_id AND slug='bat')
   OR o.structured_data#>>'{source_sale_receipt,method}' IS DISTINCT FROM 'protected_archived_sale_observation_v1'
   OR o.structured_data#>>'{source_sale_receipt,snapshot_id}' IS DISTINCT FROM NEW.source_snapshot_id::text
   OR o.structured_data#>>'{source_sale_receipt,vehicle_id}' IS DISTINCT FROM NEW.source_vehicle_id::text
   OR s.platform IS DISTINCT FROM 'bat' OR s.success IS DISTINCT FROM true OR s.http_status IS DISTINCT FROM 200
   OR s.metadata->>'vehicle_matched' IS DISTINCT FROM 'true'
   OR s.html_sha256 IS NULL OR s.html_sha256 !~ '^[0-9a-fA-F]{64}$' OR s.metadata->>'parsed_at' IS NULL
   OR lower(s.metadata->>'vehicle_id') IS DISTINCT FROM NEW.source_vehicle_id::text
   OR lower(s.html_sha256) IS DISTINCT FROM o.structured_data#>>'{source_sale_receipt,source_sha256}'
   OR s.metadata->>'parsed_at' IS DISTINCT FROM o.structured_data#>>'{source_sale_receipt,original_parsed_at}'
   OR NOT EXISTS(SELECT 1 FROM public.vehicles WHERE id=NEW.source_vehicle_id AND is_public IS TRUE
     AND deleted_at IS NULL AND listing_kind IS DISTINCT FROM 'non_vehicle_item' AND status IS DISTINCT FROM 'merged') THEN
    RAISE EXCEPTION 'Protected same-parent capture observation required';
  END IF;
 END IF;
 IF NEW.status='done' AND (NEW.observation_ids IS DISTINCT FROM ARRAY[NEW.source_sale_observation_id]) THEN
  RAISE EXCEPTION 'Canonical result array and typed result differ';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_bat_sale_work BEFORE INSERT OR UPDATE ON public.derivation_queue
 FOR EACH ROW EXECUTE FUNCTION public.guard_bat_sale_work();

CREATE FUNCTION public.enqueue_bat_sale_snapshot(p_snapshot uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET lock_timeout='500ms' AS $$
DECLARE s record; vid uuid; touched integer;
BEGIN
 -- MVCC precheck avoids producer waiting on already-existing worker queue locks.
 IF EXISTS(SELECT 1 FROM public.derivation_queue WHERE evidence_type='listing_page_snapshot'
   AND evidence_id=p_snapshot AND extractor_slug='bat-archived-sale-v1') THEN RETURN false; END IF;
 SELECT id,platform,success,http_status,html_sha256,metadata INTO s FROM public.listing_page_snapshots WHERE id=p_snapshot;
 IF NOT FOUND OR s.platform IS DISTINCT FROM 'bat' OR s.success IS DISTINCT FROM true OR s.http_status IS DISTINCT FROM 200
   OR s.html_sha256 !~ '^[0-9a-fA-F]{64}$' OR s.html_sha256 IS NULL
   OR s.metadata->>'vehicle_matched' IS DISTINCT FROM 'true' OR s.metadata->>'parsed_at' IS NULL
   OR coalesce(s.metadata->>'vehicle_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN false; END IF;
 vid:=(s.metadata->>'vehicle_id')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.vehicles WHERE id=vid AND is_public IS TRUE AND deleted_at IS NULL
   AND listing_kind IS DISTINCT FROM 'non_vehicle_item' AND status IS DISTINCT FROM 'merged') THEN RETURN false; END IF;
 INSERT INTO public.derivation_queue(evidence_type,evidence_id,extractor_slug,user_id,requested_by,priority,
   source_snapshot_id,source_vehicle_id,cost_cents,credential_source)
 VALUES('listing_page_snapshot',p_snapshot,'bat-archived-sale-v1',NULL,'trigger',150,p_snapshot,vid,0,'deterministic')
 ON CONFLICT(evidence_type,evidence_id,extractor_slug) DO NOTHING;
 GET DIAGNOSTICS touched=ROW_COUNT;
 RETURN touched=1;
END $$;
CREATE FUNCTION public.trg_enqueue_bat_sale_snapshot() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='UPDATE' AND row(NEW.metadata,NEW.success,NEW.http_status,NEW.html_sha256)
   IS NOT DISTINCT FROM row(OLD.metadata,OLD.success,OLD.http_status,OLD.html_sha256) THEN RETURN NEW; END IF;
 PERFORM public.enqueue_bat_sale_snapshot(NEW.id); RETURN NEW;
END $$;
CREATE TRIGGER enqueue_bat_sale_snapshot AFTER INSERT OR UPDATE OF metadata,success,http_status,html_sha256
 ON public.listing_page_snapshots FOR EACH ROW EXECUTE FUNCTION public.trg_enqueue_bat_sale_snapshot();

CREATE FUNCTION public.seed_bat_sale_snapshots() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET lock_timeout='500ms' AS $$
DECLARE s public.bat_sale_replay_state%ROWTYPE; c record; seen integer:=0; queued integer:=0;
BEGIN
 IF NOT pg_try_advisory_xact_lock(879106,1) THEN RETURN 0; END IF;
 SELECT * INTO s FROM public.bat_sale_replay_state WHERE id FOR UPDATE;
 IF s.scan_completed_at IS NOT NULL OR
   (SELECT count(*) FROM (SELECT 1 FROM public.derivation_queue WHERE evidence_type='listing_page_snapshot'
    AND status IN ('pending','claimed') LIMIT 500) p)>=500 THEN RETURN 0; END IF;
 FOR c IN SELECT id FROM public.listing_page_snapshots WHERE platform='bat' AND success
   AND (s.snapshot_cursor IS NULL OR id>s.snapshot_cursor) ORDER BY id LIMIT 500 LOOP
  IF public.enqueue_bat_sale_snapshot(c.id) THEN queued:=queued+1; END IF;
  s.snapshot_cursor:=c.id; seen:=seen+1;
 END LOOP;
 UPDATE public.bat_sale_replay_state SET snapshot_cursor=s.snapshot_cursor,keys_seen=keys_seen+seen,seed_queued=seed_queued+queued,
   scan_completed_at=CASE WHEN seen<500 THEN now() ELSE NULL END,
   last_seed_at=CASE WHEN seen>0 THEN now() ELSE last_seed_at END WHERE id;
 RETURN queued;
END $$;

-- Existing private/public-comment dispatcher keeps its exact return contract and
-- selection, except that it cannot claim this separately owned deterministic lane.
CREATE OR REPLACE FUNCTION public.claim_derivation_work(p_worker text,p_batch_size integer DEFAULT 5,p_user_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid,user_id uuid,evidence_type text,evidence_id uuid,extractor_slug text,attempts integer,request_note text)
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 WITH picked AS (SELECT q.id FROM public.derivation_queue q WHERE q.status='pending'
  AND q.evidence_type<>'listing_page_snapshot' AND q.next_attempt_at<=now() AND q.attempts<q.max_attempts
  AND (p_user_id IS NULL OR q.user_id=p_user_id) ORDER BY q.priority,q.created_at LIMIT p_batch_size FOR UPDATE SKIP LOCKED)
 UPDATE public.derivation_queue q SET status='claimed',locked_at=now(),locked_by=p_worker,attempts=q.attempts+1
 FROM picked WHERE q.id=picked.id RETURNING q.id,q.user_id,q.evidence_type,q.evidence_id,q.extractor_slug,q.attempts,q.request_note;
$$;
CREATE FUNCTION public.claim_bat_sale_snapshots(p_worker text,p_limit integer DEFAULT 20)
RETURNS TABLE(id uuid,source_snapshot_id uuid,source_vehicle_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET lock_timeout='500ms' SET statement_timeout='10s' AS $$
BEGIN
 IF p_worker IS NULL OR btrim(p_worker)='' OR length(p_worker)>80 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'Invalid bounded worker'; END IF;
 IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND pid<>pg_backend_pid()) OR
  (SELECT count(*) FROM pg_stat_activity WHERE state='active' AND backend_type='client backend' AND pid<>pg_backend_pid())>8 THEN RETURN; END IF;
 PERFORM set_config('app.writer','batch-extract-snapshots:source_sale_qualification',true);
 PERFORM public.seed_bat_sale_snapshots();
 -- Bounded lease recovery; only this lane, never another user's work.
 WITH expired AS (SELECT q.id FROM public.derivation_queue q WHERE q.evidence_type='listing_page_snapshot'
   AND q.status='claimed' AND q.locked_at<now()-interval '10 minutes' ORDER BY q.locked_at LIMIT 20 FOR UPDATE SKIP LOCKED)
 UPDATE public.derivation_queue q SET status=CASE WHEN attempts>=max_attempts THEN 'failed' ELSE 'pending' END,
  locked_by=NULL,locked_at=NULL,next_attempt_at=now()+interval '15 minutes',error_message='lease_expired'
 FROM expired e WHERE q.id=e.id;
 RETURN QUERY WITH picked AS (SELECT q.id FROM public.derivation_queue q WHERE q.evidence_type='listing_page_snapshot'
  AND q.extractor_slug='bat-archived-sale-v1' AND q.status IN ('pending','skipped') AND q.next_attempt_at<=now()
  AND q.attempts<q.max_attempts ORDER BY q.next_attempt_at,q.created_at,q.id LIMIT p_limit FOR UPDATE SKIP LOCKED)
 UPDATE public.derivation_queue q SET status='claimed',locked_at=now(),locked_by=p_worker,attempts=q.attempts+1
 FROM picked p WHERE q.id=p.id RETURNING q.id,q.source_snapshot_id,q.source_vehicle_id;
END $$;
CREATE FUNCTION public.finish_bat_sale_snapshot(p_id uuid,p_worker text,p_status text,p_observation uuid DEFAULT NULL,p_reason text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET lock_timeout='500ms' AS $$
DECLARE q public.derivation_queue%ROWTYPE;
BEGIN
 IF p_status NOT IN ('done','skipped','retry') OR p_status IS NULL
   OR (p_status='done' AND (p_observation IS NULL OR p_reason IS NOT NULL)) OR (p_status<>'done' AND p_observation IS NOT NULL)
   OR (p_status<>'done' AND (p_reason IS NULL OR p_reason !~ '^[a-z][a-z0-9_]{0,100}$')) THEN RAISE EXCEPTION 'Invalid completion'; END IF;
 SELECT * INTO q FROM public.derivation_queue WHERE id=p_id AND evidence_type='listing_page_snapshot'
  AND extractor_slug='bat-archived-sale-v1' AND status='claimed' AND locked_by=p_worker FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM set_config('app.writer','batch-extract-snapshots:source_sale_qualification',true);
 UPDATE public.derivation_queue SET
  status=CASE WHEN p_status='retry' THEN CASE WHEN attempts>=max_attempts AND p_reason<>'batch_budget_deferred' THEN 'failed' ELSE 'pending' END ELSE p_status END,
  attempts=CASE WHEN p_status='skipped' THEN 0 WHEN p_reason='batch_budget_deferred' THEN greatest(0,attempts-1) ELSE attempts END,
  next_attempt_at=now()+CASE WHEN p_status='skipped' THEN interval '24 hours' ELSE interval '15 minutes' END,
  locked_at=NULL,locked_by=NULL,completed_at=CASE WHEN p_status IN ('done','skipped') THEN now() ELSE NULL END,
  error_message=p_reason,source_sale_observation_id=p_observation,
  observation_ids=CASE WHEN p_observation IS NOT NULL THEN ARRAY[p_observation] ELSE NULL END,
  cost_cents=0,credential_source='deterministic'
 WHERE id=p_id;
 IF p_status IN ('done','skipped') THEN
  UPDATE public.bat_sale_replay_state SET last_finished_at=now() WHERE id;
 END IF;
 RETURN true;
END $$;
CREATE FUNCTION public.read_bat_sale_intake(p_snapshot uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp SET statement_timeout='5s' AS $$
 SELECT coalesce((SELECT jsonb_build_object('snapshot_id',q.source_snapshot_id,'vehicle_id',q.source_vehicle_id,
 'status',q.status,'reason',q.error_message,'attempts',q.attempts,'next_attempt_at',q.next_attempt_at,
 'completed_at',q.completed_at,'observation_id',o.id,'ingested_at',o.ingested_at,
 'receipt',o.structured_data->'source_sale_receipt',
 'stale',q.status<>'done' OR o.id IS NULL OR o.is_superseded IS DISTINCT FROM false
  OR v.is_public IS DISTINCT FROM true OR v.deleted_at IS NOT NULL OR v.listing_kind IS NOT DISTINCT FROM 'non_vehicle_item'
  OR v.status IS NOT DISTINCT FROM 'merged' OR s.platform IS DISTINCT FROM 'bat' OR s.success IS DISTINCT FROM true
  OR s.http_status IS DISTINCT FROM 200 OR s.metadata->>'vehicle_matched' IS DISTINCT FROM 'true'
  OR lower(s.metadata->>'vehicle_id') IS DISTINCT FROM q.source_vehicle_id::text
  OR lower(s.html_sha256) IS DISTINCT FROM o.structured_data#>>'{source_sale_receipt,source_sha256}'
  OR s.metadata->>'parsed_at' IS DISTINCT FROM o.structured_data#>>'{source_sale_receipt,original_parsed_at}')
 FROM public.derivation_queue q JOIN public.listing_page_snapshots s ON s.id=q.source_snapshot_id
 JOIN public.vehicles v ON v.id=q.source_vehicle_id LEFT JOIN public.vehicle_observations o ON o.id=q.source_sale_observation_id
 WHERE q.evidence_type='listing_page_snapshot' AND q.evidence_id=p_snapshot AND q.extractor_slug='bat-archived-sale-v1'),
 jsonb_build_object('status','not_queued','stale',true));
$$;
CREATE FUNCTION public.assay_bat_sale_intake() RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp SET statement_timeout='5s' AS $$
 WITH q AS (SELECT count(*) FILTER(WHERE q.status='pending') pending,count(*) FILTER(WHERE q.status='claimed') claimed,
  count(*) FILTER(WHERE q.status='done') qualified,count(*) FILTER(WHERE q.status='skipped') refused,
  count(*) FILTER(WHERE q.status='failed') failed,count(*) FILTER(WHERE q.status='skipped' AND q.next_attempt_at<=now()) refusal_rechecks_due,
  count(*) FILTER(WHERE q.status='done' AND (o.id IS NULL OR o.is_superseded IS DISTINCT FROM false
   OR v.is_public IS DISTINCT FROM true OR v.deleted_at IS NOT NULL OR v.listing_kind IS NOT DISTINCT FROM 'non_vehicle_item'
   OR v.status IS NOT DISTINCT FROM 'merged' OR s.platform IS DISTINCT FROM 'bat' OR s.success IS DISTINCT FROM true
   OR s.http_status IS DISTINCT FROM 200 OR s.metadata->>'vehicle_matched' IS DISTINCT FROM 'true'
   OR lower(s.metadata->>'vehicle_id') IS DISTINCT FROM q.source_vehicle_id::text
   OR lower(s.html_sha256) IS DISTINCT FROM o.structured_data#>>'{source_sale_receipt,source_sha256}'
   OR s.metadata->>'parsed_at' IS DISTINCT FROM o.structured_data#>>'{source_sale_receipt,original_parsed_at}')) stale_qualified
  FROM public.derivation_queue q LEFT JOIN public.listing_page_snapshots s ON s.id=q.source_snapshot_id
  LEFT JOIN public.vehicles v ON v.id=q.source_vehicle_id LEFT JOIN public.vehicle_observations o ON o.id=q.source_sale_observation_id
  WHERE q.evidence_type='listing_page_snapshot' AND q.extractor_slug='bat-archived-sale-v1'),
 s AS (SELECT * FROM public.bat_sale_replay_state WHERE id)
 SELECT jsonb_build_object('status',CASE WHEN q.failed+q.stale_qualified>0 THEN 'failed'
  WHEN (s.scan_completed_at IS NULL OR q.pending+q.claimed+q.refusal_rechecks_due>0)
   AND greatest(s.last_seed_at,s.last_finished_at,s.started_at)<statement_timestamp()-interval '15 minutes' THEN 'failed'
  WHEN s.scan_completed_at IS NULL OR q.pending+q.claimed+q.refusal_rechecks_due>0 THEN 'partial' ELSE 'passed' END,
  'scope','currently_supported_protected_bat_v1_capture_admission_not_native_promotion',
  'state',to_jsonb(s)-'snapshot_cursor','counts',to_jsonb(q),'model_calls',0,
  'refusal_policy','explicit_unknowns_rechecked_daily_no_native_correction') FROM s,q;
$$;

ALTER TABLE public.bat_sale_replay_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bat_sale_replay_state FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.bat_sale_replay_state TO service_role;
CREATE POLICY bat_sale_state_service_read ON public.bat_sale_replay_state FOR SELECT TO service_role USING(true);
REVOKE ALL ON FUNCTION public.guard_bat_sale_work(),public.enqueue_bat_sale_snapshot(uuid),public.trg_enqueue_bat_sale_snapshot(),
 public.seed_bat_sale_snapshots(),public.claim_bat_sale_snapshots(text,integer),public.finish_bat_sale_snapshot(uuid,text,text,uuid,text),
 public.read_bat_sale_intake(uuid),public.assay_bat_sale_intake() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_bat_sale_snapshot(uuid),public.claim_bat_sale_snapshots(text,integer),
 public.finish_bat_sale_snapshot(uuid,text,text,uuid,text),public.read_bat_sale_intake(uuid),public.assay_bat_sale_intake() TO service_role;
INSERT INTO public.pipeline_registry(table_name,column_name,owned_by,description,do_not_write_directly,write_via) VALUES
 ('bat_sale_replay_state',NULL,'batch-extract-snapshots','Operational finite retained-BaT scan/progress, no testimony.',true,'seed_bat_sale_snapshots / finish_bat_sale_snapshot'),
 ('derivation_queue','source_snapshot_id','batch-extract-snapshots','Pinned typed retained capture, exact deterministic route only.',true,'enqueue_bat_sale_snapshot'),
 ('derivation_queue','source_vehicle_id','batch-extract-snapshots','Typed visible real parent binding; immutable within work item.',true,'enqueue_bat_sale_snapshot'),
 ('derivation_queue','source_sale_observation_id','batch-extract-snapshots','Same-parent/same-capture canonical protected result; no caller-authored sale facts.',true,'finish_bat_sale_snapshot');

DO $health$
DECLARE v text:=pg_get_viewdef('public.v_job_health'::regclass,true); a text; b text;
BEGIN
 a:='WITH taxonomy_assay AS MATERIALIZED (';
 IF position(a IN v)=0 THEN RAISE EXCEPTION 'Job health owner shape differs'; END IF;
 v:=replace(v,a,'WITH bat_sale_assay AS MATERIALIZED (SELECT public.assay_bat_sale_intake() AS reading), taxonomy_assay AS MATERIALIZED (');
 a:=$s$WHEN j.jobname = 'drain-vehicle-derived-queues'::text THEN ( SELECT metric_assay.reading ->> 'status'::text
               FROM metric_assay)$s$;
 b:=a||$s$
            WHEN j.jobname = 'qualify-bat-archived-sales'::text THEN (SELECT reading->>'status' FROM bat_sale_assay)$s$;
 IF position(a IN v)=0 THEN RAISE EXCEPTION 'Job health assay differs'; END IF; v:=replace(v,a,b);
 a:=$s$WHEN j.jobname = 'drain-vehicle-derived-queues'::text THEN ( SELECT metric_assay.reading
               FROM metric_assay)$s$;
 b:=a||$s$
            WHEN j.jobname = 'qualify-bat-archived-sales'::text THEN (SELECT reading FROM bat_sale_assay)$s$;
 IF position(a IN v)=0 THEN RAISE EXCEPTION 'Job health receipt differs'; END IF; v:=replace(v,a,b);
 a:=$s$WHEN j.jobname = 'drain-vehicle-derived-queues'::text THEN
            CASE$s$;
 b:=$s$WHEN j.jobname = 'qualify-bat-archived-sales'::text THEN
            CASE WHEN lr.last_run_at IS NULL OR lr.last_run_at<=statement_timestamp()-interval '15 minutes' THEN 'failed'::text
                 WHEN (SELECT reading->>'status' FROM bat_sale_assay)='failed' THEN 'failed'::text
                 WHEN (SELECT reading->>'status' FROM bat_sale_assay)='passed' AND lr.last_status='succeeded' THEN 'passed'::text
                 ELSE 'unknown'::text END
            $s$||a;
 IF position(a IN v)=0 THEN RAISE EXCEPTION 'Job health decision differs'; END IF; v:=replace(v,a,b);
 EXECUTE 'CREATE OR REPLACE VIEW public.v_job_health AS '||v;
END $health$;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='qualify-bat-archived-sales') THEN RAISE EXCEPTION 'Archive sale job exists'; END IF;
 PERFORM cron.schedule('qualify-bat-archived-sales','*/5 * * * *',$cmd$
 SELECT net.http_post(url:='https://qkgaybvrernstplzjaam.supabase.co/functions/v1/batch-extract-snapshots',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||public.get_service_role_key_for_cron()),
  body:='{"mode":"source_sale_qualification","use_source_queue":true,"qualification_version":"v1","dry_run":false,"batch_size":20}'::jsonb,
  timeout_milliseconds:=60000);
 $cmd$);
END $$;
COMMENT ON TABLE public.bat_sale_replay_state IS 'Operational retained BaT cache replay cursor/counters for the existing batch-extract-snapshots protected-v1 intake; no native result promotion, model calls or source writes. Consumer assay_bat_sale_intake.';
COMMENT ON COLUMN public.bat_sale_replay_state.id IS 'Singleton true operational identity, not an entity or source claim.';
COMMENT ON COLUMN public.bat_sale_replay_state.snapshot_cursor IS 'FK to last visited retained BaT capture PK; finite scan, incremental metadata eligibility trigger remains active.';
COMMENT ON COLUMN public.bat_sale_replay_state.scan_completed_at IS 'Database clock of short final source-key page; not all-market or semantic qualification proof.';
COMMENT ON COLUMN public.bat_sale_replay_state.started_at IS 'Database replay start clock; not source publication or sale time.';
COMMENT ON COLUMN public.bat_sale_replay_state.keys_seen IS 'Visited retained BaT keys, including ineligible headers; not admitted claims.';
COMMENT ON COLUMN public.bat_sale_replay_state.seed_queued IS 'New work rows inserted by finite seeding only; incremental trigger enqueues are counted in queue, not here.';
COMMENT ON COLUMN public.bat_sale_replay_state.last_seed_at IS 'Last actual keyset progress; idle/skipped seed does not forge progress.';
COMMENT ON COLUMN public.bat_sale_replay_state.last_finished_at IS 'Last persisted qualified or explicitly refused work outcome; refused is not sale knowledge.';
COMMENT ON COLUMN public.derivation_queue.source_snapshot_id IS 'Nullable FK to retained capture; required/equal evidence_id only for registered deterministic listing_page_snapshot route; immutable work binding.';
COMMENT ON COLUMN public.derivation_queue.source_vehicle_id IS 'Nullable FK to visible real vehicle selected by existing protected metadata; intake independently re-verifies custody; not inferred entity resolution.';
COMMENT ON COLUMN public.derivation_queue.source_sale_observation_id IS 'Nullable typed FK to canonical same-parent/same-capture protected v1 sale_result; done requires exact observation_ids agreement and guard verification.';
COMMENT ON FUNCTION public.claim_bat_sale_snapshots(text,integer) IS 'Service-only deterministic lane claim: lock/load governor,500-key seed under500pending,1..20SKIP LOCKED work items,10minlease recovery; private/comment dispatcher excludes this lane.';
COMMENT ON FUNCTION public.finish_bat_sale_snapshot(uuid,text,text,uuid,text) IS 'Service-only lease CAS with typed protected-result guard; explicit refusals recheck24h; transient15minretry/pause3; unstarted budget deferral restores attempt. No testimony DML.';
COMMENT ON FUNCTION public.read_bat_sale_intake(uuid) IS 'Service-only cached work/canonical receipt reader; original ingestion/verification clocks and explicit source/parent staleness; no raw capture access.';
COMMENT ON FUNCTION public.assay_bat_sale_intake() IS 'Service-only actual source-scan/qualified/refused/lease/failure assay; unresolved evidence remains explicit; cadence in existing v_job_health.';
NOTIFY pgrst,'reload schema';
COMMIT;
