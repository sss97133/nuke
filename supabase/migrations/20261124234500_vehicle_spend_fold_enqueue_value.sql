-- vehicle_spend_fold queues the cars it refolds on vehicle_value_recompute_queue, so value_score (which counts their spend
-- papers since 20261124232500) follows a refold without a hand run. The receipts trigger recompute_value_from_receipts
-- queues only scope_type = 'vehicle' receipts in processing_status validated/saved; a link, a line, a supersede or a
-- duplicate on a linked receipt queued nothing. Measured 2026-11-25: the 24 cars with spend rows carried value_breakdown
-- computed 2026-11-15 or earlier.
-- Contract: supabase/sql/test_vehicle_spend_lines.sql (extended). Revert: re-run the function from
-- 20261124224500_vehicle_spend_lines.sql.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
CREATE OR REPLACE FUNCTION public.vehicle_spend_fold(p_run text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $fold$
DECLARE
  v_run text := coalesce(p_run, 'vehicle-spend-fold:' || to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS"Z"'));
  v_ids uuid[];
  v_checked int;
  v_removed int := 0;
  v_written int := 0;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('vehicle_spend_fold')) THEN
    RETURN jsonb_build_object('run', v_run, 'skipped', 'another fold holds the lock');
  END IF;
  WITH d AS (
    SELECT vehicle_id, md5(string_agg(receipt_id::text || '|' || coalesce(receipt_item_id::text, '') || '|' || basis || '|' || amount::text,
                                      ',' ORDER BY receipt_id, receipt_item_id NULLS FIRST, basis)) AS h
      FROM public.vehicle_spend_lines_due GROUP BY vehicle_id),
  c AS (
    SELECT vehicle_id, md5(string_agg(receipt_id::text || '|' || coalesce(receipt_item_id::text, '') || '|' || basis || '|' || amount::text,
                                      ',' ORDER BY receipt_id, receipt_item_id NULLS FIRST, basis)) AS h
      FROM public.vehicle_spend_lines GROUP BY vehicle_id)
  SELECT count(*)::int, array_agg(vehicle_id) FILTER (WHERE dh IS DISTINCT FROM ch)
    INTO v_checked, v_ids
    FROM (SELECT coalesce(d.vehicle_id, c.vehicle_id) AS vehicle_id, d.h AS dh, c.h AS ch
            FROM d FULL JOIN c ON c.vehicle_id = d.vehicle_id) x;
  IF v_ids IS NOT NULL THEN
    DELETE FROM public.vehicle_spend_lines WHERE vehicle_id = ANY (v_ids);
    GET DIAGNOSTICS v_removed = ROW_COUNT;
    INSERT INTO public.vehicle_spend_lines (vehicle_id, receipt_id, receipt_item_id, basis, amount, run_id)
    SELECT vehicle_id, receipt_id, receipt_item_id, basis, amount, v_run
      FROM public.vehicle_spend_lines_due WHERE vehicle_id = ANY (v_ids);
    GET DIAGNOSTICS v_written = ROW_COUNT;
    -- vehicle_spend_fold_enqueue_v1: a refolded car's value_score reads these rows (compute_vehicle_value), so it is queued.
    INSERT INTO public.vehicle_value_recompute_queue (vehicle_id)
    SELECT v.id FROM public.vehicles v WHERE v.id = ANY (v_ids)
    ON CONFLICT (vehicle_id) DO UPDATE SET queued_at = LEAST(public.vehicle_value_recompute_queue.queued_at, now());
  END IF;
  RETURN jsonb_build_object('run', v_run, 'cars_checked', v_checked, 'cars_refolded', coalesce(cardinality(v_ids), 0),
                            'rows_removed', v_removed, 'rows_written', v_written);
END
$fold$;
COMMIT;
