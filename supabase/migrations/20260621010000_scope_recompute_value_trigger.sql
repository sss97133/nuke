-- Scope the vehicle-value recompute trigger to columns that actually affect value
-- ============================================================================
-- trg_recompute_value_on_images fired recompute_value_from_images() on EVERY
-- INSERT/DELETE/UPDATE of vehicle_images with no column list. recompute calls
-- compute_vehicle_value(), whose only inputs FROM vehicle_images are:
--   count(*)                                  -- membership (vehicle_id) + insert/delete
--   count(*) filter (where coalesce(is_approved, true))   -- is_approved
-- Nothing else on the row affects value. So every metadata write — work_session_id,
-- apple_ml_labels, latitude/longitude, suggested_vehicle_id, condition_score,
-- vehicle_zone, … — was triggering a full per-vehicle revaluation (count over the
-- vehicle's entire image set + a vehicles UPDATE) for no reason. On a 38.9M-row
-- table that is a large, constant, wasted prod load, and it forced every backfill
-- into tiny batches (statement timeouts, measured 2026-06-21).
--
-- Fix: fire only on the value-relevant changes. Same function, scoped events.
-- Value semantics are unchanged (the dropped events never changed the computed value).

DROP TRIGGER IF EXISTS trg_recompute_value_on_images ON public.vehicle_images;

CREATE TRIGGER trg_recompute_value_on_images
  AFTER INSERT OR DELETE OR UPDATE OF vehicle_id, is_approved
  ON public.vehicle_images
  FOR EACH ROW
  EXECUTE FUNCTION recompute_value_from_images();
