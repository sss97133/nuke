-- ============================================================
-- Batched Vehicle Image Ordering Backfill (timeout-safe)
-- ============================================================
-- The full-table UPDATE to normalize image ordering can time out on large datasets.
-- This migration adds small, composable functions to fix ordering per vehicle and
-- a batched runner that processes N vehicles per call.
--
-- Use:
--   select public.backfill_vehicle_images_order_batch(50);
-- Repeat until it returns 0.

-- Ensure we have a helper for updated_at if present (not required).

CREATE OR REPLACE FUNCTION public.fix_vehicle_images_for_vehicle(p_vehicle_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_vehicle_id IS NULL THEN
    RETURN;
  END IF;

  -- 1) Normalize timestamps for stable ordering (legacy rows can have taken_at NULL)
  UPDATE public.vehicle_images
  SET taken_at = created_at
  WHERE vehicle_id = p_vehicle_id
    AND (is_document IS NULL OR is_document = false)
    AND taken_at IS NULL;

  -- 2) Recompute position (0-based) for non-document, non-duplicate images
  WITH ranked AS (
    SELECT
      id,
      ROW_NUMBER() OVER (
        ORDER BY
          is_primary DESC,
          taken_at DESC NULLS LAST,
          created_at DESC,
          id ASC
      ) AS rn
    FROM public.vehicle_images
    WHERE vehicle_id = p_vehicle_id
      AND (is_document IS NULL OR is_document = false)
      AND (is_duplicate IS NULL OR is_duplicate = false)
  )
  UPDATE public.vehicle_images vi
  SET position = ranked.rn - 1
  FROM ranked
  WHERE vi.id = ranked.id
    AND (vi.position IS DISTINCT FROM ranked.rn - 1);

  -- 3) Ensure exactly one primary image per vehicle (best-ranked becomes primary)
  WITH ranked AS (
    SELECT
      id,
      ROW_NUMBER() OVER (
        ORDER BY
          is_primary DESC,
          taken_at DESC NULLS LAST,
          created_at DESC,
          id ASC
      ) AS rn
    FROM public.vehicle_images
    WHERE vehicle_id = p_vehicle_id
      AND (is_document IS NULL OR is_document = false)
      AND (is_duplicate IS NULL OR is_duplicate = false)
  ),
  keepers AS (
    SELECT id FROM ranked WHERE rn = 1
  )
  UPDATE public.vehicle_images
  SET is_primary = (id IN (SELECT id FROM keepers))
  WHERE vehicle_id = p_vehicle_id
    AND (is_document IS NULL OR is_document = false)
    AND (is_duplicate IS NULL OR is_duplicate = false);
END;
$$;

-- Batched runner: fixes vehicles where primary/taken_at is inconsistent.
CREATE OR REPLACE FUNCTION public.backfill_vehicle_images_order_batch(p_batch_size int DEFAULT 50)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch int := LEAST(500, GREATEST(1, COALESCE(p_batch_size, 50)));
  v_vehicle_ids uuid[];
  v_id uuid;
  v_processed int := 0;
BEGIN
  -- Candidate vehicles: have at least one non-doc/non-dup image AND need fixing:
  -- - no primary or multiple primaries, OR
  -- - any missing taken_at
  SELECT array_agg(vehicle_id) INTO v_vehicle_ids
  FROM (
    SELECT vi.vehicle_id
    FROM public.vehicle_images vi
    WHERE vi.vehicle_id IS NOT NULL
      AND (vi.is_document IS NULL OR vi.is_document = false)
      AND (vi.is_duplicate IS NULL OR vi.is_duplicate = false)
    GROUP BY vi.vehicle_id
    HAVING
      SUM(CASE WHEN vi.is_primary = true THEN 1 ELSE 0 END) <> 1
      OR SUM(CASE WHEN vi.taken_at IS NULL THEN 1 ELSE 0 END) > 0
    ORDER BY MAX(COALESCE(vi.updated_at, vi.created_at)) DESC
    LIMIT v_batch
  ) c;

  IF v_vehicle_ids IS NULL OR array_length(v_vehicle_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  FOREACH v_id IN ARRAY v_vehicle_ids
  LOOP
    PERFORM public.fix_vehicle_images_for_vehicle(v_id);
    v_processed := v_processed + 1;
  END LOOP;

  RETURN v_processed;
END;
$$;

GRANT EXECUTE ON FUNCTION public.backfill_vehicle_images_order_batch(int) TO service_role;


