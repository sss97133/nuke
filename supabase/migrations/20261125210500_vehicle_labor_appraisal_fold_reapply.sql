-- labor_fold_v1, re-applied. The 2026-11-25 deploy of 20261125153000 stopped at its closure check:
-- labor_fold_logic_unlisted() hit the 120 s statement_timeout (the planner re-ran the regexp over every listed body
-- once per public function). psql applies a file statement by statement, so the tables, the rule list, the compute
-- and the slow check landed; the reader, the fold, the signal triggers, the two patches, the seed and its cron did not.
-- 20261125153000 now materializes the check's CTEs (25 ms live, result NULL: every callee listed) and is idempotent
-- (tables IF NOT EXISTS, rule rows ON CONFLICT, the rename and both patches guarded by their markers, triggers dropped
-- and created, the cron unscheduled and scheduled), so this file applies it again, whole.
-- Test: supabase/sql/test_vehicle_labor_appraisal_fold.sql applies 20261125153000 twice, then this file.
\ir 20261125153000_vehicle_labor_appraisal_fold.sql
