-- 20261014091000_schema_atlas_writer_skip_scan.sql
--
-- v_schema_atlas: the writer columns (writers_30d, undeclared_stmts_30d, last_write) come from an index skip scan over
-- write_receipts instead of aggregating every receipt of the last 30 days. Same rows, same columns, same meanings.
--
-- MEASURED (prod, read-only, scripts/data/q.sh as postgres, 2026-10-14):
--   select * from v_schema_atlas: 21.4 s (05:28Z, EXPLAIN ANALYZE with a 60 s cap; every read under the 10 s role
--   timeout failed). 19.9 s of it was the wr CTE: an index scan of idx_write_receipts_tbl over the 1,601,281 receipts
--   since 2026-09-14 plus an incremental sort, to find 46 (table, writer) pairs. Everything else took 0.35 s
--   (columns 112 ms, cron name match 123 ms). write_receipts holds 2,814,969 rows (411 MB heap) and grows by about
--   220,000 a day; 87% of the 30-day window is vehicle_observations / ingest-observation.
--   No index carries writer, so distinct writers per table need every row; that is what this index adds.
--
-- WHAT.
--   1. idx_write_receipts_tbl_writer_at: btree (tbl, writer, at DESC). Built on a temp copy of all 2,814,969 receipts it
--      is 86 MB (many receipts share one transaction clock, so btree deduplication applies), 11.3 s to sort.
--   2. v_schema_atlas.wr: a recursive skip scan visits each (tbl, writer) pair once and reads its newest receipt (68
--      pairs, 16 ms on the copy); pairs with a receipt inside 30 days give writers_30d (sorted, as array_agg DISTINCT
--      gave) and last_write; undeclared_stmts_30d counts (tbl, 'undeclared', at > now() - 30 days) in the index.
--      The whole view ran in 423 ms, 28 ms warm, against the copy. Nothing else in the view changes.
--   Writes: one more btree entry per receipt (about 2.5 a second). No row, grant or policy changes.
--
-- Build: CONCURRENTLY, the 411 MB heap read twice. lock_timeout bounds the wait for older transactions. An interrupted
-- build leaves an INVALID index; the conditional drop clears it on a re-run, and the assertion fails the deploy rather
-- than accept one. The view is replaced only after the index is valid: without it the skip scan would read the table
-- once per pair. No BEGIN around the build: the deploy applies this file with psql -f in autocommit.
-- Contract: supabase/sql/test_schema_atlas_writers.sql (CI job schema-atlas-writers-contract).
SET statement_timeout = '900s';
SET lock_timeout = '180s';

DO $precheck$
BEGIN
  IF encode(sha256(convert_to(pg_get_viewdef('public.v_schema_atlas'::regclass, true), 'UTF8')), 'base64')
     IS DISTINCT FROM '9HlM42Hc0M4rA6FDQltdavnEUJoToVG8NeXHCQJFxNk=' THEN
    RAISE EXCEPTION 'v_schema_atlas changed after 2026-10-14 05:46Z; re-read it before building its index';
  END IF;
END
$precheck$;

SELECT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.idx_write_receipts_tbl_writer_at')
                 AND NOT indisvalid) AS writer_index_invalid \gset
\if :writer_index_invalid
DROP INDEX CONCURRENTLY IF EXISTS public.idx_write_receipts_tbl_writer_at;
\endif
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_write_receipts_tbl_writer_at
  ON public.write_receipts (tbl, writer, at DESC);

DO $assert$
DECLARE
  def text;
BEGIN
  IF NOT coalesce((SELECT indisvalid AND indisready AND NOT indisunique FROM pg_index
                    WHERE indexrelid = to_regclass('public.idx_write_receipts_tbl_writer_at')), false) THEN
    RAISE EXCEPTION 'idx_write_receipts_tbl_writer_at is missing, INVALID or unique after the build; DROP INDEX CONCURRENTLY public.idx_write_receipts_tbl_writer_at and re-run';
  END IF;
  def := pg_get_indexdef(to_regclass('public.idx_write_receipts_tbl_writer_at'));
  IF def NOT LIKE '% USING btree (tbl, writer, at DESC)' THEN
    RAISE EXCEPTION 'idx_write_receipts_tbl_writer_at exists with another definition: %', def;
  END IF;
END
$assert$;

SET lock_timeout = '5s';
COMMENT ON INDEX public.idx_write_receipts_tbl_writer_at IS
'Distinct writers per table without reading every receipt: v_schema_atlas walks (tbl, writer) pairs with a recursive skip scan, reads each pair''s newest receipt and counts undeclared receipts inside 30 days. Without it the atlas aggregated the 1.6 M receipts of the last 30 days (19.9 s of a 21.4 s read, 2026-10-14). Built CONCURRENTLY 2026-10-14 (20261014091000).';

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '15s';

DO $guard$
BEGIN
  IF encode(sha256(convert_to(pg_get_viewdef('public.v_schema_atlas'::regclass, true), 'UTF8')), 'base64')
     IS DISTINCT FROM '9HlM42Hc0M4rA6FDQltdavnEUJoToVG8NeXHCQJFxNk=' THEN
    RAISE EXCEPTION 'v_schema_atlas changed after 2026-10-14 05:46Z; re-read it before replacing it';
  END IF;
END
$guard$;

CREATE OR REPLACE VIEW public.v_schema_atlas AS
 WITH RECURSIVE t AS (
         SELECT c.oid,
            c.relname AS table_name,
            c.reltuples::bigint AS est_rows,
            (c.relpages + COALESCE(tc.relpages, 0))::bigint * current_setting('block_size'::text)::bigint AS heap_toast_bytes,
            obj_description(c.oid, 'pg_class'::name) AS purpose
           FROM pg_class c
             LEFT JOIN pg_class tc ON tc.oid = c.reltoastrelid
          WHERE c.relnamespace = 'public'::regnamespace::oid AND (c.relkind = ANY (ARRAY['r'::"char", 'p'::"char"]))
        ), cols AS (
         SELECT a.attrelid AS oid,
            count(*) AS n_cols,
            count(*) FILTER (WHERE d.description IS NOT NULL) AS n_cols_described
           FROM pg_attribute a
             JOIN t t_1 ON t_1.oid = a.attrelid
             LEFT JOIN pg_description d ON d.objoid = a.attrelid AND d.classoid = 'pg_class'::regclass::oid AND d.objsubid = a.attnum
          WHERE a.attnum > 0 AND NOT a.attisdropped
          GROUP BY a.attrelid
        ), act AS (
         SELECT pg_stat_user_tables.relid AS oid,
            pg_stat_user_tables.n_tup_ins + pg_stat_user_tables.n_tup_upd + pg_stat_user_tables.n_tup_del AS writes,
            COALESCE(pg_stat_user_tables.seq_scan, 0::bigint) + COALESCE(pg_stat_user_tables.idx_scan, 0::bigint) AS reads
           FROM pg_stat_user_tables
          WHERE pg_stat_user_tables.schemaname = 'public'::name
        ), fk_out AS (
         SELECT pg_constraint.conrelid AS oid,
            count(*) AS n,
            array_agg(DISTINCT pg_constraint.confrelid::regclass::text) AS parents
           FROM pg_constraint
          WHERE pg_constraint.contype = 'f'::"char"
          GROUP BY pg_constraint.conrelid
        ), fk_in AS (
         SELECT pg_constraint.confrelid AS oid,
            count(*) AS n
           FROM pg_constraint
          WHERE pg_constraint.contype = 'f'::"char"
          GROUP BY pg_constraint.confrelid
        ), trg AS (
         SELECT pg_trigger.tgrelid AS oid,
            count(*) AS n
           FROM pg_trigger
          WHERE NOT pg_trigger.tgisinternal
          GROUP BY pg_trigger.tgrelid
        ), reg AS (
         SELECT pipeline_registry.table_name,
            count(*) AS fields,
            array_agg(DISTINCT pipeline_registry.owned_by) AS owners
           FROM public.pipeline_registry
          GROUP BY pipeline_registry.table_name
        ), writer_pairs AS (
        ( SELECT r.tbl,
            r.writer,
            r.at
           FROM public.write_receipts r
          ORDER BY r.tbl, r.writer, r.at DESC
         LIMIT 1)
        UNION ALL
         SELECT n.tbl,
            n.writer,
            n.at
           FROM writer_pairs p
             CROSS JOIN LATERAL ( SELECT r.tbl,
                    r.writer,
                    r.at
                   FROM public.write_receipts r
                  WHERE ROW(r.tbl, r.writer) > ROW(p.tbl, p.writer)
                  ORDER BY r.tbl, r.writer, r.at DESC
                 LIMIT 1) n
        ), wr AS (
         SELECT w.tbl,
            array_agg(w.writer ORDER BY w.writer) AS writers,
            ( SELECT count(*) AS count
                   FROM public.write_receipts u
                  WHERE u.tbl = w.tbl AND u.writer = 'undeclared'::text AND u.at > (now() - '30 days'::interval)) AS undeclared_stmts,
            max(w.at) AS last_write
           FROM writer_pairs w
          WHERE w.at > (now() - '30 days'::interval)
          GROUP BY w.tbl
        ), cr AS (
         SELECT t_1.table_name,
            array_agg(j.jobname ORDER BY j.jobname) AS crons
           FROM t t_1
             JOIN cron.job j ON j.active AND j.command ~* (('\m'::text || t_1.table_name::text) || '\M'::text)
          GROUP BY t_1.table_name
        )
 SELECT t.table_name,
        CASE
            WHEN COALESCE(act.writes, 0::bigint) > 0 THEN 'written'::text
            WHEN COALESCE(act.reads, 0::bigint) > 0 THEN 'read-only'::text
            ELSE 'idle'::text
        END AS activity,
    act.writes AS writes_since_stats_reset,
    act.reads AS reads_since_stats_reset,
    t.est_rows,
    t.heap_toast_bytes,
    cols.n_cols,
    cols.n_cols_described,
    COALESCE(fo.n, 0::bigint) AS fk_out,
    fo.parents AS fk_parents,
    COALESCE(fi.n, 0::bigint) AS fk_in,
    COALESCE(trg.n, 0::bigint) AS triggers,
    t.purpose,
    reg.fields AS registry_fields,
    reg.owners AS registry_owners,
    wr.writers AS writers_30d,
    wr.undeclared_stmts AS undeclared_stmts_30d,
    wr.last_write,
    cr.crons AS crons_mentioning
   FROM t
     LEFT JOIN cols ON cols.oid = t.oid
     LEFT JOIN act ON act.oid = t.oid
     LEFT JOIN fk_out fo ON fo.oid = t.oid
     LEFT JOIN fk_in fi ON fi.oid = t.oid
     LEFT JOIN trg ON trg.oid = t.oid
     LEFT JOIN reg ON reg.table_name = t.table_name
     LEFT JOIN wr ON wr.tbl = t.table_name
     LEFT JOIN cr ON cr.table_name = t.table_name;

COMMENT ON VIEW public.v_schema_atlas IS
  'One row per public table. activity = written / read-only / idle from pg_stat_user_tables since statistics reset (counters in writes_ and reads_since_stats_reset); est rows and heap+toast bytes; columns and columns described; FK in/out; triggers; purpose (table COMMENT); pipeline_registry owners; declared writers (write_receipts, 30 d, by a skip scan over idx_write_receipts_tbl_writer_at); active crons naming it. Computed live from the catalog. 2026-09-28; writer columns made fast 2026-10-14 (20261014091000).';

COMMIT;
RESET lock_timeout;
RESET statement_timeout;
