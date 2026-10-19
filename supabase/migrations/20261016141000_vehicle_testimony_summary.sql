-- vehicle_testimony_summary: a vehicle's testimony counts in one read, as the viewer may read them.
--
-- The showcase (/showcase) printed its testimony breakdown from a 2,000-row read that the API cuts at 1,000 rows,
-- in no order, and took its first and last observed dates from the same sample. On the owner's K5 (7,202 current
-- observations a visitor can read, 2026-10-15) it showed "specification 790, media 201, condition 8" against
-- 2,693 / 1,794 / 2,709. The API refuses aggregate selects (PGRST123), so the counts need a reader.
--
-- Reader: vehicle_testimony_summary(p_vehicle_id uuid) returns one jsonb:
-- {total, by_kind: {kind: n}, first_observed, last_observed} over the vehicle's observations with
-- is_superseded = false (the showcase's own filter); by_kind sums to total. SECURITY INVOKER: row security applies,
-- so a visitor counts the rows a visitor can read (a public vehicle's public kinds) and an owner counts all of
-- theirs. One value, so the API's row cap does not apply. Contract: supabase/sql/test_vehicle_testimony_summary.sql.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.vehicle_testimony_summary(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  WITH k AS (
    SELECT o.kind::text AS kind, count(*) AS n, min(o.observed_at) AS first_at, max(o.observed_at) AS last_at
    FROM public.vehicle_observations o
    WHERE o.vehicle_id = p_vehicle_id AND o.is_superseded = false
    GROUP BY o.kind
  )
  SELECT jsonb_build_object(
    'total', coalesce(sum(k.n), 0)::bigint,
    'by_kind', coalesce(jsonb_object_agg(coalesce(k.kind, 'unknown'), k.n), '{}'::jsonb),
    'first_observed', min(k.first_at),
    'last_observed', max(k.last_at))
  FROM k
$function$;
REVOKE ALL ON FUNCTION public.vehicle_testimony_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_testimony_summary(uuid) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.vehicle_testimony_summary(uuid) IS
  'A vehicle''s current observations (is_superseded = false) as the caller may read them: {total, by_kind, '
  'first_observed, last_observed}, one jsonb (no API row cap). Runs as the caller, so row security decides. '
  'The showcase''s testimony breakdown. 2026-10-15.';

COMMIT;
