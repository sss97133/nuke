-- Purchase-provenance writer: the sanctioned way to correct vehicles.purchase_price, purchase_date and
-- purchase_location. Modeled on correct_vehicle_sale_provenance_batch (whose whitelist is sale fields only):
-- same citation rule (source.ref required, or an owner_observation id that is a live observation of the vehicle),
-- same expected-value guard, same {"value": null} to clear, same audit trail, here under
-- provenance_metadata.purchase_provenance_corrections. Service role only; one UPDATE per vehicle.
-- Break (2026-10-15, owner): a build total was stored as a purchase price on a trade-in that was never priced,
-- and no sanctioned writer covered the purchase columns.
-- Forward-only, no row changes, no permission changes beyond this function. Applied by CI, never by hand.
-- Contract: supabase/sql/test_purchase_provenance_corrector.sql (db-contracts).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';
CREATE OR REPLACE FUNCTION public.correct_vehicle_purchase_provenance(p_rows jsonb, p_asserted_by text DEFAULT 'agent'::text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_allowed CONSTANT text[] := ARRAY['purchase_price','purchase_date','purchase_location'];
  v_row      jsonb;
  v_source   jsonb;
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
    RAISE EXCEPTION 'correct_vehicle_purchase_provenance: p_rows must be a JSON array';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_id := (v_row ->> 'vehicle_id')::uuid;
    v_source := v_row -> 'source';
    IF v_source ->> 'type' = 'owner_observation' THEN
      IF (v_source ->> 'observation_id') IS NULL OR NOT EXISTS (
           SELECT 1 FROM vehicle_observations o
           WHERE o.id = (v_source ->> 'observation_id')::uuid
             AND o.vehicle_id = v_id
             AND coalesce(o.is_superseded, false) = false) THEN
        RAISE EXCEPTION 'correct_vehicle_purchase_provenance: owner_observation % is not a live observation of vehicle %',
          v_source ->> 'observation_id', v_id;
      END IF;
      v_source := v_source || jsonb_build_object('ref', 'vehicle_observations/' || (v_source ->> 'observation_id'));
    END IF;
    IF v_source IS NULL OR v_source = '{}'::jsonb OR (v_source ->> 'ref') IS NULL THEN
      RAISE EXCEPTION 'correct_vehicle_purchase_provenance: vehicle % has no source document with a ref -- corrections must be cited, never guessed', v_id;
    END IF;
    IF v_row -> 'corrections' IS NULL OR jsonb_typeof(v_row -> 'corrections') <> 'object' THEN
      RAISE EXCEPTION 'correct_vehicle_purchase_provenance: vehicle % has no corrections object', v_id;
    END IF;

    SELECT * INTO v_veh FROM vehicles WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      v_missing := v_missing || jsonb_build_array(v_id);
      CONTINUE;
    END IF;

    v_set := '{}'::jsonb;
    v_audit := '[]'::jsonb;

    FOR v_field, v_spec IN SELECT key, value FROM jsonb_each(v_row -> 'corrections') LOOP
      IF v_spec IS NULL OR jsonb_typeof(v_spec) = 'null' THEN
        v_skipped := v_skipped + 1;   -- JSON null = no proposal; clearing is {"value": null}
        CONTINUE;
      END IF;
      IF jsonb_typeof(v_spec) <> 'object' THEN
        RAISE EXCEPTION 'correct_vehicle_purchase_provenance: vehicle % field % spec must be an object {value, expected?}, got %', v_id, v_field, jsonb_typeof(v_spec);
      END IF;
      IF NOT (v_field = ANY (c_allowed)) THEN
        RAISE EXCEPTION 'correct_vehicle_purchase_provenance: unsupported field % (supported: %)', v_field, array_to_string(c_allowed, ', ');
      END IF;

      v_orig := CASE v_field
        WHEN 'purchase_price'    THEN v_veh.purchase_price::text
        WHEN 'purchase_date'     THEN v_veh.purchase_date::text
        WHEN 'purchase_location' THEN v_veh.purchase_location
      END;
      v_new := v_spec ->> 'value';

      v_same := CASE v_field
        WHEN 'purchase_price' THEN v_orig::numeric IS NOT DISTINCT FROM v_new::numeric
        WHEN 'purchase_date'  THEN v_orig::date    IS NOT DISTINCT FROM v_new::date
        ELSE v_orig IS NOT DISTINCT FROM v_new END;
      IF v_same THEN
        v_noop := v_noop + 1;
        CONTINUE;
      END IF;

      IF v_spec ? 'expected' THEN
        IF NOT (CASE v_field
          WHEN 'purchase_price' THEN v_orig::numeric IS NOT DISTINCT FROM (v_spec ->> 'expected')::numeric
          WHEN 'purchase_date'  THEN v_orig::date    IS NOT DISTINCT FROM (v_spec ->> 'expected')::date
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
        'source', v_source,
        'reason', COALESCE(v_row ->> 'reason', p_reason),
        'asserted_by', p_asserted_by,
        'asserted_at', now()));
    END LOOP;

    IF v_set = '{}'::jsonb THEN
      CONTINUE;
    END IF;

    UPDATE vehicles SET
      purchase_price    = CASE WHEN v_set ? 'purchase_price'    THEN (v_set ->> 'purchase_price')::numeric ELSE purchase_price END,
      purchase_date     = CASE WHEN v_set ? 'purchase_date'     THEN (v_set ->> 'purchase_date')::date     ELSE purchase_date END,
      purchase_location = CASE WHEN v_set ? 'purchase_location' THEN  v_set ->> 'purchase_location'        ELSE purchase_location END,
      provenance_metadata = COALESCE(provenance_metadata, '{}'::jsonb) || jsonb_build_object(
        'purchase_provenance_corrections',
          COALESCE(provenance_metadata -> 'purchase_provenance_corrections', '[]'::jsonb) || v_audit)
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
$function$;
REVOKE ALL ON FUNCTION public.correct_vehicle_purchase_provenance(jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.correct_vehicle_purchase_provenance(jsonb, text, text) TO service_role;
COMMENT ON FUNCTION public.correct_vehicle_purchase_provenance(jsonb, text, text) IS
  'Sanctioned writer for vehicles.purchase_price/purchase_date/purchase_location. Cited (source.ref), expected-value guarded, audited in provenance_metadata.purchase_provenance_corrections. Service role only.';
COMMIT;
