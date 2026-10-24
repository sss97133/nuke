-- caller controls the transaction (wrap in BEGIN ... ROLLBACK for tests); no COMMIT here
-- Revert 20261025141000 (new shadow objects only). Data-only revert: UPDATE public.nuke_estimate_quality_shadow SET status='superseded' WHERE run_id='<run_id>';

DROP FUNCTION IF EXISTS public.fill_estimate_quality_shadow(uuid, text);
DROP TABLE IF EXISTS public.nuke_estimate_quality_shadow;
DROP TABLE IF EXISTS public.shadow_quality_calibration;

