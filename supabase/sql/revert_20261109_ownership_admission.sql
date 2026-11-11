-- Full revert of 20261109055301 + 20261109070000 on the live database (run as the database owner).
-- 1) restore every row a re-derivation run changed (replace the run id; repeat per run):
--      SELECT * FROM public.rollback_ownership_role_rederivation('<run_id>', 'revert', false);
-- 2) restore the pre-repair functions from the backup taken before apply:
DO $revert$
DECLARE d record;
BEGIN
  FOR d IN SELECT definition FROM public.backup_20261109_ownership_admission_fn LOOP EXECUTE d.definition; END LOOP;
END $revert$;
-- 3) the producer, its helper and its backup table may stay (they change nothing unless called); to remove them:
--      DROP FUNCTION public.rederive_vehicle_ownership_roles(uuid, text, uuid, boolean);
--      DROP FUNCTION public.current_title_verification_ids(uuid, uuid);
--    (keep rollback_ownership_role_rederivation and ownership_role_rederivation_backup as the audit trail.)
