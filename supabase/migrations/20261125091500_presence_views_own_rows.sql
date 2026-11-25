-- presence_views_own_rows_v1: user_presence and vehicle_views answer a caller only its own rows.
--
-- WHY. Measured live 2026-11-24 (Pacific): both tables had SELECT policies USING (true) for PUBLIC and for
-- anon/authenticated, so a logged-out caller read every row: user_presence 50,427 rows (869 naming a user, 3 users;
-- 46 of those on non-public vehicles), vehicle_views 35,517 rows (5,898 naming a user). Each row is (user_id,
-- vehicle_id, time): who looked at which car, when. Their INSERT policies were WITH CHECK (true) for PUBLIC, so any
-- caller could also file a row naming another user.
--
-- CONSUMERS (grep of web, iOS, edge functions, scripts; pg_proc, pg_views, pg_policy, pg_trigger live):
--   * web VehicleProfileContext: inserts a vehicle_views row (return=minimal) and upserts its own user_presence row.
--     Nothing in the web or iOS reads either table back; no "N viewing" counter exists.
--   * get_vehicle_feed_data (SECURITY INVOKER) counts vehicle_views per car as view_count. Its only caller is
--     scripts/monitor-completion-progress.js; an API caller now counts only its own views there.
--   * scripts/backfill-analysis-signals.mjs reads vehicle_views with the service key (RLS does not apply).
--   * update_user_presence / cleanup_old_presence: not executable by anon or authenticated.
-- If a page needs a count, it gets a SECURITY DEFINER function returning a number, never rows.
--
-- RULE. SELECT: authenticated, user_id = auth.uid(). INSERT: anon and authenticated, user_id null or the caller's
-- own id. UPDATE on user_presence stays user_presence_update_self (own row). An upsert (ON CONFLICT DO UPDATE)
-- checks the SELECT policy on the new row, so an anonymous presence heartbeat (user_id null) is refused; the web
-- now sends the heartbeat only when signed in (same change).
--
-- REVERT. supabase/sql/revert_20261125091500_presence_views_own_rows.sql
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DROP POLICY IF EXISTS "Anyone can view presence" ON public.user_presence;
DROP POLICY IF EXISTS user_presence_select_all ON public.user_presence;
DROP POLICY IF EXISTS "Anyone can create presence" ON public.user_presence;
DROP POLICY IF EXISTS user_presence_insert_any ON public.user_presence;
DROP POLICY IF EXISTS user_presence_select_own ON public.user_presence;
DROP POLICY IF EXISTS user_presence_insert_own ON public.user_presence;

CREATE POLICY user_presence_select_own ON public.user_presence
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY user_presence_insert_own ON public.user_presence
  FOR INSERT TO anon, authenticated WITH CHECK (user_id IS NULL OR user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS view_select ON public.vehicle_views;
DROP POLICY IF EXISTS view_insert ON public.vehicle_views;
DROP POLICY IF EXISTS vehicle_views_select_own ON public.vehicle_views;
DROP POLICY IF EXISTS vehicle_views_insert_own ON public.vehicle_views;

CREATE POLICY vehicle_views_select_own ON public.vehicle_views
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY vehicle_views_insert_own ON public.vehicle_views
  FOR INSERT TO anon, authenticated WITH CHECK (user_id IS NULL OR user_id = (SELECT auth.uid()));

COMMENT ON TABLE public.user_presence IS
  'A signed-in user''s last-seen time on a vehicle page. Each caller reads only its own rows (20261125091500); a count for a page comes from a definer function, never rows.';
COMMENT ON TABLE public.vehicle_views IS
  'One row per vehicle page view. Each caller reads only its own rows (20261125091500); a count for a page comes from a definer function, never rows.';
