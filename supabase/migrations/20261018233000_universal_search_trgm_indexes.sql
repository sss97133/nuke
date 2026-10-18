-- universal-search runs its entity searches in parallel and answers when the slowest one finishes. Two of them had no index for their
-- leading-wildcard ilike and read the whole table on every text query (measured 2026-10-18 02:5xZ, cold cache):
--   external_identities: handle ILIKE '%q%' OR display_name ILIKE '%q%', a sequential scan of 748k rows / 31.5k blocks, 6.7-7.8 s;
--   businesses (a view over organizations): business_name ILIKE '%q%', 4.5k wide rows / 2k blocks, 1.0-1.6 s.
-- Logged out, 'porsche 911' took 21-46 s end to end and 'FJ40' 1.0-1.4 s. Trigram GIN indexes let both reads touch only matching rows
-- (the function reads with the service role, so the row policies do not stop ilike from using them). The columns are short (about
-- 9 characters each in external_identities), so the indexes are small.
-- No BEGIN: CREATE INDEX CONCURRENTLY cannot run in a transaction block, and it does not block the lanes writing these tables. It does
-- wait for older transactions to finish; with lock_timeout at 10 s, #1754 and #1900 timed out in that wait while 50-70 s backfill
-- transactions were open, so lock_timeout here is 90 s. The wait takes no lock that blocks reads or writes.
-- Revert: DROP INDEX CONCURRENTLY IF EXISTS public.idx_external_identities_handle_trgm, then the same for
-- idx_external_identities_display_name_trgm and idx_organizations_business_name_trgm.
SET statement_timeout = '120s';
SET lock_timeout = '90s';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_external_identities_handle_trgm
  ON public.external_identities USING gin (handle gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_external_identities_display_name_trgm
  ON public.external_identities USING gin (display_name gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organizations_business_name_trgm
  ON public.organizations USING gin (business_name gin_trgm_ops);
