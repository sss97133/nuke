-- Restores prior function bodies and drops the view. No transaction-ending statement; run inside a transaction.
CREATE OR REPLACE FUNCTION public.get_class_stratified_price(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_year int; v_make text; v_model text; v_canon text;
  v_subject uuid; v_ids uuid[]; v_bc jsonb; v_coarse text;
  v_n int; v_median numeric; v_p25 numeric; v_p75 numeric; v_min_comps int := 5;
BEGIN
  SELECT year, make, model INTO v_year, v_make, v_model FROM vehicles WHERE id = p_vehicle_id;
  IF v_year IS NULL OR v_make IS NULL THEN
    RETURN jsonb_build_object('comp_method','blocked','reason','vehicle missing year/make');
  END IF;

  -- subject's coarse build class
  v_bc := public.nuke_build_class(p_vehicle_id);
  v_coarse := CASE WHEN v_bc->>'build_class' IN ('documented_build','modified') THEN 'build'
                   WHEN v_bc->>'build_class' = 'stock' THEN 'stock' ELSE 'unknown' END;
  IF v_coarse = 'unknown' THEN
    RETURN jsonb_build_object('comp_method','blocked', 'reason',
      'subject build class unknown — needs vision; not priced (intake gap, not a verdict)',
      'subject_build_class', v_bc->>'build_class');
  END IF;

  -- resolve the vehicle's year-grain cohort (canonical model alias resolution)
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

  -- class-matched priced comps: same coarse class as the subject, excluding the subject
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
$function$

;
CREATE OR REPLACE FUNCTION public.get_platform_stratified_price(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_coarse text; v_n int; v_median numeric; v_p25 numeric; v_p75 numeric; v_min int := 5;
BEGIN
  SELECT coarse_class INTO v_coarse FROM public.vehicle_build_class WHERE vehicle_id = p_vehicle_id;
  IF v_coarse IS NULL THEN
    v_coarse := CASE WHEN (public.nuke_build_class(p_vehicle_id)->>'build_class') IN ('documented_build','modified') THEN 'build'
                     WHEN (public.nuke_build_class(p_vehicle_id)->>'build_class')='stock' THEN 'stock' ELSE 'unknown' END;
  END IF;
  IF v_coarse = 'unknown' THEN
    RETURN jsonb_build_object('comp_method','blocked','reason','subject build class unknown — needs vision');
  END IF;

  WITH comps AS (
    SELECT vbc.vehicle_id,
           (SELECT max(final_price) FROM public.vehicle_events ve
             WHERE ve.vehicle_id = vbc.vehicle_id AND ve.final_price > 0) AS px
    FROM public.vehicle_build_class vbc
    WHERE vbc.coarse_class = v_coarse AND vbc.vehicle_id <> p_vehicle_id
  )
  SELECT count(px), percentile_cont(0.5) WITHIN GROUP (ORDER BY px),
         percentile_cont(0.25) WITHIN GROUP (ORDER BY px), percentile_cont(0.75) WITHIN GROUP (ORDER BY px)
    INTO v_n, v_median, v_p25, v_p75
  FROM comps WHERE px IS NOT NULL;

  IF coalesce(v_n,0) < v_min THEN
    RETURN jsonb_build_object('comp_method','blocked',
      'reason', format('only %s class-matched priced platform comps (need %s)', coalesce(v_n,0), v_min),
      'subject_class', v_coarse, 'n_class_matched', coalesce(v_n,0));
  END IF;

  RETURN jsonb_build_object(
    'comp_method','class_stratified', 'subject_class', v_coarse,
    'n_class_matched_priced', v_n, 'value', round(v_median),
    'value_low', round(v_p25), 'value_high', round(v_p75),
    'comp_universe', 'curated full-size squarebody Blazer ∪ GMC Jimmy (compacts excluded), 1973-1991, materialized',
    'note', 'Priced against the curated platform, class-matched. Unknown comps excluded until vision classifies them.');
END;
$function$
;
drop view if exists public.comp_eligible_vehicle_events;
