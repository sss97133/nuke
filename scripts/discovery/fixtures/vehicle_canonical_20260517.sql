-- =========================================================================
-- 20260517_fix_vehicle_canonical_multi_cardinality.sql
-- Date:   2026-05-17
-- Status: PROPOSED — apply after explicit review.
--
-- Fixes the issue logged in .claude/ISSUES.md
--   "[MEDIUM] vehicle_canonical view collapses multi-cardinality properties"
--
-- After ingesting 747 K5 wire cells, vehicle_canonical returned 5 rows for
-- the K5 (one per property) instead of one per (wire, property). Cause: the
-- view partitioned by (vehicle_id, property_id) which is correct for VIN
-- (one per vehicle) but wrong for wire_circuit_id (162 per vehicle, one
-- per wire).
--
-- Fix:
--   1. Add `discriminator_key` column to observation_properties.
--      For multi-cardinality properties whose discriminator lives in
--      structured_data, this names the top-level JSON key. NULL otherwise.
--   2. Backfill wire_* properties with discriminator_key='wire_id'.
--   3. Recreate vehicle_canonical to partition by
--      (vehicle_id, property_id, structured_data->>discriminator_key).
--      When discriminator_key is NULL, the partition collapses to one row
--      per (vehicle, property) just as before.
--
-- Note: mileage_miles and sale_price_usd are also `cardinality='multi'` but
-- their "multi" is time-ordered (history of readings) — for those, the
-- canonical answer at query time IS the most recent, so they STAY without a
-- discriminator_key (the view collapses them to current). wire_* is
-- multi-simultaneously-distinct (each wire is its own claim at the same
-- time), which is what the discriminator_key handles.
-- =========================================================================

BEGIN;

ALTER TABLE public.observation_properties
  ADD COLUMN IF NOT EXISTS discriminator_key text;

COMMENT ON COLUMN public.observation_properties.discriminator_key IS
  'For cardinality=multi properties where each row is a simultaneously-distinct claim (not a time-ordered history): the top-level key in vehicle_observations.structured_data that identifies the claim. e.g. "wire_id" for wire_* properties. NULL for single-cardinality or for time-ordered multi (mileage, sale_price).';

UPDATE public.observation_properties
   SET discriminator_key = 'wire_id'
 WHERE category = 'wiring' AND cardinality = 'multi'
   AND discriminator_key IS NULL;

CREATE OR REPLACE VIEW public.vehicle_canonical AS
WITH ranked AS (
  SELECT
    o.vehicle_id,
    o.property_id,
    o.id              AS observation_id,
    o.structured_data,
    o.content_text,
    o.confidence_score,
    o.observed_at,
    o.source_id,
    o.rank,
    o.kind,
    o.changeset_id,
    op.discriminator_key,
    CASE
      WHEN op.discriminator_key IS NOT NULL
        THEN o.structured_data ->> op.discriminator_key
      ELSE '__single__'
    END AS discriminator_value,
    ROW_NUMBER() OVER (
      PARTITION BY o.vehicle_id, o.property_id,
        CASE
          WHEN op.discriminator_key IS NOT NULL
            THEN o.structured_data ->> op.discriminator_key
          ELSE '__single__'
        END
      ORDER BY
        CASE o.rank::text
          WHEN 'preferred'  THEN 0
          WHEN 'normal'     THEN 1
          WHEN 'deprecated' THEN 2
          ELSE 3
        END,
        COALESCE(o.confidence_score, 0) DESC,
        o.observed_at DESC
    ) AS rn
  FROM public.vehicle_observations o
  JOIN public.observation_properties op ON op.id = o.property_id
  WHERE o.is_superseded = false
    AND o.property_id IS NOT NULL
    AND o.rank::text <> 'deprecated'
)
-- Column order matches the pre-fix view exactly; discriminator_value is
-- appended at the end so CREATE OR REPLACE VIEW accepts the change (Postgres
-- forbids renaming/reordering existing view columns via REPLACE).
SELECT vehicle_id, property_id, observation_id,
       structured_data, content_text, confidence_score,
       observed_at, source_id, kind, rank, changeset_id,
       discriminator_value
FROM ranked
WHERE rn = 1;

COMMENT ON VIEW public.vehicle_canonical IS
  'AX-012: projection of current value per (vehicle_id, property_id, discriminator_value). Single-cardinality and time-ordered-multi properties: discriminator_value = ''__single__'' (one row per property). Simultaneously-distinct multi (e.g. wire_*): discriminator_value carries the per-claim key from structured_data → observation_properties.discriminator_key. Highest rank → confidence → most recent wins.';

NOTIFY pgrst, 'reload schema';

COMMIT;
