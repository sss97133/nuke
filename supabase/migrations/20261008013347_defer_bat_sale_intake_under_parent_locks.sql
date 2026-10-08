-- Runtime55P03: one busy vehicle FK rolled back the entire500key seed.
-- Preserve capture work through an append-only operational deferral, not a new
-- testimony store or a relaxed parent/result FK. Producer and worker skip busy
-- parents; the existing canonical intake/receipt guard remains authoritative.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='1s';
CREATE TABLE public.bat_sale_capture_deferrals(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 snapshot_id uuid NOT NULL REFERENCES public.listing_page_snapshots(id),
 requested_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bat_sale_capture_deferrals_snapshot ON public.bat_sale_capture_deferrals(snapshot_id);
ALTER TABLE public.bat_sale_capture_deferrals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bat_sale_capture_deferrals FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SEQUENCE public.bat_sale_capture_deferrals_id_seq FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.bat_sale_capture_deferrals TO service_role;
CREATE POLICY bat_sale_deferrals_service_read ON public.bat_sale_capture_deferrals FOR SELECT TO service_role USING(true);
CREATE FUNCTION public.defer_bat_sale_snapshot(p_snapshot uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp SET lock_timeout='500ms' AS $$
 INSERT INTO public.bat_sale_capture_deferrals(snapshot_id) VALUES(p_snapshot);
$$;
CREATE OR REPLACE FUNCTION public.enqueue_bat_sale_snapshot(p_snapshot uuid) RETURNS boolean
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
 PERFORM 1 FROM public.vehicles WHERE id=vid FOR KEY SHARE SKIP LOCKED;
 IF NOT FOUND THEN PERFORM public.defer_bat_sale_snapshot(p_snapshot); RETURN false; END IF;
 BEGIN
 INSERT INTO public.derivation_queue(evidence_type,evidence_id,extractor_slug,user_id,requested_by,priority,
   source_snapshot_id,source_vehicle_id,cost_cents,credential_source)
 VALUES('listing_page_snapshot',p_snapshot,'bat-archived-sale-v1',NULL,'trigger',150,p_snapshot,vid,0,'deterministic')
 ON CONFLICT(evidence_type,evidence_id,extractor_slug) DO NOTHING;
 GET DIAGNOSTICS touched=ROW_COUNT;
 RETURN touched=1;
 EXCEPTION WHEN lock_not_available THEN
  PERFORM public.defer_bat_sale_snapshot(p_snapshot); RETURN false;
 END;
END $$;
CREATE FUNCTION public.retry_bat_sale_deferrals() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET lock_timeout='500ms' AS $$
DECLARE d record; consumed integer:=0;
BEGIN
 FOR d IN SELECT id,snapshot_id FROM public.bat_sale_capture_deferrals ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED LOOP
  -- If still busy, enqueue appends a NEW event before this one is consumed.
  -- Concurrent producer appends are distinct; no coalesced-row lost wakeups.
  PERFORM public.enqueue_bat_sale_snapshot(d.snapshot_id);
  DELETE FROM public.bat_sale_capture_deferrals WHERE id=d.id;
  consumed:=consumed+1;
 END LOOP;
 RETURN consumed;
END $$;
CREATE OR REPLACE FUNCTION public.claim_bat_sale_snapshots(p_worker text,p_limit integer DEFAULT 20)
RETURNS TABLE(id uuid,source_snapshot_id uuid,source_vehicle_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET lock_timeout='500ms' SET statement_timeout='10s' AS $$
BEGIN
 IF p_worker IS NULL OR btrim(p_worker)='' OR length(p_worker)>80 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'Invalid bounded worker'; END IF;
 IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND pid<>pg_backend_pid()) OR
  (SELECT count(*) FROM pg_stat_activity WHERE state='active' AND backend_type='client backend' AND pid<>pg_backend_pid())>8 THEN RETURN; END IF;
 PERFORM set_config('app.writer','batch-extract-snapshots:source_sale_qualification',true);
 PERFORM public.retry_bat_sale_deferrals();
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
CREATE OR REPLACE FUNCTION public.assay_bat_sale_intake() RETURNS jsonb
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
 d AS (SELECT count(*) deferred FROM public.bat_sale_capture_deferrals),
 s AS (SELECT * FROM public.bat_sale_replay_state WHERE id)
 SELECT jsonb_build_object('status',CASE WHEN q.failed+q.stale_qualified>0 THEN 'failed'
  WHEN (s.scan_completed_at IS NULL OR q.pending+q.claimed+q.refusal_rechecks_due+d.deferred>0)
   AND greatest(s.last_seed_at,s.last_finished_at,s.started_at)<statement_timestamp()-interval '15 minutes' THEN 'failed'
  WHEN s.scan_completed_at IS NULL OR q.pending+q.claimed+q.refusal_rechecks_due+d.deferred>0 THEN 'partial' ELSE 'passed' END,
  'scope','currently_supported_protected_bat_v1_capture_admission_not_native_promotion',
  'state',to_jsonb(s)-'snapshot_cursor','counts',to_jsonb(q)||to_jsonb(d),'model_calls',0,
  'refusal_policy','explicit_unknowns_rechecked_daily_no_native_correction') FROM s,q,d;
$$;

REVOKE ALL ON FUNCTION public.defer_bat_sale_snapshot(uuid),public.retry_bat_sale_deferrals() FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO public.pipeline_registry(table_name,column_name,owned_by,description,do_not_write_directly,write_via)
 VALUES('bat_sale_capture_deferrals',NULL,'batch-extract-snapshots','Append-only operational capture retries earned by actual parent FK contention; no testimony.',true,'enqueue_bat_sale_snapshot / retry_bat_sale_deferrals');
COMMENT ON TABLE public.bat_sale_capture_deferrals IS 'Operational append events preserving a retained capture while its visible parent FK is busy. No parent/result FK is relaxed; canonical source intake still independently verifies custody. Consumed by existing service claim; assay includes pending deferrals.';
COMMENT ON COLUMN public.bat_sale_capture_deferrals.id IS 'Monotonic operational event PK; distinct concurrent producer events prevent lost wakeups under consumer locks.';
COMMENT ON COLUMN public.bat_sale_capture_deferrals.snapshot_id IS 'Typed FK to preserved retained capture requiring a later eligible-parent work attempt; not inferred vehicle or sale testimony.';
COMMENT ON COLUMN public.bat_sale_capture_deferrals.requested_at IS 'Database deferral request clock; not source capture, sale, qualification or progress time.';
COMMENT ON FUNCTION public.defer_bat_sale_snapshot(uuid) IS 'Internal operational append; callable only by owner functions, no API-role EXECUTE.';
COMMENT ON FUNCTION public.retry_bat_sale_deferrals() IS 'Internal bounded20event SKIP LOCKED retry; a still-busy capture appends a distinct successor before old event removal. Private source/parent checks and work uniqueness retained.';
COMMENT ON FUNCTION public.enqueue_bat_sale_snapshot(uuid) IS 'Existing eligible source/parent checks and typed route; parent KEY SHARE SKIP LOCKED and isolated lock-race savepoint append capture deferrals instead of aborting raw producer or whole seed.';
NOTIFY pgrst,'reload schema';
COMMIT;
