-- First-class house-confirmed no-sale on vehicle_events. Aggregators (conceptcarz) list unsold lots with an estimate or
-- a bid as if sold. When the auction house's own lot page says "Not Sold", the event becomes event_status 'unsold',
-- price_kind 'high_bid_unsold', final_price = the high bid (NULL when unpublished), price_verification 'verified'
-- citing the house page, sold_at moved to ended_at. The prior values are kept in metadata.no_sale_corrections.
-- When the vehicle's sale_price was that same figure (and no other sold event carries it), the vehicle is corrected
-- through correct_vehicle_sale_provenance_batch: sale_price NULL, high_bid, and (if this is its latest event)
-- sale_status 'unsold' / auction_outcome 'no_sale'.
CREATE OR REPLACE FUNCTION public.record_vehicle_event_no_sale(
  p_event_id uuid,
  p_house_citation text,
  p_high_bid numeric,
  p_high_bid_source text,
  p_run_id text,
  p_ended_on date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ev      vehicle_events%ROWTYPE;
  v_veh     vehicles%ROWTYPE;
  v_ended   timestamptz;
  v_latest  boolean;
  v_corr    jsonb := '{}'::jsonb;
  v_vres    jsonb;
BEGIN
  IF p_house_citation IS NULL OR p_house_citation !~ 'https?://' THEN
    RAISE EXCEPTION 'record_vehicle_event_no_sale: p_house_citation must cite the house lot page (URL) that says not sold';
  END IF;
  IF p_run_id IS NULL OR p_run_id = '' THEN
    RAISE EXCEPTION 'record_vehicle_event_no_sale: p_run_id is required';
  END IF;
  IF p_high_bid IS NOT NULL AND (p_high_bid <= 0 OR p_high_bid_source IS NULL OR p_high_bid_source = '') THEN
    RAISE EXCEPTION 'record_vehicle_event_no_sale: a high bid must be positive and cited (p_high_bid_source)';
  END IF;

  SELECT * INTO v_ev FROM vehicle_events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'record_vehicle_event_no_sale: event % not found', p_event_id;
  END IF;
  IF v_ev.event_status = 'unsold' AND v_ev.final_price IS NOT DISTINCT FROM p_high_bid
     AND v_ev.price_verification = 'verified' THEN
    RETURN jsonb_build_object('ok', true, 'noop', true, 'event_id', p_event_id);
  END IF;

  v_ended := COALESCE(p_ended_on::timestamptz, v_ev.ended_at, v_ev.sold_at);

  UPDATE vehicle_events SET
    event_status = 'unsold',
    final_price = p_high_bid,
    price_kind = 'high_bid_unsold',
    price_kind_source = 'record_vehicle_event_no_sale ' || p_run_id || ': ' || p_house_citation,
    price_verification = 'verified',
    price_verification_source = 'house-confirmed no sale: ' || p_house_citation
      || COALESCE('; high bid ' || p_high_bid::text || ': ' || p_high_bid_source, '; high bid not published'),
    price_verification_run_id = p_run_id,
    price_verification_at = now(),
    ended_at = v_ended,
    sold_at = NULL,
    hammer_price = NULL, gross_price = NULL, buyer_premium_amount = NULL, net_to_owner = NULL,
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('no_sale_corrections',
      COALESCE(metadata -> 'no_sale_corrections', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'run_id', p_run_id, 'at', now(), 'house_citation', p_house_citation, 'high_bid', p_high_bid,
        'high_bid_source', p_high_bid_source,
        'original', jsonb_build_object('event_status', v_ev.event_status, 'final_price', v_ev.final_price,
          'sold_at', v_ev.sold_at, 'ended_at', v_ev.ended_at, 'price_kind', v_ev.price_kind,
          'price_kind_source', v_ev.price_kind_source, 'price_verification', v_ev.price_verification,
          'price_verification_source', v_ev.price_verification_source,
          'price_verification_run_id', v_ev.price_verification_run_id, 'price_verification_at', v_ev.price_verification_at,
          'hammer_price', v_ev.hammer_price, 'gross_price', v_ev.gross_price,
          'buyer_premium_amount', v_ev.buyer_premium_amount, 'net_to_owner', v_ev.net_to_owner)))),
    updated_at = now()
  WHERE id = p_event_id;

  IF v_ev.vehicle_id IS NOT NULL THEN
    SELECT * INTO v_veh FROM vehicles WHERE id = v_ev.vehicle_id;
    IF FOUND AND v_veh.sale_price IS NOT NULL AND v_ev.final_price IS NOT NULL
       AND v_veh.sale_price::numeric = v_ev.final_price
       AND NOT EXISTS (SELECT 1 FROM vehicle_events o WHERE o.vehicle_id = v_ev.vehicle_id AND o.id <> p_event_id
                         AND o.event_status = 'sold' AND o.final_price = v_veh.sale_price
                         AND o.price_verification IS DISTINCT FROM 'contradicted'
                         AND o.sale_truth_role IS DISTINCT FROM 'duplicate') THEN
      v_latest := NOT EXISTS (SELECT 1 FROM vehicle_events o WHERE o.vehicle_id = v_ev.vehicle_id AND o.id <> p_event_id
                         AND o.sale_truth_role IS DISTINCT FROM 'duplicate'
                         AND COALESCE(o.sold_at, o.ended_at) > v_ended);
      v_corr := jsonb_build_object('sale_price', jsonb_build_object('value', NULL, 'expected', v_veh.sale_price));
      IF p_high_bid IS NOT NULL THEN
        v_corr := v_corr || jsonb_build_object('high_bid', jsonb_build_object('value', round(p_high_bid)));
      END IF;
      IF v_latest THEN
        v_corr := v_corr || jsonb_build_object('sale_status', jsonb_build_object('value', 'unsold'),
                                               'auction_outcome', jsonb_build_object('value', 'no_sale'));
      END IF;
      v_vres := correct_vehicle_sale_provenance_batch(jsonb_build_array(jsonb_build_object(
        'vehicle_id', v_ev.vehicle_id,
        'reason', 'house-confirmed no sale on event ' || p_event_id || ' (' || p_run_id || ')',
        'source', jsonb_build_object('type', 'house_no_sale', 'ref', p_house_citation, 'event_id', p_event_id,
                                     'run_id', p_run_id, 'high_bid_source', p_high_bid_source),
        'corrections', v_corr)),
        'record_vehicle_event_no_sale', 'a no-sale is not a sale price');
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'event_id', p_event_id, 'vehicle_id', v_ev.vehicle_id,
    'original_status', v_ev.event_status, 'original_final_price', v_ev.final_price,
    'high_bid', p_high_bid, 'vehicle_correction', v_vres);
END;
$function$;

COMMENT ON FUNCTION public.record_vehicle_event_no_sale(uuid, text, numeric, text, text, date) IS
  'Record a house-confirmed no-sale on a vehicle_events row (event_status unsold, final_price = cited high bid). Reversible from metadata.no_sale_corrections.';
