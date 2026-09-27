-- correct_vehicle_sale_provenance v2 — the same chokepoint, widened to the sale fields, batch-shaped.
--
-- WHY (measured 2026-09-26/27 against BaT's own catalog + lot pages, session cb179857):
--   Of 182,509 BaT-linked vehicles rows, 30,612 lots that did NOT sell carry a sale_price
--   (the high bid), 8,878 sold lots carry a wrong sale_price, 1,562 sold lots have none,
--   36,378 sold lots have no sale_date and 4,498 a wrong one, 4,152 unsold lots read
--   sale_status='sold' and 30,005 sold lots read something else. clean_vehicle_prices marks
--   is_sold from sale_price > 0, so every unsold high bid is a "sale" in every nuke.ag value.
--   v1 of this function (20260708120205) is the ONE sanctioned correction path, but it only
--   knows sale_date and canonical_platform and applies one value to many vehicles — a
--   BaT-truth pass needs per-vehicle values across sale_price / sale_status / auction_outcome /
--   reserve_status / high_bid / sale_date / bat_buyer, with the original + citation kept.
--   Every agent that met one of these rows wrote its own UPDATE (no record) or gave up.
--
-- SCHEMA_LAW pre-mint checklist:
--  1. §1 search: correct_vehicle_sale_provenance (this, v1), correct_image_provenance,
--     correct_fabricated_location_stamp, supersede_observation (observations only),
--     auto_correct_vehicle_cascading (identity), Tetris batchUpsertWithProvenance (gap-fill /
--     confirm / QUARANTINE — cannot correct a wrong value by design). Nothing corrects a sale
--     field with provenance → widen v1, do not mint a parallel writer.
--  2. §2: these are PROJECTION columns on vehicles. No testimony row is touched; the
--     original value + the citing document go to provenance_metadata.sale_provenance_corrections
--     (v1's exact audit shape), recoverable forever.
--  3. §3: every row carries its source document {type, ref (URL), method, observed_at, ...};
--     the function refuses a row without one.
--  4. §4: supersession — the audit entry IS the superseded value. Never overwrite silently.
--  5. §5: compare-and-supersede: a row may state the value it expects to replace ("expected");
--     if the live value differs the row is skipped and reported as stale, never forced.
--     Column vocabularies are already CHECKed (vehicles_sale_status_check,
--     vehicles_reserve_status_check, auction_outcome CHECK).
--  6. §6: writers of these columns after this: this function (agents, the BaT reader's
--     supersession path) and the existing extractors' gap-fills. One UPDATE per vehicle so the
--     38 vehicles triggers fire once per vehicle, not once per field.
--  7. §7: CI-applied migration. SECURITY DEFINER, EXECUTE for service_role + authenticated
--     (same posture as v1). Live verification: see the check at the bottom.
--
-- Bulk safety: trg_invalidate_estimates_on_price runs a 500-row UPDATE on nuke_estimates for
-- EVERY corrected vehicle (make ±5 years). A 30K-row pass would issue 15M nuke_estimates
-- writes for nothing (every estimate is stale anyway — they were all computed on the dirty
-- comps). The batch function sets the transaction-local GUC nuke.bulk_sale_correction=on and
-- mark_comp_estimates_stale() now returns early under it. The caller marks estimates stale
-- once, in one statement, after the pass.

-- ─── 1. mark_comp_estimates_stale: skip under bulk correction ─────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_comp_estimates_stale()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Bulk sale corrections mark estimates stale once, at the end of the pass (see
  -- correct_vehicle_sale_provenance_batch). Per-row fan-out here would be 500 writes/vehicle.
  IF current_setting('nuke.bulk_sale_correction', true) = 'on' THEN
    RETURN NEW;
  END IF;

  -- Only fire if a price field actually changed
  IF (
    COALESCE(NEW.sale_price, 0) != COALESCE(OLD.sale_price, 0) OR
    COALESCE(NEW.winning_bid, 0) != COALESCE(OLD.winning_bid, 0) OR
    COALESCE(NEW.asking_price, 0) != COALESCE(OLD.asking_price, 0)
  ) AND NEW.make IS NOT NULL AND NEW.year IS NOT NULL THEN
    -- Mark estimates stale for vehicles with same make and similar year range
    -- Limit to 500 to prevent runaway updates
    UPDATE nuke_estimates
    SET is_stale = true
    WHERE is_stale = false
      AND vehicle_id IN (
        SELECT v.id
        FROM vehicles v
        WHERE v.make = NEW.make
          AND v.year BETWEEN NEW.year - 5 AND NEW.year + 5
          AND v.id != NEW.id
        LIMIT 500
      );
  END IF;

  RETURN NEW;
END;
$function$;

-- ─── 2. The batch chokepoint ──────────────────────────────────────────────────────────────
-- p_rows: [{ "vehicle_id": uuid,
--            "source": { "type": "bat", "ref": "https://bringatrailer.com/listing/<slug>/",
--                        "method": "...", "observed_at": "...", ... },      -- REQUIRED
--            "reason": "optional per-row note",
--            "corrections": { "<field>": { "value": <text|null>, "expected": <text|null> }, ... } }]
--   value    : the corrected value as text (cast per field); JSON null clears the column.
--   expected : optional; the value the caller believes is live. Compared per field type
--              (numeric / date / text). A mismatch skips the field and reports it as stale.
-- Returns counts + the stale/missing rows so the caller can re-read and retry.
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
    'stale', v_stale,
    'missing', v_missing,
    'asserted_by', p_asserted_by);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.correct_vehicle_sale_provenance_batch(jsonb, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.correct_vehicle_sale_provenance_batch(jsonb, text, text) IS
  'Sanctioned sale-provenance correction chokepoint, batch form (v2, 2026-09-27). Per vehicle: cited source REQUIRED, per-field value + optional expected live value (compare-and-supersede; mismatches reported as stale, never forced), original values appended to vehicles.provenance_metadata.sale_provenance_corrections. One UPDATE per vehicle. Sets nuke.bulk_sale_correction=on for the transaction so mark_comp_estimates_stale() does not fan out per row; mark estimates stale once after the pass. Supported fields: sale_price, sale_status, auction_outcome, reserve_status, high_bid, winning_bid, bat_sold_price, sold_price, sale_date, bat_sale_date, auction_end_date, bat_buyer, canonical_platform. Does NOT touch any testimony table.';

-- ─── 3. v1 signature kept; now a thin wrapper over the batch function ─────────────────────
CREATE OR REPLACE FUNCTION public.correct_vehicle_sale_provenance(
  p_vehicle_ids uuid[],
  p_field       text,
  p_value       text,
  p_source      jsonb,
  p_asserted_by text DEFAULT 'agent',
  p_reason      text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_rows   jsonb;
  v_result jsonb;
BEGIN
  IF p_source IS NULL OR p_source = '{}'::jsonb THEN
    RAISE EXCEPTION 'correct_vehicle_sale_provenance: a source document (p_source) is required -- corrections must be cited, never guessed';
  END IF;
  -- v1 gate kept: a sale_date correction must cite an extracted_year or a ref URL
  IF p_field = 'sale_date' AND (p_source ->> 'extracted_year') IS NULL AND (p_source ->> 'ref') IS NULL THEN
    RAISE EXCEPTION 'correct_vehicle_sale_provenance: sale_date corrections must cite either an extracted_year or a ref URL';
  END IF;
  -- the batch function requires source.ref; v1 callers that cite by extracted_year only get a synthetic ref
  IF (p_source ->> 'ref') IS NULL THEN
    p_source := p_source || jsonb_build_object('ref', 'extracted_year:' || (p_source ->> 'extracted_year'));
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'vehicle_id', id,
           'source', p_source,
           'corrections', jsonb_build_object(p_field, jsonb_build_object('value', p_value))))
    INTO v_rows
  FROM unnest(p_vehicle_ids) AS id;

  v_result := correct_vehicle_sale_provenance_batch(COALESCE(v_rows, '[]'::jsonb), p_asserted_by, p_reason);

  RETURN jsonb_build_object('ok', true, 'field', p_field, 'value', p_value,
    'vehicles_corrected', v_result -> 'vehicles_corrected',
    'vehicles_skipped_noop', (v_result -> 'fields_noop'),
    'source', p_source, 'asserted_by', p_asserted_by);
END;
$fn$;

COMMENT ON FUNCTION public.correct_vehicle_sale_provenance(uuid[],text,text,jsonb,text,text) IS
  'Sanctioned vehicle sale-provenance correction chokepoint (Class 3), v2 wrapper over correct_vehicle_sale_provenance_batch. Supersedes one sale field for many vehicles from a REQUIRED source document; originals preserved in vehicles.provenance_metadata.sale_provenance_corrections. Supported fields now: sale_price, sale_status, auction_outcome, reserve_status, high_bid, winning_bid, bat_sold_price, sold_price, sale_date, bat_sale_date, auction_end_date, bat_buyer, canonical_platform.';

-- ─── Live verification (run after apply; expected: ok=true, 0 corrected, 0 stale) ─────────
-- select correct_vehicle_sale_provenance_batch('[]'::jsonb, 'migration-check');
-- select correct_vehicle_sale_provenance_batch(
--   jsonb_build_array(jsonb_build_object('vehicle_id', '00000000-0000-0000-0000-000000000000',
--     'source', jsonb_build_object('type','check','ref','urn:none'),
--     'corrections', jsonb_build_object('sale_price', jsonb_build_object('value', null)))), 'migration-check');
--   -> missing = ["00000000-..."], vehicles_corrected = 0
