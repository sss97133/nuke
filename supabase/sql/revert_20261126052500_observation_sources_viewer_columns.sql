-- Revert of 20261126052500_observation_sources_viewer_columns: table-level SELECT for anon and authenticated again
-- (all 26 columns, as before). Rows stay governed by the unchanged policy.
SET lock_timeout = '5s';
SET statement_timeout = '60s';
GRANT SELECT ON public.observation_sources TO anon, authenticated;
DO $$ BEGIN
  IF to_regclass('public.private_row_probes') IS NOT NULL THEN
    DELETE FROM public.private_row_probes WHERE relation = 'observation_sources' AND subject_kind = 'private_column'
       AND subject_column IN ('notes', 'trust_factors') AND owner_lane = 'ta-readers';
  END IF;
END $$;
