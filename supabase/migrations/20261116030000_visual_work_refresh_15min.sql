-- Visual work build log refresh: every 15 minutes, and a receipts lookup by key in the input digest.
--
-- WHY. The refresh cron (20261116022000) ran every 5 minutes. Its six runs 03:48-04:13Z on 2026-11-12 were all
-- digest no-ops and averaged 1.30 s wall, 1.21 s execution (cron.job_run_details, pg_stat_user_functions): about
-- 350 s a day. Readers already compare the stored digest per call, so the cadence only sets how soon a changed car
-- gets its stored copy back; until then the reader computes live.
-- Measured on prod 2026-11-12, EXPLAIN (ANALYZE, BUFFERS) SELECT visual_work_build_log_refresh() on a fresh
-- connection, warm: 15,282 buffers, 107-112 ms. The cron runs are slower because their pages are cold.
--   input digest: 7,510 buffers, 62 ms execution, 15-30 ms planning; 1,309 of them a sequential scan of receipts,
--     because `id IN (a) OR id IN (b)` cannot use the primary key.
--   enumeration: a BitmapAnd of the structured_data GIN and kind_time indexes, 606 pages, 85 ms cold, 10 ms warm.
--     A partial index would answer it in a few pages, but building one reads the 12 GB heap twice; not worth it
--     for about a third of a cold no-op at 96 runs a day.
--
-- WHAT.
-- 1. The digest reads receipts with one `id IN (a UNION b)`: the same set, by primary key. Digest values are
--    unchanged (the digest hashes row values, not its own source): 103dd6a13cf91142ca63eaad24bc5ecc before and after
--    for 20d21fb0; 7,510 -> 6,384 buffers.
-- 2. The cron runs every 15 minutes at :11 (11-59/15; the 15-minute offset with the fewest other jobs). The refresh
--    rebuilds a row whose valid_until is within 20 minutes (was 10), longer than one period, so a clock-dependent
--    row is rebuilt before it lapses instead of serving live computes until the next run.
-- Reversal: the cron back to '3-58/5', the margin back to 10 minutes and the digest's receipts test back to
-- `id IN (a) OR id IN (b)` (refresh md5 ab84065d09ede2d955b9c9c3e175ed94, digest md5 bd74a5f098645600df87da3a886f3632).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $patch$
DECLARE def text; change record;
BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.visual_work_build_log_refresh(integer)'::regprocedure)
    IS DISTINCT FROM 'ab84065d09ede2d955b9c9c3e175ed94'
  OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.visual_work_build_log_inputs_digest(uuid)'::regprocedure)
    IS DISTINCT FROM 'bd74a5f098645600df87da3a886f3632' THEN
  RAISE EXCEPTION 'Visual work build log refresh or input digest drifted; inspect current owner';
 END IF;

 def:=pg_get_functiondef('public.visual_work_build_log_refresh(integer)'::regprocedure);
 FOR change IN SELECT * FROM (VALUES
  ($old$   IF s_digest IS NOT DISTINCT FROM d AND s_until>now()+interval '10 minutes' THEN fresh:=fresh+1; CONTINUE; END IF;$old$,
   $new$   -- The margin exceeds the 15-minute cron period, so a row is rebuilt before its valid_until lapses.
   IF s_digest IS NOT DISTINCT FROM d AND s_until>now()+interval '20 minutes' THEN fresh:=fresh+1; CONTINUE; END IF;$new$)
 ) changes(old_text,new_text) LOOP
  IF (length(def)-length(replace(def,change.old_text,'')))/length(change.old_text)<>1 THEN
   RAISE EXCEPTION 'Visual work build log refresh anchor drifted';
  END IF;
  def:=replace(def,change.old_text,change.new_text);
 END LOOP;
 EXECUTE def;

 def:=pg_get_functiondef('public.visual_work_build_log_inputs_digest(uuid)'::regprocedure);
 FOR change IN SELECT * FROM (VALUES
  ($old$r.id IN (SELECT (e->>'receipt_id')::uuid FROM rl, u WHERE e->>'receipt_id' ~ u.p) OR r.id IN (SELECT receipt_id FROM items)$old$,
   $new$r.id IN (SELECT (e->>'receipt_id')::uuid FROM rl, u WHERE e->>'receipt_id' ~ u.p UNION SELECT receipt_id FROM items)$new$)
 ) changes(old_text,new_text) LOOP
  IF (length(def)-length(replace(def,change.old_text,'')))/length(change.old_text)<>1 THEN
   RAISE EXCEPTION 'Visual work input digest anchor drifted';
  END IF;
  def:=replace(def,change.old_text,change.new_text);
 END LOOP;
 EXECUTE def;
END $patch$;

DO $cron$
BEGIN
 IF to_regnamespace('cron') IS NOT NULL THEN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='visual-work-build-log-refresh') THEN
   PERFORM cron.unschedule('visual-work-build-log-refresh');
  END IF;
  PERFORM cron.schedule('visual-work-build-log-refresh','11-59/15 * * * *',
   $cmd$SET statement_timeout = '90s'; SET lock_timeout = '3s'; SELECT public.visual_work_build_log_refresh();$cmd$);
 END IF;
END $cron$;
COMMIT;
