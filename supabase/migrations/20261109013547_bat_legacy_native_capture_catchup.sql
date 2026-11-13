-- One capability catchup for successful pre-rich-intake reads. The fixed cutoff
-- is PR3100's successful Supabase deploy42517883738, not a recurring cadence.
-- Dispatch advances last_synced_at beyond it even if that attempt later fails.
SELECT current_setting('statement_timeout') AS statement_timeout,
       current_setting('lock_timeout') AS lock_timeout \gset bat_legacy_prior_
SELECT set_config('statement_timeout',CASE WHEN current_setting('statement_timeout')::interval=interval '0'
 OR current_setting('statement_timeout')::interval>interval '10 seconds' THEN '10s' ELSE current_setting('statement_timeout') END,false);
SELECT set_config('lock_timeout',CASE WHEN current_setting('lock_timeout')::interval=interval '0'
 OR current_setting('lock_timeout')::interval>interval '2 seconds' THEN '2s' ELSE current_setting('lock_timeout') END,false);
DO $repair$
DECLARE body text:=pg_get_functiondef('public.bat_live_pull_run(integer,boolean)'::regprocedure);
 anchor text:=$old$AND (m.next_poll_at IS NULL OR m.next_poll_at <= v_now
               -- Current cadence transition;$old$;
 replacement text:=$new$AND (m.next_poll_at IS NULL OR m.next_poll_at <= v_now
               -- One-time native payload capability catchup; normal dispatch fences repeat attempts.
               OR (m.last_synced_at < timestamptz '2026-11-08 20:01:29+00'
                   AND m.sync_latency_ms IS NOT NULL
                   AND m.last_comment_synced_at >= m.last_synced_at
                   AND m.auction_end_time > v_now + interval '10 minutes'
                   AND nullif(m.stream_state->>'last_observation_id','') IS NULL
                   AND EXISTS (SELECT 1 FROM public.auction_events legacy
                     WHERE legacy.vehicle_id=m.vehicle_id AND legacy.source='bat'
                       AND legacy.source_url IN (rtrim(m.external_auction_url,'/'),rtrim(m.external_auction_url,'/')||'/')
                       AND legacy.outcome='live' AND legacy.high_bid>0 AND legacy.total_bids>0
                       AND legacy.scraped_at>=m.last_synced_at AND legacy.auction_end_date>v_now))
               -- Current cadence transition;$new$;
BEGIN
 IF strpos(body,replacement)>0 THEN RETURN; END IF;
 IF (length(body)-length(replace(body,anchor,'')))/length(anchor)<>1 THEN
   RAISE EXCEPTION 'Unexpected BaT due predicate; inspect before replacing';
 END IF;
 EXECUTE replace(body,anchor,replacement);
END;
$repair$;
SET statement_timeout = :'bat_legacy_prior_statement_timeout';
SET lock_timeout = :'bat_legacy_prior_lock_timeout';
