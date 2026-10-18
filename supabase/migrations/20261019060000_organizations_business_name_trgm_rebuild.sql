-- 20261018233000 built idx_external_identities_handle_display_name_trgm (valid), then its CREATE INDEX CONCURRENTLY of
-- idx_organizations_business_name_trgm hit the 90 s lock_timeout waiting for an older transaction to finish (deploy run 39101484475,
-- 2026-10-18 05:45Z) and left the index INVALID: still written on every organizations change, never used by universal-search's
-- business_name ilike. Drop it and build it again. organizations is 5.7k rows, so the build itself takes about a second.
-- No BEGIN: DROP/CREATE INDEX CONCURRENTLY cannot run in a transaction block; neither blocks reads or writes while it waits.
-- Live reads run under a 10 s statement budget, so this does too: a lock wait past 5 s fails the build and can leave the
-- index INVALID again; the DROP above makes a rerun in a quiet deploy slot repair it.
-- Revert: DROP INDEX CONCURRENTLY IF EXISTS public.idx_organizations_business_name_trgm;
SET statement_timeout = '10s';
SET lock_timeout = '5s';
DROP INDEX CONCURRENTLY IF EXISTS public.idx_organizations_business_name_trgm;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organizations_business_name_trgm
  ON public.organizations USING gin (business_name gin_trgm_ops);
