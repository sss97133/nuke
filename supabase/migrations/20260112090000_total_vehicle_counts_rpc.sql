-- Total vehicle counts (public-safe aggregate)
-- Exposes *counts only* across all vehicles (public + private), for UI badges/tooltips.
-- IMPORTANT: This bypasses RLS via SECURITY DEFINER, but returns only an integer count.

CREATE OR REPLACE FUNCTION public.get_total_vehicle_count(
  make_prefix TEXT DEFAULT NULL,
  model_contains TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::int
  FROM public.vehicles v
  WHERE v.status <> 'pending'
    AND (
      make_prefix IS NULL
      OR btrim(make_prefix) = ''
      OR v.make ILIKE (btrim(make_prefix) || '%')
    )
    AND (
      model_contains IS NULL
      OR btrim(model_contains) = ''
      OR v.model ILIKE ('%' || btrim(model_contains) || '%')
    );
$$;

REVOKE ALL ON FUNCTION public.get_total_vehicle_count(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_total_vehicle_count(TEXT, TEXT) TO anon, authenticated, service_role;

