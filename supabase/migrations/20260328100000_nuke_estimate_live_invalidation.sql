-- Nuke Estimate Live Invalidation
--
-- Problem: nuke_estimate was a one-time computation. When comparable sales
-- data changed, estimates went stale silently. The cron only processed
-- vehicles with NULL estimates, ignoring the is_stale flag entirely.
--
-- Fix:
-- 1. Trigger marks comps stale when a vehicle's price changes
-- 2. Cron now processes both NULL and stale estimates (stale first)

-- 1. Invalidation trigger function
-- When a vehicle's price changes, mark estimates for same-make vehicles
-- within ±5 year range as stale (they used this vehicle as a comp).
CREATE OR REPLACE FUNCTION mark_comp_estimates_stale()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    COALESCE(NEW.sale_price, 0) != COALESCE(OLD.sale_price, 0) OR
    COALESCE(NEW.winning_bid, 0) != COALESCE(OLD.winning_bid, 0) OR
    COALESCE(NEW.asking_price, 0) != COALESCE(OLD.asking_price, 0)
  ) AND NEW.make IS NOT NULL AND NEW.year IS NOT NULL THEN
    UPDATE nuke_estimates
    SET is_stale = true
    WHERE is_stale = false
      AND vehicle_id IN (
        SELECT v.id
        FROM vehicles v
        WHERE v.make = NEW.make
          AND v.year BETWEEN NEW.year - 5 AND NEW.year + 5
          AND v.id != NEW.id
        LIMIT 500
      );
  END IF;
  RETURN NEW;
END;
$$;

-- 2. Attach trigger
DROP TRIGGER IF EXISTS trg_invalidate_estimates_on_price ON vehicles;
CREATE TRIGGER trg_invalidate_estimates_on_price
AFTER UPDATE OF sale_price, winning_bid, asking_price
ON vehicles
FOR EACH ROW
EXECUTE FUNCTION mark_comp_estimates_stale();

-- 3. Updated batch function: process stale + NULL
CREATE OR REPLACE FUNCTION public.run_valuation_batch_by_quality(
  p_shard_id integer DEFAULT 0,
  p_total_shards integer DEFAULT 1,
  p_batch_size integer DEFAULT 100
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_vehicle_ids JSONB;
BEGIN
  SELECT jsonb_agg(id) INTO v_vehicle_ids
  FROM (
    SELECT v.id
    FROM vehicles v
    LEFT JOIN nuke_estimates ne ON ne.vehicle_id = v.id
    WHERE v.deleted_at IS NULL
      AND v.year IS NOT NULL
      AND v.make IS NOT NULL
      AND (
        v.nuke_estimate IS NULL
        OR (ne.is_stale = true)
      )
      AND (p_total_shards = 1 OR (ABS(HASHTEXT(v.id::text)) % p_total_shards) = p_shard_id)
    ORDER BY
      CASE WHEN ne.is_stale = true THEN 0 ELSE 1 END,
      CASE WHEN v.status = 'active' THEN 0 ELSE 1 END,
      COALESCE(v.data_quality_score, 0) DESC,
      v.id ASC
    LIMIT p_batch_size
  ) q;

  IF v_vehicle_ids IS NULL THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/compute-vehicle-valuation',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || get_service_role_key_for_cron()
    ),
    body    := jsonb_build_object('vehicle_ids', v_vehicle_ids)
  );
END;
$$;
