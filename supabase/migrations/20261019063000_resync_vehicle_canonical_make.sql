-- resync_vehicle_canonical_make: re-resolve vehicles.canonical_make_id for one id range by the rule #1904 put in
-- auto_classify_vehicle (display_name, then canonical_name, then alias, case-insensitive). The trigger fixes rows as they
-- change; rows written before 2026-10-18 05:02Z keep the id of a make they no longer carry. Measured 02:30Z over
-- mv_treemap_outcomes: 1,654 of 512,978 (880 NULL although the make matches, 774 pointing at another make); a 06:28Z
-- sample of 8,144 rows was unchanged (0.32%).
--   * Dry run unless p_apply. A range is at most 1/64 of the uuid space, so each call reads a bounded pkey range.
--   * Only a make that resolves changes a row; a set id whose make resolves to nothing is reported, not cleared.
--   * Each changed row's prior id goes to superseded_rows; app.writer names the writer for the vehicles triggers.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.resync_vehicle_canonical_make(p_lo uuid, p_hi uuid, p_apply boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_writer CONSTANT text := 'resync_vehicle_canonical_make';
  v_timeout_ms bigint := (SELECT setting::bigint FROM pg_settings WHERE name = 'statement_timeout');
  v_changed integer := 0;
  v_result jsonb;
BEGIN
  IF v_timeout_ms < 1 OR v_timeout_ms > 60000 THEN
    RAISE EXCEPTION '%: caller must set statement_timeout between 1 ms and 60 s (now % ms)', c_writer, v_timeout_ms;
  END IF;
  IF p_lo IS NULL OR p_hi IS NULL OR p_lo >= p_hi THEN
    RAISE EXCEPTION '%: need p_lo < p_hi', c_writer;
  END IF;
  IF ('x' || substr(replace(p_hi::text, '-', ''), 1, 8))::bit(32)::bigint
     - ('x' || substr(replace(p_lo::text, '-', ''), 1, 8))::bit(32)::bigint > 67108864 THEN
    RAISE EXCEPTION '%: a range covers at most 1/64 of the uuid space', c_writer;
  END IF;
  PERFORM set_config('lock_timeout', '3s', true);

  CREATE TEMP TABLE IF NOT EXISTS make_resync (vehicle_id uuid, make text, was uuid, resolved uuid) ON COMMIT DROP;
  TRUNCATE make_resync;
  INSERT INTO make_resync
  SELECT v.id, v.make, v.canonical_make_id, r.id
  FROM public.vehicles v
  LEFT JOIN LATERAL (
    SELECT cm.id
    FROM public.canonical_makes cm
    WHERE lower(cm.display_name) = lower(btrim(v.make))
       OR lower(cm.canonical_name) = lower(btrim(v.make))
       OR lower(btrim(v.make)) = ANY (SELECT lower(a) FROM unnest(cm.aliases) AS a)
    ORDER BY lower(cm.display_name) = lower(btrim(v.make)) DESC, lower(cm.canonical_name) = lower(btrim(v.make)) DESC, cm.id
    LIMIT 1) r ON true
  WHERE v.id >= p_lo AND v.id < p_hi AND nullif(btrim(v.make), '') IS NOT NULL;

  SELECT jsonb_build_object(
    'range', jsonb_build_array(p_lo, p_hi), 'apply', p_apply, 'read', count(*),
    'null_but_resolves', count(*) FILTER (WHERE was IS NULL AND resolved IS NOT NULL),
    'other_make', count(*) FILTER (WHERE was IS NOT NULL AND resolved IS NOT NULL AND was <> resolved),
    'set_but_unresolved', count(*) FILTER (WHERE was IS NOT NULL AND resolved IS NULL),
    'samples', coalesce((SELECT jsonb_agg(jsonb_build_object('vehicle_id', vehicle_id, 'make', make, 'was', was, 'resolved', resolved))
                         FROM (SELECT * FROM make_resync WHERE resolved IS NOT NULL AND was IS DISTINCT FROM resolved
                               ORDER BY vehicle_id LIMIT 5) s), '[]'::jsonb))
  INTO v_result FROM make_resync;

  IF p_apply THEN
    INSERT INTO public.superseded_rows (source_table, row_id, row_data, asserted_by, source, reason)
    SELECT 'vehicles', vehicle_id, jsonb_build_object('field', 'canonical_make_id', 'value', was, 'replacement', resolved, 'make', make),
           c_writer, jsonb_build_object('rule', 'auto_classify_vehicle make resolution (display_name, canonical_name, alias)'),
           'canonical_make_id re-resolved from the vehicle''s make text'
    FROM make_resync WHERE resolved IS NOT NULL AND was IS DISTINCT FROM resolved;

    PERFORM set_config('app.writer', c_writer, true);
    UPDATE public.vehicles v SET canonical_make_id = m.resolved
      FROM make_resync m
     WHERE v.id = m.vehicle_id AND m.resolved IS NOT NULL AND v.canonical_make_id IS NOT DISTINCT FROM m.was
       AND m.was IS DISTINCT FROM m.resolved;
    GET DIAGNOSTICS v_changed = ROW_COUNT;
  END IF;

  RETURN v_result || jsonb_build_object('changed', v_changed);
END;
$function$;

REVOKE ALL ON FUNCTION public.resync_vehicle_canonical_make(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resync_vehicle_canonical_make(uuid, uuid, boolean) TO service_role;

COMMIT;
