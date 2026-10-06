-- Repair backlog: the data model's own work queue, read from the atlas. Read-only; installs nothing.
-- One row per live, non-scratch table that still has a model gap, ranked by rows x gaps, so the
-- standing repair loop (data-machine-cases.md section 12) takes the top unowned row instead of a
-- lead re-deriving the order from memos. Gap kinds follow data-machine.md, repair loop step 2:
--   describe : a column without COMMENT ON, or no table purpose        (Cartographer lane)
--   key      : no foreign key in or out                                 (Keys lane)
--   owner    : written in 30 d with no pipeline_registry row, or by an undeclared writer
--   reader   : written but never read since the stats reset             (a fold with no reader)
--   assay    : a cron writes it and none of those jobs carries an assay in v_job_health
-- Clocks (event vs ingest declared per event table) are not measured here: they live in column
-- comments and need the Cartographer's parse. Match rates for text columns that name an entity
-- (the Keys worklist) need sampled probes, not metadata; see the lane C entity-text-field memo.
-- Limits: est_rows are planner estimates; reads/writes count since the last stats reset; a
-- declared owner is a declaration, not verified responsibility; absence of a gap here is not
-- semantic completeness. Run: scripts/data/q.sh "$(cat scripts/discovery/repair-backlog.sql)"
WITH assayed AS (
  SELECT jobname FROM public.v_job_health WHERE active AND assay_status IS NOT NULL
), t AS (
  SELECT a.table_name, a.activity, coalesce(a.est_rows, 0) AS est_rows,
         a.n_cols, a.n_cols_described,
         (a.n_cols_described < a.n_cols OR a.purpose IS NULL) AS gap_describe,
         (coalesce(a.fk_in, 0) + coalesce(a.fk_out, 0) = 0) AS gap_key,
         (a.activity = 'written'
            AND (coalesce(a.registry_fields, 0) = 0 OR coalesce(a.undeclared_stmts_30d, 0) > 0)) AS gap_owner,
         (a.activity = 'written' AND coalesce(a.reads_since_stats_reset, 0) = 0) AS gap_reader,
         (a.crons_mentioning IS NOT NULL AND array_length(a.crons_mentioning, 1) > 0
            AND NOT EXISTS (SELECT 1 FROM assayed s WHERE s.jobname = ANY (a.crons_mentioning))) AS gap_assay
  FROM public.v_schema_atlas a
  WHERE coalesce(a.est_rows, 0) > 0
    AND a.activity <> 'idle'
    AND a.table_name NOT LIKE '\_%'
    AND a.table_name NOT LIKE 'zz_backup%'
    AND a.table_name NOT LIKE 'scratch%'
)
SELECT table_name, activity, est_rows,
       (n_cols - n_cols_described) AS cols_undescribed,
       array_remove(ARRAY[
         CASE WHEN gap_describe THEN 'describe' END,
         CASE WHEN gap_key      THEN 'key'      END,
         CASE WHEN gap_owner    THEN 'owner'    END,
         CASE WHEN gap_reader   THEN 'reader'   END,
         CASE WHEN gap_assay    THEN 'assay'    END], NULL) AS gaps,
       (gap_describe::int + gap_key::int + gap_owner::int + gap_reader::int + gap_assay::int) AS n_gaps,
       round(est_rows * (gap_describe::int + gap_key::int + gap_owner::int + gap_reader::int + gap_assay::int)
             / 1e6, 1) AS rank_mrows
FROM t
WHERE gap_describe OR gap_key OR gap_owner OR gap_reader OR gap_assay
ORDER BY rank_mrows DESC, est_rows DESC
LIMIT 50;
