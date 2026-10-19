-- 20261014001500_actor_profile_read.sql failed twice (deploy runs 39220404684 and 39221750765) on its
-- CREATE INDEX CONCURRENTLY: the 10s lock_timeout expired while the build waited for its table lock or for older
-- transactions, leaving external_identities_platform_lower_handle_idx invalid each time. A concurrent build blocks
-- no reader or writer while it waits, so this builds the same index with a 60s lock wait, after which a re-dispatch
-- of 20261014001500 finds it valid and only installs its functions.
-- Autocommit is required: supabase-deploy.yml applies with psql -f; DROP/CREATE INDEX CONCURRENTLY cannot run in a
-- transaction block. Refuses if the index is already valid, on lock waiters, idle transactions or another build.
SET statement_timeout = '300s';
SET lock_timeout = '60s';

DO $preflight$
BEGIN
  IF EXISTS (SELECT FROM pg_index WHERE indexrelid = to_regclass('public.external_identities_platform_lower_handle_idx')
      AND indisvalid) THEN
    RAISE EXCEPTION 'external_identities_platform_lower_handle_idx is already valid; nothing to rebuild';
  END IF;
  IF EXISTS (SELECT FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock')
    OR EXISTS (SELECT FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND datname = current_database()
      AND state IN ('idle in transaction', 'idle in transaction (aborted)'))
    OR EXISTS (SELECT FROM pg_stat_progress_create_index WHERE pid <> pg_backend_pid()) THEN
    RAISE EXCEPTION 'Identity handle index rebuild requires no lock waiters, idle transactions or active builds';
  END IF;
END
$preflight$;

DROP INDEX CONCURRENTLY IF EXISTS public.external_identities_platform_lower_handle_idx;

CREATE INDEX CONCURRENTLY external_identities_platform_lower_handle_idx
  ON public.external_identities (platform, lower(handle));

DO $verify$
DECLARE
  target oid := to_regclass('public.external_identities_platform_lower_handle_idx');
  expected constant text := 'CREATE INDEX external_identities_platform_lower_handle_idx ON public.external_identities USING btree (platform, lower(handle))';
BEGIN
  IF target IS NULL OR NOT EXISTS (SELECT FROM pg_index WHERE indexrelid = target AND indisvalid AND indisready AND indislive)
    OR pg_get_indexdef(target) IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'Identity handle index is not valid with the expected definition after rebuild';
  END IF;
END
$verify$;

RESET lock_timeout;
RESET statement_timeout;
