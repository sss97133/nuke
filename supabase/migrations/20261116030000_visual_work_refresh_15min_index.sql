SET statement_timeout = '900s';
SET lock_timeout = '180s';
-- Visual work build log refresh: every 15 minutes, a small partial index for its enumeration, and a receipts
-- lookup by key in the input digest.
--
-- WHY. The refresh cron (20261116022000) ran every 5 minutes. Its six runs 03:48-04:13Z on 2026-11-12 were all
-- digest no-ops and averaged 1.30 s wall, 1.21 s execution (cron.job_run_details, pg_stat_user_functions): about
-- 350 s a day. Readers already compare the stored digest per call, so the cadence only sets how soon a changed car
-- gets its stored copy back; until then the reader computes live.
-- Measured on prod 2026-11-12, EXPLAIN (ANALYZE, BUFFERS) SELECT visual_work_build_log_refresh() on a fresh
-- connection, warm: 15,282 buffers, 107-112 ms. The cron runs are slower because their pages are cold.
--   enumeration (and the same test in the stale-row DELETE): BitmapAnd of idx_vobs_structured_data_gin (421 pages)
--     and idx_observations_kind_time (141 pages, 49,507 rows) plus 44 heap pages, to find 41 visual work records;
--     85 ms cold, 10 ms warm.
--   input digest: 7,510 buffers, 62 ms execution, 15-30 ms planning; 1,309 of them a sequential scan of receipts,
--     because `id IN (a) OR id IN (b)` cannot use the primary key.
--
-- WHAT.
-- 1. idx_vobs_visual_work: btree (vehicle_id) WHERE kind='work_record' AND extraction_method='visual_work_v1'. It holds
--    the visual work records only (41 rows today, a few kB). It answers the refresh enumeration, the DELETE's
--    EXISTS and the digest's own records CTE (which tests the same two columns, superseded rows included).
-- 2. The digest reads receipts with one `id IN (a UNION b)`: the same set, by primary key. Digest values are
--    unchanged (the digest hashes row values, not its own source): 103dd6a13cf91142ca63eaad24bc5ecc before and after
--    for 20d21fb0; 7,510 -> 6,384 buffers.
-- 3. The cron runs every 15 minutes at :11 (11-59/15; the 15-minute offset with the fewest other jobs). The refresh
--    rebuilds a row whose valid_until is within 20 minutes (was 10), longer than one period, so a clock-dependent
--    row is rebuilt before it lapses instead of serving live computes until the next run.
--
-- BUILD. As 20261014043000: no outer transaction (the deploy runs psql -f in autocommit; CREATE INDEX CONCURRENTLY
-- cannot run in a block). statement_timeout is this file's first statement, so it governs the build over the deploy's
-- 120 s PGOPTIONS. The concurrent build reads the 12 GB heap twice; that precedent built two indexes on the 10 GB heap
-- in 8 min 24 s. An interrupted build leaves an INVALID index; the conditional drop clears it on a re-run.
-- Reversal: DROP INDEX CONCURRENTLY public.idx_vobs_visual_work; the cron back to '3-58/5'; the margin back to 10
-- minutes and the digest's receipts test back to `id IN (a) OR id IN (b)` (refresh md5 ab84065d09ede2d955b9c9c3e175ed94,
-- digest md5 bd74a5f098645600df87da3a886f3632).

DROP INDEX CONCURRENTLY IF EXISTS public.idx_vobs_visual_work;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vobs_visual_work
  ON public.vehicle_observations (vehicle_id)
  WHERE kind = 'work_record' AND extraction_method = 'visual_work_v1';

DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.idx_vobs_visual_work') AND indisvalid) THEN
    RAISE EXCEPTION 'idx_vobs_visual_work is missing or INVALID after the build; DROP INDEX CONCURRENTLY public.idx_vobs_visual_work and re-run';
  END IF;
END $check$;

COMMENT ON INDEX public.idx_vobs_visual_work IS
'visual_work_v1 work records by vehicle. Answers the visual work build log refresh enumeration and stale-row test and the input digest''s records CTE without the 2.4 GB structured_data GIN index. Built CONCURRENTLY 2026-11-12.';

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
  ($old$   -- The contract containment uses the structured_data GIN index (~40 ms; kind alone read 21k pages).$old$,
   $new$   -- idx_vobs_visual_work answers this (kind and method partial index); the containment filters its rows.$new$),
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
RESET lock_timeout;
RESET statement_timeout;
