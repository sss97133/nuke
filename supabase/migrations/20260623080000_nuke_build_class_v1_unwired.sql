-- 20260623080000_nuke_build_class_v1_unwired.sql
-- Applied to prod 2026-06-23 via apply_migration (mirrors live).
--
-- WIRE #1 (v1) of the build-class valuation unlock (docs/features/build-class-valuation-unlock.md).
-- Classifies a vehicle's build class from EVIDENCE → class + confidence + DNA.
-- STANDALONE: nothing in valuation calls it yet, so it cannot mis-price. It exists to
-- be validated and tuned before it feeds comps/condition.
--
-- Key data lesson: structured flags LIE. The K5 ($50k+ documented restomod) reads
-- is_modified=false, empty mods, a generated stub description — its build-ness is only
-- in its photos/receipts/work. So the reliable signals are:
--   * documented investment/activity (receipts ≥ $5k OR ≥ 20 work sessions) → documented_build
--   * listing-text build keywords (restomod/LS-swap/frame-off/…) → modified
--   * stock keywords (numbers-matching/survivor/…) w/o build keywords → stock
--   * is_modified=true is a weak POSITIVE only (never trusted as a negative)
--   * else → honest 'unknown' (stays blocked, never guessed into a price)
--
-- Validated: K5 → documented_build (high); Blazer Chalet → unknown (no signal, not a
-- stock verdict). v1 thresholds/keywords are heuristic and meant to be tuned;
-- owner-overridable later. The many 'unknown' comps prove class-stratified comps need a
-- vision pass over comp listings before they can fire.
CREATE OR REPLACE FUNCTION public.nuke_build_class(p_vehicle_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE AS $function$
DECLARE
  v_receipts numeric; v_sessions int; v_photos int; v_is_mod boolean;
  v_text text; v_build_kw boolean; v_stock_kw boolean;
  v_class text; v_conf text; v_reasons text[] := '{}';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vehicles WHERE id = p_vehicle_id) THEN
    RETURN jsonb_build_object('error','vehicle not found','vehicle_id',p_vehicle_id);
  END IF;

  SELECT coalesce(sum(coalesce(total_amount,total)),0) INTO v_receipts
    FROM receipts WHERE vehicle_id = p_vehicle_id AND superseded_at IS NULL;
  SELECT count(*) INTO v_sessions
    FROM work_sessions WHERE vehicle_id = p_vehicle_id AND session_type IS DISTINCT FROM 'baseline_backfill';
  SELECT count(*) INTO v_photos FROM vehicle_images WHERE vehicle_id = p_vehicle_id;

  SELECT is_modified,
         lower(concat_ws(' ', description, bat_listing_title, listing_title, modifications, modification_details, trim_details, notes))
    INTO v_is_mod, v_text
    FROM vehicles WHERE id = p_vehicle_id;

  v_build_kw := v_text ~* '(resto[- ]?mod|ls[- ]?swap|engine swap|frame[- ]?off|pro[- ]?touring|coilover|custom built|fuel.inject|crate (motor|engine)|bagged|tubbed|built \d|restomod)';
  v_stock_kw := v_text ~* '(numbers[- ]?matching|all[- ]?original|factory original|unrestored|bone[- ]?stock|survivor|matching numbers)';

  IF v_receipts >= 5000 OR v_sessions >= 20 THEN
    v_class := 'documented_build'; v_conf := 'high';
    v_reasons := array_append(v_reasons, format('documented investment/activity (receipts $%s, %s work sessions)', round(v_receipts), v_sessions));
  ELSIF v_build_kw AND NOT v_stock_kw THEN
    v_class := 'modified'; v_conf := 'medium'; v_reasons := array_append(v_reasons, 'listing text describes modifications/build');
  ELSIF v_is_mod IS TRUE AND v_build_kw THEN
    v_class := 'modified'; v_conf := 'medium'; v_reasons := array_append(v_reasons, 'is_modified flag + build keywords');
  ELSIF v_stock_kw AND NOT v_build_kw THEN
    v_class := 'stock'; v_conf := 'medium'; v_reasons := array_append(v_reasons, 'listing text claims original/survivor/numbers-matching');
  ELSIF v_is_mod IS TRUE THEN
    v_class := 'modified'; v_conf := 'low'; v_reasons := array_append(v_reasons, 'is_modified flag only (weak)');
  ELSE
    v_class := 'unknown'; v_conf := 'none';
    v_reasons := array_append(v_reasons, 'no reliable build-class signal - needs vision over the build photos (intake gap, not a stock verdict)');
  END IF;

  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'build_class', v_class,
    'confidence', v_conf,
    'method_version', 'v1_heuristic_unwired',
    'doctrine_note', 'Build class drives class-stratified comps + class-aware condition; UNKNOWN stays blocked, never guessed into a price. v1 heuristic - tune thresholds/keywords; owner-overridable.',
    'source_dna', jsonb_build_object(
      'receipts_total_USD', round(v_receipts),
      'work_sessions', v_sessions,
      'photos', v_photos,
      'is_modified_flag', v_is_mod,
      'build_keywords_hit', v_build_kw,
      'stock_keywords_hit', v_stock_kw,
      'reasons', to_jsonb(v_reasons)
    )
  );
END;
$function$;
