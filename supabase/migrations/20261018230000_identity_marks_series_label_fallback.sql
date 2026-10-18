-- resolve_vehicle_identity_marks: a recorded series that is not a series code no longer hides the family's.
-- vehicles.series often holds a tonnage or generation label ('1/2 Ton', '3rd Gen'); the resolver demanded the mark's
-- series_code match it and never fell back to the family, so a 1984 C10 with series '1/2 Ton' and a Silverado trim got
-- no SILVERADO 10 plate. The family match now applies whether or not a series is recorded. vehicle_profile_read keeps a
-- series-coded mark only when the vehicle's own model/series/trim text carries the code, so a family match cannot add a
-- series the record does not name.
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.resolve_vehicle_identity_marks(
  p_brand text,
  p_family text DEFAULT NULL,
  p_year integer DEFAULT NULL,
  p_series text DEFAULT NULL,
  p_trim text DEFAULT NULL,
  p_body text DEFAULT NULL
)
RETURNS SETOF public.vehicle_identity_marks
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH args AS (
    SELECT
      nullif(btrim(p_brand), '') AS brand,
      nullif(btrim(p_family), '') AS family,
      p_year AS yr,
      nullif(btrim(p_series), '') AS series,
      nullif(btrim(p_trim), '') AS trim_pkg,
      nullif(btrim(p_body), '') AS body
  )
  SELECT m.*
  FROM public.vehicle_identity_marks m
  CROSS JOIN args a
  WHERE m.vetted = true
    AND a.brand IS NOT NULL
    AND lower(m.brand) = lower(a.brand)
    AND (
      a.family IS NULL
      OR m.family IS NULL
      OR lower(m.family) = lower(a.family)
      OR lower(coalesce(m.series_code, '')) = lower(a.family)
      OR position(lower(m.family) in lower(a.family)) > 0
      OR (
        lower(m.family) = 'pickup'
        AND (
          lower(a.family) IN (
            'c10', 'k10', 'c20', 'k20', 'c30', 'k30', 'r10', 'v10', 'r20', 'v20',
            '3100', '3600', '3800', 'apache', 'cameo', 'silverado',
            'c1500', 'k1500', 'c2500', 'k2500', 'c3500', 'k3500',
            'sierra', 'syclone', 's10', 's-10', 'sonoma', 'caballero',
            'f-1', 'f-100', 'f-150', 'f-250', 'f-350', 'f-450',
            'power wagon', 'd100', 'd150', 'w100', 'w150', 'w200', 'c/k'
          )
          OR lower(a.family) ~ '\y(pickup|c10|k10|c20|k20|c30|k30|3100|3600|apache|cameo|silverado|c1500|k1500|sierra|syclone|f-100|f-150|f-250|f-350|power wagon)\y'
        )
      )
    )
    AND (a.yr IS NULL OR (a.yr >= m.year_start AND a.yr <= m.year_end))
    AND (
      m.series_code IS NULL
      OR (
        a.series IS NOT NULL
        AND (
          lower(m.series_code) = lower(a.series)
          OR position(lower(m.series_code) in lower(a.series)) > 0
          OR (lower(a.series) = 'k10' AND lower(m.series_code) = 'c10')
          OR (lower(a.series) = 'k20' AND lower(m.series_code) = 'c20')
          OR (lower(a.series) = 'k30' AND lower(m.series_code) = 'c30')
          OR (lower(a.series) = 'k1500' AND lower(m.series_code) = 'c1500')
        )
      )
      OR (
        a.family IS NOT NULL
        AND (
          lower(m.series_code) = lower(a.family)
          OR position(lower(m.series_code) in lower(a.family)) > 0
          OR (lower(a.family) = 'k10' AND lower(m.series_code) = 'c10')
          OR (lower(a.family) = 'k20' AND lower(m.series_code) = 'c20')
          OR (lower(a.family) = 'k30' AND lower(m.series_code) = 'c30')
          OR (lower(a.family) = 'k1500' AND lower(m.series_code) = 'c1500')
        )
      )
      OR (
        a.series IS NULL
        AND a.trim_pkg IS NULL
        AND a.body IS NULL
        AND lower(coalesce(a.family, '')) IN ('', 'pickup', 'c/k')
      )
    )
    AND (
      m.trim_package IS NULL
      OR (
        a.trim_pkg IS NOT NULL
        AND (
          lower(m.trim_package) = lower(a.trim_pkg)
          OR lower(regexp_replace(m.trim_package, '\s*\(.*$', '')) = lower(a.trim_pkg)
        )
      )
      OR (
        a.trim_pkg IS NULL
        AND a.family IS NOT NULL
        AND (
          (
            position(lower(m.trim_package) in lower(a.family)) > 0
            AND NOT (lower(m.trim_package) = 'cheyenne' AND position('cheyenne super' in lower(a.family)) > 0)
            AND NOT (lower(m.trim_package) = 'custom' AND (position('custom deluxe' in lower(a.family)) > 0 OR position('super custom' in lower(a.family)) > 0))
            AND NOT (lower(m.trim_package) = 'sierra' AND (position('sierra grande' in lower(a.family)) > 0 OR position('sierra classic' in lower(a.family)) > 0 OR position('high sierra' in lower(a.family)) > 0))
          )
        )
      )
      OR (
        a.series IS NULL
        AND a.trim_pkg IS NULL
        AND a.body IS NULL
        AND lower(coalesce(a.family, '')) IN ('', 'pickup', 'c/k')
      )
    )
    AND (
      m.body_style IS NULL
      OR (
        a.body IS NOT NULL
        AND (
          lower(m.body_style) = lower(a.body)
          OR position(lower(m.body_style) in lower(a.body)) > 0
          OR position(lower(a.body) in lower(m.body_style)) > 0
        )
      )
      OR (
        a.body IS NULL
        AND a.family IS NOT NULL
        AND position(lower(m.body_style) in lower(a.family)) > 0
      )
      OR (
        a.series IS NULL
        AND a.trim_pkg IS NULL
        AND a.body IS NULL
        AND lower(coalesce(a.family, '')) IN ('', 'pickup', 'c/k')
      )
    )
  ORDER BY
    (m.trim_package IS NOT NULL) DESC,
    (m.series_code IS NOT NULL) DESC,
    (m.body_style IS NOT NULL) DESC,
    (m.family IS NOT NULL) DESC,
    (m.year_end - m.year_start) ASC,
    m.year_start DESC;
$function$;

GRANT EXECUTE ON FUNCTION public.resolve_vehicle_identity_marks(text, text, integer, text, text, text) TO anon, authenticated, service_role;

COMMIT;
