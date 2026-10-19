-- Superseded, never applied: this first issue failed on apply (supabase-deploy 38504896966, 2026-10-14 03:11Z,
-- "permission denied for table job": it updated cron.job directly) and its transaction rolled back whole.
-- The working issue is 20261014031500_treemap_refresh_daily_reissue.sql, which uses cron.alter_job and cron.schedule.
-- Kept as a no-op so a replay of the migration history passes over it.
SELECT 1;
