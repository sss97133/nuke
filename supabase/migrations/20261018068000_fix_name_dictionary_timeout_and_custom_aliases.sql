-- Superseded, never applied: this first issue failed on apply (supabase-deploy 39019973478, 2026-10-17 09:08Z,
-- "permission denied for table job": it updated cron.job directly) and its transaction rolled back whole.
-- The working issue is 20261018068500_fix_name_dictionary_timeout_and_custom_aliases_reissue.sql, which uses cron.schedule.
-- Kept as a no-op so a replay of the migration history passes over it.
SELECT 1;
