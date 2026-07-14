-- 20260524000400_v_vehicle_anchor_view_pushdown.sql
--
-- The first cut of v_vehicle_anchor used a CTE that aggregated all of
-- vehicle_images (1M+ rows) before joining to vehicles. The planner couldn't
-- push WHERE vehicle_id = X down into the CTE, so even per-vehicle queries
-- timed out at 10s+.
--
-- This rewrite uses scalar subqueries per derived column. The planner can
-- scope each subquery to the matched vehicles, so per-vehicle queries finish
-- in ms while table-wide queries still work (but cost the obvious O(V*I/V)).

CREATE OR REPLACE VIEW public.v_vehicle_anchor AS
SELECT
  v.id   AS vehicle_id,
  v.vin,
  v.owner_id,
  v.ownership_verified,
  v.title_status,

  (SELECT count(*) FROM vehicle_images vi
    WHERE vi.vehicle_id = v.id
      AND classify_image_origin(vi.source, vi.image_url) = 'owner')   AS owner_photo_count,
  (SELECT count(*) FROM vehicle_images vi
    WHERE vi.vehicle_id = v.id
      AND classify_image_origin(vi.source, vi.image_url) = 'listing') AS listing_photo_count,
  (SELECT count(*) FROM vehicle_images vi
    WHERE vi.vehicle_id = v.id
      AND classify_image_origin(vi.source, vi.image_url) = 'unknown') AS unknown_photo_count,
  (SELECT count(*) FROM vehicle_images vi WHERE vi.vehicle_id = v.id)  AS total_photo_count,

  (SELECT count(DISTINCT vi.user_id) FROM vehicle_images vi
    WHERE vi.vehicle_id = v.id
      AND vi.user_id IS NOT NULL
      AND classify_image_origin(vi.source, vi.image_url) = 'owner')   AS distinct_owners,

  (SELECT mode() WITHIN GROUP (ORDER BY vi.user_id)
     FROM vehicle_images vi
    WHERE vi.vehicle_id = v.id
      AND vi.user_id IS NOT NULL
      AND classify_image_origin(vi.source, vi.image_url) = 'owner')   AS dominant_owner,

  CASE
    WHEN v.vin IS NOT NULL AND length(trim(v.vin)) >= 11 THEN 'vin'
    WHEN (SELECT count(DISTINCT vi.user_id) FROM vehicle_images vi
           WHERE vi.vehicle_id = v.id
             AND vi.user_id IS NOT NULL
             AND classify_image_origin(vi.source, vi.image_url) = 'owner') = 1
         AND (SELECT count(*) FROM vehicle_images vi
               WHERE vi.vehicle_id = v.id
                 AND classify_image_origin(vi.source, vi.image_url) = 'owner') > 0
         AND (SELECT count(*) FROM vehicle_images vi
               WHERE vi.vehicle_id = v.id
                 AND classify_image_origin(vi.source, vi.image_url) = 'owner')
             >= (SELECT count(*) FROM vehicle_images vi WHERE vi.vehicle_id = v.id) * 0.5
      THEN 'owner'
    WHEN (SELECT count(*) FROM vehicle_images vi
           WHERE vi.vehicle_id = v.id
             AND classify_image_origin(vi.source, vi.image_url) = 'listing') > 0
         AND (SELECT count(*) FROM vehicle_images vi
               WHERE vi.vehicle_id = v.id
                 AND classify_image_origin(vi.source, vi.image_url) = 'owner') = 0
      THEN 'listing'
    ELSE 'unknown'
  END AS anchor_kind,

  CASE
    WHEN v.vin IS NOT NULL AND length(trim(v.vin)) >= 11
      THEN upper(trim(v.vin))
    WHEN (SELECT count(DISTINCT vi.user_id) FROM vehicle_images vi
           WHERE vi.vehicle_id = v.id
             AND vi.user_id IS NOT NULL
             AND classify_image_origin(vi.source, vi.image_url) = 'owner') = 1
         AND (SELECT count(*) FROM vehicle_images vi
               WHERE vi.vehicle_id = v.id
                 AND classify_image_origin(vi.source, vi.image_url) = 'owner') > 0
      THEN (SELECT mode() WITHIN GROUP (ORDER BY vi.user_id)::text
              FROM vehicle_images vi
             WHERE vi.vehicle_id = v.id
               AND vi.user_id IS NOT NULL
               AND classify_image_origin(vi.source, vi.image_url) = 'owner')
    ELSE NULL
  END AS anchor_id,

  CASE
    WHEN v.vin IS NOT NULL AND length(trim(v.vin)) >= 11 THEN 1
    WHEN (SELECT count(DISTINCT vi.user_id) FROM vehicle_images vi
           WHERE vi.vehicle_id = v.id
             AND vi.user_id IS NOT NULL
             AND classify_image_origin(vi.source, vi.image_url) = 'owner') = 1
         AND (SELECT count(*) FROM vehicle_images vi
               WHERE vi.vehicle_id = v.id
                 AND classify_image_origin(vi.source, vi.image_url) = 'owner') > 0
      THEN 2
    WHEN (SELECT count(*) FROM vehicle_images vi
           WHERE vi.vehicle_id = v.id
             AND classify_image_origin(vi.source, vi.image_url) = 'listing') > 0
         AND (SELECT count(*) FROM vehicle_images vi
               WHERE vi.vehicle_id = v.id
                 AND classify_image_origin(vi.source, vi.image_url) = 'owner') = 0
      THEN 3
    ELSE 4
  END AS anchor_tier
FROM vehicles v;

COMMENT ON VIEW public.v_vehicle_anchor IS
'Anchor derivation as scalar subqueries so the planner can push WHERE vehicle_id = X down. Hot path is per-vehicle; table-wide aggregates remain expensive and should use a materialized view if needed.';

GRANT SELECT ON public.v_vehicle_anchor TO anon, authenticated;
