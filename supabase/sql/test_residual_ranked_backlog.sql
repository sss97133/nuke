-- Isolated PostgreSQL 17 contract for 20261006210524_v_residual_ranked_backlog.sql (C28: the repair backlog as a view).
-- Synthetic rows only; never production. Run from the repo root in an empty disposable dm_residual_backlog_* database:
--   createdb dm_residual_backlog_ci
--   psql -X -v ON_ERROR_STOP=1 -d dm_residual_backlog_ci -f supabase/sql/test_residual_ranked_backlog.sql
-- Fixtures: v_schema_atlas and v_job_health are plain tables with the live views' column names and types (read from
-- pg_attribute on 2026-10-06; v_job_health keeps only the three columns the migration reads). v_residual starts as the
-- live C25 island view with the live ACL (every table privilege for the three API roles, from Supabase default
-- privileges, set here with ALTER DEFAULT PRIVILEGES), so the DROP-then-CREATE path runs as it will in production.
-- Covered: the migration applies over the old view and applies again; the column list, order and types; every comment;
-- each gap rule and its boundary; the scope rules; null safety; the rank arithmetic; the ACL (service_role only, as for the
-- atlas and job-health views) and real reads as service_role, anon and authenticated; no ORDER BY or LIMIT in the view;
-- the backlog script reads the view and returns only open work.
-- Not covered: the real atlas and job-health views; the refusal of DROP VIEW when a dependent exists (PostgreSQL's own
-- rule, checked on the live database with pg_depend before the migration was written).
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_residual_backlog_%'
     OR current_setting('server_version_num')::int / 10000 <> 17
     OR to_regclass('public.v_schema_atlas') IS NOT NULL
     OR to_regclass('public.v_job_health') IS NOT NULL
     OR to_regclass('public.v_residual') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty, disposable dm_residual_backlog_* PostgreSQL 17 database';
  END IF;
END $$;
SET statement_timeout = '30s';
SET lock_timeout = '3s';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;

-- Supabase's default privileges: every object postgres creates in public starts with all table privileges for the three
-- API roles. This is how the live C25 view got its ACL, and what a DROP then CREATE VIEW starts from again.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;

CREATE FUNCTION pg_temp.ok(label text, condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %', label; END IF;
  RAISE NOTICE 'PASS %', label;
END $$;

-- The atlas stub. Defaults describe a complete, written, read, keyed, owned table with no cron; each case overrides
-- only what makes it differ. Types are the live view's.
CREATE TABLE public.v_schema_atlas (
  table_name name,
  activity text DEFAULT 'written',
  writes_since_stats_reset bigint DEFAULT 10,
  reads_since_stats_reset bigint DEFAULT 10,
  est_rows bigint DEFAULT 100000,
  heap_toast_bytes bigint DEFAULT 8192,
  n_cols bigint DEFAULT 4,
  n_cols_described bigint DEFAULT 4,
  fk_out bigint DEFAULT 0,
  fk_parents text[],
  fk_in bigint DEFAULT 1,
  triggers bigint DEFAULT 0,
  purpose text DEFAULT 'fixture purpose',
  registry_fields bigint DEFAULT 1,
  registry_owners text[],
  writers_30d text[],
  undeclared_stmts_30d bigint,
  last_write timestamptz,
  crons_mentioning text[]
);
CREATE TABLE public.v_job_health (jobname text, active boolean, assay_status text);
INSERT INTO public.v_job_health VALUES
  ('job_plain', true, NULL),            -- active, no assay
  ('job_assayed', true, 'passed'),      -- active, carries an assay
  ('job_failed_assay', true, 'failed'), -- a failing assay is still an assay
  ('job_paused_assayed', false, 'passed'); -- paused: its assay does not count
-- The live atlas and job-health views are service_role only; the stubs say the same, so any denial below comes from
-- v_residual's own ACL and a view reads its sources with its owner's rights.
REVOKE ALL ON public.v_schema_atlas, public.v_job_health FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_schema_atlas, public.v_job_health TO service_role;

-- The live C25 view, as pg_get_viewdef printed it on 2026-10-06, with its live ACL.
CREATE VIEW public.v_residual AS
SELECT a.table_name, a.est_rows, a.heap_toast_bytes, a.n_cols, a.n_cols_described,
       a.writes_since_stats_reset, a.reads_since_stats_reset, a.last_write, a.writers_30d, a.crons_mentioning,
       CASE WHEN COALESCE(a.writes_since_stats_reset, 0::bigint) > 0 THEN 'island_written'::text
            ELSE 'island_idle'::text END AS residual_kind
FROM public.v_schema_atlas a
WHERE COALESCE(a.est_rows, 0::bigint) > 0 AND COALESCE(a.fk_in, 0::bigint) = 0
  AND COALESCE(a.fk_out, 0::bigint) = 0 AND COALESCE(a.n_cols_described, 0::bigint) = 0
ORDER BY a.est_rows DESC;
COMMENT ON VIEW public.v_residual IS 'fixture copy of the C25 island view';

SELECT pg_temp.ok('fixture: the old view has residual_kind and grants INSERT to anon',
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'v_residual' AND column_name = 'residual_kind')
  AND has_table_privilege('anon', 'public.v_residual', 'INSERT'));

-- Cases that must be listed. Each overrides the complete-table defaults.
INSERT INTO public.v_schema_atlas (table_name) VALUES ('t_complete'), ('my_scratch'), ('x_zz_backup');
INSERT INTO public.v_schema_atlas (table_name, n_cols_described) VALUES ('t_describe_cols', 2);
INSERT INTO public.v_schema_atlas (table_name, purpose) VALUES ('t_describe_purpose', NULL);
INSERT INTO public.v_schema_atlas (table_name, fk_in) VALUES ('t_key', 0), ('a_b', 0);
INSERT INTO public.v_schema_atlas (table_name, fk_in, fk_out) VALUES ('t_key_null', NULL, NULL), ('t_key_out_only', 0, 2);
INSERT INTO public.v_schema_atlas (table_name, registry_fields) VALUES ('t_owner_unregistered', NULL);
INSERT INTO public.v_schema_atlas (table_name, undeclared_stmts_30d) VALUES ('t_owner_undeclared', 3);
INSERT INTO public.v_schema_atlas (table_name, activity, writes_since_stats_reset, registry_fields)
  VALUES ('t_owner_readonly', 'read-only', 0, NULL);
INSERT INTO public.v_schema_atlas (table_name, reads_since_stats_reset) VALUES ('t_reader', 0);
-- Not reachable in the live atlas (read-only means a scan was counted); pins the reader rule as written: written tables only.
INSERT INTO public.v_schema_atlas (table_name, activity, writes_since_stats_reset, reads_since_stats_reset)
  VALUES ('t_reader_readonly', 'read-only', 0, 0);
INSERT INTO public.v_schema_atlas (table_name, crons_mentioning) VALUES
  ('t_assay', ARRAY['job_plain']),
  ('t_assay_cleared', ARRAY['job_assayed']),
  ('t_assay_failing', ARRAY['job_failed_assay']),
  ('t_assay_paused', ARRAY['job_paused_assayed']),
  ('t_assay_mixed', ARRAY['job_plain', 'job_assayed']),
  ('t_assay_empty', ARRAY[]::text[]);
INSERT INTO public.v_schema_atlas (table_name, n_cols, n_cols_described) VALUES ('t_no_cols', NULL, NULL);
INSERT INTO public.v_schema_atlas (table_name, est_rows, n_cols_described) VALUES ('t_small', 40000, 0), ('t_small_b', 30000, 0);
INSERT INTO public.v_schema_atlas (table_name, est_rows, fk_in) VALUES ('t_round', 1250000, 0);
-- More rows than t_all but one gap: rank 1.8 against 7.5, so a reader that orders by rows alone is caught.
INSERT INTO public.v_schema_atlas (table_name, est_rows, fk_in) VALUES ('t_big', 1800000, 0);
-- One row with every gap open, and distinct carried-over values to check the pass-through columns.
INSERT INTO public.v_schema_atlas (table_name, est_rows, heap_toast_bytes, n_cols, n_cols_described, fk_in,
  registry_fields, reads_since_stats_reset, writes_since_stats_reset, writers_30d, last_write, crons_mentioning)
VALUES ('t_all', 1500000, 123456, 4, 0, 0, NULL, 0, 7, ARRAY['undeclared', 'w1'], '2026-10-01 00:00:00+00', ARRAY['job_plain']);

-- Cases that must stay out. Each would rank high if listed.
INSERT INTO public.v_schema_atlas (table_name, activity, writes_since_stats_reset, reads_since_stats_reset, est_rows, fk_in, n_cols_described)
  VALUES ('t_idle', 'idle', 0, 0, 1000000, 0, 0);
INSERT INTO public.v_schema_atlas (table_name, est_rows, fk_in, n_cols_described) VALUES
  ('t_empty', 0, 0, 0), ('t_unanalyzed', -1, 0, 0), ('t_null_rows', NULL, 0, 0),
  ('_hidden', 1000000, 0, 0), ('zz_backup_old', 1000000, 0, 0), ('scratch_tmp', 1000000, 0, 0);

-- The contract. Run after the first apply and again after a second apply.
CREATE FUNCTION pg_temp.assert_contract(stage text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  cols text;
  acl text;
  bad text;
  top text;
  script_cols text;
  script_n integer;
  rows_as_service bigint;
  anon_denied boolean;
  authenticated_denied boolean;
BEGIN
  -- Shape: names, order and types; the C25 tag is gone.
  SELECT string_agg(a.attname::text || ':' || format_type(a.atttypid, a.atttypmod), ',' ORDER BY a.attnum) INTO cols
  FROM pg_attribute a WHERE a.attrelid = 'public.v_residual'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  PERFORM pg_temp.ok(stage || ': columns, order and types',
    cols = 'table_name:name,activity:text,est_rows:bigint,cols_undescribed:bigint,gaps:text[],n_gaps:integer,'
        || 'rank_mrows:numeric,heap_toast_bytes:bigint,n_cols:bigint,n_cols_described:bigint,'
        || 'writes_since_stats_reset:bigint,reads_since_stats_reset:bigint,last_write:timestamp with time zone,'
        || 'writers_30d:text[],crons_mentioning:text[]');
  PERFORM pg_temp.ok(stage || ': residual_kind is gone',
    NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.v_residual'::regclass AND attname = 'residual_kind' AND NOT attisdropped));

  -- Comments: the view and every column.
  SELECT string_agg(a.attname::text, ',') INTO bad
  FROM pg_attribute a WHERE a.attrelid = 'public.v_residual'::regclass AND a.attnum > 0 AND NOT a.attisdropped
    AND coalesce(col_description(a.attrelid, a.attnum), '') = '';
  PERFORM pg_temp.ok(stage || ': every column has a comment (missing: ' || coalesce(bad, 'none') || ')', bad IS NULL);
  PERFORM pg_temp.ok(stage || ': the view has a comment that is not the fixture text',
    coalesce(obj_description('public.v_residual'::regclass, 'pg_class'), '') LIKE 'C28 repair backlog%');

  -- Access: SELECT for service_role and nothing else for anyone but the owner, PUBLIC included (the posture of
  -- v_schema_atlas and v_job_health). The ACL is read from the catalog and then exercised with real reads.
  SELECT string_agg(coalesce(r.rolname, 'PUBLIC') || ':' || x.privilege_type, ',' ORDER BY coalesce(r.rolname, 'PUBLIC'), x.privilege_type) INTO acl
  FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x LEFT JOIN pg_roles r ON r.oid = x.grantee
  WHERE c.oid = 'public.v_residual'::regclass AND x.grantee <> c.relowner;
  PERFORM pg_temp.ok(stage || ': ACL is SELECT for service_role only (got ' || coalesce(acl, 'none') || ')',
    acl = 'service_role:SELECT');
  PERFORM pg_temp.ok(stage || ': the catalog says service_role can read and anon and authenticated cannot',
    has_table_privilege('service_role', 'public.v_residual', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.v_residual', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.v_residual', 'SELECT'));
  BEGIN
    SET LOCAL ROLE service_role;
    SELECT count(*) INTO rows_as_service FROM public.v_residual;
  EXCEPTION WHEN insufficient_privilege THEN
    rows_as_service := -1;
  END;
  RESET ROLE;
  PERFORM pg_temp.ok(stage || ': service_role reads the rows (got ' || rows_as_service || ')', rows_as_service > 0);
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM 1 FROM public.v_residual LIMIT 1;
    anon_denied := false;
  EXCEPTION WHEN insufficient_privilege THEN
    anon_denied := true;
  END;
  RESET ROLE;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM 1 FROM public.v_residual LIMIT 1;
    authenticated_denied := false;
  EXCEPTION WHEN insufficient_privilege THEN
    authenticated_denied := true;
  END;
  RESET ROLE;
  PERFORM pg_temp.ok(stage || ': a read as anon or authenticated is refused with insufficient_privilege',
    anon_denied AND authenticated_denied);

  PERFORM pg_temp.ok(stage || ': the view is not updatable, so only SELECT can matter',
    (SELECT is_updatable FROM information_schema.views WHERE table_schema = 'public' AND table_name = 'v_residual') = 'NO');

  -- No ordering or limit inside the view: readers order and limit.
  PERFORM pg_temp.ok(stage || ': the stored definition has no ORDER BY and no LIMIT',
    pg_get_viewdef('public.v_residual'::regclass) !~* '\m(order by|limit)\M');

  -- Rows, gaps and arithmetic against the cases. A full join also reports a missing or an unexpected row.
  SELECT string_agg(coalesce(e.name, v.table_name::text) || ' got ' || coalesce(v.gaps::text, 'no row')
                    || '/' || coalesce(v.cols_undescribed::text, '-') || '/' || coalesce(v.rank_mrows::text, '-')
                    || ' want ' || coalesce(e.gaps::text, 'no row') || '/' || coalesce(e.cols_undesc::text, '-')
                    || '/' || coalesce(e.rank::text, '-'), '; ' ORDER BY coalesce(e.name, v.table_name::text)) INTO bad
  FROM (VALUES
    ('t_complete',           ARRAY[]::text[],                                        0, 0.0::numeric),
    ('my_scratch',           ARRAY[]::text[],                                        0, 0.0),
    ('x_zz_backup',          ARRAY[]::text[],                                        0, 0.0),
    ('t_describe_cols',      ARRAY['describe'],                                      2, 0.1),
    ('t_describe_purpose',   ARRAY['describe'],                                      0, 0.1),
    ('t_key',                ARRAY['key'],                                           0, 0.1),
    ('a_b',                  ARRAY['key'],                                           0, 0.1),
    ('t_key_null',           ARRAY['key'],                                           0, 0.1),
    ('t_key_out_only',       ARRAY[]::text[],                                        0, 0.0),
    ('t_owner_unregistered', ARRAY['owner'],                                         0, 0.1),
    ('t_owner_undeclared',   ARRAY['owner'],                                         0, 0.1),
    ('t_owner_readonly',     ARRAY[]::text[],                                        0, 0.0),
    ('t_reader',             ARRAY['reader'],                                        0, 0.1),
    ('t_reader_readonly',    ARRAY[]::text[],                                        0, 0.0),
    ('t_assay',              ARRAY['assay'],                                         0, 0.1),
    ('t_assay_cleared',      ARRAY[]::text[],                                        0, 0.0),
    ('t_assay_failing',      ARRAY[]::text[],                                        0, 0.0),
    ('t_assay_paused',       ARRAY['assay'],                                         0, 0.1),
    ('t_assay_mixed',        ARRAY[]::text[],                                        0, 0.0),
    ('t_assay_empty',        ARRAY[]::text[],                                        0, 0.0),
    ('t_no_cols',            ARRAY[]::text[],                                        0, 0.0),
    ('t_small',              ARRAY['describe'],                                      4, 0.0),
    ('t_small_b',            ARRAY['describe'],                                      4, 0.0),
    ('t_round',              ARRAY['key'],                                           0, 1.3),
    ('t_big',                ARRAY['key'],                                           0, 1.8),
    ('t_all',                ARRAY['describe', 'key', 'owner', 'reader', 'assay'],   4, 7.5)
  ) AS e(name, gaps, cols_undesc, rank)
  FULL JOIN public.v_residual v ON v.table_name = e.name
  WHERE v.table_name IS NULL OR e.name IS NULL
     OR v.gaps IS DISTINCT FROM e.gaps
     OR v.n_gaps IS DISTINCT FROM cardinality(e.gaps)
     OR v.cols_undescribed IS DISTINCT FROM e.cols_undesc
     OR v.rank_mrows IS DISTINCT FROM e.rank;
  PERFORM pg_temp.ok(stage || ': gaps, counts, cols_undescribed and rank per case (' || coalesce(bad, 'all match') || ')', bad IS NULL);
  PERFORM pg_temp.ok(stage || ': complete tables stay in the view with an empty array, not NULL',
    (SELECT count(*) FROM public.v_residual WHERE n_gaps = 0 AND gaps = '{}') = 11
    AND NOT EXISTS (SELECT 1 FROM public.v_residual WHERE gaps IS NULL OR n_gaps IS NULL OR rank_mrows IS NULL));
  PERFORM pg_temp.ok(stage || ': idle, empty, never-analyzed, unknown-size and scratch-named tables are out',
    NOT EXISTS (SELECT 1 FROM public.v_residual
                WHERE table_name IN ('t_idle', 't_empty', 't_unanalyzed', 't_null_rows', '_hidden', 'zz_backup_old', 'scratch_tmp')));

  -- Carried-over columns pass through unchanged.
  PERFORM pg_temp.ok(stage || ': evidence columns pass through from the atlas',
    EXISTS (SELECT 1 FROM public.v_residual v JOIN public.v_schema_atlas a USING (table_name)
            WHERE v.table_name = 't_all' AND v.activity = a.activity AND v.est_rows = a.est_rows
              AND v.heap_toast_bytes = a.heap_toast_bytes AND v.n_cols = a.n_cols AND v.n_cols_described = a.n_cols_described
              AND v.writes_since_stats_reset = a.writes_since_stats_reset AND v.reads_since_stats_reset = a.reads_since_stats_reset
              AND v.last_write = a.last_write AND v.writers_30d = a.writers_30d AND v.crons_mentioning = a.crons_mentioning));

  -- The reader's order: rank, then rows; the island rule of the old view is a filter on this one.
  SELECT table_name::text INTO top FROM public.v_residual ORDER BY rank_mrows DESC, est_rows DESC, table_name LIMIT 1;
  PERFORM pg_temp.ok(stage || ': the top row is the table with the most rows x gaps', top = 't_all');
  PERFORM pg_temp.ok(stage || ': equal ranks order by rows (40,000 before 30,000)',
    (SELECT array_position(array_agg(table_name::text ORDER BY rank_mrows DESC, est_rows DESC, table_name), 't_small')
          < array_position(array_agg(table_name::text ORDER BY rank_mrows DESC, est_rows DESC, table_name), 't_small_b')
     FROM public.v_residual));
  PERFORM pg_temp.ok(stage || ': the old island rule (key gap and no described column) still selects the written and read-only islands',
    (SELECT array_agg(table_name::text ORDER BY table_name) FROM public.v_residual
     WHERE 'key' = ANY (gaps) AND coalesce(n_cols_described, 0) = 0) = ARRAY['t_all']);

  -- The backlog script reads this view: same columns, open work only.
  DROP TABLE IF EXISTS script_out;
  EXECUTE 'CREATE TEMP TABLE script_out AS ' || (SELECT string_agg(line, E'\n' ORDER BY ctid) FROM script_text);
  SELECT string_agg(attname::text, ',' ORDER BY attnum) INTO script_cols
  FROM pg_attribute WHERE attrelid = 'script_out'::regclass AND attnum > 0 AND NOT attisdropped;
  SELECT count(*) INTO script_n FROM script_out;
  PERFORM pg_temp.ok(stage || ': the backlog script returns table_name, activity, est_rows, cols_undescribed, gaps, n_gaps, rank_mrows',
    script_cols = 'table_name,activity,est_rows,cols_undescribed,gaps,n_gaps,rank_mrows');
  PERFORM pg_temp.ok(stage || ': the backlog script lists only tables with an open gap (15 here)',
    script_n = 15 AND NOT EXISTS (SELECT 1 FROM script_out WHERE n_gaps = 0));
  -- The script's own order is the order its rows were written into script_out (ctid), not a re-sort here.
  PERFORM pg_temp.ok(stage || ': the backlog script puts t_all first',
    (SELECT table_name::text FROM script_out ORDER BY ctid LIMIT 1) = 't_all');
  PERFORM pg_temp.ok(stage || ': the backlog script orders by rank, then rows, never rising',
    NOT EXISTS (SELECT 1 FROM (SELECT rank_mrows, est_rows,
                                      lag(rank_mrows) OVER (ORDER BY ctid) AS prev_rank,
                                      lag(est_rows) OVER (ORDER BY ctid) AS prev_rows
                               FROM script_out) o
                WHERE o.prev_rank IS NOT NULL
                  AND (o.rank_mrows > o.prev_rank OR (o.rank_mrows = o.prev_rank AND o.est_rows > o.prev_rows))));
END $$;

-- The backlog script's text, read as lines the way data-model-health-test.sql reads its queries.
CREATE TEMP TABLE script_text(line text);
\copy script_text(line) FROM 'scripts/discovery/repair-backlog.sql' WITH (FORMAT csv, DELIMITER E'\x01', QUOTE E'\x02', ESCAPE E'\x02')

\ir ../migrations/20261006210524_v_residual_ranked_backlog.sql
SELECT pg_temp.assert_contract('first apply');

-- A second apply (a replay, or a re-run after a partial deploy) must land the same shape.
\ir ../migrations/20261006210524_v_residual_ranked_backlog.sql
SELECT pg_temp.assert_contract('second apply');

SELECT pg_temp.ok('done: residual ranked backlog contract', true);
