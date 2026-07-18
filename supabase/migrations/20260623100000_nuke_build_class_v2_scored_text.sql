-- 20260623100000_nuke_build_class_v2_scored_text.sql
-- Applied to prod 2026-06-23 via apply_migration (mirrors live). Supersedes the v1 body
-- in 20260623080000. "Fix the comps": v1 keyword-exact matching left 79% of the K5
-- cohort 'unknown' even though the BaT/auction descriptions were full of signal (engine
-- replaced, aftermarket wheels, lift kit, original owner, 44k miles, ...). v2 reads the
-- FULL description + listing fields and SCORES build vs stock signals, engine-swap as the
-- decisive build tell. On the 1977 K5 cohort: unknown 54->32, modified 11->27, stock 1->7;
-- the K5 now prices against 16 build comps (was 6), median $30,500. Remaining 'unknown'
-- are genuinely text-less -> vision (BYOK, see build-class-comp-vision-prompt.md).
-- Still STANDALONE (unwired from valuation).
CREATE OR REPLACE FUNCTION public.nuke_build_class(p_vehicle_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE AS $function$
DECLARE
  v_receipts numeric; v_sessions int; v_photos int; v_is_mod boolean; v_text text;
  v_swap boolean; v_build int := 0; v_stock int := 0;
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
         lower(concat_ws(' ', description, bat_listing_title, listing_title, modifications,
                              modification_details, trim_details, notes, maintenance_notes))
    INTO v_is_mod, v_text FROM vehicles WHERE id = p_vehicle_id;
  v_text := coalesce(v_text,'');

  v_swap := v_text ~* '(engine|motor|v8|v-8|transmission|trans).{0,30}(replac|swap|rebuil|crate)'
         OR v_text ~* '(replac|swap|rebuil|crate|ls[- ]?\d|ls[- ]?swap).{0,30}(engine|motor|v8|v-8|transmission|trans)';

  v_build := (v_swap)::int
    + (v_text ~* 'resto[- ]?mod|pro[- ]?touring|custom built|frame[- ]?off')::int
    + (v_text ~* 'lift kit|lifted|lowered|lowering|coilover|air[- ]?ride|bagged|drop(ped)? spindle|tubbed')::int
    + (v_text ~* 'coys|american racing|cragar|weld|aftermarket wheel|rally wheel|\d{2}[- ]?(inch|″|in\.).{0,12}wheel')::int
    + (v_text ~* 'disc brake conversion|power disc|big brake|wilwood|headers|fuel.inject|efi conversion')::int
    + (v_text ~* 'grant .{0,12}(wheel|steering)|aftermarket (stereo|gauge|seat)|bluetooth|modern (stereo|audio)|restored|restoration')::int
    + (v_text ~* '\b(built|modified|upgraded|swapped|custom)\b')::int;

  v_stock := (v_text ~* 'original owner|numbers[- ]?matching|matching numbers|all[- ]?original|unrestored|survivor|factory original|as[- ]?delivered|bone[- ]?stock|untouched')::int
    + (v_text ~* 'original .{0,12}(paint|engine|drivetrain|interior|miles)|date[- ]?code|window sticker|build sheet')::int
    + (v_text ~* '\b(stock|factory)\b')::int;

  IF v_receipts >= 5000 OR v_sessions >= 20 THEN
    v_class := 'documented_build'; v_conf := 'high';
    v_reasons := array_append(v_reasons, format('documented investment/activity (receipts $%s, %s work sessions)', round(v_receipts), v_sessions));
  ELSIF v_swap OR v_build >= 3 THEN
    v_class := 'modified'; v_conf := 'high';
    v_reasons := array_append(v_reasons, format('engine-swap=%s, build signals=%s, stock signals=%s', v_swap, v_build, v_stock));
  ELSIF v_build >= 1 AND v_build > v_stock THEN
    v_class := 'modified'; v_conf := 'medium';
    v_reasons := array_append(v_reasons, format('build signals=%s > stock signals=%s', v_build, v_stock));
  ELSIF v_stock >= 1 AND v_stock >= v_build THEN
    v_class := 'stock'; v_conf := 'medium';
    v_reasons := array_append(v_reasons, format('original/stock signals=%s >= build signals=%s (no engine swap)', v_stock, v_build));
  ELSIF v_build >= 1 THEN
    v_class := 'modified'; v_conf := 'low'; v_reasons := array_append(v_reasons, 'single build signal');
  ELSE
    v_class := 'unknown'; v_conf := 'none';
    v_reasons := array_append(v_reasons, 'no text or doc signal - needs vision (intake gap, not a stock verdict)');
  END IF;

  RETURN jsonb_build_object(
    'vehicle_id', p_vehicle_id, 'build_class', v_class, 'confidence', v_conf,
    'method_version', 'v2_scored_text_unwired',
    'doctrine_note', 'Build class drives class-stratified comps; UNKNOWN stays blocked, never guessed. v2 scores full description text (engine-swap = decisive build tell). Tunable; owner-overridable.',
    'source_dna', jsonb_build_object(
      'receipts_total_USD', round(v_receipts), 'work_sessions', v_sessions, 'photos', v_photos,
      'is_modified_flag', v_is_mod, 'engine_swap', v_swap,
      'build_score', v_build, 'stock_score', v_stock,
      'has_text', length(v_text) > 20, 'reasons', to_jsonb(v_reasons)
    )
  );
END;
$function$;
