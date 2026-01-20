-- Vehicle listing kind classification
--
-- Problem:
-- - Some upstream sources (BaT, Mecum, etc.) include non-vehicle items (parts, tools, memorabilia).
-- - These sometimes get imported into `public.vehicles` and show up in the main vehicle feed.
--
-- Solution:
-- - Add a simple `listing_kind` flag so the app + pipelines can treat these correctly.
-- - Keep this additive + safe for repeated db resets.

BEGIN;

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS listing_kind TEXT NOT NULL DEFAULT 'vehicle'
    CHECK (listing_kind IN ('vehicle', 'non_vehicle_item'));

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS source_listing_category TEXT,
  ADD COLUMN IF NOT EXISTS source_listing_subcategory TEXT;

CREATE INDEX IF NOT EXISTS idx_vehicles_listing_kind ON public.vehicles(listing_kind);
CREATE INDEX IF NOT EXISTS idx_vehicles_non_vehicle_item ON public.vehicles(id)
  WHERE listing_kind = 'non_vehicle_item';
CREATE INDEX IF NOT EXISTS idx_vehicles_source_listing_category ON public.vehicles(source_listing_category);

-- Best-effort backfill for obvious non-vehicle imports.
-- 1) BaT: non-vehicle items frequently have slugs that do not begin with `YYYY-`.
UPDATE public.vehicles v
SET listing_kind = 'non_vehicle_item'
WHERE v.listing_kind = 'vehicle'
  AND COALESCE(v.listing_url, v.discovery_url, v.bat_auction_url) ~* '^https?://(www\\.)?bringatrailer\\.com/listing/(?!\\d{4}-)';

-- 2) Placeholder identity: "N/A" / "unknown" records are rarely real vehicles.
UPDATE public.vehicles v
SET listing_kind = 'non_vehicle_item'
WHERE v.listing_kind = 'vehicle'
  AND (
    lower(coalesce(v.make, '')) in ('n/a', 'na', 'unknown')
    OR lower(coalesce(v.model, '')) in ('n/a', 'na', 'unknown')
  );

-- Keep aggregate counts aligned with the default browse experience.
-- NOTE: This intentionally counts only "real" vehicles (excludes non-vehicle items).
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
    AND v.listing_kind = 'vehicle'
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

COMMIT;

