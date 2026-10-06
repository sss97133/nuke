-- C28 (docs/ledger/theory/data-machine-cases.md section 12, proposal 1): the repair backlog as a view.
--
-- WHY. The next repair was chosen by a lead reading PLAN.md and lane memos. The ranking existed only as a read-only
-- script (scripts/discovery/repair-backlog.sql, PR #701). The case says: extend v_residual into that ranked view
-- rather than adding a second view. This replaces the C25 island view (20261001000500): one row per live table
-- instead of one row per island, residual_kind replaced by the gaps array, the rank computed in the view.
--
-- WHAT. public.v_residual, one row per table in schema public that is non-empty (est_rows > 0), not idle (a write or a
-- scan counted since the statistics reset) and not scratch-named (leading underscore, zz_backup*, scratch*). The five
-- gap rules are those of repair-backlog.sql, unchanged: describe, key, owner, reader, assay. No ORDER BY and no
-- LIMIT: readers order by rank_mrows desc, est_rows desc and limit. A table with no open gap stays in the view with
-- gaps = '{}' and n_gaps = 0, so "complete" is visible and the denominator is the view's own row count.
--
-- SHAPE CHANGE: DROP VIEW then CREATE VIEW in one transaction. CREATE OR REPLACE VIEW cannot remove residual_kind,
-- change a column type or reorder columns, and the ranked columns belong first. Verified live 2026-10-06 (read-only,
-- through scripts/data/q.sh): no view, materialized view or rule depends on v_residual (pg_depend, pg_rewrite); no
-- function body, cron command, view or materialized view definition names it; the repo has no reader (docs and its
-- creating migration only). The DROP has no CASCADE and no IF EXISTS: a dependent that appears before this runs, or a
-- missing view, aborts the transaction and the C25 view stays.
--
-- ACCESS. v_schema_atlas and v_job_health are service_role only. v_residual is readable by anon and authenticated as
-- well today (Supabase default privileges gave those roles every table privilege on it; the live ACL was read on
-- 2026-10-06), because a view runs with its owner's rights. This migration keeps the same three roles and narrows each
-- to SELECT: the view is not updatable, so the other privileges did nothing. Whether anon and authenticated should read
-- the backlog at all is the owner's call: REVOKE SELECT ON public.v_residual FROM anon, authenticated closes it. A view
-- has no RLS.
--
-- MEASURED 2026-10-06T21:12:39Z (this file's SELECT body, run read-only through scripts/data/q.sh; nothing written):
-- 384 rows (81 written, 303 read-only), 7 with no open gap. Open gaps: describe 369, key 90, owner 66, assay 3, reader 0.
-- Rows by n_gaps: 0 -> 7, 1 -> 242, 2 -> 120, 3 -> 14, 4 -> 1. The top 50 by rank_mrows matched the top 50 of
-- repair-backlog.sql (same tables, gap counts and ranks) when both were run at about 21:00Z. Of the 175 rows of the C25
-- view, 82 stay (10 written, 72 read-only); 75 idle islands (0.76M rows) and 18 scratch-named ones (1.15M rows) leave
-- the view and remain in v_schema_atlas. The live database moves between reads (385 rows at 21:02Z, 384 at 21:12Z).
--
-- CONTRACT TEST: supabase/sql/test_residual_ranked_backlog.sql (PostgreSQL 17 in CI) applies this file over a copy of
-- the C25 view with stub atlas and job-health tables, then checks columns, gap rules, scope and grants.
--
-- LIMITS (also in the comments below). est_rows are planner estimates. Reads and writes count since the last
-- statistics reset, and a reset moves every table not touched since out of the view. A declared owner is a
-- declaration, not verified responsibility. crons_mentioning is a name match, not proof that a job writes the table.
-- The reader gap counts any scan, so it fires only when nothing has scanned a written table. Absence of a gap is not
-- semantic completeness. Event and ingest clocks and text-to-key match rates are not measured here.

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

DROP VIEW public.v_residual;

CREATE VIEW public.v_residual AS
WITH assayed AS (
  SELECT jobname
  FROM public.v_job_health
  WHERE active AND assay_status IS NOT NULL
), live AS (
  SELECT a.table_name, a.activity, a.est_rows, a.heap_toast_bytes, a.n_cols, a.n_cols_described,
         a.writes_since_stats_reset, a.reads_since_stats_reset, a.last_write, a.writers_30d,
         a.crons_mentioning, a.purpose, a.fk_in, a.fk_out, a.registry_fields, a.undeclared_stmts_30d
  FROM public.v_schema_atlas a
  WHERE coalesce(a.est_rows, 0) > 0
    AND a.activity <> 'idle'
    AND a.table_name NOT LIKE '\_%'
    AND a.table_name NOT LIKE 'zz_backup%'
    AND a.table_name NOT LIKE 'scratch%'
), flagged AS (
  SELECT l.*,
         array_remove(ARRAY[
           CASE WHEN coalesce(l.n_cols_described, 0) < coalesce(l.n_cols, 0) OR l.purpose IS NULL THEN 'describe' END,
           CASE WHEN coalesce(l.fk_in, 0) + coalesce(l.fk_out, 0) = 0 THEN 'key' END,
           CASE WHEN l.activity = 'written'
                 AND (coalesce(l.registry_fields, 0) = 0 OR coalesce(l.undeclared_stmts_30d, 0) > 0) THEN 'owner' END,
           CASE WHEN l.activity = 'written' AND coalesce(l.reads_since_stats_reset, 0) = 0 THEN 'reader' END,
           CASE WHEN coalesce(cardinality(l.crons_mentioning), 0) > 0
                 AND NOT EXISTS (SELECT 1 FROM assayed s WHERE s.jobname = ANY (l.crons_mentioning)) THEN 'assay' END
         ], NULL) AS gaps
  FROM live l
)
SELECT f.table_name,
       f.activity,
       f.est_rows,
       coalesce(f.n_cols, 0) - coalesce(f.n_cols_described, 0) AS cols_undescribed,
       f.gaps,
       cardinality(f.gaps) AS n_gaps,
       round(f.est_rows * cardinality(f.gaps) / 1e6, 1) AS rank_mrows,
       f.heap_toast_bytes,
       f.n_cols,
       f.n_cols_described,
       f.writes_since_stats_reset,
       f.reads_since_stats_reset,
       f.last_write,
       f.writers_30d,
       f.crons_mentioning
FROM flagged f;

COMMENT ON VIEW public.v_residual IS
  'C28 repair backlog (data-machine-cases.md section 12): the data model''s work queue, one row per live table. Grain: one table in schema public with est_rows > 0, activity written or read-only (idle tables are out), and no scratch name (leading underscore, zz_backup*, scratch*). gaps lists the open model gaps (describe, key, owner, reader, assay; rules on the gaps column), n_gaps counts them, rank_mrows = est_rows x n_gaps / 1e6 rounded to 0.1: rows are the mass, gaps the work. Complete tables stay in with gaps = {} so the view''s row count is the denominator. No ORDER BY and no LIMIT: read it with WHERE n_gaps > 0 ORDER BY rank_mrows DESC, est_rows DESC LIMIT n. Replaces the C25 island view (residual_kind island_written / island_idle): an island is now key in gaps with n_cols_described = 0, and idle or scratch-named tables are no longer listed (v_schema_atlas still has them). Limits: est_rows are planner estimates; reads and writes count since the last statistics reset; a declared owner is a declaration, not verified responsibility; absence of a gap is not semantic completeness; event and ingest clocks and text-to-key match rates are not measured. Cost: reads v_job_health, which runs its assay functions, about 0.5 s warm on 2026-10-06. Reader: scripts/discovery/repair-backlog.sql.';

COMMENT ON COLUMN public.v_residual.table_name IS
  'Name of a table in schema public (ordinary or partitioned; views are not rows here). Grain key: one row per table. Source: v_schema_atlas.table_name, from pg_class.relname.';
COMMENT ON COLUMN public.v_residual.activity IS
  'Use of the table since the last statistics reset: written when inserts, updates or deletes were counted, read-only when only scans were counted. Idle tables (neither) are not in this view. Source: v_schema_atlas.activity, from pg_stat_user_tables; a statistics reset restarts the counters, so every table not touched since leaves the view.';
COMMENT ON COLUMN public.v_residual.est_rows IS
  'Planner estimate of the live row count (pg_class.reltuples), in rows. Not an exact count; a never-analyzed table reports -1 and is out of scope (only est_rows > 0 is listed). Source: v_schema_atlas.est_rows.';
COMMENT ON COLUMN public.v_residual.cols_undescribed IS
  'Columns of the table with no COMMENT ON COLUMN, in columns: n_cols minus n_cols_described (0 when the atlas has no column counts). Can be 0 while the describe gap is open, when the table has no COMMENT ON TABLE. Source: v_schema_atlas (pg_attribute, pg_description).';
COMMENT ON COLUMN public.v_residual.gaps IS
  'Open model gaps of this table, an array of tags in this fixed order; an empty array means none of the five is open, not that the table is semantically complete. describe: a live column has no COMMENT ON COLUMN, or the table has no COMMENT ON TABLE (Cartographer lane). key: no foreign key in or out, NOT VALID keys included (Keys lane). owner: the table is written and has no pipeline_registry row, or write_receipts holds a statement from an undeclared writer in the last 30 days; only a table with a write-receipt trigger can show an undeclared writer, and a declared owner is a declaration, not verified responsibility. reader: the table is written and no sequential or index scan has been counted since the statistics reset; any scan counts, whatever its origin (monitors and constraint checks included), so the tag fires only when nothing at all has scanned the table. assay: an active cron job command names the table and none of the active jobs that name it carries an assay in v_job_health (assay_status not null); a name match, not proof that the job writes the table. Not measured here: event and ingest clocks per event table, and match rates for text columns that name an entity. Source: v_schema_atlas and v_job_health; rules as in scripts/discovery/repair-backlog.sql and data-machine.md repair loop step 2.';
COMMENT ON COLUMN public.v_residual.n_gaps IS
  'Number of open gaps: the length of gaps (0 to 5), counting gap kinds, not columns or rows. Source: computed here.';
COMMENT ON COLUMN public.v_residual.rank_mrows IS
  'Rank key in millions of rows: est_rows x n_gaps / 1e6, rounded to one decimal. Rows are the mass and open gaps the work; it is not a cost estimate or an owner-set priority. A table under about 50,000 rows with one gap rounds to 0.0, so order by rank_mrows DESC, est_rows DESC. Source: computed here from est_rows and n_gaps.';
COMMENT ON COLUMN public.v_residual.heap_toast_bytes IS
  'On-disk size of the table heap plus its TOAST relation, in bytes: relpages x block size from planner statistics, so it lags the file until VACUUM or ANALYZE; indexes are excluded. Source: v_schema_atlas.heap_toast_bytes.';
COMMENT ON COLUMN public.v_residual.n_cols IS
  'Number of live (not dropped) columns of the table, in columns. Source: v_schema_atlas.n_cols, from pg_attribute.';
COMMENT ON COLUMN public.v_residual.n_cols_described IS
  'Number of those columns that carry a COMMENT ON COLUMN, in columns; the denominator is n_cols. Source: v_schema_atlas.n_cols_described, from pg_description.';
COMMENT ON COLUMN public.v_residual.writes_since_stats_reset IS
  'Rows inserted, updated and deleted since the last statistics reset (n_tup_ins + n_tup_upd + n_tup_del), in rows, not statements. Source: v_schema_atlas, from pg_stat_user_tables.';
COMMENT ON COLUMN public.v_residual.reads_since_stats_reset IS
  'Sequential and index scans started on the table since the last statistics reset (seq_scan + idx_scan), in scans, not rows; any origin. Source: v_schema_atlas, from pg_stat_user_tables.';
COMMENT ON COLUMN public.v_residual.last_write IS
  'Time of the newest write_receipts row for this table in the last 30 days (the receipt timestamp, taken at the start of the writing transaction; timestamptz); NULL when there is none, which includes every table without a write-receipt trigger. Source: v_schema_atlas.last_write.';
COMMENT ON COLUMN public.v_residual.writers_30d IS
  'Distinct writer names recorded in write_receipts for this table in the last 30 days; the name undeclared marks a statement that carried no writer. NULL when none was recorded. Source: v_schema_atlas.writers_30d.';
COMMENT ON COLUMN public.v_residual.crons_mentioning IS
  'Names of the active pg_cron jobs whose command text contains this table name as a whole word; a name match, not proof that a job writes the table (a job may reach it through a function). NULL when none. Source: v_schema_atlas.crons_mentioning.';

REVOKE ALL ON public.v_residual FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_residual TO anon, authenticated, service_role;

-- Catalog-only check: the shape is as intended and every column is described, or the transaction aborts and the C25 view stays.
DO $$
DECLARE
  want CONSTANT text[] := ARRAY[
    'table_name:name', 'activity:text', 'est_rows:bigint', 'cols_undescribed:bigint', 'gaps:text[]',
    'n_gaps:integer', 'rank_mrows:numeric', 'heap_toast_bytes:bigint', 'n_cols:bigint',
    'n_cols_described:bigint', 'writes_since_stats_reset:bigint', 'reads_since_stats_reset:bigint',
    'last_write:timestamp with time zone', 'writers_30d:text[]', 'crons_mentioning:text[]'];
  have text[];
  bare text[];
BEGIN
  SELECT array_agg(a.attname::text || ':' || format_type(a.atttypid, a.atttypmod) ORDER BY a.attnum)
    INTO have
  FROM pg_attribute a
  WHERE a.attrelid = 'public.v_residual'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF have IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'v_residual has columns %, expected %', have, want;
  END IF;
  SELECT array_agg(a.attname::text ORDER BY a.attnum)
    INTO bare
  FROM pg_attribute a
  WHERE a.attrelid = 'public.v_residual'::regclass AND a.attnum > 0 AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF bare IS NOT NULL THEN
    RAISE EXCEPTION 'v_residual columns without COMMENT ON COLUMN: %', bare;
  END IF;
  IF obj_description('public.v_residual'::regclass, 'pg_class') IS NULL THEN
    RAISE EXCEPTION 'v_residual has no COMMENT ON VIEW';
  END IF;
END $$;

COMMIT;

-- Verify live after the run (read-only):
--   select count(*) as tables, count(*) filter (where n_gaps = 0) as complete from public.v_residual;
--   select table_name, gaps, rank_mrows from public.v_residual where n_gaps > 0 order by rank_mrows desc, est_rows desc limit 10;
--   select grantee, privilege_type from information_schema.role_table_grants where table_name = 'v_residual' order by 1, 2;  -- SELECT only
