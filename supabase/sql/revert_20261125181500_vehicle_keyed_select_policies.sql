-- Revert of 20261125181500_vehicle_keyed_select_policies.sql: puts back the SELECT policies production held on
-- 2026-11-25. This re-opens every tag and every scan session, private and deleted cars included, to anon and to every
-- signed-in user.
SET statement_timeout = '30s';
SET lock_timeout = '5s';

BEGIN;
DROP POLICY IF EXISTS image_tags_select ON public.image_tags;
DROP POLICY IF EXISTS "Image tags are publicly viewable" ON public.image_tags;
DROP POLICY IF EXISTS "Public tag reading" ON public.image_tags;
DROP POLICY IF EXISTS image_tags_select_all ON public.image_tags;
CREATE POLICY "Image tags are publicly viewable" ON public.image_tags FOR SELECT USING (true);
CREATE POLICY "Public tag reading" ON public.image_tags FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY image_tags_select_all ON public.image_tags FOR SELECT USING (true);

DROP POLICY IF EXISTS ai_scan_sessions_select ON public.ai_scan_sessions;
DROP POLICY IF EXISTS "Public can view scan sessions" ON public.ai_scan_sessions;
CREATE POLICY "Public can view scan sessions" ON public.ai_scan_sessions FOR SELECT USING (true);
COMMIT;
