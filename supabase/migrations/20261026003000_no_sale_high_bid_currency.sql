-- High bids on house-confirmed no-sales get a first-class currency, FX rate (+source) and USD value on vehicle_events.
-- record_vehicle_event_no_sale gains p_high_bid_currency (default 'USD'); non-USD bids are converted with fx_usd_rate
-- on the sale date. final_price stays the native-currency high bid; vehicles.high_bid receives the USD value.
-- Also revokes PUBLIC execute on this SECURITY DEFINER writer (service_role only).
ALTER TABLE public.vehicle_events
  ADD COLUMN IF NOT EXISTS high_bid_currency text,
  ADD COLUMN IF NOT EXISTS high_bid_fx_to_usd numeric,
  ADD COLUMN IF NOT EXISTS high_bid_fx_source text,
  ADD COLUMN IF NOT EXISTS high_bid_usd numeric;
ALTER TABLE public.vehicle_events DROP CONSTRAINT IF EXISTS vehicle_events_high_bid_currency_iso;
ALTER TABLE public.vehicle_events ADD CONSTRAINT vehicle_events_high_bid_currency_iso
  CHECK (high_bid_currency IS NULL OR high_bid_currency ~ '^[A-Z]{3}$') NOT VALID;
COMMENT ON COLUMN public.vehicle_events.high_bid_currency IS 'ISO currency of final_price when price_kind = high_bid_unsold';
COMMENT ON COLUMN public.vehicle_events.high_bid_usd IS 'High bid (no-sale) in USD = final_price * high_bid_fx_to_usd';

-- Backfill existing USD no-sale high bids recorded by the function.
UPDATE public.vehicle_events SET high_bid_currency = 'USD', high_bid_fx_to_usd = 1, high_bid_fx_source = 'USD (no conversion)',
  high_bid_usd = final_price
WHERE price_kind = 'high_bid_unsold' AND final_price IS NOT NULL AND high_bid_currency IS NULL
  AND metadata ? 'no_sale_corrections' AND upper(COALESCE(currency_code, 'USD')) = 'USD';

DROP FUNCTION IF EXISTS public.record_vehicle_event_no_sale(uuid, text, numeric, text, text, date);
CREATE FUNCTION public.record_vehicle_event_no_sale(
  p_event_id uuid,
  p_house_citation text,
  p_high_bid numeric,
  p_high_bid_source text,
  p_run_id text,
  p_ended_on date DEFAULT NULL,
  p_high_bid_currency text DEFAULT 'USD')
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
  v_cur     text := upper(COALESCE(p_high_bid_currency, 'USD'));
  v_fx      record;
  v_fx_rate numeric;
  v_fx_src  text;
  v_usd     numeric;
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

  IF v_cur !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'record_vehicle_event_no_sale: p_high_bid_currency must be an ISO 4217 code, got %', p_high_bid_currency;
  END IF;

  SELECT * INTO v_ev FROM vehicle_events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'record_vehicle_event_no_sale: event % not found', p_event_id;
  END IF;
  IF v_ev.event_status = 'unsold' AND v_ev.final_price IS NOT DISTINCT FROM p_high_bid
     AND v_ev.high_bid_currency IS NOT DISTINCT FROM (CASE WHEN p_high_bid IS NULL THEN NULL ELSE v_cur END)
     AND v_ev.price_verification = 'verified' THEN
    RETURN jsonb_build_object('ok', true, 'noop', true, 'event_id', p_event_id);
  END IF;

  v_ended := COALESCE(p_ended_on::timestamptz, v_ev.ended_at, v_ev.sold_at);

  IF p_high_bid IS NOT NULL THEN
    IF v_cur = 'USD' THEN
      v_fx_rate := 1; v_fx_src := 'USD (no conversion)';
    ELSE
      IF v_ended IS NULL THEN
        RAISE EXCEPTION 'record_vehicle_event_no_sale: a % high bid needs a sale date (p_ended_on) for FX', v_cur;
      END IF;
      SELECT * INTO v_fx FROM fx_usd_rate(v_cur, v_ended::date);
      IF v_fx.rate IS NULL THEN
        RAISE EXCEPTION 'record_vehicle_event_no_sale: no % USD rate on or before %', v_cur, v_ended::date;
      END IF;
      v_fx_rate := v_fx.rate;
      v_fx_src := v_fx.source || ' (' || v_fx.rate_date || ') ' || COALESCE(v_fx.source_url, '');
    END IF;
    v_usd := round(p_high_bid * v_fx_rate, 2);
  END IF;

  UPDATE vehicle_events SET
    event_status = 'unsold',
    final_price = p_high_bid,
    high_bid_currency = CASE WHEN p_high_bid IS NULL THEN NULL ELSE v_cur END,
    high_bid_fx_to_usd = v_fx_rate,
    high_bid_fx_source = v_fx_src,
    high_bid_usd = v_usd,
    price_kind = 'high_bid_unsold',
    price_kind_source = 'record_vehicle_event_no_sale ' || p_run_id || ': ' || p_house_citation,
    price_verification = 'verified',
    price_verification_source = 'house-confirmed no sale: ' || p_house_citation
      || COALESCE('; high bid ' || v_cur || ' ' || p_high_bid::text || ': ' || p_high_bid_source, '; high bid not published'),
    price_verification_run_id = p_run_id,
    price_verification_at = now(),
    ended_at = v_ended,
    sold_at = NULL,
    hammer_price = NULL, gross_price = NULL, buyer_premium_amount = NULL, net_to_owner = NULL,
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('no_sale_corrections',
      COALESCE(metadata -> 'no_sale_corrections', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'run_id', p_run_id, 'at', now(), 'house_citation', p_house_citation, 'high_bid', p_high_bid, 'high_bid_currency', v_cur, 'high_bid_usd', v_usd,
        'high_bid_source', p_high_bid_source,
        'original', jsonb_build_object('event_status', v_ev.event_status, 'final_price', v_ev.final_price,
          'sold_at', v_ev.sold_at, 'ended_at', v_ev.ended_at, 'price_kind', v_ev.price_kind,
          'price_kind_source', v_ev.price_kind_source, 'price_verification', v_ev.price_verification,
          'price_verification_source', v_ev.price_verification_source,
          'price_verification_run_id', v_ev.price_verification_run_id, 'price_verification_at', v_ev.price_verification_at,
          'hammer_price', v_ev.hammer_price, 'gross_price', v_ev.gross_price,
          'buyer_premium_amount', v_ev.buyer_premium_amount, 'net_to_owner', v_ev.net_to_owner,
          'high_bid_currency', v_ev.high_bid_currency, 'high_bid_fx_to_usd', v_ev.high_bid_fx_to_usd,
          'high_bid_fx_source', v_ev.high_bid_fx_source, 'high_bid_usd', v_ev.high_bid_usd)))),
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
        v_corr := v_corr || jsonb_build_object('high_bid', jsonb_build_object('value', round(v_usd)));
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
    'high_bid', p_high_bid, 'high_bid_currency', v_cur, 'high_bid_fx_to_usd', v_fx_rate,
    'high_bid_usd', v_usd, 'vehicle_correction', v_vres);
END;
$function$;


COMMENT ON FUNCTION public.record_vehicle_event_no_sale(uuid, text, numeric, text, text, date, text) IS
  'Record a house-confirmed no-sale on a vehicle_events row (event_status unsold, final_price = cited high bid in p_high_bid_currency, high_bid_usd via fx_usd_rate). Reversible from metadata.no_sale_corrections.';
REVOKE ALL ON FUNCTION public.record_vehicle_event_no_sale(uuid, text, numeric, text, text, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_vehicle_event_no_sale(uuid, text, numeric, text, text, date, text) TO service_role;
