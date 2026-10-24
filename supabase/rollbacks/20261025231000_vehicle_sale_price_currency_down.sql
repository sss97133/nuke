-- Revert 20261025231000_vehicle_sale_price_currency: restore previous function bodies, then drop the new columns.
-- Before running, convert any non-USD rows back (see notes): rows with sale_price_currency <> 'USD' would otherwise
-- keep a native amount in sale_price.
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
    'discovery_url','auction_source','normalized_model','normalized_series'];
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
        WHEN 'interior_color'     THEN v_veh.interior_color
        WHEN 'color'              THEN v_veh.color
        WHEN 'bat_seller'         THEN v_veh.bat_seller
        WHEN 'seller_name'        THEN v_veh.seller_name
        WHEN 'discovery_url'      THEN v_veh.discovery_url
        WHEN 'auction_source'     THEN v_veh.auction_source
        WHEN 'normalized_model'   THEN v_veh.normalized_model
        WHEN 'normalized_series'  THEN v_veh.normalized_series
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
    'asserted_by', p_asserted_by);
END;
$function$;
CREATE OR REPLACE FUNCTION public.sync_vehicle_sale_price_from_verified_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_latest vehicle_events%rowtype;
  v_price  integer;
  v_cur    integer;
  v_status text;
begin
  if new.vehicle_id is null or new.price_verification is distinct from 'verified' or new.event_status is distinct from 'sold' then
    return null;
  end if;

  select * into v_latest
  from vehicle_events e
  where e.vehicle_id = new.vehicle_id
    and e.price_verification = 'verified'
    and e.event_status = 'sold'
    and e.final_price > 0
    and coalesce(e.sale_truth_role, '') <> 'duplicate'
  order by e.sold_at desc nulls last, e.price_verification_at desc nulls last
  limit 1;

  if not found or v_latest.id <> new.id
     or coalesce(v_latest.currency_code, 'USD') <> 'USD'
     or v_latest.price_verification_source is null then
    return null;
  end if;

  v_price := round(v_latest.final_price)::integer;
  select sale_price, sale_status into v_cur, v_status from vehicles where id = new.vehicle_id;
  if v_cur is not distinct from v_price and v_status is not distinct from 'sold' then
    return null;
  end if;

  perform correct_vehicle_sale_provenance_batch(
    jsonb_build_array(jsonb_build_object(
      'vehicle_id', new.vehicle_id,
      'reason', 'latest verified sold event ' || v_latest.id,
      'source', jsonb_build_object('type', 'verified_vehicle_event', 'ref', v_latest.price_verification_source,
                                   'event_id', v_latest.id, 'run_id', v_latest.price_verification_run_id),
      'corrections', jsonb_build_object(
        'sale_price', jsonb_build_object('value', v_price),
        'sale_status', jsonb_build_object('value', 'sold'),
        'sale_date', jsonb_build_object('value', (v_latest.sold_at at time zone 'UTC')::date)))),
    'trigger:sync_vehicle_sale_price_from_verified_event',
    'sale_price follows the latest verified sold event');
  return null;
end;
$function$;
CREATE OR REPLACE FUNCTION public.get_vehicle_current_price(p_vehicle_id uuid)
 RETURNS TABLE(price numeric, price_source text)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_vehicle RECORD;
  v_external_listing RECORD;
BEGIN
  -- Get vehicle
  SELECT * INTO v_vehicle FROM vehicles WHERE id = p_vehicle_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  
  -- Priority 1: Sale price (if sold)
  IF v_vehicle.sale_price IS NOT NULL AND v_vehicle.sale_price > 0
     AND NOT public.vehicle_sale_price_untrusted(p_vehicle_id, v_vehicle.sale_price) THEN
    RETURN QUERY SELECT v_vehicle.sale_price, 'sale_price';
  END IF;
  
  -- Priority 2: Active auction bid
  SELECT * INTO v_external_listing
  FROM external_listings
  WHERE vehicle_id = p_vehicle_id
    AND listing_status IN ('active', 'live', 'pending')
    AND current_bid IS NOT NULL
    AND current_bid > 0
  ORDER BY updated_at DESC
  LIMIT 1;
  
  IF FOUND AND v_external_listing.current_bid IS NOT NULL THEN
    RETURN QUERY SELECT v_external_listing.current_bid, 'current_bid';
  END IF;
  
  -- Priority 3: Asking price
  IF v_vehicle.asking_price IS NOT NULL AND v_vehicle.asking_price > 0 THEN
    RETURN QUERY SELECT v_vehicle.asking_price, 'asking_price';
  END IF;
  
  -- Priority 4: Current value
  IF v_vehicle.current_value IS NOT NULL AND v_vehicle.current_value > 0 THEN
    RETURN QUERY SELECT v_vehicle.current_value, 'current_value';
  END IF;
  
  -- No price available
  RETURN;
END;
$function$;

CREATE OR REPLACE FUNCTION public.vehicle_price_facts(p_vehicle_ids uuid[])
 RETURNS TABLE(vehicle_id uuid, price_kind text, price_amount numeric, price_as_of timestamp with time zone, price_live boolean, sold_amount numeric, sold_on date, sold_basis text, sold_amount_from text, ask_amount numeric, ask_as_of timestamp with time zone, bid_amount numeric, bid_on date, bid_from text, estimate_amount numeric, estimate_confidence integer, estimate_as_of timestamp with time zone, outcome text, platform text, source_url text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Keep the canonical sale basis once per selected vehicle. The SQL helper
  -- returns all twenty fields, so folding this stage repeats its source rule.
  WITH v AS MATERIALIZED (
    SELECT v.id, v.sale_status, v.auction_outcome, v.reserve_status,
           CASE WHEN public.vehicle_sale_price_untrusted(v.id, v.sale_price) THEN NULL ELSE v.sale_price END AS sale_price, v.bat_sold_price, v.sold_price, v.winning_bid, v.high_bid,
           v.asking_price, v.sale_date, v.bat_sale_date, v.listing_updated_at, v.listing_posted_at,
           v.nuke_estimate, v.nuke_estimate_confidence, v.valuation_calculated_at,
           v.canonical_outcome, v.canonical_platform,
           COALESCE(v.listing_url, v.bat_auction_url, v.platform_url) AS source_url,
           vehicle_sale_basis(v.sale_status, v.auction_outcome, v.canonical_platform, v.listing_url,
                              v.discovery_url, v.sale_price::numeric, v.notes, v.import_metadata,
                              v.created_at) AS basis,
           v.auction_end_date
    FROM vehicles v
    WHERE v.id = ANY (p_vehicle_ids)
      AND v.deleted_at IS NULL
  ),
  dated AS (
    -- Leave date parsing inline: an unused malformed legacy date must retain
    -- the old lazy CASE behavior rather than becoming a new reader exception.
    SELECT v.*, CASE WHEN v.auction_end_date ~ '^\d{4}-\d{2}-\d{2}'
      THEN left(v.auction_end_date, 10)::date END AS auction_end_on
    FROM v
  ),
  f AS (
    SELECT v.*,
      CASE WHEN v.basis IS NOT NULL THEN COALESCE(NULLIF(v.sale_price, 0)::numeric, NULLIF(v.winning_bid, 0)::numeric,
                                                  NULLIF(v.bat_sold_price, 0)::numeric, NULLIF(v.sold_price, 0)::numeric)
      END AS f_sold_amount,
      CASE WHEN v.basis IS NOT NULL THEN
        CASE WHEN v.sale_price > 0 THEN 'sale_price' WHEN v.winning_bid > 0 THEN 'winning_bid'
             WHEN v.bat_sold_price > 0 THEN 'bat_sold_price' WHEN v.sold_price > 0 THEN 'sold_price' END
      END AS f_sold_from,
      CASE WHEN v.basis IS NOT NULL THEN COALESCE(v.sale_date, v.bat_sale_date, v.auction_end_on) END AS f_sold_on,
      NULLIF(v.asking_price, 0) AS f_ask,
      COALESCE(NULLIF(v.high_bid, 0), NULLIF(v.winning_bid, 0))::numeric AS f_bid,
      CASE WHEN v.high_bid > 0 THEN 'high_bid' WHEN v.winning_bid > 0 THEN 'winning_bid' END AS f_bid_from,
      NULLIF(v.nuke_estimate, 0) AS f_estimate,
      COALESCE(v.sale_status = 'auction_live', false) AS f_live,
      COALESCE(v.sale_status, '') NOT IN ('sold', 'ended', 'not_sold', 'unsold', 'bid_to', 'auction_live', 'upcoming')
        AS f_ask_active
    FROM dated v
  )
  SELECT
    f.id,
    CASE WHEN f.basis IS NOT NULL                     THEN 'sold'
         WHEN f.f_live AND f.f_bid IS NOT NULL        THEN 'bid'
         WHEN f.f_ask_active AND f.f_ask IS NOT NULL  THEN 'ask'
         WHEN f.f_bid IS NOT NULL                     THEN 'bid'
         WHEN f.f_estimate IS NOT NULL                THEN 'estimate'
    END,
    CASE WHEN f.basis IS NOT NULL                     THEN f.f_sold_amount
         WHEN f.f_live AND f.f_bid IS NOT NULL        THEN f.f_bid
         WHEN f.f_ask_active AND f.f_ask IS NOT NULL  THEN f.f_ask
         WHEN f.f_bid IS NOT NULL                     THEN f.f_bid
         ELSE f.f_estimate
    END,
    CASE WHEN f.basis IS NOT NULL                     THEN f.f_sold_on::timestamptz
         WHEN f.f_live AND f.f_bid IS NOT NULL        THEN NULL
         WHEN f.f_ask_active AND f.f_ask IS NOT NULL  THEN COALESCE(f.listing_updated_at, f.listing_posted_at)
         WHEN f.f_bid IS NOT NULL                     THEN f.auction_end_on::timestamptz
         ELSE f.valuation_calculated_at
    END,
    f.f_live,
    f.f_sold_amount, f.f_sold_on, f.basis, f.f_sold_from,
    f.f_ask, CASE WHEN f.f_ask IS NOT NULL THEN COALESCE(f.listing_updated_at, f.listing_posted_at) END,
    f.f_bid, CASE WHEN f.f_bid IS NOT NULL THEN f.auction_end_on END, f.f_bid_from,
    f.f_estimate, CASE WHEN f.f_estimate IS NOT NULL THEN f.nuke_estimate_confidence END,
    CASE WHEN f.f_estimate IS NOT NULL THEN f.valuation_calculated_at END,
    CASE WHEN f.basis IS NOT NULL THEN 'sold'
         WHEN f.sale_status IN ('not_sold', 'unsold', 'bid_to') OR f.reserve_status = 'reserve_not_met'
              OR f.auction_outcome IN ('reserve_not_met', 'no_sale')                          THEN 'reserve_not_met'
         WHEN f.sale_status IN ('auction_live', 'upcoming')                                   THEN 'active'
         WHEN f.sale_status = 'for_sale'
              OR (COALESCE(f.asking_price, 0) > 0 AND COALESCE(f.sale_status, 'available') NOT IN ('ended'))
                                                                                              THEN 'for_sale'
         WHEN f.sale_status = 'ended'                                                         THEN 'ended'
         WHEN f.sale_status = 'available' AND (COALESCE(f.high_bid, 0) > 0 OR COALESCE(f.winning_bid, 0) > 0)
                                                                                              THEN 'ended'
         ELSE 'unknown'
    END,
    f.canonical_platform, f.source_url
  FROM f;
$function$;

CREATE OR REPLACE FUNCTION public.vehicle_price_signal(vehicle_ids uuid[])
 RETURNS TABLE(vehicle_id uuid, primary_label text, primary_value numeric, anchor_label text, anchor_value numeric, delta_amount numeric, delta_pct numeric, confidence integer, sources text[], missing_fields text[], updated_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH caller AS (
  SELECT auth.uid() AS uid
),
v AS (
  -- The owner's purchase price reaches the owner only (owner rule 2026-09-28): the owner, user, creator,
  -- uploader or a contributor with access. For everyone else it is absent from the signal (no PAID label,
  -- no PURCHASE anchor, no delta or confidence from it, not listed as missing), and a private vehicle
  -- returns no row.
  SELECT
    vh.id AS vehicle_id,
    NULLIF(vh.msrp, 0) AS msrp,
    NULLIF(vh.current_value, 0) AS current_value,
    CASE WHEN ins.insider THEN NULLIF(vh.purchase_price, 0) END AS purchase_price,
    NOT ins.insider AS purchase_masked,
    NULLIF(vh.asking_price, 0) AS asking_price,
    CASE WHEN public.vehicle_sale_price_untrusted(vh.id, vh.sale_price) THEN NULL ELSE NULLIF(vh.sale_price, 0) END AS sale_price,
    vh.is_for_sale,
    vh.updated_at
  FROM vehicles vh
  CROSS JOIN caller c
  CROSS JOIN LATERAL (
    SELECT CASE WHEN c.uid IS NULL THEN false
                ELSE coalesce(c.uid IN (vh.owner_id, vh.user_id, vh.created_by_user_id, vh.uploaded_by), false)
                     OR public.vehicle_user_has_access(vh.id, c.uid) END AS insider
  ) ins
  WHERE vh.id = ANY(vehicle_ids)
    AND (coalesce(vh.is_public, false) OR ins.insider)
),
sale AS (
  SELECT DISTINCT ON (vehicle_id)
    vehicle_id,
    COALESCE(
      NULLIF(NULLIF((metadata->'what'->>'sold_price')::numeric, 0), NULL),
      NULLIF(NULLIF((metadata->'what'->>'sale_price')::numeric, 0), NULL)
    ) AS sold_price,
    event_date::timestamptz AS sold_date
  FROM vehicle_timeline_events
  WHERE vehicle_id = ANY(vehicle_ids)
    AND (event_type IN ('ownership_transfer','auction_sale','sold') OR title ILIKE 'Sold%')
    AND ((metadata->'what' ? 'sold_price') OR (metadata->'what' ? 'sale_price'))
  ORDER BY vehicle_id, event_date DESC
),
live AS (
  SELECT DISTINCT ON (vehicle_id)
    vehicle_id,
    platform,
    listing_url,
    current_bid,
    end_date,
    COALESCE(updated_at, created_at) AS ts
  FROM external_listings
  WHERE vehicle_id = ANY(vehicle_ids)
    AND listing_status = 'active'
    AND current_bid IS NOT NULL
    AND current_bid > 0
    AND (end_date IS NULL OR end_date > NOW())
  ORDER BY
    vehicle_id,
    COALESCE(end_date, 'infinity'::timestamptz) ASC,
    COALESCE(updated_at, created_at) DESC
),
base AS (
  SELECT
    v.vehicle_id,
    v.msrp,
    v.current_value,
    v.purchase_price,
    v.asking_price,
    COALESCE(v.sale_price, sale.sold_price) AS sale_price,
    v.is_for_sale,
    sale.sold_date,
    live.current_bid AS live_bid,
    live.platform AS live_platform,
    live.listing_url AS live_listing_url,
    (v.sale_price IS NOT NULL) AS vehicle_sale_exists,
    (sale.sold_price IS NOT NULL) AS event_sale_exists,
    (live.current_bid IS NOT NULL) AS live_bid_exists,
    v.purchase_masked,
    v.updated_at
  FROM v
  LEFT JOIN sale ON sale.vehicle_id = v.vehicle_id
  LEFT JOIN live ON live.vehicle_id = v.vehicle_id
),
picked AS (
  SELECT
    b.*,
    CASE
      WHEN b.sale_price IS NOT NULL THEN 'SOLD'
      WHEN b.live_bid IS NOT NULL THEN 'BID'
      WHEN b.is_for_sale IS TRUE AND b.asking_price IS NOT NULL THEN 'ASK'
      WHEN b.current_value IS NOT NULL THEN 'EST'
      WHEN b.purchase_price IS NOT NULL THEN 'PAID'
      WHEN b.msrp IS NOT NULL THEN 'MSRP'
      ELSE NULL
    END AS primary_label,
    CASE
      WHEN b.sale_price IS NOT NULL THEN b.sale_price
      WHEN b.live_bid IS NOT NULL THEN b.live_bid
      WHEN b.is_for_sale IS TRUE AND b.asking_price IS NOT NULL THEN b.asking_price
      WHEN b.current_value IS NOT NULL THEN b.current_value
      WHEN b.purchase_price IS NOT NULL THEN b.purchase_price
      WHEN b.msrp IS NOT NULL THEN b.msrp
      ELSE NULL
    END AS primary_value,
    CASE
      WHEN b.purchase_price IS NOT NULL THEN 'PURCHASE'
      WHEN b.msrp IS NOT NULL THEN 'MSRP'
      ELSE NULL
    END AS anchor_label,
    CASE
      WHEN b.purchase_price IS NOT NULL THEN b.purchase_price
      WHEN b.msrp IS NOT NULL THEN b.msrp
      ELSE NULL
    END AS anchor_value
  FROM base b
)
SELECT
  p.vehicle_id,
  p.primary_label,
  p.primary_value,
  p.anchor_label,
  p.anchor_value,
  CASE WHEN p.primary_value IS NOT NULL AND p.anchor_value IS NOT NULL THEN p.primary_value - p.anchor_value END AS delta_amount,
  CASE WHEN p.primary_value IS NOT NULL AND p.anchor_value IS NOT NULL AND p.anchor_value <> 0 THEN ((p.primary_value - p.anchor_value)/p.anchor_value)*100 END AS delta_pct,
  GREATEST(
    0,
    (CASE
      WHEN p.primary_label = 'SOLD' THEN 40
      WHEN p.primary_label = 'BID' THEN 30
      WHEN p.primary_label IN ('ASK','EST') THEN 25
      ELSE 0
    END)
    + (CASE WHEN p.purchase_price IS NOT NULL THEN 10 ELSE 0 END)
    + (CASE WHEN p.msrp IS NOT NULL THEN 5 ELSE 0 END)
    + (CASE WHEN p.sold_date IS NOT NULL AND p.sold_date > NOW() - INTERVAL '365 days' THEN 10 ELSE 0 END)
  ) AS confidence,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN p.vehicle_sale_exists THEN 'vehicles.sale_price'::text END,
    CASE WHEN p.event_sale_exists THEN 'vehicle_timeline_events.sale'::text END,
    CASE WHEN p.live_bid_exists THEN 'external_listings.current_bid'::text END,
    CASE WHEN p.is_for_sale IS TRUE AND p.asking_price IS NOT NULL THEN 'vehicles.asking_price'::text END,
    CASE WHEN p.current_value IS NOT NULL THEN 'vehicles.current_value'::text END,
    CASE WHEN p.purchase_price IS NOT NULL THEN 'vehicles.purchase_price'::text END,
    CASE WHEN p.msrp IS NOT NULL THEN 'vehicles.msrp'::text END
  ], NULL) AS sources,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN p.purchase_price IS NULL AND NOT p.purchase_masked THEN 'purchase_price'::text END,
    CASE WHEN p.msrp IS NULL THEN 'msrp'::text END,
    CASE WHEN p.live_bid IS NULL THEN 'live_bid'::text END,
    CASE WHEN p.is_for_sale IS TRUE AND p.asking_price IS NULL THEN 'asking_price'::text END,
    CASE WHEN p.current_value IS NULL THEN 'current_value'::text END
  ], NULL) AS missing_fields,
  COALESCE(p.updated_at, NOW()) AS updated_at
FROM picked p;
$function$;

CREATE OR REPLACE FUNCTION public.popup_make_intel(p_make text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET statement_timeout TO '10s'
AS $function$
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM vehicles WHERE make = p_make AND is_public = true),
    'for_sale', (SELECT count(*) FROM vehicles WHERE make = p_make AND is_public = true AND is_for_sale = true),
    'recent_sales', (
      SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb ORDER BY sub.sale_date DESC NULLS LAST), '[]'::jsonb)
      FROM (
        SELECT id, year, model, sale_price, sale_date,
               primary_image_url as thumbnail, mileage,
               nuke_estimate, heat_score
        FROM vehicles
        WHERE make = p_make AND is_public = true
          AND sale_price > 0 AND (NOT EXISTS (SELECT 1 FROM public.vehicle_events g WHERE g.vehicle_id = vehicles.id AND g.price_verification IS NOT NULL) OR NOT public.vehicle_sale_price_untrusted(vehicles.id, vehicles.sale_price))
          AND sale_date > now() - interval '90 days'
        ORDER BY sale_date DESC NULLS LAST
        LIMIT 8
      ) sub
    ),
    'live_now', (
      SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb), '[]'::jsonb)
      FROM (
        SELECT id, year, model, 
               COALESCE(asking_price, current_value) as price,
               primary_image_url as thumbnail,
               discovery_source as source
        FROM vehicles
        WHERE make = p_make AND is_public = true AND is_for_sale = true
        ORDER BY created_at DESC
        LIMIT 4
      ) sub
    ),
    'top_models', (
      SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb ORDER BY sub.cnt DESC), '[]'::jsonb)
      FROM (
        SELECT model as label, count(*) as cnt,
               round(avg(sale_price) FILTER (WHERE sale_price > 0 AND (NOT EXISTS (SELECT 1 FROM public.vehicle_events g WHERE g.vehicle_id = vehicles.id AND g.price_verification IS NOT NULL) OR NOT public.vehicle_sale_price_untrusted(vehicles.id, vehicles.sale_price))))::int as avg_price,
               count(*) FILTER (WHERE is_for_sale = true) as for_sale
        FROM vehicles
        WHERE make = p_make AND is_public = true AND model IS NOT NULL
        GROUP BY model
        ORDER BY count(*) DESC
        LIMIT 12
      ) sub
    ),
    'sources', (
      SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb ORDER BY sub.cnt DESC), '[]'::jsonb)
      FROM (
        SELECT platform_source as label, count(*) as cnt
        FROM vehicles
        WHERE make = p_make AND is_public = true AND platform_source IS NOT NULL
        GROUP BY platform_source
        ORDER BY count(*) DESC
        LIMIT 6
      ) sub
    ),
    'price_scatter', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('y', year, 'p', sale_price))
      FROM (
        SELECT year, sale_price
        FROM vehicles
        WHERE make = p_make AND is_public = true
          AND sale_price > 0 AND (NOT EXISTS (SELECT 1 FROM public.vehicle_events g WHERE g.vehicle_id = vehicles.id AND g.price_verification IS NOT NULL) OR NOT public.vehicle_sale_price_untrusted(vehicles.id, vehicles.sale_price)) AND year > 1900
        ORDER BY random()
        LIMIT 200
      ) sub
    ), '[]'::jsonb)
  );
$function$;

CREATE OR REPLACE FUNCTION public.popup_model_intel(p_make text, p_model text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET statement_timeout TO '10s'
AS $function$
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM vehicles WHERE make = p_make AND model = p_model AND is_public = true),
    'for_sale', (SELECT count(*) FROM vehicles WHERE make = p_make AND model = p_model AND is_public = true AND is_for_sale = true),
    'recent_sales', (
      SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb ORDER BY sub.sale_date DESC NULLS LAST), '[]'::jsonb)
      FROM (
        SELECT id, year, make, model, sale_price, sale_date,
               primary_image_url, mileage, nuke_estimate
        FROM vehicles
        WHERE make = p_make AND model = p_model AND is_public = true
          AND sale_price > 0 AND (NOT EXISTS (SELECT 1 FROM public.vehicle_events g WHERE g.vehicle_id = vehicles.id AND g.price_verification IS NOT NULL) OR NOT public.vehicle_sale_price_untrusted(vehicles.id, vehicles.sale_price))
        ORDER BY sale_date DESC NULLS LAST
        LIMIT 6
      ) sub
    ),
    'live_now', (
      SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb), '[]'::jsonb)
      FROM (
        SELECT id, year, make, model,
               COALESCE(asking_price, current_value) as sale_price,
               primary_image_url, mileage, nuke_estimate
        FROM vehicles
        WHERE make = p_make AND model = p_model AND is_public = true AND is_for_sale = true
        ORDER BY created_at DESC
        LIMIT 4
      ) sub
    ),
    'price_scatter', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('y', year, 'p', sale_price))
      FROM (
        SELECT year, sale_price
        FROM vehicles
        WHERE make = p_make AND model = p_model AND is_public = true
          AND sale_price > 0 AND (NOT EXISTS (SELECT 1 FROM public.vehicle_events g WHERE g.vehicle_id = vehicles.id AND g.price_verification IS NOT NULL) OR NOT public.vehicle_sale_price_untrusted(vehicles.id, vehicles.sale_price)) AND year > 1900
        ORDER BY random()
        LIMIT 100
      ) sub
    ), '[]'::jsonb),
    'year_range', (
      SELECT jsonb_build_object(
        'min', min(year),
        'max', max(year)
      )
      FROM vehicles
      WHERE make = p_make AND model = p_model AND is_public = true AND year > 1900
    ),
    'sources', (
      SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb ORDER BY sub.cnt DESC), '[]'::jsonb)
      FROM (
        SELECT platform_source as label, count(*) as cnt
        FROM vehicles
        WHERE make = p_make AND model = p_model AND is_public = true AND platform_source IS NOT NULL
        GROUP BY platform_source
        ORDER BY count(*) DESC
        LIMIT 6
      ) sub
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.popup_source_intel(p_source text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET statement_timeout TO '14s'
AS $function$
DECLARE
  norm text;
  v_total bigint;
  v_for_sale bigint;
  v_sold_week bigint;
  v_sold_month bigint;
  v_recent jsonb;
  v_live jsonb;
  v_makes jsonb;
BEGIN
  -- Normalize source aliases
  norm := CASE
    WHEN lower(p_source) IN ('bat', 'bat_core', 'bat_import', 'bat_listing', 'bat_profile_extraction', 'bringatrailer') THEN 'bringatrailer'
    WHEN lower(p_source) IN ('c&b', 'carsandbids', 'cars-and-bids') THEN 'cars-and-bids'
    WHEN lower(p_source) IN ('fb', 'facebook', 'fb_marketplace', 'facebook_marketplace') THEN 'facebook_marketplace'
    WHEN lower(p_source) IN ('bj', 'barrett-jackson', 'barrettjackson') THEN 'barrett-jackson'
    WHEN lower(p_source) IN ('rm', 'rm-sothebys', 'rmsothebys') THEN 'rm-sothebys'
    WHEN lower(p_source) IN ('cl', 'craigslist') THEN 'craigslist'
    WHEN lower(p_source) IN ('classic', 'classic.com') THEN 'classic'
    WHEN lower(p_source) IN ('cc', 'collectingcars', 'collecting-cars') THEN 'collecting-cars'
    ELSE lower(p_source)
  END;

  -- Single scan for counts
  SELECT count(*),
         count(*) FILTER (WHERE is_for_sale = true),
         count(*) FILTER (WHERE sale_date > now() - interval '7 days' AND sale_price > 0 AND (NOT EXISTS (SELECT 1 FROM public.vehicle_events g WHERE g.vehicle_id = vehicles.id AND g.price_verification IS NOT NULL) OR NOT public.vehicle_sale_price_untrusted(vehicles.id, vehicles.sale_price))),
         count(*) FILTER (WHERE sale_date > now() - interval '30 days' AND sale_price > 0 AND (NOT EXISTS (SELECT 1 FROM public.vehicle_events g WHERE g.vehicle_id = vehicles.id AND g.price_verification IS NOT NULL) OR NOT public.vehicle_sale_price_untrusted(vehicles.id, vehicles.sale_price)))
  INTO v_total, v_for_sale, v_sold_week, v_sold_month
  FROM vehicles
  WHERE platform_source = norm AND is_public = true;

  -- Recent sales
  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb), '[]'::jsonb) INTO v_recent
  FROM (
    SELECT id, year, make, model, sale_price, sale_date, primary_image_url as thumbnail
    FROM vehicles WHERE platform_source = norm AND is_public = true AND sale_price > 0 AND (NOT EXISTS (SELECT 1 FROM public.vehicle_events g WHERE g.vehicle_id = vehicles.id AND g.price_verification IS NOT NULL) OR NOT public.vehicle_sale_price_untrusted(vehicles.id, vehicles.sale_price))
    ORDER BY sale_date DESC NULLS LAST LIMIT 6
  ) sub;

  -- Live now
  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb), '[]'::jsonb) INTO v_live
  FROM (
    SELECT id, year, make, model, COALESCE(asking_price, current_value) as price, primary_image_url as thumbnail
    FROM vehicles WHERE platform_source = norm AND is_public = true AND is_for_sale = true
    ORDER BY created_at DESC LIMIT 4
  ) sub;

  -- Top makes
  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb), '[]'::jsonb) INTO v_makes
  FROM (
    SELECT make as label, count(*) as cnt, count(*) FILTER (WHERE is_for_sale) as for_sale
    FROM vehicles WHERE platform_source = norm AND is_public = true AND make IS NOT NULL
    GROUP BY make ORDER BY count(*) DESC LIMIT 8
  ) sub;

  RETURN jsonb_build_object(
    'total', v_total,
    'for_sale', v_for_sale,
    'sold_this_week', v_sold_week,
    'sold_this_month', v_sold_month,
    'recent_sales', v_recent,
    'live_now', v_live,
    'top_makes', v_makes
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_make_model_terminal(p_make text, p_model text, p_year integer DEFAULT NULL::integer, p_grain text DEFAULT 'year'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_subject uuid; v_ids uuid[]; v_count int; v_canon_model text;
  v_price jsonb; v_flow jsonb; v_sentiment jsonb; v_production jsonb;
  v_survival jsonb; v_comps jsonb; v_dealers jsonb; v_cited jsonb; v_points jsonb;
BEGIN
  SELECT cm.canonical_model INTO v_canon_model FROM public.canonical_models cm
  WHERE lower(cm.make) = lower(p_make)
    AND (lower(cm.canonical_model) = lower(p_model) OR lower(p_model) = ANY (SELECT lower(a) FROM unnest(cm.aliases) a))
  LIMIT 1;
  v_canon_model := COALESCE(v_canon_model, p_model);

  SELECT subject_id INTO v_subject FROM public.make_model_profiles
   WHERE lower(canonical_make) = lower(p_make) AND lower(canonical_model) = lower(v_canon_model)
     AND grain = p_grain AND (p_grain <> 'year' OR year = p_year) LIMIT 1;
  IF v_subject IS NULL THEN
    RETURN jsonb_build_object('resolved', false,
      'note', 'No make_model subject registered yet — call register_make_model_subject(). Absence is an intake gap, not a market verdict.');
  END IF;

  -- definer: the cohort is what a visitor may see (public, not deleted), stated here instead of left to row
  -- security, whose per-row checks on vehicles pushed the visitor call past the 15 s limit (2026-09-28)
  SELECT array_agg(cm.vehicle_id) INTO v_ids
  FROM public.cohort_members(v_subject) cm JOIN public.vehicles v ON v.id = cm.vehicle_id
  WHERE v.is_public AND v.deleted_at IS NULL;
  v_count := COALESCE(array_length(v_ids, 1), 0);

  SELECT jsonb_build_object('populated', count(*) > 0, 'source', 'vehicle_events.final_price',
           'method', 'cohort_aggregate', 'n', count(*),
           'median', percentile_cont(0.5) WITHIN GROUP (ORDER BY ve.final_price),
           'p25', percentile_cont(0.25) WITHIN GROUP (ORDER BY ve.final_price),
           'p75', percentile_cont(0.75) WITHIN GROUP (ORDER BY ve.final_price),
           'min', min(ve.final_price), 'max', max(ve.final_price), 'observed_at', now())
    INTO v_price FROM public.vehicle_events ve
  WHERE ve.vehicle_id = ANY (v_ids) AND ve.final_price IS NOT NULL AND ve.final_price > 0
    AND ve.price_verification IS DISTINCT FROM 'unverified' AND ve.price_verification IS DISTINCT FROM 'contradicted' AND ve.sale_truth_role IS DISTINCT FROM 'duplicate';

  SELECT jsonb_build_object('populated', count(*) > 0, 'source', 'vehicle_events', 'method', 'quarterly_flow',
           'series', COALESCE(jsonb_agg(jsonb_build_object('quarter', q, 'sales', n, 'median_price', med) ORDER BY q), '[]'::jsonb))
    INTO v_flow FROM (
    SELECT date_trunc('quarter', COALESCE(ve.sold_at, ve.ended_at)) AS q, count(*) AS n,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY ve.final_price) AS med
    FROM public.vehicle_events ve WHERE ve.vehicle_id = ANY (v_ids)
      AND COALESCE(ve.sold_at, ve.ended_at) IS NOT NULL AND ve.final_price IS NOT NULL AND ve.final_price > 0
    AND ve.price_verification IS DISTINCT FROM 'unverified' AND ve.price_verification IS DISTINCT FROM 'contradicted' AND ve.sale_truth_role IS DISTINCT FROM 'duplicate'
    GROUP BY 1) s;

  -- price_points: the HONEST full set — every priced cohort sale, UNCAPPED, source + date(-exact?).
  SELECT jsonb_build_object('populated', count(*) > 0, 'source', 'vehicle_events.final_price (uncapped per-sale)',
           'n', count(*), 'n_dated', count(*) FILTER (WHERE date_exact),
           'points', COALESCE(jsonb_agg(jsonb_build_object('vehicle_id', vehicle_id, 'price', price, 'date', d,
                       'date_exact', date_exact, 'source', source, 'miles', miles, 'url', url) ORDER BY price), '[]'::jsonb))
    INTO v_points FROM (
    SELECT ve.vehicle_id, ve.final_price AS price,
           COALESCE(ve.sold_at, ve.ended_at, ve.created_at)::date AS d,
           (ve.sold_at IS NOT NULL OR ve.ended_at IS NOT NULL) AS date_exact,
           ve.source_platform AS source, v.mileage AS miles, ve.source_url AS url
    FROM public.vehicle_events ve JOIN public.vehicles v ON v.id = ve.vehicle_id
    WHERE ve.vehicle_id = ANY (v_ids) AND ve.final_price IS NOT NULL AND ve.final_price > 0
    AND ve.price_verification IS DISTINCT FROM 'unverified' AND ve.price_verification IS DISTINCT FROM 'contradicted' AND ve.sale_truth_role IS DISTINCT FROM 'duplicate'
    ORDER BY ve.final_price) pts;

  SELECT jsonb_build_object('populated', count(cd.sentiment_score) > 0, 'source', 'comment_discoveries',
           'method', 'cohort_avg', 'avg_sentiment_score', avg(cd.sentiment_score), 'n', count(cd.sentiment_score), 'observed_at', now())
    INTO v_sentiment FROM public.comment_discoveries cd WHERE cd.vehicle_id = ANY (v_ids);

  SELECT jsonb_build_object('populated', count(*) > 0, 'source', 'vehicle_events.seller_identifier', 'method', 'top_sellers_in_cohort',
           'top', COALESCE(jsonb_agg(jsonb_build_object('seller', seller_identifier, 'events', n, 'median_price', med) ORDER BY n DESC), '[]'::jsonb))
    INTO v_dealers FROM (
    SELECT ve.seller_identifier, count(*) AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY ve.final_price) AS med
    FROM public.vehicle_events ve WHERE ve.vehicle_id = ANY (v_ids) AND ve.seller_identifier IS NOT NULL AND ve.seller_identifier <> ''
    GROUP BY ve.seller_identifier ORDER BY count(*) DESC LIMIT 10) d;

  SELECT jsonb_build_object(
           'populated', count(*) FILTER (WHERE cited) > 0,
           'source', 'vehicle_production_data',
           'total_produced', max(total_produced) FILTER (WHERE cited),
           'min_produced', min(total_produced) FILTER (WHERE cited),
           'max_produced', max(total_produced) FILTER (WHERE cited),
           'rarity_level', (array_agg(rarity_level ORDER BY total_produced DESC) FILTER (WHERE cited))[1],
           'verified', bool_or(cited),
           'source_url', (array_agg(source_url ORDER BY total_produced DESC) FILTER (WHERE cited))[1],
           'n_cited', count(*) FILTER (WHERE cited),
           'has_uncited_claims', COALESCE(bool_or(NOT cited), false))
    INTO v_production FROM (
      SELECT vp.total_produced, vp.rarity_level, vp.source_url,
             (vp.source_url IS NOT NULL AND COALESCE(vp.quarantined, false) = false) AS cited
      FROM public.vehicle_production_data vp
      WHERE lower(vp.make) = lower(p_make)
        AND (lower(vp.model) = lower(v_canon_model) OR lower(vp.model) = lower(p_model))
        AND vp.year = p_year
    ) q;

  SELECT jsonb_build_object('populated', sre.survival_rate IS NOT NULL, 'source', 'survival_rate_estimates',
           'survival_rate', sre.survival_rate, 'estimated_surviving', sre.estimated_surviving,
           'confidence', sre.confidence_score, 'floor_known_members', v_count,
           'note', 'survival_rate_estimates is sparse; member count is a lower-bound floor, not the estimate.')
    INTO v_survival FROM public.survival_rate_estimates sre
  WHERE lower(sre.make) = lower(p_make) AND lower(sre.model) = lower(p_model)
    AND COALESCE(p_year, sre.year_start) BETWEEN sre.year_start AND sre.year_end LIMIT 1;

  -- comps: full cohort sold set (UNCAPPED), priciest first. The client paginates/virtualizes.
  SELECT jsonb_build_object('populated', count(*) > 0, 'source', 'vehicle_events (cohort sold)', 'n', count(*),
           'rows', COALESCE(jsonb_agg(jsonb_build_object('vehicle_id', vehicle_id, 'year', yr, 'make', mk, 'model', mdl, 'trim', tr,
                     'sale_price', sale_price, 'miles', miles, 'platform', platform, 'sold_date', sold_date,
                     'listing_url', listing_url, 'image_url', image_url) ORDER BY sale_price DESC NULLS LAST), '[]'::jsonb))
    INTO v_comps FROM (
    SELECT ve.vehicle_id, v.year AS yr, v.make AS mk, v.model AS mdl, v.trim AS tr, ve.final_price AS sale_price,
           v.mileage AS miles, ve.source_platform AS platform, COALESCE(ve.sold_at, ve.ended_at) AS sold_date,
           ve.source_url AS listing_url, v.primary_image_url AS image_url
    FROM public.vehicle_events ve JOIN public.vehicles v ON v.id = ve.vehicle_id
    WHERE ve.vehicle_id = ANY (v_ids) AND ve.final_price IS NOT NULL AND ve.final_price > 0
    AND ve.price_verification IS DISTINCT FROM 'unverified' AND ve.price_verification IS DISTINCT FROM 'contradicted' AND ve.sale_truth_role IS DISTINCT FROM 'duplicate'
      AND COALESCE(ve.sold_at, ve.ended_at) IS NOT NULL ORDER BY ve.final_price DESC) c;

  -- projection_event has no read policy: only the service role (and direct database sessions) ever saw these
  -- rows. Running as definer must not widen that, so cited fields stay empty for everyone else.
  IF coalesce(auth.role(), 'service_role') = 'service_role' THEN
    SELECT jsonb_agg(public.project_attribute(v_subject, attr) ORDER BY attr) INTO v_cited FROM (
      SELECT DISTINCT request_envelope->>'attribute' AS attr FROM public.projection_event
      WHERE request_envelope->>'subject_id' = v_subject::text AND request_envelope->>'subject_kind' = 'make_model' AND retracted_at IS NULL) a;
  END IF;

  RETURN jsonb_build_object('resolved', true, 'subject_id', v_subject,
    'cohort', jsonb_build_object('make', p_make, 'model', COALESCE(v_canon_model, p_model), 'year', p_year, 'grain', p_grain),
    'cohort_count', jsonb_build_object('populated', v_count > 0, 'value', v_count, 'source', 'cohort_members'),
    'price_distribution', COALESCE(v_price, jsonb_build_object('populated', false)),
    'price_points', COALESCE(v_points, jsonb_build_object('populated', false)),
    'market_flow', COALESCE(v_flow, jsonb_build_object('populated', false)),
    'sentiment', COALESCE(v_sentiment, jsonb_build_object('populated', false)),
    'dealer_flow', COALESCE(v_dealers, jsonb_build_object('populated', false)),
    'production', COALESCE(v_production, jsonb_build_object('populated', false)),
    'survival', COALESCE(v_survival, jsonb_build_object('populated', false, 'floor_known_members', v_count)),
    'comps', COALESCE(v_comps, jsonb_build_object('populated', false)),
    'cited_fields', COALESCE(v_cited, '[]'::jsonb),
    'note', 'Cohort terminal: live aggregates ASSEMBLED from substrate + curated fields PROJECTED. populated=false is an intake gap.');
END;
$function$;
DROP FUNCTION IF EXISTS public.vehicle_sale_price_fx_usd(numeric, text, date);
ALTER TABLE public.vehicles
  DROP CONSTRAINT IF EXISTS vehicles_sale_price_usd_required,
  DROP CONSTRAINT IF EXISTS vehicles_sale_price_currency_iso,
  DROP COLUMN IF EXISTS sale_price_fx_source,
  DROP COLUMN IF EXISTS sale_price_fx_date,
  DROP COLUMN IF EXISTS sale_price_fx_rate,
  DROP COLUMN IF EXISTS sale_price_usd,
  DROP COLUMN IF EXISTS sale_price_currency;
