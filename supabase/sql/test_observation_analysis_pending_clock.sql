\set ON_ERROR_STOP on
\i supabase/sql/test_registered_retained_analysis.sql
-- A reused legacy row predates its next source arrival by months.
INSERT INTO public.analysis_queue(vehicle_id,status,priority,created_at)
 VALUES('22222222-2222-2222-2222-222222222222','pending',50,now()-interval '200 days');
\i supabase/migrations/20261030184735_retain_analysis_pending_clock.sql
SELECT pg_temp.ok('unfinished pre-clock work remains explicitly unknown, not backdated',
 (SELECT r->>'selected'='1' AND r->>'unknown_pending_clock'='1' AND r->>'oldest_selected_age_seconds' IS NULL
  FROM(SELECT public.analysis_queue_health(NULL,100)r)x));
SELECT public.enqueue_analysis_work('11111111-1111-1111-1111-111111111111','new_arrival','{}',ARRAY['data-quality'],70);
SELECT pg_temp.ok('another arrival cannot erase an unknown earlier obligation',
 (SELECT oldest_pending_at IS NULL AND last_requested_at IS NOT NULL AND analysis_deferred FROM public.analysis_queue
 WHERE vehicle_id='11111111-1111-1111-1111-111111111111'));
SELECT public.enqueue_analysis_work('22222222-2222-2222-2222-222222222222','new_arrival','{}',ARRAY['data-quality'],70);
SELECT pg_temp.ok('new work on an old reusable row receives a current server request clock',
 (SELECT oldest_pending_at>clock_timestamp()-interval '5s' AND last_requested_at>=oldest_pending_at
 AND created_at<clock_timestamp()-interval '100 days' FROM public.analysis_queue WHERE vehicle_id='22222222-2222-2222-2222-222222222222'));
DO $$ DECLARE c public.analysis_queue; at_time timestamptz; r jsonb; iteration integer; BEGIN
 SELECT oldest_pending_at INTO at_time FROM public.analysis_queue WHERE vehicle_id='22222222-2222-2222-2222-222222222222';
 FOR iteration IN 1..2 LOOP
  SELECT * INTO c FROM public.claim_analysis_queue_batch(1,'clock-contract','22222222-2222-2222-2222-222222222222',true);
  IF iteration=1 THEN
   PERFORM public.enqueue_analysis_work(c.vehicle_id,'during_active','{}',ARRAY['data-quality'],70);
   PERFORM pg_temp.ok('concurrent arrival retains the oldest obligation clock',
    (SELECT oldest_pending_at=at_time AND last_requested_at>=at_time FROM public.analysis_queue WHERE id=c.id));
  END IF;
  r:=public.compute_retained_analysis_widget(c.vehicle_id,'data-quality','registered_source_state_v1');
  PERFORM public.record_analysis_queue_signal(c.id,'clock-contract',c.claimed_revision,c.lease_token,
   jsonb_build_object('vehicle_id',c.vehicle_id,'widget_slug','data-quality','score',NULL,'severity','info','value_json',r));
  PERFORM public.finish_analysis_queue_work(c.id,'clock-contract',c.claimed_revision,c.lease_token,ARRAY['data-quality']);
 END LOOP;
 PERFORM pg_temp.ok('completed work leaves the live backlog instead of retaining an old age',
  public.analysis_queue_health(c.vehicle_id,10)->>'selected'='0');
 PERFORM public.enqueue_analysis_work(c.vehicle_id,'new_episode','{}',ARRAY['data-quality'],70);
 PERFORM pg_temp.ok('a later pending episode starts its own clock',
  (SELECT oldest_pending_at>at_time FROM public.analysis_queue WHERE id=c.id));
 PERFORM pg_temp.ok('a request inside the current statement cannot produce a negative age',
  (public.analysis_queue_health(c.vehicle_id,10)->>'p95_selected_age_seconds')::numeric>=0);
END $$;
SELECT pg_temp.ok('new health retains a bounded and qualified age receipt',
 (SELECT r->>'age_basis'='first_unfinished_revision_request' AND r->>'unknown_pending_clock'='0'
  AND (r->>'oldest_selected_age_seconds')::numeric<5 AND NOT (r->>'has_more')::boolean
 FROM(SELECT public.analysis_queue_health('22222222-2222-2222-2222-222222222222',10)r)x));
