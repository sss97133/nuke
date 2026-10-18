-- vehicles' canonical-columns trigger resolves its helpers in public, whatever the caller's search_path.
-- Session cb179857, 2026-09-27.
--
-- MEASURED: sync-live-auctions' mirror (upsert_live_auction_listings → vehicle_listings) failed on every chunk at the
-- 20:00Z run — "function resolve_platform_slug(text) does not exist" — and 166 times 02:17–15:45Z. Chain: the
-- vehicle_listings trigger apply_auction_listing_outcome_to_vehicle_timeline runs with search_path='' (an earlier blanket
-- hardening pass) and updates vehicles; vehicles' BEFORE trigger trg_resolve_canonical_columns has NO search_path of its
-- own, inherits '', and cannot find resolve_platform_slug / vehicle_sale_basis unqualified. Every writer with an empty
-- search_path that touches vehicles fails the same way.
-- Fix: pin this trigger function's search_path (it references only public objects). No body change.

SET statement_timeout = '120s';
ALTER FUNCTION public.trg_resolve_canonical_columns() SET search_path = public, pg_temp;
RESET statement_timeout;

-- POST-APPLY: SELECT proconfig FROM pg_proc WHERE proname='trg_resolve_canonical_columns';  -- {search_path=public, pg_temp}
--             next sync-live-auctions run logs "Mirrored N live rows into vehicle_listings".
