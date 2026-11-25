-- v_job_health: a job with its own fresh failed assay reads failed, whatever its last run did.
--
-- WHY. Since 20261125213500 a job with no special-cased assay shows its fresh job_assay_readings row as assay and
-- assay_status, but health_status still reads 'passed' on a succeeded run, so a job whose own assay says it is failing
-- its purpose (a read limit set too high, a backlog) shows green. health_status now takes the worse of the run and the
-- job's own fresh assay: a fresh row with status 'failed' reads 'failed'.
--
-- WHAT. One CASE arm, added just before the generic "last run succeeded -> passed" arm, so the special-cased jobs
-- (bat-live-pull and the six drains and qualifiers above it) and paused jobs keep their own rules. A stale row (older
-- than its fresh_for) is not read, as before. The view is patched from its live definition by anchor (the
-- 20261125213500 pattern) and stops if the anchor drifted; re-applying it changes nothing.
--
-- Measured read-only, 2026-11-25 06:35 PT: 14 job_assay_readings rows; the 4 'failed' ones belong to special-cased jobs
-- already reading failed, so no job changes colour at deploy. The first generic job it covers is
-- vehicle-labor-appraisal-seed (its read-limit assay, #3988).
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $view$
DECLARE
  d text := pg_get_viewdef('public.v_job_health'::regclass);
  anchor text := 'WHEN \(lr\.last_status = ''succeeded''::text\) THEN ''passed''::text\s+ELSE ''unknown''::text\s+END AS health_status';
  done_mark text := 'own_fail\.assayed_at';
  n int;
BEGIN
  IF d ~ done_mark THEN RETURN; END IF;
  n := (SELECT count(*) FROM regexp_matches(d, anchor, 'g'));
  IF n <> 1 THEN RAISE EXCEPTION 'v_job_health health_status anchor drifted: % matches', n; END IF;
  d := regexp_replace(d, anchor,
    'WHEN ((SELECT own_fail.reading ->> ''status'' FROM job_assay_readings own_fail WHERE own_fail.jobname = j.jobname '
    || 'AND own_fail.assayed_at > statement_timestamp() - own_fail.fresh_for) = ''failed'') THEN ''failed''::text '
    || 'WHEN (lr.last_status = ''succeeded''::text) THEN ''passed''::text ELSE ''unknown''::text END AS health_status');
  EXECUTE 'CREATE OR REPLACE VIEW public.v_job_health AS ' || d;
END
$view$;

DO $chk$
BEGIN
  IF pg_get_viewdef('public.v_job_health'::regclass) !~ 'own_fail\.assayed_at' THEN
    RAISE EXCEPTION 'v_job_health: worst-of arm not applied';
  END IF;
END
$chk$;

COMMIT;
