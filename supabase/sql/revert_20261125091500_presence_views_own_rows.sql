-- Revert of 20261125091500_presence_views_own_rows: restores the open policies it replaced (live before 2026-11-25).
-- Restoring them re-opens every row of both tables to logged-out callers; run only to undo a breakage.
SET lock_timeout = '5s';
SET statement_timeout = '60s';
DROP POLICY IF EXISTS user_presence_select_own ON public.user_presence;
DROP POLICY IF EXISTS user_presence_insert_own ON public.user_presence;
CREATE POLICY user_presence_select_all ON public.user_presence FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY user_presence_insert_any ON public.user_presence FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS vehicle_views_select_own ON public.vehicle_views;
DROP POLICY IF EXISTS vehicle_views_insert_own ON public.vehicle_views;
CREATE POLICY view_select ON public.vehicle_views FOR SELECT USING (true);
CREATE POLICY view_insert ON public.vehicle_views FOR INSERT WITH CHECK (true);
COMMENT ON TABLE public.user_presence IS NULL;
COMMENT ON TABLE public.vehicle_views IS NULL;
