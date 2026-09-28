-- recompute_vehicle_canonical_columns: re-run the canonical resolver for listed vehicles.
--
-- WHY: canonical_platform / canonical_outcome / canonical_sold_price are derived by the BEFORE trigger
-- trg_resolve_canonical_columns, which fires only on UPDATE OF its source columns (sale_status, sale_price,
-- reserve_status, ...). Rows written while it could not fire keep a stale derivation: on 2026-09-28, 4,780 BaT
-- rows (export of the 195K archive-linked cars) read sale_status 'sold' + auction_outcome 'sold' with
-- canonical_outcome NULL (4,686), 'unknown' (91) or 'reserve_not_met' (3), so every reader of canonical_outcome
-- (mcp-connector, mv_vehicle_census, v_vehicle_canonical) misses them. No fact is wrong on those rows, so the
-- correction chokepoint has nothing to correct and treats them as no-ops.
--
-- This changes no fact: it assigns sale_status to itself, which fires the resolver (and the row's ordinary
-- update triggers, the same set every chokepoint correction fires) and returns the derived outcome counts
-- before and after. Service role only; at most 500 ids per call; deleted rows are skipped.

CREATE OR REPLACE FUNCTION public.recompute_vehicle_canonical_columns(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_requested int := coalesce(array_length(p_ids, 1), 0);
  v_before    jsonb;
  v_after     jsonb;
  v_touched   int := 0;
BEGIN
  IF v_requested > 500 THEN
    RAISE EXCEPTION 'recompute_vehicle_canonical_columns: at most 500 ids per call (got %)', v_requested;
  END IF;

  SELECT coalesce(jsonb_object_agg(k, n), '{}'::jsonb) INTO v_before
  FROM (SELECT coalesce(canonical_outcome, 'null') k, count(*) n FROM vehicles
        WHERE id = ANY(p_ids) AND deleted_at IS NULL GROUP BY 1) s;

  -- the resolver is a BEFORE trigger on UPDATE OF sale_status (among others); assigning the column to
  -- itself fires it without changing any fact
  UPDATE vehicles SET sale_status = sale_status
  WHERE id = ANY(p_ids) AND deleted_at IS NULL;
  GET DIAGNOSTICS v_touched = ROW_COUNT;

  SELECT coalesce(jsonb_object_agg(k, n), '{}'::jsonb) INTO v_after
  FROM (SELECT coalesce(canonical_outcome, 'null') k, count(*) n FROM vehicles
        WHERE id = ANY(p_ids) AND deleted_at IS NULL GROUP BY 1) s;

  RETURN jsonb_build_object('ok', true, 'requested', v_requested, 'touched', v_touched,
    'canonical_outcome_before', v_before, 'canonical_outcome_after', v_after);
END;
$fn$;

REVOKE ALL ON FUNCTION public.recompute_vehicle_canonical_columns(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recompute_vehicle_canonical_columns(uuid[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_vehicle_canonical_columns(uuid[]) TO service_role;

COMMENT ON FUNCTION public.recompute_vehicle_canonical_columns(uuid[]) IS
  'Re-runs trg_resolve_canonical_columns for the listed vehicles by assigning sale_status to itself; no fact changes, only the derived canonical_* columns. Returns canonical_outcome counts before/after. Service role only; <= 500 ids per call.';
