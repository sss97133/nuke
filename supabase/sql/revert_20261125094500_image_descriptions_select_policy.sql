-- Revert of 20261125094500_image_descriptions_select_policy.sql: puts back the SELECT policy production held on
-- 2026-11-24 (FOR SELECT TO public USING (true)). This re-opens every description, unfiled photos included, to anon.
SET statement_timeout = '30s';
SET lock_timeout = '5s';

ALTER POLICY image_descriptions_select ON public.image_descriptions USING (true);
COMMENT ON POLICY image_descriptions_select ON public.image_descriptions IS NULL;
