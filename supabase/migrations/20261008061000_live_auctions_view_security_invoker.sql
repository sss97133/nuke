-- 20261008061000_live_auctions_view_security_invoker.sql
--
-- Close a read door found by the describe-batch10 lane while describing monitored_auctions (PR #838): public.live_auctions_view
-- is owned by postgres (which has BYPASSRLS) and does not set security_invoker, over monitored_auctions JOIN
-- live_auction_sources, both with RLS on and no policy, while anon and authenticated hold SELECT on the view. So anon reads 0
-- rows of either table at /rest/v1 but every live monitor through the view: 1,436 rows on 2026-10-07 17:12Z (counted under
-- SET LOCAL ROLE anon in a read-only transaction), each with external_auction_url, current_bid_cents, bid_count,
-- high_bidder_username, reserve_status and auction_end_time.
--
-- EVIDENCE (read-only, prod, 2026-10-07 17:08-17:12Z): pg_class.reloptions empty for the view (no security_invoker); owner
-- postgres; pg_depend lists no dependent view; the view has no comment. No reader on origin/main 437a022ae in
-- nuke_frontend/src, mcp-server, apps or supabase/functions (the live surfaces read monitored_auctions through
-- get_live_auction_health and service-role clients).
--
-- WHAT: ALTER VIEW ... SET (security_invoker = true), so a reader sees what the two tables' policies allow that reader: anon and
-- authenticated 0 rows until a policy admits them, service_role every row. The definition and the grants are unchanged. A
-- comment on the view records the change. Idempotent.
-- Reversal: ALTER VIEW public.live_auctions_view RESET (security_invoker);
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

ALTER VIEW public.live_auctions_view SET (security_invoker = true);

COMMENT ON VIEW public.live_auctions_view IS
'Live auction monitors (monitored_auctions rows with is_live true) joined to their platform (live_auction_sources): bid in cents and dollars, bid count, high bidder, reserve status, end time, seconds remaining, soft-close state and last sync, soonest end first. security_invoker since 2026-10-07 (20261008061000): a reader sees what the two tables'' policies allow that reader (on 2026-10-07 no policy admits anon or authenticated, so they read 0 rows; service_role reads all). Before that the view ran with the rights of its owner postgres and showed anon every live row (1,436 on 2026-10-07 17:12Z, with high_bidder_username). No reader in the repo on 2026-10-07.';

DO $$
DECLARE
  opts text := coalesce((SELECT reloptions::text FROM pg_class WHERE oid = 'public.live_auctions_view'::regclass), '');
BEGIN
  IF opts NOT ILIKE '%security_invoker=true%' THEN
    RAISE EXCEPTION 'live_auctions_view is not security_invoker (reloptions %)', opts;
  END IF;
  RAISE NOTICE 'live_auctions_view: security_invoker on';
END $$;

COMMIT;
