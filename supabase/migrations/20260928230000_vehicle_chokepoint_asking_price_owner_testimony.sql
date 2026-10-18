-- correct_vehicle_sale_provenance_batch v2.4: asking_price, and owner testimony as a citable source.
--
-- Asked by the setup lane (price plan step 3: this function becomes the only writer of price fields) after the
-- k5-wiring lane hit both gaps on the K5 (e08bf694): its $189,000 ask came from an owner-input "listing"
-- observation with no content (2025-09-20), and the correction's real source is the owner's own word (a paid
-- client build, not for sale).
--   * asking_price joins the supported fields (numeric; the price triggers already fire for every correction,
--     since sale_price is always in the SET list, so this adds no trigger work).
--   * source {type: 'owner_observation', observation_id}: the owner's word, recorded first as a
--     vehicle_observations row through the sanctioned writer (ingest-observation), is cited by its id. The row
--     must exist on this vehicle and not be superseded; who said it and when lives on that row. ref is filled in
--     as 'vehicle_observations/<id>'. Every other source still needs its own ref.
-- Everything else is unchanged from the live v2.3.

CREATE OR REPLACE FUNCTION public.correct_vehicle_sale_provenance_batch(p_rows jsonb, p_asserted_by text DEFAULT 'agent'::text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_allowed CONSTANT text[] := ARRAY[
    'sale_price','sale_status','auction_outcome','reserve_status','high_bid','winning_bid',
    'bat_sold_price','sold_price','sale_date','bat_sale_date','auction_end_date','bat_buyer',
    'canonical_platform','msrp','msrp_source','listing_kind','year','make','model','bat_auction_url',
    'asking_price'];
  c_numeric CONSTANT text[] := ARRAY['sale_price','high_bid','winning_bid','bat_sold_price','sold_price','msrp','year','asking_price'];
  c_date    CONSTANT text[] := ARRAY['sale_date','bat_sale_date'];
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
    RAISE EXCEPTION 'correct_vehicle_sale_provenance_batch: p_rows must be a JSON array';
  END IF;

  PERFORM set_config('nuke.bulk_sale_correction', 'on', true);

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_id := (v_row ->> 'vehicle_id')::uuid;
    v_source := v_row -> 'source';
    -- owner testimony: a live observation of this vehicle, cited by id (who said it lives on that row)
    IF v_source ->> 'type' = 'owner_observation' THEN
      IF (v_source ->> 'observation_id') IS NULL OR NOT EXISTS (
           SELECT 1 FROM vehicle_observations o
           WHERE o.id = (v_source ->> 'observation_id')::uuid
             AND o.vehicle_id = v_id
             AND coalesce(o.is_superseded, false) = false) THEN
        RAISE EXCEPTION 'correct_vehicle_sale_provenance_batch: owner_observation % is not a live observation of vehicle %',
          v_source ->> 'observation_id', v_id;
      END IF;
      v_source := v_source || jsonb_build_object('ref', 'vehicle_observations/' || (v_source ->> 'observation_id'));
    END IF;
    IF v_source IS NULL OR v_source = '{}'::jsonb OR (v_source ->> 'ref') IS NULL THEN
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
        WHEN 'msrp'               THEN v_veh.msrp::text
        WHEN 'msrp_source'        THEN v_veh.msrp_source
        WHEN 'listing_kind'       THEN v_veh.listing_kind
        WHEN 'year'               THEN v_veh.year::text
        WHEN 'make'               THEN v_veh.make
        WHEN 'model'              THEN v_veh.model
        WHEN 'bat_auction_url'    THEN v_veh.bat_auction_url
        WHEN 'asking_price'       THEN v_veh.asking_price::text
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
        'source', v_source,
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
      platform_source    = CASE WHEN v_set ? 'canonical_platform' THEN COALESCE(v_source ->> 'ref', 'correct_vehicle_sale_provenance') ELSE platform_source END,
      msrp               = CASE WHEN v_set ? 'msrp'               THEN (v_set ->> 'msrp')::numeric            ELSE msrp END,
      msrp_source        = CASE WHEN v_set ? 'msrp_source'        THEN  v_set ->> 'msrp_source'                ELSE msrp_source END,
      listing_kind       = CASE WHEN v_set ? 'listing_kind'       THEN  v_set ->> 'listing_kind'               ELSE listing_kind END,
      asking_price       = CASE WHEN v_set ? 'asking_price'       THEN (v_set ->> 'asking_price')::numeric    ELSE asking_price END,
      provenance_metadata = COALESCE(provenance_metadata, '{}'::jsonb) || jsonb_build_object(
        'sale_provenance_corrections',
          COALESCE(provenance_metadata -> 'sale_provenance_corrections', '[]'::jsonb) || v_audit)
    WHERE id = v_id;

    -- identity / link columns in their own statement, only when one of them is corrected: triggers declared
    -- UPDATE OF year/make/model (duplicate detection, auto services, VIN checks) then fire for identity moves
    -- only, never for an ordinary sale correction (which lists none of these columns)
    IF v_set ?| ARRAY['year', 'make', 'model'] THEN
      UPDATE vehicles SET
        year  = CASE WHEN v_set ? 'year'  THEN (v_set ->> 'year')::integer ELSE year END,
        make  = CASE WHEN v_set ? 'make'  THEN  v_set ->> 'make'  ELSE make END,
        model = CASE WHEN v_set ? 'model' THEN  v_set ->> 'model' ELSE model END
      WHERE id = v_id;
    END IF;
    IF v_set ? 'bat_auction_url' THEN
      UPDATE vehicles SET bat_auction_url = v_set ->> 'bat_auction_url' WHERE id = v_id;
    END IF;

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
