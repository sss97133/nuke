-- Revert 20261125021500_vendor_organization_proposals: the job, the fold and its tables go. Register rows the fold
-- promoted stay (their basis names the proposal id); undo one by restoring its decision through a reviewed migration.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $$ BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'vendor-organization-proposals'; END IF;
END $$;
DROP FUNCTION IF EXISTS public.vendor_organization_proposals_fold(text);
DROP FUNCTION IF EXISTS public.vendor_organization_proposals_due();
DROP TABLE IF EXISTS public.vendor_organization_proposals;
DROP TABLE IF EXISTS public.vendor_organization_proposal_rules;
COMMIT;
