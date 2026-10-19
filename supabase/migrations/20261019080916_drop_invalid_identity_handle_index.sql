-- Deploy run 39220404684 applied 20261014001500_actor_profile_read.sql and its CREATE INDEX CONCURRENTLY hit the
-- 10s lock timeout, leaving external_identities_platform_lower_handle_idx invalid: unused by the planner, still
-- maintained on every write, and refused by that migration's own preflight. Nothing after the build ran.
-- Drop only an invalid copy so 20261014001500 can be re-applied through the deploy workflow's migration_file input.
-- DROP INDEX CONCURRENTLY cannot run inside a transaction block.
SET statement_timeout = '120s';
SET lock_timeout = '10s';

DO $guard$
BEGIN
  IF EXISTS (SELECT FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = 'external_identities_platform_lower_handle_idx'
      AND c.relnamespace = 'public'::regnamespace AND i.indisvalid) THEN
    RAISE EXCEPTION 'external_identities_platform_lower_handle_idx is valid; not dropping it';
  END IF;
END
$guard$;

DROP INDEX CONCURRENTLY IF EXISTS public.external_identities_platform_lower_handle_idx;

RESET lock_timeout;
RESET statement_timeout;
