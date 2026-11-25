-- bat_stream_probe_v1: the BaT stream handoff is called between closes, and every call is stamped.
--
-- WHY. bat_live_pull_run posts extract-bat-core {mode: live_stream} only in a minute with a closing lot
-- (v_stream_lots > 0). extract-bat-core hands off to ingest-observation (?native_collection_handoff=1), whose
-- closingBatTargets selection refused every run from 2026-11-24 21:08 PT to 2026-11-25 02:45 PT: net._http_response held
-- 304 answers, all HTTP 500 '{"success":false,"error":"bat_live_handoff_http_500"}' (read 2026-11-25 03:15 PT, pg_net
-- ttl 6 h). After 20261125223000 bounded the window there were no closing lots, so the path
-- was not called at all, and the first call on the deployed version would come at the next BaT close (10:00 PT).
--
-- WHAT. A rule row and a patch:
--   1. Rule row live_auction_sources (bat) scraping_config.live_pull.stream_probe = {every_minutes 10, basis}, written
--      only if absent.
--   2. bat_live_pull_run, in place (sha256 of the live body after 20261125223000 and 20261125213500, anchors once each):
--      a. In a minute with no closing lot, when the newest stamped call is older than every_minutes (or there is none),
--         it posts the same handoff with dry_run true. In a minute with a closing lot it posts the real handoff only, as
--         before: the probe never runs then. A dry run selects the targets and returns them; the collector, the only
--         code that contacts BaT, runs for accepted targets only, and dry_run is never accepted. Contracts on main that
--         fail if it were: batLiveCollector.test.ts "canonical collector dry-run and idle preserve target preview
--         without launching work" (accepted false, no background task, no socket) and liveStream.test.ts (the handoff
--         forwards dry_run true). Absent or malformed every_minutes: no probe (the rule before).
--      b. Every stream or probe call is stamped in live_pull.stream_calls, the newest 5 kept:
--         {request_id, at, kind stream|probe, targets}. The puller rewrites live_pull as
--         (live_pull - 'rest_probes') || {...}, so the key persists between calls.
--   The reader of those stamps and their answers (net._http_response) is a separate job, stacked on 20261125090700.
--
-- BASIS. every_minutes 10: 144 dry runs a day, no BaT contact; a broken path answers within 10 minutes of breaking.
--
-- REVERT. Remove live_pull.stream_probe: the probe stops (stream_calls stays as data). Re-create bat_live_pull_run from
-- the body hashed below to drop the stamp.

SET lock_timeout = '5s';

UPDATE public.live_auction_sources
SET scraping_config = jsonb_set(coalesce(scraping_config, '{}'::jsonb), '{live_pull}',
      coalesce(scraping_config -> 'live_pull', '{}'::jsonb) || jsonb_build_object('stream_probe', jsonb_build_object(
        'every_minutes', 10,
        'basis', 'every 10 min: 144 dry runs a day with no BaT contact (dry_run is never accepted, so the collector does '
                 || 'not start); a broken handoff answers within 10 min of breaking')))
WHERE slug = 'bat'
  AND scraping_config #> '{live_pull,stream_probe}' IS NULL;

DO $patch$
DECLARE
  sig  text := 'public.bat_live_pull_run(integer,boolean)';
  body text;
  n    int;
  a1   text := $a$  IF v_stream_lots>0 THEN
    v_stream_req:=net.http_post(url:=v_base||'/functions/v1/extract-bat-core',
      headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key),
      body:=jsonb_build_object('mode','live_stream'),timeout_milliseconds:=150000);
  END IF;$a$;
  r1   text := $r$  -- bat_stream_probe_v1: with no lot closing, a dry run of the same handoff at most every
  -- live_pull.stream_probe.every_minutes (the collector, the only code that contacts BaT, runs for accepted targets
  -- only), so the deployed path answers between closes. Every call is stamped in live_pull.stream_calls.
  IF v_stream_lots>0
     OR (CASE WHEN v_cfg #>> '{stream_probe,every_minutes}' ~ '^[0-9]{1,4}$'
              THEN coalesce(CASE WHEN pg_input_is_valid(v_cfg #>> '{stream_calls,-1,at}', 'timestamp with time zone')
                                 THEN (v_cfg #>> '{stream_calls,-1,at}')::timestamptz END, '-infinity'::timestamptz)
                   <= v_now - make_interval(mins => (v_cfg #>> '{stream_probe,every_minutes}')::integer)
              ELSE false END) THEN
    v_stream_req:=net.http_post(url:=v_base||'/functions/v1/extract-bat-core',
      headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key),
      body:=jsonb_build_object('mode','live_stream')
            ||CASE WHEN v_stream_lots>0 THEN '{}'::jsonb ELSE '{"dry_run":true}'::jsonb END,timeout_milliseconds:=150000);
  END IF;$r$;
  a2   text := $a$(coalesce(scraping_config -> 'live_pull', '{}'::jsonb) - 'rest_probes') || jsonb_build_object($a$;
  r2   text := $r$(coalesce(scraping_config -> 'live_pull', '{}'::jsonb) - 'rest_probes')
        || CASE WHEN v_stream_req IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('stream_calls',
             (SELECT coalesce(jsonb_agg(c.e ORDER BY c.o), '[]'::jsonb)
                FROM (SELECT t.e, t.o, count(*) OVER () AS n
                        FROM jsonb_array_elements(
                               CASE WHEN jsonb_typeof(scraping_config #> '{live_pull,stream_calls}') = 'array'
                                    THEN scraping_config #> '{live_pull,stream_calls}' ELSE '[]'::jsonb END
                               || jsonb_build_array(jsonb_build_object('request_id', v_stream_req, 'at', v_now,
                                    'kind', CASE WHEN v_stream_lots>0 THEN 'stream' ELSE 'probe' END,
                                    'targets', v_stream_lots))) WITH ORDINALITY t(e, o)) c
               WHERE c.o > c.n - 5)) END
        || jsonb_build_object($r$;
BEGIN
  body := pg_get_functiondef(sig::regprocedure);
  IF position('bat_stream_probe_v1' IN body) > 0 THEN RETURN; END IF;
  IF encode(sha256(convert_to(body, 'UTF8')), 'base64') <> 'MM/n9x0BCWeA+bP7MkVV3jjq0UGWGtH07VLsqx2nrEk=' THEN
    RAISE EXCEPTION 'bat_stream_probe: bat_live_pull_run differs from the body read on 2026-11-25 11:15Z; rebase on the live body';
  END IF;
  n := (length(body) - length(replace(body, a1, ''))) / length(a1);
  IF n <> 1 THEN RAISE EXCEPTION 'bat_stream_probe anchor 1 drifted: % matches', n; END IF;
  n := (length(body) - length(replace(body, a2, ''))) / length(a2);
  IF n <> 1 THEN RAISE EXCEPTION 'bat_stream_probe anchor 2 drifted: % matches', n; END IF;
  EXECUTE replace(replace(body, a1, r1), a2, r2);
END
$patch$;
