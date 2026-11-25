-- Two views that make a stall of the pg_cron launcher visible: one row per stall, naming the job that caused it.
--
-- WHY. pg_cron runs here without background workers (cron.use_background_workers = off), so the launcher reads each
-- job's results over libpq. When a multi-statement command raises a NOTICE mid-run, the server flushes the results it
-- has so far. The launcher reads them and then waits for the rest of that job's results. While it waits it starts
-- no job. Measured 2026-11-18..25: job 526 stopped every start for 194-328 s each night at 04:25Z, and job 646 for
-- 149-236 s at 09:22Z (fixed by 20261125041500 and 20261125051500). Nothing in the system reported either stall.
--
-- v_cron_launcher_stalls: one row for each gap of more than 90 s between consecutive starts in
--   cron.job_run_details over the last 48 hours. The 30-second model-fold-tick keeps a healthy gap at 72 s or less.
--   blocking_jobid is the earliest-ending multi-statement run that spans the gap. The launcher records a run's
--   end_time when it reads the result, so the blocking job's end_time lands first, at the gap's end, and the jobs
--   stuck behind it end later. running lists every run that spans the gap, with its statement count.
-- v_cron_notice_risk: active multi-statement cron commands that do not begin with SET client_min_messages, and that
--   call, up to three levels deep, a public function whose body runs DROP/CREATE ... IF [NOT] EXISTS,
--   ADD COLUMN IF NOT EXISTS, or RAISE NOTICE/WARNING/INFO. A command that begins with
--   SET client_min_messages = error cannot stall the launcher this way.
--   Read 2026-11-25 05:3xZ: 14 jobs. 645 and 646 (map_facts folds), 744-746 (spec_landing_drain_v1 >
--   data_set_membership_plan_v2), 499, 500, 574, 681, 694, 724, 731, 736, 741.
--
-- Morning check: select * from v_cron_launcher_stalls returns 0 rows on a night with no stall.
-- Reads only cron.job and cron.job_run_details. Grants: service_role only (cron commands are internal).
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE VIEW public.v_cron_launcher_stalls AS
WITH s AS (
  SELECT d.start_time, lag(d.start_time) OVER (ORDER BY d.start_time) AS prev
    FROM cron.job_run_details d
   WHERE d.start_time > now() - interval '48 hours'
), g AS (
  SELECT s.prev AS gap_start, s.start_time AS gap_end, extract(epoch FROM s.start_time - s.prev)::int AS gap_s
    FROM s
   WHERE s.start_time - s.prev > interval '90 seconds'
), sp AS (
  SELECT g.gap_start, d.jobid, j.jobname, d.end_time,
         array_length(regexp_split_to_array(regexp_replace(coalesce(j.command, ''), ';\s*$', ''), ';'), 1) AS statements
    FROM g
    JOIN cron.job_run_details d
      ON d.start_time > g.gap_start - interval '6 hours' AND d.start_time <= g.gap_start
     AND d.end_time >= g.gap_end - interval '5 seconds'
    LEFT JOIN cron.job j ON j.jobid = d.jobid
)
SELECT g.gap_start, g.gap_end, g.gap_s,
       (SELECT sp.jobid FROM sp WHERE sp.gap_start = g.gap_start AND sp.statements > 1
         ORDER BY sp.end_time, sp.jobid LIMIT 1) AS blocking_jobid,
       (SELECT sp.jobname FROM sp WHERE sp.gap_start = g.gap_start AND sp.statements > 1
         ORDER BY sp.end_time, sp.jobid LIMIT 1) AS blocking_jobname,
       (SELECT jsonb_agg(jsonb_build_object('jobid', sp.jobid, 'jobname', sp.jobname, 'statements', sp.statements,
                                            'end_time', sp.end_time) ORDER BY sp.end_time, sp.jobid)
          FROM sp WHERE sp.gap_start = g.gap_start) AS running
  FROM g;

COMMENT ON VIEW public.v_cron_launcher_stalls IS
  'One row per gap of more than 90 s between pg_cron starts in the last 48 h; blocking_jobid is the earliest-ending multi-statement run spanning it. 0 rows = no launcher stall. 20261125053000.';

CREATE OR REPLACE VIEW public.v_cron_notice_risk AS
WITH RECURSIVE j AS (
  SELECT j.jobid, j.jobname, j.command,
         array_length(regexp_split_to_array(regexp_replace(j.command, ';\s*$', ''), ';'), 1) AS statements
    FROM cron.job j
   WHERE j.active AND j.command !~* '^\s*set\s+client_min_messages'
), calls(jobid, fn, depth, path) AS (
  SELECT DISTINCT j.jobid, lower(m[1]) COLLATE "C", 1, lower(m[1]) COLLATE "C"
    FROM j CROSS JOIN LATERAL regexp_matches(j.command, '([a-z_][a-z0-9_]*)\s*\(', 'gi') m
   WHERE j.statements > 1
  UNION
  SELECT c.jobid, lower(m[1]) COLLATE "C", c.depth + 1, (c.path || '>' || lower(m[1])) COLLATE "C"
    FROM calls c
    JOIN pg_proc p ON p.proname = c.fn AND p.pronamespace = 'public'::regnamespace AND p.prolang <> 13
    CROSS JOIN LATERAL regexp_matches(p.prosrc, '([a-z_][a-z0-9_]*)\s*\(', 'gi') m
   WHERE c.depth < 3 AND lower(m[1]) <> c.fn
     AND EXISTS (SELECT 1 FROM pg_proc q WHERE q.proname = lower(m[1]) AND q.pronamespace = 'public'::regnamespace)
)
SELECT j.jobid, j.jobname, j.statements,
       array_agg(DISTINCT c.path ORDER BY c.path) AS raising_paths
  FROM j
  JOIN calls c ON c.jobid = j.jobid
  JOIN pg_proc p ON p.proname = c.fn AND p.pronamespace = 'public'::regnamespace AND p.prolang <> 13
 WHERE p.prosrc ~* '((drop|create)\s+(temp\s+|temporary\s+|unlogged\s+)?(table|index|view|materialized view|sequence|type|schema)\s+if\s+(not\s+)?exists|add\s+column\s+if\s+not\s+exists|raise\s+(notice|warning|info))'
 GROUP BY j.jobid, j.jobname, j.statements;

COMMENT ON VIEW public.v_cron_notice_risk IS
  'Active multi-statement cron commands without a leading SET client_min_messages whose functions (3 levels) can raise a notice; each can stall the pg_cron launcher until it ends. Fix: prefix SET client_min_messages = error. 20261125053000.';

REVOKE ALL ON public.v_cron_launcher_stalls, public.v_cron_notice_risk FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_cron_launcher_stalls, public.v_cron_notice_risk TO service_role;
