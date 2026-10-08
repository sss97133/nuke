-- Existing25-record taxonomy batches finish in0.2–0.5s but leave a growing
-- retained-source backlog. Raise only the vehicle ceiling: the8s loop budget,
--100cache-key seed,500pending backpressure and existing governor remain intact.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='drain-vehicle-taxonomy'
   AND active AND schedule='* * * * *' AND command LIKE '%drain_vehicle_taxonomy_queue()%') THEN
  RAISE EXCEPTION 'Active retained taxonomy minute contract unavailable; preserve owner pause';
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.drain_vehicle_taxonomy_queue() RETURNS jsonb
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
   ORDER BY next_due_at,vehicle_id FOR UPDATE SKIP LOCKED LIMIT 250 LOOP
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
REVOKE ALL ON FUNCTION public.drain_vehicle_taxonomy_queue() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.drain_vehicle_taxonomy_queue() TO service_role;
COMMENT ON FUNCTION public.drain_vehicle_taxonomy_queue() IS 'Service-only bounded materializer: governor/advisory exclusion, retained-cache100-key seed under500 pending, max250 vehicles with unchanged8s stop-new-record budget and20s cron budget, SKIP LOCKED, idempotent source receipts and only differing derived canonical columns. Failures15min/pause3. No provider/model calls, raw testimony or bypass flags. Actual assay distinguishes verifications, projection changes, pending work and source coverage.';
NOTIFY pgrst,'reload schema';
COMMIT;
