-- Repair backlog: the data model's own work queue, read from the database. Read-only; installs nothing.
-- The ranking lives in the view public.v_residual (migration 20261006210524_v_residual_ranked_backlog.sql, case C28,
-- data-machine-cases.md section 12): one row per live, non-scratch table, with its open gaps and rows x gaps. This
-- script reads the top of it, so the standing repair loop takes the top unowned row instead of a lead re-deriving the
-- order from memos. Gap kinds follow data-machine.md, repair loop step 2:
--   describe : a column without COMMENT ON, or no table purpose        (Cartographer lane)
--   key      : no foreign key in or out                                 (Keys lane)
--   owner    : written, with no pipeline_registry row or with an undeclared writer in the last 30 d
--   reader   : written but never read since the stats reset             (a fold with no reader)
--   assay    : an active cron job names the table and none of those jobs carries an assay in v_job_health
-- Clocks (event vs ingest declared per event table) are not measured here: they live in column
-- comments and need the Cartographer's parse. Match rates for text columns that name an entity
-- (the Keys worklist) need sampled probes, not metadata; see the lane C entity-text-field memo.
-- Limits: est_rows are planner estimates; reads/writes count since the last stats reset; a
-- declared owner is a declaration, not verified responsibility; absence of a gap here is not
-- semantic completeness. The view's column comments hold the full definitions.
-- Run: scripts/data/q.sh "$(cat scripts/discovery/repair-backlog.sql)"
SELECT table_name, activity, est_rows, cols_undescribed, gaps, n_gaps, rank_mrows
FROM public.v_residual
WHERE n_gaps > 0
ORDER BY rank_mrows DESC, est_rows DESC
LIMIT 50;
