-- Profile overhaul (synthesis fix #11): un-gray garage cards whose vehicles
-- have images but no is_primary flag.
--
-- get_first_image_batch (the garage-card fallback when
-- vehicles.primary_image_url is NULL) hard-required is_primary = true, so a
-- vehicle with zero flagged primaries returned nothing and the card rendered
-- the 0.3-opacity gray placeholder forever. Measured case: 1984 K10 SWB
-- 6442df03-9cac-43a8-b89e-e4fb4c08ee99 -- 484 images, 0 primary.
--
-- Amendment: keep the is_primary preference, but FALL BACK to the newest
-- owner-trust image (iphoto / user_upload / manual / tech_capture /
-- photo_auto_sync) when no primary exists. Scoped to owner-trust sources to
-- respect the restoration-lead-image rule (owner-trust sources only); all
-- other quality gates from the prod definition are preserved verbatim.
--
-- NOTE (drift repair): the prod definition of this function was never
-- committed to the repo. This migration is now the committed source of
-- truth; the return signature (vehicle_id uuid, image_url text) is preserved
-- exactly.

CREATE OR REPLACE FUNCTION public.get_first_image_batch(vehicle_ids uuid[])
RETURNS TABLE(vehicle_id uuid, image_url text)
LANGUAGE sql
STABLE
AS $function$
  SELECT DISTINCT ON (vi.vehicle_id)
    vi.vehicle_id, vi.image_url
  FROM vehicle_images vi
  WHERE vi.vehicle_id = ANY(vehicle_ids)
    AND vi.image_url IS NOT NULL
    AND vi.is_duplicate IS NOT TRUE
    AND COALESCE(vi.is_superseded, false) = false
    AND COALESCE(vi.is_document, false) = false
    AND COALESCE(vi.image_vehicle_match_status, 'pending')
        NOT IN ('mismatch', 'unrelated')
    AND COALESCE(vi.source, '') NOT IN ('ssd_blast', 'drop-folder', 'hd_archive')
    AND (
      vi.image_url NOT LIKE '%/storage/v1/object/public/vehicle-photos/%'
      OR position(vi.vehicle_id::text in vi.image_url) > 0
    )
    -- Explicit primary flag is preferred (the unique partial index
    -- vehicle_images_one_primary_per_vehicle_idx guarantees at most one).
    -- When a vehicle has NO primary, fall back to its newest owner-trust
    -- image rather than returning nothing (permanently gray card).
    AND (
      vi.is_primary = true
      OR vi.source IN ('iphoto', 'user_upload', 'manual', 'tech_capture', 'photo_auto_sync')
    )
  ORDER BY
    vi.vehicle_id,
    (vi.is_primary = true) DESC,
    COALESCE(vi.taken_at, vi.created_at) DESC NULLS LAST;
$function$;

COMMENT ON FUNCTION public.get_first_image_batch(uuid[]) IS
  'Garage-card image fallback: prefers the flagged primary image, falls back to the newest owner-trust image (iphoto/user_upload/manual/tech_capture/photo_auto_sync) when no primary exists.';

-- One-row data fix: flag a primary for the 1984 K10 SWB so the canonical
-- path (vehicles.primary_image_url backfill + primary-first ordering) also
-- works. Picks the newest non-duplicate, non-document owner-trust image
-- (measured pick: 65a7ef08-1f9f-4a1a-949c-2edc766a325d, iphoto,
-- taken 2026-03-24). The NOT EXISTS guard makes this a no-op if a primary
-- has appeared since, protecting the partial unique index
-- vehicle_images_one_primary_per_vehicle_idx.
UPDATE vehicle_images
SET is_primary = true
WHERE id = (
  SELECT id FROM vehicle_images
  WHERE vehicle_id = '6442df03-9cac-43a8-b89e-e4fb4c08ee99'
    AND source IN ('iphoto', 'user_upload', 'manual', 'tech_capture', 'photo_auto_sync')
    AND COALESCE(is_duplicate, false) = false
    AND COALESCE(is_document, false) = false
  ORDER BY COALESCE(taken_at, created_at) DESC
  LIMIT 1
)
AND NOT EXISTS (
  SELECT 1 FROM vehicle_images
  WHERE vehicle_id = '6442df03-9cac-43a8-b89e-e4fb4c08ee99'
    AND is_primary = true
);
