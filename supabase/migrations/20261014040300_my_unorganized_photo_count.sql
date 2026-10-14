-- my_unorganized_photo_count: the Inbox badge's number, read up to the 1,000 the badge can show.
--
-- Measured 2026-10-14. The mobile bottom nav (MobileBottomNav) counts the signed-in user's unorganized photos on
-- every route change:
--   select count(id) from vehicle_images where user_id = $1 and vehicle_id is null
--     and (organization_status = 'unorganized' or organization_status is null)      -- PostgREST count=exact
-- pg_stat_statements since 2026-09-29 09:20Z: 476 authenticated calls, mean 2,940 ms, max 14,362 ms, 1,399 s of
-- database time. As authenticated for the owner's account (10,055 unorganized photos): 5,550 ms, 7,067 blocks read
-- from disk, and the same query answered in 43 ms once its pages were cached.
-- Cause: idx_vehicle_images_unorganized (user_id, created_at DESC) WHERE vehicle_id IS NULL finds the user's 11,635
-- rows, but organization_status is not in it, so every row is fetched from the 49 GB heap to read that one column
-- (about one random page per row, 1,580 of them then discarded as ignored or organized). The count is exact because
-- PostgREST asks for count=exact, and the badge never shows it: it prints the number up to 999 and "999+" above.
-- (idx_vehicle_images_orphan_check, a partial index on vehicle_id WHERE vehicle_id IS NULL, is INVALID on production:
-- 0 bytes, indisvalid false; it serves nothing, and it would not serve a per-user filter anyway.)
--
-- This reader stops counting at 1,000, the first number the badge cannot tell from any larger one, so it fetches at
-- most about 1,160 heap rows instead of all of them: 670 blocks read cold, 5 ms warm, against 5,550 ms cold, 43 ms
-- warm. Same rows, same filter, same ordering of nothing (a count): min(count, 1000).
--
-- SECURITY INVOKER, on purpose: the caller's row policies stay in force, so it counts exactly what the old query
-- counted and nothing the policies would hide; user_id = auth.uid() narrows it to the caller's own rows. No new
-- privilege surface, no table, policy or row change, no new index (a partial index would need two passes over the
-- 49 GB heap; the existing one serves the capped read).
--
-- Contract: supabase/sql/test_my_unorganized_photo_count.sql (CI job my-unorganized-photo-count-contract).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';

CREATE OR REPLACE FUNCTION public.my_unorganized_photo_count()
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT count(*)::integer
  FROM (
    SELECT 1
    FROM public.vehicle_images vi
    WHERE vi.user_id = (SELECT auth.uid())
      AND vi.vehicle_id IS NULL
      AND (vi.organization_status = 'unorganized' OR vi.organization_status IS NULL)
    LIMIT 1000
  ) capped
$$;

REVOKE ALL ON FUNCTION public.my_unorganized_photo_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_unorganized_photo_count() TO authenticated, service_role;

COMMENT ON FUNCTION public.my_unorganized_photo_count() IS
  'How many photos the signed-in user has that no vehicle holds yet (vehicle_id null, organization_status unorganized or null), counted up to 1,000: the Inbox badge prints the number to 999 and 999+ above, so it never needs more. SECURITY INVOKER: the caller''s row policies apply and user_id = auth.uid() narrows it to their own rows. Replaces a count=exact PostgREST read of vehicle_images that fetched every one of the user''s unorganized rows from the heap (5,550 ms cold, 10,055 rows, 2026-10-14). Used by MobileBottomNav.';

COMMIT;

-- Live verification (after apply), as authenticated through PostgREST:
--   POST /rest/v1/rpc/my_unorganized_photo_count {}   -- an integer, 1000 for an account with more than 999; well under a second cold
