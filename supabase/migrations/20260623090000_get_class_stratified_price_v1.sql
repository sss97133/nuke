-- 20260623090000_get_class_stratified_price_v1.sql
-- Applied to prod 2026-06-23 via apply_migration (mirrors live). WIRE #2 (v1) of the
-- build-class unlock: prices a vehicle against comps of its OWN build class instead of
-- the class-blind cohort median — producing comp_method='class_stratified', the value
-- iOS isThin waits for. Reads nuke_build_class per cohort member (ok for year-grain;
-- materialize build_class for model-grain scale, and before wiring into the hot iOS
-- read path get_vehicle_valuation). Honest blocks: unknown subject class, or < 5
-- class-matched priced comps => 'blocked', never a guessed number.
-- Validated: K5 e08bf694 -> class_stratified, $30,050 from 6 build comps.
-- See docs/features/build-class-valuation-unlock.md + build-class-comp-vision-prompt.md.
CREATE OR REPLACE FUNCTION public.get_class_stratified_price(p_vehicle_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE AS $function$
DECLARE
  v_year int; v_make text; v_model text; v_canon text;
  v_subject uuid; v_ids uuid[]; v_bc jsonb; v_coarse text;
  v_n int; v_median numeric; v_p25 numeric; v_p75 numeric; v_min_comps int := 5;
BEGIN
  SELECT year, make, model INTO v_year, v_make, v_model FROM vehicles WHERE id = p_vehicle_id;
  IF v_year IS NULL OR v_make IS NULL THEN
    RETURN jsonb_build_object('comp_method','blocked','reason','vehicle missing year/make');
  END IF;

  v_bc := public.nuke_build_class(p_vehicle_id);
  v_coarse := CASE WHEN v_bc->>'build_class' IN ('documented_build','modified') THEN 'build'
                   WHEN v_bc->>'build_class' = 'stock' THEN 'stock' ELSE 'unknown' END;
  IF v_coarse = 'unknown' THEN
    RETURN jsonb_build_object('comp_method','blocked', 'reason',
      'subject build class unknown — needs vision; not priced (intake gap, not a verdict)',
      'subject_build_class', v_bc->>'build_class');
  END IF;

  SELECT cm.canonical_model INTO v_canon FROM public.canonical_models cm
   WHERE lower(cm.make)=lower(v_make)
     AND (lower(cm.canonical_model)=lower(v_model) OR lower(v_model)=any(select lower(a) from unnest(cm.aliases) a))
   LIMIT 1;
  v_canon := coalesce(v_canon, v_model);
  SELECT subject_id INTO v_subject FROM public.make_model_profiles
   WHERE lower(canonical_make)=lower(v_make) AND lower(canonical_model)=lower(v_canon)
     AND grain='year' AND year=v_year LIMIT 1;
  IF v_subject IS NULL THEN
    RETURN jsonb_build_object('comp_method','blocked','reason','no registered cohort for this year-make-model');
  END IF;
  SELECT array_agg(vehicle_id) INTO v_ids FROM public.cohort_members(v_subject);

  WITH comps AS (
    SELECT m AS vid,
           CASE WHEN public.nuke_build_class(m)->>'build_class' IN ('documented_build','modified') THEN 'build'
                WHEN public.nuke_build_class(m)->>'build_class' = 'stock' THEN 'stock' ELSE 'unknown' END AS cc,
           (SELECT max(final_price) FROM vehicle_events ve WHERE ve.vehicle_id=m AND ve.final_price>0) AS px
    FROM unnest(v_ids) m
    WHERE m <> p_vehicle_id
  )
  SELECT count(*) FILTER (WHERE px IS NOT NULL),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY px),
         percentile_cont(0.25) WITHIN GROUP (ORDER BY px),
         percentile_cont(0.75) WITHIN GROUP (ORDER BY px)
    INTO v_n, v_median, v_p25, v_p75
  FROM comps WHERE cc = v_coarse AND px IS NOT NULL;

  IF coalesce(v_n,0) < v_min_comps THEN
    RETURN jsonb_build_object('comp_method','blocked',
      'reason', format('only %s class-matched priced comps (need %s) — not defensibly priceable yet', coalesce(v_n,0), v_min_comps),
      'subject_class', v_coarse, 'n_class_matched', coalesce(v_n,0));
  END IF;

  RETURN jsonb_build_object(
    'comp_method', 'class_stratified',
    'subject_class', v_coarse,
    'subject_build_class', v_bc->>'build_class',
    'n_class_matched_priced', v_n,
    'value', round(v_median),
    'value_low', round(v_p25), 'value_high', round(v_p75),
    'basis', format('median of %s class-matched (%s) priced comps in the %s %s %s cohort', v_n, v_coarse, v_year, v_make, v_canon),
    'note', 'A build priced against builds, not the class-blind cohort median. UNKNOWN comps excluded until vision classifies them.'
  );
END;
$function$;
