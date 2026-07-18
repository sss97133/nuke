-- 20260524000300_v_vehicle_anchor_view.sql
--
-- Anchor as a VIEW, not a stored field or function call.
--
-- quad's plan was a GENERATED ALWAYS AS (...) STORED column on vehicles. That
-- can't work — Postgres only allows generated columns derived from columns on
-- the SAME row, and the anchor depends on vehicle_images aggregation.
--
-- A VIEW is the right shape: there is no column to set wrong. Querying the
-- view always reflects current substrate. The "tree creates the shadow" —
-- you can't store a stale or contradictory anchor because no storage exists.
--
-- compute_origination_anchor(uuid) (per-row, plpgsql) stays around for ad-hoc
-- diagnostics, but this view is the set-based path the rest of the system
-- should query against.

CREATE OR REPLACE VIEW public.v_vehicle_anchor AS
WITH origin_stats AS (
  SELECT
    vi.vehicle_id,
    count(*) FILTER (WHERE classify_image_origin(vi.source, vi.image_url) = 'owner')   AS owner_photo_count,
    count(*) FILTER (WHERE classify_image_origin(vi.source, vi.image_url) = 'listing') AS listing_photo_count,
    count(*) FILTER (WHERE classify_image_origin(vi.source, vi.image_url) = 'unknown') AS unknown_photo_count,
    count(*)                                                                            AS total_photo_count,
    count(DISTINCT vi.user_id) FILTER (
      WHERE classify_image_origin(vi.source, vi.image_url) = 'owner'
        AND vi.user_id IS NOT NULL
    ) AS distinct_owners,
    mode() WITHIN GROUP (ORDER BY vi.user_id) FILTER (
      WHERE classify_image_origin(vi.source, vi.image_url) = 'owner'
        AND vi.user_id IS NOT NULL
    ) AS dominant_owner
  FROM vehicle_images vi
  GROUP BY vi.vehicle_id
)
SELECT
  v.id AS vehicle_id,
  v.vin,
  v.owner_id,
  v.ownership_verified,
  v.title_status,
  COALESCE(o.owner_photo_count, 0)   AS owner_photo_count,
  COALESCE(o.listing_photo_count, 0) AS listing_photo_count,
  COALESCE(o.unknown_photo_count, 0) AS unknown_photo_count,
  COALESCE(o.total_photo_count, 0)   AS total_photo_count,
  COALESCE(o.distinct_owners, 0)     AS distinct_owners,
  o.dominant_owner,
  -- Anchor selection — strongest claim wins
  CASE
    WHEN v.vin IS NOT NULL AND length(trim(v.vin)) >= 11 THEN 'vin'
    WHEN COALESCE(o.distinct_owners, 0) = 1
         AND COALESCE(o.owner_photo_count, 0) > 0
         AND o.owner_photo_count >= o.total_photo_count * 0.5
      THEN 'owner'
    WHEN COALESCE(o.listing_photo_count, 0) > 0
         AND COALESCE(o.owner_photo_count, 0) = 0
      THEN 'listing'
    ELSE 'unknown'
  END AS anchor_kind,
  CASE
    WHEN v.vin IS NOT NULL AND length(trim(v.vin)) >= 11
      THEN upper(trim(v.vin))
    WHEN COALESCE(o.distinct_owners, 0) = 1
         AND COALESCE(o.owner_photo_count, 0) > 0
         AND o.owner_photo_count >= o.total_photo_count * 0.5
      THEN o.dominant_owner::text
    ELSE NULL
  END AS anchor_id,
  -- Tier number for ordering / filtering
  CASE
    WHEN v.vin IS NOT NULL AND length(trim(v.vin)) >= 11 THEN 1
    WHEN COALESCE(o.distinct_owners, 0) = 1
         AND COALESCE(o.owner_photo_count, 0) > 0
         AND o.owner_photo_count >= o.total_photo_count * 0.5
      THEN 2
    WHEN COALESCE(o.listing_photo_count, 0) > 0
         AND COALESCE(o.owner_photo_count, 0) = 0
      THEN 3
    ELSE 4
  END AS anchor_tier
FROM vehicles v
LEFT JOIN origin_stats o ON o.vehicle_id = v.id;

COMMENT ON VIEW public.v_vehicle_anchor IS
'Set-based derivation of every vehicle''s origination anchor (vin/owner/listing/unknown) + photo-origin breakdown. The view IS the anchor — no column to mis-set, no function call per row. Replaces the per-row compute_origination_anchor() in hot paths.';

GRANT SELECT ON public.v_vehicle_anchor TO anon, authenticated;
