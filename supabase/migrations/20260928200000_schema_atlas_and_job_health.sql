-- v_schema_atlas + v_job_health: the database describes itself.
-- Approved by Skylar 2026-09-25 and written then, but not shipped (the database was starved that
-- day). Shipped 2026-09-28 as step 1 of the ontology drill: every table's live activity, size, links,
-- description coverage, owners and writers, computed from the catalog so it cannot go stale.
--
-- SCHEMA_LAW pre-mint checklist:
--  1. Search (2026-09-25; re-checked 2026-09-28: 0 relations named %atlas%): no table-level atlas or
--     per-job health read model exists. Nearest: v_write_pulse (writes only), queue_lock_health
--     (locks only), pipeline_registry (fields only). These views join those; they replace none.
--  2. Not a fact class: derived read models over the catalog and existing ledgers.
--  3. No testimony, no DNA columns.
--  4. Views: zero storage.
--  5. Read-only; no invariants.
--  6. No writers.
--  7. CI-applied migration; operator data, SELECT for service_role only.
--
-- Measured on prod 2026-09-28 with these exact bodies (read-only):
--  - v_schema_atlas: 924 tables in ~1 s. Since statistics reset (cluster restored 2026-09-24):
--    96 written, 328 only read, 500 idle. 483 tables and 2,957 of 16,394 columns carry a
--    description; 36 tables have pipeline_registry owners; 3 have declared writers in
--    write_receipts (30 d); 3 are named by an active cron (crons mostly call functions, so the
--    name match misses cron -> function -> table paths).
--  - v_job_health: 143 jobs in ~3 s; 23 active; 4 failing in the last 24 h; 6 on a streak of 3+
--    failures; longest streak 195.

SET statement_timeout = '60s';
SET lock_timeout = '10s';

CREATE OR REPLACE VIEW public.v_schema_atlas AS
WITH t AS (
  SELECT c.oid, c.relname AS table_name, c.reltuples::bigint AS est_rows,
         (c.relpages + coalesce(tc.relpages, 0))::bigint * current_setting('block_size')::bigint AS heap_toast_bytes,
         obj_description(c.oid, 'pg_class') AS purpose
  FROM pg_class c LEFT JOIN pg_class tc ON tc.oid = c.reltoastrelid
  WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
),
cols AS (
  SELECT a.attrelid AS oid, count(*) AS n_cols,
         count(*) FILTER (WHERE d.description IS NOT NULL) AS n_cols_described
  FROM pg_attribute a
  JOIN t ON t.oid = a.attrelid
  LEFT JOIN pg_description d ON d.objoid = a.attrelid AND d.classoid = 'pg_class'::regclass AND d.objsubid = a.attnum
  WHERE a.attnum > 0 AND NOT a.attisdropped
  GROUP BY 1
),
act AS (
  SELECT relid AS oid, n_tup_ins + n_tup_upd + n_tup_del AS writes,
         coalesce(seq_scan, 0) + coalesce(idx_scan, 0) AS reads
  FROM pg_stat_user_tables WHERE schemaname = 'public'
),
fk_out AS (SELECT conrelid AS oid, count(*) AS n, array_agg(DISTINCT confrelid::regclass::text) AS parents FROM pg_constraint WHERE contype = 'f' GROUP BY 1),
fk_in AS (SELECT confrelid AS oid, count(*) AS n FROM pg_constraint WHERE contype = 'f' GROUP BY 1),
trg AS (SELECT tgrelid AS oid, count(*) AS n FROM pg_trigger WHERE NOT tgisinternal GROUP BY 1),
reg AS (SELECT table_name, count(*) AS fields, array_agg(DISTINCT owned_by) AS owners FROM public.pipeline_registry GROUP BY 1),
wr AS (SELECT tbl, array_agg(DISTINCT writer) AS writers, count(*) FILTER (WHERE writer = 'undeclared') AS undeclared_stmts, max(at) AS last_write
       FROM public.write_receipts WHERE at > now() - interval '30 days' GROUP BY 1),
cr AS (SELECT t.table_name, array_agg(j.jobname ORDER BY j.jobname) AS crons FROM t JOIN cron.job j ON j.active AND j.command ~* ('\m' || t.table_name || '\M') GROUP BY 1)
SELECT t.table_name,
       CASE WHEN coalesce(act.writes, 0) > 0 THEN 'written' WHEN coalesce(act.reads, 0) > 0 THEN 'read-only' ELSE 'idle' END AS activity,
       act.writes AS writes_since_stats_reset,
       act.reads  AS reads_since_stats_reset,
       t.est_rows, t.heap_toast_bytes,
       cols.n_cols, cols.n_cols_described,
       coalesce(fo.n, 0) AS fk_out, fo.parents AS fk_parents, coalesce(fi.n, 0) AS fk_in,
       coalesce(trg.n, 0) AS triggers,
       t.purpose,
       reg.fields AS registry_fields, reg.owners AS registry_owners,
       wr.writers AS writers_30d, wr.undeclared_stmts AS undeclared_stmts_30d, wr.last_write,
       cr.crons AS crons_mentioning
FROM t
LEFT JOIN cols ON cols.oid = t.oid
LEFT JOIN act  ON act.oid = t.oid
LEFT JOIN fk_out fo ON fo.oid = t.oid
LEFT JOIN fk_in  fi ON fi.oid = t.oid
LEFT JOIN trg       ON trg.oid = t.oid
LEFT JOIN reg       ON reg.table_name = t.table_name
LEFT JOIN wr        ON wr.tbl = t.table_name
LEFT JOIN cr        ON cr.table_name = t.table_name;

COMMENT ON VIEW public.v_schema_atlas IS
  'One row per public table. activity = written / read-only / idle from pg_stat_user_tables since statistics reset (counters in writes_ and reads_since_stats_reset); est rows and heap+toast bytes; columns and columns described; FK in/out; triggers; purpose (table COMMENT); pipeline_registry owners; declared writers (write_receipts, 30 d); active crons naming it. Computed live from the catalog. 2026-09-28.';

CREATE OR REPLACE VIEW public.v_job_health AS
WITH runs AS (
  SELECT d.jobid, d.status, d.start_time, d.return_message,
         row_number() OVER (PARTITION BY d.jobid ORDER BY d.start_time DESC) AS rn
  FROM cron.job_run_details d
  WHERE d.start_time > now() - interval '7 days'
),
first_ok AS (
  SELECT jobid, min(rn) AS rn FROM runs WHERE status <> 'failed' GROUP BY jobid
),
streak AS (
  SELECT r.jobid, count(*) AS n
  FROM runs r LEFT JOIN first_ok f USING (jobid)
  WHERE r.status = 'failed' AND r.rn < coalesce(f.rn, 2147483647)
  GROUP BY r.jobid
),
day AS (
  SELECT jobid, count(*) AS runs_24h, count(*) FILTER (WHERE status = 'failed') AS failed_24h
  FROM runs WHERE start_time > now() - interval '24 hours' GROUP BY jobid
),
last_run AS (
  SELECT jobid, status AS last_status, start_time AS last_run_at FROM runs WHERE rn = 1
),
last_err AS (
  SELECT DISTINCT ON (jobid) jobid, left(return_message, 300) AS last_error
  FROM runs WHERE status = 'failed' ORDER BY jobid, start_time DESC
)
SELECT j.jobid,
       j.jobname,
       j.schedule,
       j.active,
       coalesce(day.runs_24h, 0)   AS runs_24h,
       coalesce(day.failed_24h, 0) AS failed_24h,
       coalesce(s.n, 0)            AS consecutive_failures,
       lr.last_status,
       lr.last_run_at,
       le.last_error,
       substring(j.command FROM 'app\.writer''\s*,\s*''([^'']+)') AS declared_writer,
       left(regexp_replace(j.command, '\s+', ' ', 'g'), 200) AS command
FROM cron.job j
LEFT JOIN day          ON day.jobid = j.jobid
LEFT JOIN streak s     ON s.jobid = j.jobid
LEFT JOIN last_run lr  ON lr.jobid = j.jobid
LEFT JOIN last_err le  ON le.jobid = j.jobid;

COMMENT ON VIEW public.v_job_health IS
  'One row per pg_cron job: 24 h runs and failures, consecutive-failure streak (7 d window), last status and error, declared app.writer. 2026-09-28.';

REVOKE ALL ON public.v_schema_atlas, public.v_job_health FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_schema_atlas, public.v_job_health TO service_role;
