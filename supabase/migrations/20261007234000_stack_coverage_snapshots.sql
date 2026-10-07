-- 20261007234000_stack_coverage_snapshots.sql
--
-- The expansion of the stack registry as a time series: one row per stack version per reading of stack_coverage(), written
-- by one sanctioned writer, append-only. Until now every coverage reading since 2026-10-07 02:08Z lived only in DONE.md and
-- LANES rows (registry mean 0.115 → 0.168 tonight; S01 0/1 → 1/1; SA 0.60 of 5 → 0.50 of 18). The SCHEMA_LAW pre-mint memo
-- docs/proposals/2026-10-07-stack-coverage-snapshots.md (PR #787, merged 579e05b59) answered the seven questions: no existing
-- dated-measurement table fits (vein_runs grades theses; data_quality_snapshots is a dead vehicle-field sampler, 1,002 rows
-- 2026-04-07..14; source_quality_snapshots is per source), a view cannot hold a past reading, corrections are the next
-- reading, invariants are constraints, one writer with receipts, registry rows. The owner asked for it through skylar-c4 on
-- 2026-10-07 04:40Z ("a nightly snapshot of v_stacks coverage, so expansion becomes a time series").
--
-- EVIDENCE (read-only, prod, 2026-10-07 12:22Z): stacks PRIMARY KEY (stack_id, version); stack_coverage(text) returns
--   TABLE(stack_id, version, coverage numeric, n_needs, n_present, n_partial, n_missing, needs jsonb, measured_at) for the
--   latest version of each stack (65 rows, about 1 s, coverage NULL only when a stack has no needs); vein_append_only() is
--   the registry's append-only trigger function (raises on UPDATE or DELETE); no table named stack_coverage_snapshots exists.
--
-- WHAT.
--   1. public.stack_coverage_snapshots: PRIMARY KEY (stack_id, version, measured_at); FOREIGN KEY (stack_id, version) →
--      stacks; CHECKs: coverage NULL or 0..1, n_present + n_partial + n_missing = n_needs (all >= 0), needs is a jsonb
--      array; append-only (vein_append_only); RLS on with no policy; SELECT for service_role only; index on measured_at.
--   2. public.snapshot_stack_coverage(p_registered_by text) returns jsonb: SECURITY DEFINER, EXECUTE for service_role only,
--      app.writer set with set_config for the call and restored; inserts one row per stack from stack_coverage(NULL) at one
--      clock (now() of the transaction), ON CONFLICT DO NOTHING so a replay at the same clock adds nothing; one
--      write_receipts row per call that wrote; returns {rows, measured_at, ms}.
--   3. public.v_stack_coverage_series: one row per reading (stacks, showable >= 0.9, nonzero, mean coverage, needs present
--      of needs); SELECT for service_role only.
--   4. pipeline_registry table row; comments on the table, its 11 columns, the writer and the view.
--   No row is written here. The first reading is a hand call after the deploy; a schedule (pg_cron, nightly after the
--   generator and the night run) waits for the owner's standing-runner ruling, and until then the lead calls the writer
--   after each registry change.
--
-- COST. 65 rows per reading, about 40 KB with the needs evidence; a nightly reading is about 1.2 MB a month.
-- CONTRACT. supabase/sql/test_stack_coverage_snapshots.sql (PostgreSQL 17, synthetic rows, CI job metric-fold-health-contract).
-- FIRST READER. select * from v_stack_coverage_series order by measured_at; per stack:
--   select measured_at, coverage, n_present, n_needs from stack_coverage_snapshots where stack_id = 'S01' order by 1.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

-- 1. The series table -------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stack_coverage_snapshots (
  stack_id      text        NOT NULL,
  version       integer     NOT NULL,
  measured_at   timestamptz NOT NULL,
  coverage      numeric(5,4),
  n_needs       integer     NOT NULL,
  n_present     integer     NOT NULL,
  n_partial     integer     NOT NULL,
  n_missing     integer     NOT NULL,
  needs         jsonb       NOT NULL,
  source        text        NOT NULL DEFAULT 'stack_coverage()',
  registered_by text        NOT NULL,
  CONSTRAINT stack_coverage_snapshots_pkey PRIMARY KEY (stack_id, version, measured_at),
  CONSTRAINT stack_coverage_snapshots_stack_fkey FOREIGN KEY (stack_id, version) REFERENCES public.stacks (stack_id, version),
  CONSTRAINT stack_coverage_snapshots_coverage_check CHECK (coverage IS NULL OR (coverage >= 0 AND coverage <= 1)),
  CONSTRAINT stack_coverage_snapshots_counts_check CHECK (n_present >= 0 AND n_partial >= 0 AND n_missing >= 0 AND n_present + n_partial + n_missing = n_needs),
  CONSTRAINT stack_coverage_snapshots_needs_check CHECK (jsonb_typeof(needs) = 'array')
);
CREATE INDEX IF NOT EXISTS stack_coverage_snapshots_measured_at_idx ON public.stack_coverage_snapshots (measured_at);
DROP TRIGGER IF EXISTS stack_coverage_snapshots_append_only ON public.stack_coverage_snapshots;
CREATE TRIGGER stack_coverage_snapshots_append_only BEFORE UPDATE OR DELETE ON public.stack_coverage_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.vein_append_only();
ALTER TABLE public.stack_coverage_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stack_coverage_snapshots FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.stack_coverage_snapshots TO service_role;

COMMENT ON TABLE public.stack_coverage_snapshots IS
'Time series of stack coverage: one row per stack version per reading of stack_coverage() (grain: stack_id + version + measured_at), written only by snapshot_stack_coverage() (service_role, receipted). Append-only (vein_append_only): a wrong reading is superseded by the next clock, never corrected. Every row keys to stacks (stack_id, version); coverage is NULL only for a stack with no needs; n_present + n_partial + n_missing = n_needs; needs holds the per-need verdicts of the reading so a later reader can ask why a number moved. Readers: v_stack_coverage_series (one row per reading). RLS on with no policy: service_role reads. Minted 2026-10-07 (migration 20261007234000) after the pre-mint memo docs/proposals/2026-10-07-stack-coverage-snapshots.md; no schedule yet (the standing-runner ruling is the owner''s), the lead calls the writer after each registry change. Clock: measured_at is the transaction clock of the reading.';
COMMENT ON COLUMN public.stack_coverage_snapshots.stack_id IS 'Stack read (stacks.stack_id), with version the latest version at the reading. Unit: none (key). Source: stack_coverage(). Grain: one stack version per reading. Clock: n/a.';
COMMENT ON COLUMN public.stack_coverage_snapshots.version IS 'Version of the stack that was read: the latest version at measured_at (a new version carries its full need list, so coverage is comparable only within a version). Unit: none (integer). Source: stack_coverage(). Grain: one stack version per reading. Clock: n/a.';
COMMENT ON COLUMN public.stack_coverage_snapshots.measured_at IS 'When the reading was taken: now() of the writer''s transaction, shared by every row of one reading. Unit: timestamptz. Source: snapshot_stack_coverage(). Grain: one reading. Clock: measurement time.';
COMMENT ON COLUMN public.stack_coverage_snapshots.coverage IS 'Needs present divided by needs, 4 decimals, 0..1 (CHECK); NULL only when the stack has no needs. A structural reading (an object exists with rows, a column is filled, a function exists), not semantic completeness. Unit: share 0..1. Source: stack_coverage(). Grain: one stack version per reading. Clock: as of measured_at.';
COMMENT ON COLUMN public.stack_coverage_snapshots.n_needs IS 'Needs of the stack version at the reading; equals n_present + n_partial + n_missing (CHECK). Unit: count. Source: stack_coverage(). Grain: one stack version per reading. Clock: as of measured_at.';
COMMENT ON COLUMN public.stack_coverage_snapshots.n_present IS 'Needs resolved present at the reading. Unit: count. Source: stack_coverage(). Grain: one stack version per reading. Clock: as of measured_at.';
COMMENT ON COLUMN public.stack_coverage_snapshots.n_partial IS 'Needs resolved partial at the reading (exists without rows or owner, thin fill, key without foreign key, stale intake). Unit: count. Source: stack_coverage(). Grain: one stack version per reading. Clock: as of measured_at.';
COMMENT ON COLUMN public.stack_coverage_snapshots.n_missing IS 'Needs resolved missing at the reading (no such object, or an abstract layer with no declared table). Unit: count. Source: stack_coverage(). Grain: one stack version per reading. Clock: as of measured_at.';
COMMENT ON COLUMN public.stack_coverage_snapshots.needs IS 'The reading''s per-need verdicts, one jsonb object per need {layer, kind, object, verdict, evidence, note} in layer order (CHECK: a jsonb array), kept so a later reader can see which need moved. Unit: none (jsonb array). Source: stack_coverage().needs. Grain: one stack version per reading. Clock: as of measured_at.';
COMMENT ON COLUMN public.stack_coverage_snapshots.source IS 'The function that produced the reading; ''stack_coverage()'' today (default). Unit: none (text). Source: snapshot_stack_coverage(). Grain: one row. Clock: n/a.';
COMMENT ON COLUMN public.stack_coverage_snapshots.registered_by IS 'Who called the writer (session, job or migration), as passed in p_registered_by. Unit: none (text). Source: the caller. Grain: one reading. Clock: n/a.';

-- 2. The writer -------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.snapshot_stack_coverage(p_registered_by text DEFAULT 'snapshot_stack_coverage')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_writer      constant text := 'snapshot_stack_coverage';
  v_prev_writer text := current_setting('app.writer', true);
  v_at          timestamptz := now();
  v_started     timestamptz := clock_timestamp();
  v_rows        integer := 0;
BEGIN
  IF coalesce(btrim(p_registered_by), '') = '' THEN
    RAISE EXCEPTION 'snapshot_stack_coverage: p_registered_by must name the caller' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM set_config('app.writer', c_writer, true);

  WITH ins AS (
    INSERT INTO public.stack_coverage_snapshots
      (stack_id, version, measured_at, coverage, n_needs, n_present, n_partial, n_missing, needs, source, registered_by)
    SELECT c.stack_id, c.version, v_at, c.coverage, c.n_needs, c.n_present, c.n_partial, c.n_missing,
           coalesce(c.needs, '[]'::jsonb), 'stack_coverage()', p_registered_by
    FROM public.stack_coverage(NULL) c
    ON CONFLICT (stack_id, version, measured_at) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_rows FROM ins;

  -- stack_coverage_snapshots has no write-receipt trigger; record this writer's statement the way record_write_receipt does.
  IF v_rows > 0 THEN
    INSERT INTO public.write_receipts (tbl, op, rows, writer, db_role, app_name, txid)
    VALUES ('stack_coverage_snapshots', 'INSERT', v_rows, c_writer, current_user,
            current_setting('application_name', true), txid_current());
  END IF;

  PERFORM set_config('app.writer', coalesce(v_prev_writer, ''), true);

  RETURN jsonb_build_object('rows', v_rows, 'measured_at', v_at,
                            'ms', round(extract(epoch FROM clock_timestamp() - v_started) * 1000));
END
$$;
REVOKE ALL ON FUNCTION public.snapshot_stack_coverage(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.snapshot_stack_coverage(text) TO service_role;

COMMENT ON FUNCTION public.snapshot_stack_coverage(text) IS
'Sanctioned writer of stack_coverage_snapshots (migration 20261007234000): one reading = one row per stack from stack_coverage(NULL) at the transaction clock (now()), ON CONFLICT DO NOTHING so the same clock is never written twice, one write_receipts row per call that wrote, app.writer set for the call and restored. p_registered_by names the caller (session, job, migration). Returns {rows, measured_at, ms}. SECURITY DEFINER, EXECUTE for service_role only. About 1 s on prod (the cost of stack_coverage). No schedule yet; the lead calls it after each registry change until the owner''s standing-runner ruling.';

-- 3. The reader --------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_stack_coverage_series AS
SELECT measured_at,
       count(*)::integer                                   AS stacks,
       count(*) FILTER (WHERE coverage >= 0.9)::integer    AS showable,
       count(*) FILTER (WHERE coverage > 0)::integer       AS nonzero,
       round(avg(coverage), 4)                             AS mean_coverage,
       sum(n_present)::integer                             AS needs_present,
       sum(n_needs)::integer                               AS needs
FROM public.stack_coverage_snapshots
GROUP BY measured_at
ORDER BY measured_at;
REVOKE ALL ON public.v_stack_coverage_series FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_stack_coverage_series TO service_role;
COMMENT ON VIEW public.v_stack_coverage_series IS
'One row per coverage reading (stack_coverage_snapshots.measured_at): stacks read, showable (coverage >= 0.9), nonzero, mean coverage (4 decimals), needs present of needs. The registry''s expansion as a time series; compare readings, not stacks, across versions. service_role reads.';

-- 4. Registry ------------------------------------------------------------------------------------------------------------------
INSERT INTO public.pipeline_registry (table_name, column_name, owned_by, description, do_not_write_directly, write_via)
SELECT 'stack_coverage_snapshots', NULL, 'snapshot_stack_coverage',
       'Time series of stack coverage: one row per stack version per reading of stack_coverage(); append-only; keyed to stacks.',
       true,
       'snapshot_stack_coverage(text) only (SECURITY DEFINER, service_role; one call per reading; write_receipts). No schedule yet (standing-runner ruling pending); the lead calls it after each registry change. Migration 20261007234000.'
WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_registry WHERE table_name = 'stack_coverage_snapshots' AND column_name IS NULL);

COMMIT;
