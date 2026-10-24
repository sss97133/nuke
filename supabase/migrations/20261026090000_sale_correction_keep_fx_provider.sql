-- Sale corrections keep the vehicle's recorded fx provider.
-- correct_vehicle_sale_provenance_batch re-derives sale_price_usd whenever amount, date or currency moves. Since
-- 20261026080000 it picked the preferred provider per currency, so re-correcting a GBP vehicle stored at the ECB cross
-- would silently move it to the BoE rate. Now it converts with vehicles.sale_price_fx_provider when that is set, and
-- only a row with "fx_rerate": true lets fx_rate_provider_preference choose again. A recorded provider with no rate
-- in the 7-day window raises instead of falling back.
-- New overload vehicle_sale_price_fx_usd_preferred(amount, currency, date, provider); NULL provider = preference order.
-- Rollback: supabase/rollbacks/20261026090000_sale_correction_keep_fx_provider_down.sql

CREATE OR REPLACE FUNCTION public.vehicle_sale_price_fx_usd_preferred(p_amount numeric, p_currency text, p_sale_date date, p_provider text)
 RETURNS TABLE(amount_usd numeric, fx_rate numeric, fx_date date, fx_source text, fx_provider text)
 LANGUAGE plpgsql STABLE SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_fx fx_rates%ROWTYPE;
BEGIN
  IF p_provider IS NULL THEN
    RETURN QUERY SELECT * FROM vehicle_sale_price_fx_usd_preferred(p_amount, p_currency, p_sale_date);
    RETURN;
  END IF;
  IF p_amount IS NULL OR p_currency IS NULL OR upper(p_currency) = 'USD' THEN
    RETURN QUERY SELECT NULL::numeric, NULL::numeric, NULL::date, NULL::text, NULL::text;
    RETURN;
  END IF;
  IF p_sale_date IS NULL THEN
    RAISE EXCEPTION 'vehicle_sale_price_fx_usd: % % has no sale_date to convert at', p_amount, p_currency;
  END IF;
  SELECT * INTO v_fx FROM fx_rates f
  WHERE f.base_currency = upper(p_currency) AND f.quote_currency = 'USD' AND f.provider = p_provider
    AND f.rate_date <= p_sale_date AND f.rate_date >= p_sale_date - 7
  ORDER BY f.rate_date DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'vehicle_sale_price_fx_usd: no % -> USD rate from recorded provider % within 7 days before %; pass "fx_rerate": true to choose a provider again',
      upper(p_currency), p_provider, p_sale_date;
  END IF;
  RETURN QUERY SELECT round(p_amount * v_fx.rate, 2), v_fx.rate, v_fx.rate_date,
    v_fx.source || COALESCE(' (' || v_fx.source_url || ')', ''), v_fx.provider;
END;
$function$;

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
    'asking_price','interior_color','color','bat_seller','seller_name',
    'discovery_url','auction_source','normalized_model','normalized_series','sale_price_currency'];
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
  v_fx       record;
  v_fx_hit   boolean;
  v_fx_usd   numeric;
  v_fx_rate  numeric;
  v_fx_fdate date;
  v_fx_src   text;
  v_fx_prov  text;
  v_fx_keep  text;
  v_fx_amt   numeric;
  v_fx_date  date;
  v_fx_cur   text;
  v_evd      date;
  v_superseded jsonb := '[]'::jsonb;
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
    -- keep the provider already recorded on the vehicle; only an explicit per-row "fx_rerate": true lets the
    -- preference table choose again (so a re-correction never silently swaps an ECB rate for a BoE one)
    v_fx_keep := CASE WHEN COALESCE((v_row ->> 'fx_rerate')::boolean, false) THEN NULL ELSE v_veh.sale_price_fx_provider END;
    IF NOT FOUND THEN
      v_missing := v_missing || jsonb_build_array(v_id);
      CONTINUE;
    END IF;

    -- a verified event only moves the vehicle's sale when it is the vehicle's latest sale by sale date
    -- (2026-10-24: an older verified event overwrote a newer BaT sale). Superseded rows are reported, not written.
    IF v_source ->> 'type' = 'verified_vehicle_event'
       AND (v_row -> 'corrections') ?| ARRAY['sale_price', 'sale_date', 'sale_status'] THEN
      SELECT (coalesce(e.sold_at, e.ended_at) AT TIME ZONE 'UTC')::date INTO v_evd
      FROM vehicle_events e
      WHERE e.id = (v_source ->> 'event_id')::uuid AND e.vehicle_id = v_id;
      IF v_evd IS NULL
         OR v_veh.sale_date > v_evd
         OR EXISTS (SELECT 1 FROM vehicle_events e
                    WHERE e.vehicle_id = v_id AND e.id <> (v_source ->> 'event_id')::uuid
                      AND e.price_verification = 'verified' AND e.event_status = 'sold' AND e.final_price > 0
                      AND coalesce(e.sale_truth_role, '') <> 'duplicate'
                      AND (coalesce(e.sold_at, e.ended_at) AT TIME ZONE 'UTC')::date > v_evd) THEN
        v_superseded := v_superseded || jsonb_build_array(jsonb_build_object(
          'vehicle_id', v_id, 'event_id', v_source ->> 'event_id', 'event_date', v_evd, 'vehicle_sale_date', v_veh.sale_date));
        CONTINUE;
      END IF;
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
        WHEN 'interior_color'     THEN v_veh.interior_color
        WHEN 'color'              THEN v_veh.color
        WHEN 'bat_seller'         THEN v_veh.bat_seller
        WHEN 'seller_name'        THEN v_veh.seller_name
        WHEN 'discovery_url'      THEN v_veh.discovery_url
        WHEN 'auction_source'     THEN v_veh.auction_source
        WHEN 'normalized_model'   THEN v_veh.normalized_model
        WHEN 'normalized_series'  THEN v_veh.normalized_series
        WHEN 'sale_price_currency' THEN v_veh.sale_price_currency
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

    -- sale currency + USD resolved BEFORE the write and set in the same UPDATE as the amount, so the NOT VALID
    -- check vehicles_sale_price_usd_required holds even when trg_vehicles_sale_currency_guard labels the row
    -- non-USD (it labels a NULL currency from the vehicle_events price the new amount matches; mirrored here).
    v_fx_hit := v_set ?| ARRAY['sale_price', 'sale_date', 'sale_price_currency'];
    v_fx_usd := NULL; v_fx_rate := NULL; v_fx_fdate := NULL; v_fx_src := NULL; v_fx_prov := NULL;
    IF v_fx_hit THEN
      v_fx_amt  := CASE WHEN v_set ? 'sale_price' THEN (v_set ->> 'sale_price')::integer ELSE v_veh.sale_price END;
      v_fx_date := CASE WHEN v_set ? 'sale_date'  THEN (v_set ->> 'sale_date')::date     ELSE v_veh.sale_date END;
      v_fx_cur  := CASE WHEN v_set ? 'sale_price_currency' THEN upper(v_set ->> 'sale_price_currency') ELSE v_veh.sale_price_currency END;
      IF v_fx_cur IS NULL AND v_fx_amt > 0 THEN
        SELECT CASE WHEN count(DISTINCT upper(coalesce(e.currency_code, '?'))) = 1
                     AND min(upper(e.currency_code)) IS NOT NULL AND min(upper(e.currency_code)) <> 'USD'
                    THEN min(upper(e.currency_code)) END
          INTO v_fx_cur
          FROM vehicle_events e
         WHERE e.vehicle_id = v_id AND (e.final_price = v_fx_amt OR e.hammer_price = v_fx_amt);
      END IF;
      -- the vehicle's recorded provider when it has one (v_fx_keep), else the preferred provider for the currency
      SELECT x.amount_usd, x.fx_rate, x.fx_date, x.fx_source, x.fx_provider INTO v_fx_usd, v_fx_rate, v_fx_fdate, v_fx_src, v_fx_prov
        FROM vehicle_sale_price_fx_usd_preferred(v_fx_amt, v_fx_cur, v_fx_date, v_fx_keep) x;
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
      bat_seller         = CASE WHEN v_set ? 'bat_seller'         THEN  v_set ->> 'bat_seller'                 ELSE bat_seller END,
      seller_name        = CASE WHEN v_set ? 'seller_name'        THEN  v_set ->> 'seller_name'                ELSE seller_name END,
      canonical_platform = CASE WHEN v_set ? 'canonical_platform' THEN  v_set ->> 'canonical_platform'         ELSE canonical_platform END,
      platform_source    = CASE WHEN v_set ? 'canonical_platform' THEN COALESCE(v_source ->> 'ref', 'correct_vehicle_sale_provenance') ELSE platform_source END,
      msrp               = CASE WHEN v_set ? 'msrp'               THEN (v_set ->> 'msrp')::numeric            ELSE msrp END,
      msrp_source        = CASE WHEN v_set ? 'msrp_source'        THEN  v_set ->> 'msrp_source'                ELSE msrp_source END,
      listing_kind       = CASE WHEN v_set ? 'listing_kind'       THEN  v_set ->> 'listing_kind'               ELSE listing_kind END,
      asking_price       = CASE WHEN v_set ? 'asking_price'       THEN (v_set ->> 'asking_price')::numeric    ELSE asking_price END,
      interior_color     = CASE WHEN v_set ? 'interior_color'     THEN  v_set ->> 'interior_color'             ELSE interior_color END,
      color              = CASE WHEN v_set ? 'color'              THEN  v_set ->> 'color'                      ELSE color END,
      sale_price_currency  = CASE WHEN v_fx_hit THEN v_fx_cur ELSE sale_price_currency END,
      sale_price_usd       = CASE WHEN v_fx_hit THEN v_fx_usd ELSE sale_price_usd END,
      sale_price_fx_rate   = CASE WHEN v_fx_hit THEN v_fx_rate ELSE sale_price_fx_rate END,
      sale_price_fx_date   = CASE WHEN v_fx_hit THEN v_fx_fdate ELSE sale_price_fx_date END,
      sale_price_fx_source = CASE WHEN v_fx_hit THEN v_fx_src ELSE sale_price_fx_source END,
      sale_price_fx_provider = CASE WHEN v_fx_hit THEN v_fx_prov ELSE sale_price_fx_provider END,
      provenance_metadata = COALESCE(provenance_metadata, '{}'::jsonb) || jsonb_build_object(
        'sale_provenance_corrections',
          COALESCE(provenance_metadata -> 'sale_provenance_corrections', '[]'::jsonb) || v_audit)
    WHERE id = v_id;

    -- sale currency: sale_price is the native amount in sale_price_currency (NULL = legacy USD). Whenever the
    -- amount, date or currency moves, sale_price_usd and its fx citation are re-derived from fx_rates at the
    -- sale-date rate, in the same statement as the currency so vehicles_sale_price_usd_required always holds.
    IF v_set ?| ARRAY['sale_price', 'sale_date', 'sale_price_currency'] THEN
      SELECT vv.sale_price, vv.sale_date,
             CASE WHEN v_set ? 'sale_price_currency' THEN upper(v_set ->> 'sale_price_currency') ELSE vv.sale_price_currency END
        INTO v_fx_amt, v_fx_date, v_fx_cur
      FROM vehicles vv WHERE vv.id = v_id;
      SELECT * INTO v_fx FROM vehicle_sale_price_fx_usd_preferred(v_fx_amt, v_fx_cur, v_fx_date, v_fx_keep);
      UPDATE vehicles SET
        sale_price_currency  = v_fx_cur,
        sale_price_usd       = v_fx.amount_usd,
        sale_price_fx_rate   = v_fx.fx_rate,
        sale_price_fx_date   = v_fx.fx_date,
        sale_price_fx_source = v_fx.fx_source,
        sale_price_fx_provider = v_fx.fx_provider
      WHERE id = v_id
        AND (sale_price_currency, sale_price_usd, sale_price_fx_rate, sale_price_fx_date, sale_price_fx_source, sale_price_fx_provider)
            IS DISTINCT FROM (v_fx_cur, v_fx.amount_usd, v_fx.fx_rate, v_fx.fx_date, v_fx.fx_source, v_fx.fx_provider);
    END IF;

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
    -- the other car's link and venue, laid over a lot row (2026-10-15 hybrid rows), corrected like bat_auction_url
    IF v_set ?| ARRAY['discovery_url', 'auction_source'] THEN
      UPDATE vehicles SET
        discovery_url  = CASE WHEN v_set ? 'discovery_url'  THEN v_set ->> 'discovery_url'  ELSE discovery_url END,
        auction_source = CASE WHEN v_set ? 'auction_source' THEN v_set ->> 'auction_source' ELSE auction_source END
      WHERE id = v_id;
    END IF;
    -- after the identity statement: auto_normalize_vehicle_model (BEFORE UPDATE OF model, make, year) keeps the old
    -- normalized model when the corrected model has no canonical match, so a cited value is written here, where that
    -- trigger does not fire
    IF v_set ?| ARRAY['normalized_model', 'normalized_series'] THEN
      UPDATE vehicles SET
        normalized_model  = CASE WHEN v_set ? 'normalized_model'  THEN v_set ->> 'normalized_model'  ELSE normalized_model END,
        normalized_series = CASE WHEN v_set ? 'normalized_series' THEN v_set ->> 'normalized_series' ELSE normalized_series END
      WHERE id = v_id;
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
    'superseded', v_superseded,
    'asserted_by', p_asserted_by);
END;
$function$;
