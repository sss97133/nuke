-- correct_vehicle_sale_provenance_batch: a JSON-null field spec means "no proposal", never "clear it".
--
-- WHY (incident 2026-09-27 15:19Z, session cb179857, batch_0001 of the Porsche 914 pass): the
-- generator emitted every supported field for every vehicle, with JSON null for "nothing to
-- correct" ({"sale_status": null, "sale_price": {"value": ...}}). jsonb_each() iterates those
-- keys too; `v_spec ->> 'value'` on a JSON null is NULL, no "expected" guard applies, and the
-- function cleared 92 live values on 20 vehicles (auction_end_date 14, reserve_status 14,
-- high_bid 13, bat_sale_date 11, auction_outcome 11, bat_buyer 9, sale_price 6, sale_status 5,
-- sale_date 3, bat_sold_price 3, winning_bid 3). Every original was in the audit trail the
-- function itself writes, so all 92 were put back through the same function 5 minutes later
-- (asserted_by 'bat-archive-2026-09-27-restore'); nothing was lost. The caller now strips null
-- specs too, but the guard belongs here: a spec must be an object, and clearing a column must be
-- said explicitly ({"value": null}).
--
-- Only the FOR loop's first lines change; the rest of the body is the deployed 2026-09-27 v2.

CREATE OR REPLACE FUNCTION public.correct_vehicle_sale_provenance_batch(
  p_rows        jsonb,
  p_asserted_by text DEFAULT 'agent',
  p_reason      text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  c_allowed CONSTANT text[] := ARRAY[
    'sale_price','sale_status','auction_outcome','reserve_status','high_bid','winning_bid',
    'bat_sold_price','sold_price','sale_date','bat_sale_date','auction_end_date','bat_buyer',
    'canonical_platform'];
  c_numeric CONSTANT text[] := ARRAY['sale_price','high_bid','winning_bid','bat_sold_price','sold_price'];
  c_date    CONSTANT text[] := ARRAY['sale_date','bat_sale_date'];
  v_row      jsonb;
  v_id       uuid;
  v_veh      vehicles%ROWTYPE;
  v_field    text;
  v_spec     jsonb;
  v_orig     text;
  v_new      text;
  v_same     boolean;
  v_set      jsonb;
  v_audit    jsonb;
  v_vehicles int := 0;
  v_fields   int := 0;
  v_noop     int := 0;
  v_skipped  int := 0;
  v_stale    jsonb := '[]'::jsonb;
  v_missing  jsonb := '[]'::jsonb;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'correct_vehicle_sale_provenance_batch: p_rows must be a JSON array';
  END IF;

  PERFORM set_config('nuke.bulk_sale_correction', 'on', true);

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_id := (v_row ->> 'vehicle_id')::uuid;
    IF v_row -> 'source' IS NULL OR v_row -> 'source' = '{}'::jsonb OR (v_row -> 'source' ->> 'ref') IS NULL THEN
      RAISE EXCEPTION 'correct_vehicle_sale_provenance_batch: vehicle % has no source document with a ref -- corrections must be cited, never guessed', v_id;
    END IF;
    IF v_row -> 'corrections' IS NULL OR jsonb_typeof(v_row -> 'corrections') <> 'object' THEN
      RAISE EXCEPTION 'correct_vehicle_sale_provenance_batch: vehicle % has no corrections object', v_id;
    END IF;

    SELECT * INTO v_veh FROM vehicles WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      v_missing := v_missing || jsonb_build_array(v_id);
      CONTINUE;
    END IF;

    v_set := '{}'::jsonb;
    v_audit := '[]'::jsonb;

    FOR v_field, v_spec IN SELECT key, value FROM jsonb_each(v_row -> 'corrections') LOOP
      -- a JSON null spec is "no proposal for this field" (2026-09-27 incident); clearing a column is
      -- said explicitly as {"value": null}. Anything else that is not an object is a caller bug.
      IF v_spec IS NULL OR jsonb_typeof(v_spec) = 'null' THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;
      IF jsonb_typeof(v_spec) <> 'object' THEN
        RAISE EXCEPTION 'correct_vehicle_sale_provenance_batch: vehicle % field % spec must be an object {value, expected?}, got %', v_id, v_field, jsonb_typeof(v_spec);
      END IF;
      IF NOT (v_field = ANY (c_allowed)) THEN
        RAISE EXCEPTION 'correct_vehicle_sale_provenance_batch: unsupported field % (supported: %)', v_field, array_to_string(c_allowed, ', ');
      END IF;

      v_orig := CASE v_field
        WHEN 'sale_price'         THEN v_veh.sale_price::text
        WHEN 'sale_status'        THEN v_veh.sale_status
        WHEN 'auction_outcome'    THEN v_veh.auction_outcome
        WHEN 'reserve_status'     THEN v_veh.reserve_status
        WHEN 'high_bid'           THEN v_veh.high_bid::text
        WHEN 'winning_bid'        THEN v_veh.winning_bid::text
        WHEN 'bat_sold_price'     THEN v_veh.bat_sold_price::text
        WHEN 'sold_price'         THEN v_veh.sold_price::text
        WHEN 'sale_date'          THEN v_veh.sale_date::text
        WHEN 'bat_sale_date'      THEN v_veh.bat_sale_date::text
        WHEN 'auction_end_date'   THEN v_veh.auction_end_date
        WHEN 'bat_buyer'          THEN v_veh.bat_buyer
        WHEN 'canonical_platform' THEN v_veh.canonical_platform
      END;
      v_new := v_spec ->> 'value';

      -- typed no-op / expectation checks (25000 = 25000.00; 2024-03-01 = 2024-03-01)
      v_same := CASE
        WHEN v_field = ANY (c_numeric) THEN v_orig::numeric IS NOT DISTINCT FROM v_new::numeric
        WHEN v_field = ANY (c_date)    THEN v_orig::date    IS NOT DISTINCT FROM v_new::date
        ELSE v_orig IS NOT DISTINCT FROM v_new END;
      IF v_same THEN
        v_noop := v_noop + 1;
        CONTINUE;
      END IF;

      IF v_spec ? 'expected' THEN
        IF NOT (CASE
          WHEN v_field = ANY (c_numeric) THEN v_orig::numeric IS NOT DISTINCT FROM (v_spec ->> 'expected')::numeric
          WHEN v_field = ANY (c_date)    THEN v_orig::date    IS NOT DISTINCT FROM (v_spec ->> 'expected')::date
          ELSE v_orig IS NOT DISTINCT FROM (v_spec ->> 'expected') END) THEN
          v_stale := v_stale || jsonb_build_array(jsonb_build_object(
            'vehicle_id', v_id, 'field', v_field, 'live', v_orig, 'expected', v_spec ->> 'expected', 'proposed', v_new));
          CONTINUE;
        END IF;
      END IF;

      v_set := v_set || jsonb_build_object(v_field, v_new);
      v_audit := v_audit || jsonb_build_array(jsonb_build_object(
        'field', v_field,
        'original', v_orig,
        'corrected', v_new,
        'source', v_row -> 'source',
        'reason', COALESCE(v_row ->> 'reason', p_reason),
        'asserted_by', p_asserted_by,
        'asserted_at', now()));
    END LOOP;

    IF v_set = '{}'::jsonb THEN
      CONTINUE;
    END IF;

    -- one UPDATE per vehicle: every trigger on vehicles fires once, not once per field
    UPDATE vehicles SET
      sale_price         = CASE WHEN v_set ? 'sale_price'         THEN (v_set ->> 'sale_price')::integer      ELSE sale_price END,
      sale_status        = CASE WHEN v_set ? 'sale_status'        THEN  v_set ->> 'sale_status'                ELSE sale_status END,
      auction_outcome    = CASE WHEN v_set ? 'auction_outcome'    THEN  v_set ->> 'auction_outcome'            ELSE auction_outcome END,
      reserve_status     = CASE WHEN v_set ? 'reserve_status'     THEN  v_set ->> 'reserve_status'             ELSE reserve_status END,
      high_bid           = CASE WHEN v_set ? 'high_bid'           THEN (v_set ->> 'high_bid')::integer        ELSE high_bid END,
      winning_bid        = CASE WHEN v_set ? 'winning_bid'        THEN (v_set ->> 'winning_bid')::integer     ELSE winning_bid END,
      bat_sold_price     = CASE WHEN v_set ? 'bat_sold_price'     THEN (v_set ->> 'bat_sold_price')::numeric  ELSE bat_sold_price END,
      sold_price         = CASE WHEN v_set ? 'sold_price'         THEN (v_set ->> 'sold_price')::integer      ELSE sold_price END,
      sale_date          = CASE WHEN v_set ? 'sale_date'          THEN (v_set ->> 'sale_date')::date          ELSE sale_date END,
      bat_sale_date      = CASE WHEN v_set ? 'bat_sale_date'      THEN (v_set ->> 'bat_sale_date')::date      ELSE bat_sale_date END,
      auction_end_date   = CASE WHEN v_set ? 'auction_end_date'   THEN  v_set ->> 'auction_end_date'           ELSE auction_end_date END,
      bat_buyer          = CASE WHEN v_set ? 'bat_buyer'          THEN  v_set ->> 'bat_buyer'                  ELSE bat_buyer END,
      canonical_platform = CASE WHEN v_set ? 'canonical_platform' THEN  v_set ->> 'canonical_platform'         ELSE canonical_platform END,
      platform_source    = CASE WHEN v_set ? 'canonical_platform' THEN COALESCE(v_row -> 'source' ->> 'ref', 'correct_vehicle_sale_provenance') ELSE platform_source END,
      provenance_metadata = COALESCE(provenance_metadata, '{}'::jsonb) || jsonb_build_object(
        'sale_provenance_corrections',
          COALESCE(provenance_metadata -> 'sale_provenance_corrections', '[]'::jsonb) || v_audit)
    WHERE id = v_id;

    v_vehicles := v_vehicles + 1;
    v_fields := v_fields + jsonb_array_length(v_audit);
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'vehicles_corrected', v_vehicles,
    'fields_corrected', v_fields,
    'fields_noop', v_noop,
    'fields_skipped_null_spec', v_skipped,
    'stale', v_stale,
    'missing', v_missing,
    'asserted_by', p_asserted_by);
END;
$fn$;

COMMENT ON FUNCTION public.correct_vehicle_sale_provenance_batch(jsonb, text, text) IS
  'Sanctioned sale-provenance correction chokepoint, batch form (v2.1, 2026-09-27). Per vehicle: cited source REQUIRED, per-field spec {value, expected?} (a JSON-null spec is skipped, never applied; clearing a column is an explicit {"value": null}); compare-and-supersede on "expected" (mismatches reported as stale, never forced); originals appended to vehicles.provenance_metadata.sale_provenance_corrections. One UPDATE per vehicle. Sets nuke.bulk_sale_correction=on for the transaction so mark_comp_estimates_stale() does not fan out per row. Supported fields: sale_price, sale_status, auction_outcome, reserve_status, high_bid, winning_bid, bat_sold_price, sold_price, sale_date, bat_sale_date, auction_end_date, bat_buyer, canonical_platform. Does NOT touch any testimony table.';

-- Live verification (after apply): a null spec must be reported as skipped and change nothing:
--   select correct_vehicle_sale_provenance_batch(jsonb_build_array(jsonb_build_object(
--     'vehicle_id', '<any vehicle id>', 'source', jsonb_build_object('type','check','ref','urn:none'),
--     'corrections', jsonb_build_object('sale_price', null))), 'migration-check');
--   -> fields_skipped_null_spec = 1, vehicles_corrected = 0
