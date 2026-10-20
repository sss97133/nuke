-- Activity bubbles for strangers: per-day counts of a user's photos, events and work sessions, never the images.
-- The existing get_user_contribution_days counts private-vehicle photos too and is authenticated-only, so strangers got
-- nothing (and a 401 on every profile load). This wrapper answers the owner always, and anyone else only when the profile
-- is public and the owner has not switched activity off (profiles.activity_public, default on).
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS activity_public boolean NOT NULL DEFAULT true;
GRANT SELECT (activity_public) ON public.profiles TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_user_activity_days(p_user_id uuid)
RETURNS TABLE(day date, kind text, n integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT c.day, c.kind, c.n
  FROM public.get_user_contribution_days(p_user_id) c
  WHERE auth.uid() = p_user_id
     OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id AND p.is_public IS TRUE AND p.activity_public IS TRUE);
$$;
REVOKE ALL ON FUNCTION public.get_user_activity_days(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_activity_days(uuid) TO anon, authenticated;
