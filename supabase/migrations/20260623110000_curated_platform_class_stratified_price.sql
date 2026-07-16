-- 20260623110000_curated_platform_class_stratified_price.sql
-- Applied to prod 2026-06-23 via apply_migration + a data backfill (mirrors live).
--
-- "It's big but knowing how to curate the data is imperative." The comp universe for a
-- K5 is the PLATFORM — full-size K5 Blazer ∪ its GMC Jimmy twin — across the squarebody
-- generation, NOT one narrow year-make cohort. But the raw name match catches the wrong
-- truck: compact S-10 Blazers / S-15 Jimmys share the name. CURATION = full-size only.
--
-- 1) vehicle_build_class: materialized build-class cache (inline classification over the
--    platform times out). 2) get_platform_stratified_price: prices a vehicle against the
--    curated, class-matched platform reading the cache.
-- Backfilled 1,843 curated full-size Blazer+Jimmy ('73-'91, compacts excluded via
--    model !~ s-10|s-15): 822 build, 100 stock, 921 unknown (text-less -> vision).
-- Result: K5 prices against 512 class-matched priced BUILD comps (was 16) -> $28,873,
--    range $20.9k-$42.6k (range TIGHTENED vs the 16-comp set — curation+scale).
-- Backfill is re-runnable: INSERT ... SELECT id, nuke_build_class(id) ... ON CONFLICT,
--    filtered to make ~ chevrolet|gmc, year 1973-1991, model ~ (k5|k-5|blazer|jimmy),
--    model !~ (s-10|s-15). Run in year chunks (per-statement timeout).

CREATE TABLE IF NOT EXISTS public.vehicle_build_class (
  vehicle_id     uuid PRIMARY KEY REFERENCES public.vehicles(id) ON DELETE CASCADE,
  build_class    text NOT NULL,
  coarse_class   text NOT NULL,            -- build | stock | unknown
  confidence     text,
  method_version text,
  source_dna     jsonb,
  classified_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vehicle_build_class_coarse ON public.vehicle_build_class (coarse_class);

CREATE OR REPLACE FUNCTION public.get_platform_stratified_price(p_vehicle_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE AS $function$
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
  RETURN jsonb_build_object('comp_method','class_stratified', 'subject_class', v_coarse,
    'n_class_matched_priced', v_n, 'value', round(v_median),
    'value_low', round(v_p25), 'value_high', round(v_p75),
    'comp_universe', 'curated full-size squarebody Blazer ∪ GMC Jimmy (compacts excluded), 1973-1991, materialized',
    'note', 'Priced against the curated platform, class-matched. Unknown comps excluded until vision classifies them.');
END;
$function$;
