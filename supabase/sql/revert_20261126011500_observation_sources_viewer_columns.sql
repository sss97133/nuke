-- Revert of 20261126011500_observation_sources_viewer_columns: table-level SELECT for anon and authenticated again
-- (all 26 columns, as before). Rows stay governed by the unchanged policy.
SET lock_timeout = '5s';
SET statement_timeout = '60s';
GRANT SELECT ON public.observation_sources TO anon, authenticated;
