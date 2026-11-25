-- bat_stream_window_v1: the native BaT stream's closing window gets a lower bound, held in one rule row that the edge
-- collector (ingest-observation closingBatTargets) and the minute puller (bat_live_pull_run's stream count) both read.
--
-- WHY. closingBatTargets selects monitored_auctions rows of source bat that are is_live (or got a terminal frame in the
-- last 2 min) with auction_end_time <= now + 15 min, and refuses the whole run when more than 200 qualify
-- (bat_closing_coverage_unavailable_or_over_capacity). The window had no lower bound, so lots that ended days ago and
-- were never settled count as closing. From 2026-11-12 to 2026-11-25 09:53Z every BaT outcome write failed (fixed by
-- 20261125084210), 1,655 ended lots stayed is_live (read-only, 2026-11-25 10:00Z), and extract-bat-core live_stream
-- has answered HTTP 500 every minute since: the stream that covers lots in their last minutes is down while 10:00 PT
-- (18:00Z, the next live end) approaches. The puller counted the same set and posted a stream request every minute.
--
-- WHAT.
--   1. Rule row: live_auction_sources (slug bat) scraping_config.live_pull.stream_window =
--      {lookback_minutes: 120, basis, measured_at, replaced_by}. The puller rewrites live_pull every minute as
--      (live_pull - 'rest_probes') || {run_samples, last_run}, so the key persists.
--   2. bat_live_pull_run's stream count gains the same bound, read from v_cfg (that row's live_pull), in place: the
--      body must hash to the live body read on 2026-11-25 10:50Z (after 20261125174500) and the anchor must occur once.
-- Absent or malformed lookback (not 1-5 digits): no lower bound in either reader, the rule before this row; neither
-- reader carries its own number.
--
-- BASIS of 120 minutes (read-only, 2026-11-25): of 7,978 BaT monitors retired with a stream terminal frame (ends
-- 2026-10-04 .. 2026-11-24), end to terminal_received_at is p50 0.03 min, p90 2.0 min, p99 1,092 min; 650 took over
-- 30 min and 597 of those over 2 h, i.e. 53 (0.7%) landed between 30 min and 2 h. Past 2 h the result comes from the
-- HTML settle paths (the puller's closing slot, bat-settlement-drain), not the stream. The bound is a stopgap: the
-- per-lot resolution stamp (monitored_lot_resolutions, 20261125090700) replaces it when it lands.

SET lock_timeout = '5s';

UPDATE public.live_auction_sources
SET scraping_config = jsonb_set(coalesce(scraping_config, '{}'::jsonb), '{live_pull}',
      coalesce(scraping_config -> 'live_pull', '{}'::jsonb) || jsonb_build_object('stream_window', jsonb_build_object(
        'lookback_minutes', 120,
        'basis', 'BaT monitors retired with a stream terminal frame, ends 2026-10-04..2026-11-24 (n 7,978): end to '
                 || 'terminal_received_at p50 0.03 min, p90 2.0 min, p99 1,092 min; 53 (0.7%) between 30 min and 2 h; '
                 || 'later results come from HTML settle reads, not the stream',
        'measured_at', '2026-11-25',
        'replaced_by', 'monitored_lot_resolutions (20261125090700)')))
WHERE slug = 'bat'
  AND scraping_config #> '{live_pull,stream_window}' IS NULL;

DO $patch$
DECLARE
  sig  text := 'public.bat_live_pull_run(integer,boolean)';
  body text;
  n    int;
  a    text := $a$      AND auction_end_time<=v_now+interval '15 minutes';
  IF v_stream_lots>0 THEN$a$;
  r    text := $r$      AND auction_end_time<=v_now+interval '15 minutes'
      -- bat_stream_window_v1: the lower bound closingBatTargets reads from the same row (live_pull.stream_window).
      AND (coalesce(v_cfg #>> '{stream_window,lookback_minutes}', '') !~ '^\d{1,5}$'
           OR auction_end_time>=v_now-make_interval(mins => CASE WHEN v_cfg #>> '{stream_window,lookback_minutes}' ~ '^\d{1,5}$'
                                                             THEN (v_cfg #>> '{stream_window,lookback_minutes}')::integer END));
  IF v_stream_lots>0 THEN$r$;
BEGIN
  body := pg_get_functiondef(sig::regprocedure);
  IF position('bat_stream_window_v1' IN body) > 0 THEN RETURN; END IF;
  IF encode(sha256(convert_to(body, 'UTF8')), 'base64') <> '6kRsloXMB8yA3DAl9HrJnJTUJbl8eCSdvHqnFSPD3VE=' THEN
    RAISE EXCEPTION 'bat_stream_window: bat_live_pull_run differs from the body read on 2026-11-25 10:50Z; rebase on the live body';
  END IF;
  n := (length(body) - length(replace(body, a, ''))) / length(a);
  IF n <> 1 THEN RAISE EXCEPTION 'bat_stream_window anchor drifted: % matches', n; END IF;
  EXECUTE replace(body, a, r);
END
$patch$;
